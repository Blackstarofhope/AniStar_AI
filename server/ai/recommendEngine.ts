import {
  createNetwork, trainStep, applyEWCCorrection, infer, getTotalNeurons, createCorruptedInput,
  deserializeNetwork, serializeNetwork, type FFNetworkState
} from "./forwardForward.js";
import {
  createKuramotoSystem, stepKuramoto, synchronyIndex,
  updateCouplingFromGoodness, phaseModulatedEmbedding,
  alignVisionPhasesToEmbedding, updateOrderHistory, type KuramotoState
} from "./kuramoto.js";
import {
  createNeurogenesisState, checkNeurogenesis, syncNeurogenesisState,
  type NeurogenesisState
} from "./neurogenesis.js";
import {
  createEWCState, computeFisher, ewcPenalty, addToReplay, sampleReplay,
  getReplayStats, type EWCState, type ReplayEntry
} from "./ewc.js";
import {
  embedAnime, buildUserPreferenceVector, tfidfWeight,
  buildTFIDFContext, tfidfWeightWithContext, EMBEDDING_DIM,
  type AnimeInfo
} from "./textEmbedder.js";
import { verifyArtwork, type VerificationResult } from "./visionVerifier.js";
import {
  loadModelState, saveModelState, type ModelState
} from "./modelStore.js";
import { cosineSim, normalize } from "./matrix.js";
import { getAllCurrentAnime, type AnimeScheduleItem } from "./animeData.js";

const LAYER_SIZES = [EMBEDDING_DIM, 96, 48, 24];
const KURAMOTO_SIZE = 96;

export interface Recommendation {
  mal_id: number;
  title: string;
  imageUrl: string;
  confidence: number;
  artworkVerified: boolean;
  artworkScore: number;
  genres: string[];
  score?: number;
  episodes?: number;
  broadcast?: { day?: string; time?: string };
}

export interface AIStatus {
  epoch: number;
  totalNeurons: number;
  kuramotoSyncIndex: number;
  ewcPenalty: number;
  replayBufferSize: number;
  replayBufferCapacity: number;
  goodnessHistory: number[];
  isTraining: boolean;
  neurogenesisGrowthEvents: number;
  neurogenesisPruneEvents: number;
  couplingStrength: number;
}

interface EngineState {
  network: FFNetworkState;
  kuramoto: KuramotoState;
  neurogenesis: NeurogenesisState;
  ewc: EWCState;
  ratings: { animeId: number; embedding: number[]; rating: number; timestamp: number }[];
  allAnimeEmbeddings: { animeId: number; embedding: number[] }[];
  isTraining: boolean;
  restTrainedAt: number | null;
}

let engine: EngineState | null = null;

function initEngine(): EngineState {
  const saved = loadModelState();

  if (saved) {
    return {
      network: deserializeNetwork(saved.network),
      kuramoto: saved.kuramoto,
      neurogenesis: saved.neurogenesis,
      ewc: saved.ewc,
      ratings: saved.ratings || [],
      allAnimeEmbeddings: saved.allAnimeEmbeddings || [],
      isTraining: false,
      restTrainedAt: saved.restTrainedAt ?? null,
    };
  }

  return {
    network: createNetwork(LAYER_SIZES),
    kuramoto: createKuramotoSystem(KURAMOTO_SIZE),
    neurogenesis: createNeurogenesisState(LAYER_SIZES.length - 1),
    ewc: createEWCState(),
    ratings: [],
    allAnimeEmbeddings: [],
    isTraining: false,
    restTrainedAt: null,
  };
}

function getEngine(): EngineState {
  if (!engine) {
    engine = initEngine();
  }
  return engine;
}

function persistEngine(eng: EngineState): void {
  const state: ModelState = {
    version: 2,
    network: deserializeNetwork(serializeNetwork(eng.network) as FFNetworkState),
    kuramoto: eng.kuramoto,
    neurogenesis: eng.neurogenesis,
    ewc: eng.ewc,
    ratings: eng.ratings,
    allAnimeEmbeddings: eng.allAnimeEmbeddings,
    restTrainedAt: eng.restTrainedAt ?? undefined,
    savedAt: new Date().toISOString(),
  };
  saveModelState(state);
}

function buildRecommendationItem(
  anime: AnimeScheduleItem,
  score: number,
  verification: { verified: boolean; score: number; visionEmbedding: number[] }
): Recommendation {
  const imageUrl = anime.images?.jpg?.large_image_url || "";
  const artworkBoost = verification.verified ? 1.05 : 0.95;
  const finalConfidence = Math.min(1, Math.max(0, score * artworkBoost));
  return {
    mal_id: anime.mal_id,
    title: anime.title,
    imageUrl,
    confidence: Math.round(finalConfidence * 100) / 100,
    artworkVerified: verification.verified,
    artworkScore: verification.score,
    genres: (anime.genres || []).map((g) => g.name),
    score: anime.score,
    episodes: anime.episodes,
    broadcast: anime.broadcast,
  };
}

const UNVERIFIED: { verified: boolean; score: number; visionEmbedding: number[] } = { verified: false, score: 0, visionEmbedding: [] };

function scoreAnimeList(
  eng: ReturnType<typeof getEngine>,
  animeList: AnimeScheduleItem[],
  userPref: number[],
  limit: number
): { anime: AnimeScheduleItem; score: number; embedding: number[] }[] {
  const scored: { anime: AnimeScheduleItem; score: number; embedding: number[] }[] = [];

  const embeddingCache = new Map<number, number[]>(
    eng.allAnimeEmbeddings.map((e) => [e.animeId, e.embedding])
  );

  const ctx = buildTFIDFContext(animeList as AnimeInfo[]);

  for (const anime of animeList) {
    try {
      let embedding = embeddingCache.get(anime.mal_id);
      if (!embedding) {
        embedding = tfidfWeightWithContext(ctx, anime as AnimeInfo);
        embeddingCache.set(anime.mal_id, embedding);
        eng.allAnimeEmbeddings.push({ animeId: anime.mal_id, embedding });
        if (eng.allAnimeEmbeddings.length > 2000) eng.allAnimeEmbeddings.shift();
      }

      const modulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
      const finalEmbedding = normalize(modulated);
      const ffScore = infer(eng.network, finalEmbedding);
      const cosSim = cosineSim(finalEmbedding, userPref);
      const combinedScore = 0.6 * Math.tanh(ffScore / 5) + 0.4 * (cosSim + 1) / 2;
      scored.push({ anime, score: combinedScore, embedding });
    } catch {
      continue;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function getRecommendations(limit = 10, deadlineMs = 12000): Promise<Recommendation[]> {
  const eng = getEngine();
  const deadline = Date.now() + deadlineMs;

  const partialResults: Recommendation[] = [];

  const coreWork = async (): Promise<Recommendation[]> => {
    const animeList = await getAllCurrentAnime();
    if (animeList.length === 0) return [];

    const userPref = buildUserPreferenceVector(
      eng.ratings.map((r) => ({ embedding: r.embedding, rating: r.rating }))
    );

    const topAnime = scoreAnimeList(eng, animeList, userPref, limit);

    for (const { anime, score } of topAnime) {
      partialResults.push(buildRecommendationItem(anime, score, UNVERIFIED));
    }

    const verificationMap = new Map<number, { verified: boolean; score: number; visionEmbedding: number[] }>();

    const verificationPromises = topAnime.map(async ({ anime }) => {
      try {
        const v = await verifyArtwork(anime.mal_id, anime.images?.jpg?.large_image_url || "", anime.title);
        verificationMap.set(anime.mal_id, { ...v, visionEmbedding: v.visionEmbedding ?? [] });
        if (v.visionEmbedding && v.visionEmbedding.length > 0) {
          alignVisionPhasesToEmbedding(eng.kuramoto, v.visionEmbedding);
        }
      } catch {
        verificationMap.set(anime.mal_id, UNVERIFIED);
      }
    });

    const verifyRemaining = deadline - Date.now();
    if (verifyRemaining > 0) {
      await Promise.race([
        Promise.all(verificationPromises),
        new Promise<void>((resolve) => setTimeout(resolve, verifyRemaining)),
      ]);
    }

    const recommendations: Recommendation[] = [];
    for (const { anime, score } of topAnime) {
      try {
        const verification = verificationMap.get(anime.mal_id) ?? UNVERIFIED;
        recommendations.push(buildRecommendationItem(anime, score, verification));
      } catch {
        continue;
      }
    }

    stepKuramoto(eng.kuramoto, 3);
    updateOrderHistory(eng.kuramoto);

    return recommendations;
  };

  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  let resolved = false;

  const timeoutGuard = new Promise<Recommendation[]>((resolve) => {
    const ms = deadline - Date.now();
    timerHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stepKuramoto(eng.kuramoto, 3);
        updateOrderHistory(eng.kuramoto);
        resolve(partialResults);
      }
    }, Math.max(0, ms));
  });

  return Promise.race([
    coreWork().then((result) => {
      resolved = true;
      if (timerHandle !== undefined) clearTimeout(timerHandle);
      return result;
    }),
    timeoutGuard,
  ]);
}

export async function processFeedback(
  malId: number,
  rating: number
): Promise<{ epoch: number; goodness: number }> {
  const eng = getEngine();
  eng.isTraining = true;

  try {
    let embedding = eng.allAnimeEmbeddings.find((e) => e.animeId === malId)?.embedding;

    if (!embedding) {
      const animeList = await getAllCurrentAnime();
      const anime = animeList.find((a) => a.mal_id === malId);
      if (anime) {
        embedding = tfidfWeight(animeList as AnimeInfo[], anime as AnimeInfo);
        eng.allAnimeEmbeddings.push({ animeId: malId, embedding });
      } else {
        const vec = new Array(EMBEDDING_DIM).fill(0.1);
        embedding = normalize(vec);
      }
    }

    const modulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
    const finalEmbedding = normalize(modulated);

    const replaySamples = sampleReplay(eng.ewc, 4);
    const trainingBatch: { embedding: number[]; rating: number }[] = [
      { embedding: finalEmbedding, rating },
      ...replaySamples.map((r) => ({
        embedding: normalize(phaseModulatedEmbedding(r.embedding, eng.kuramoto.textPhases)),
        rating: r.rating,
      })),
    ];

    let totalGoodness = 0;
    for (const sample of trainingBatch) {
      const liked = sample.rating > 0.5;
      const positive = liked ? sample.embedding : createCorruptedInput(sample.embedding);
      const negative = liked ? createCorruptedInput(sample.embedding) : sample.embedding;

      const g = trainStep(eng.network, positive, negative);
      totalGoodness += g;

      if (eng.ewc.fisher.length > 0) {
        applyEWCCorrection(
          eng.network,
          eng.ewc.fisher,
          eng.ewc.optimalWeights,
          eng.ewc.optimalBiases,
          80
        );
      }
    }
    const avgGoodness = totalGoodness / trainingBatch.length;

    updateCouplingFromGoodness(eng.kuramoto, Math.tanh(avgGoodness / 5));
    stepKuramoto(eng.kuramoto, 5);

    syncNeurogenesisState(eng.neurogenesis, eng.network.layers.length);
    const { grown, pruned } = checkNeurogenesis(eng.network, eng.neurogenesis, eng.kuramoto);

    if (grown || pruned) {
      if (eng.ratings.length >= 5) {
        computeFisher(eng.ewc, eng.network, eng.ratings);
      }
    }

    const replayEntry: ReplayEntry = {
      animeId: malId,
      embedding,
      rating,
      timestamp: Date.now(),
    };
    addToReplay(eng.ewc, replayEntry);

    eng.ratings.push({ animeId: malId, embedding, rating, timestamp: Date.now() });
    if (eng.ratings.length > 1000) eng.ratings.shift();

    if (eng.ratings.length >= 10 && eng.network.epoch % 10 === 0) {
      computeFisher(eng.ewc, eng.network, eng.ratings);
    }

    persistEngine(eng);

    return { epoch: eng.network.epoch, goodness: avgGoodness };
  } finally {
    eng.isTraining = false;
  }
}

export function getAIStatus(): AIStatus {
  const eng = getEngine();
  const stats = getReplayStats(eng.ewc);
  const penalty = ewcPenalty(eng.ewc, eng.network);
  const syncIdx = synchronyIndex(eng.kuramoto);

  return {
    epoch: eng.network.epoch,
    totalNeurons: getTotalNeurons(eng.network),
    kuramotoSyncIndex: Math.round(syncIdx * 100) / 100,
    ewcPenalty: Math.round(penalty * 1000) / 1000,
    replayBufferSize: stats.size,
    replayBufferCapacity: stats.capacity,
    goodnessHistory: eng.network.goodnessHistory.slice(-20),
    isTraining: eng.isTraining,
    neurogenesisGrowthEvents: eng.neurogenesis.growthEvents,
    neurogenesisPruneEvents: eng.neurogenesis.pruneEvents,
    couplingStrength: Math.round(eng.kuramoto.coupling * 100) / 100,
  };
}

export async function verifyAnimeArtwork(
  malId: number,
  imageUrlOverride?: string,
  titleOverride?: string
): Promise<VerificationResult> {
  let imageUrl = imageUrlOverride;
  let title = titleOverride;

  if (!imageUrl || !title) {
    try {
      const animeList = await getAllCurrentAnime();
      const anime = animeList.find((a) => a.mal_id === malId);
      if (anime) {
        imageUrl = imageUrl || anime.images?.jpg?.large_image_url || "";
        title = title || anime.title;
      }
    } catch {
    }
  }

  if (!imageUrl) {
    return { verified: false, score: 0, reason: "Could not resolve image URL for this anime" };
  }

  return verifyArtwork(malId, imageUrl, title);
}

export function resetEngine(): void {
  engine = null;
}

export function getTopAnimeByGenres(
  animeList: AnimeInfo[],
  genres: string[],
  limit = 3
): AnimeInfo[] {
  const filtered = genres.length > 0
    ? animeList.filter((a) => a.genres?.some((g) => genres.includes(g.name)))
    : animeList;
  return filtered
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export function hasRestTrained(): boolean {
  const eng = getEngine();
  return eng.restTrainedAt !== null;
}

export interface RestTrainResult {
  animeCount: number;
  trainedCount: number;
  highQualityCount: number;
  elapsedMs: number;
  epoch: number;
}

export async function restTrain(): Promise<RestTrainResult> {
  const eng = getEngine();
  const startMs = Date.now();

  console.log("[Star] Starting rest training — building base knowledge...");

  const animeList = await getAllCurrentAnime();
  if (animeList.length === 0) {
    return { animeCount: 0, trainedCount: 0, highQualityCount: 0, elapsedMs: Date.now() - startMs, epoch: eng.network.epoch };
  }

  const ctx = buildTFIDFContext(animeList as AnimeInfo[]);
  const embeddingCache = new Map<number, number[]>(
    eng.allAnimeEmbeddings.map((e) => [e.animeId, e.embedding])
  );

  let trainedCount = 0;
  let highQualityCount = 0;

  const fisherDataset: { embedding: number[]; rating: number }[] = [];

  for (const anime of animeList) {
    try {
      let embedding = embeddingCache.get(anime.mal_id);
      if (!embedding) {
        embedding = tfidfWeightWithContext(ctx, anime as AnimeInfo);
        embeddingCache.set(anime.mal_id, embedding);
        eng.allAnimeEmbeddings.push({ animeId: anime.mal_id, embedding });
        if (eng.allAnimeEmbeddings.length > 2000) eng.allAnimeEmbeddings.shift();
      }

      const isHighQuality = (anime.score ?? 0) >= 7.5;
      const rating = isHighQuality ? 0.75 : 0.5;

      if (isHighQuality) highQualityCount++;

      const modulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
      const finalEmbedding = normalize(modulated);

      // Neutral awareness pass: all catalog entries trained as positive (anime=valid)
      trainStep(eng.network, finalEmbedding, createCorruptedInput(finalEmbedding));

      // High-quality: second pass for stronger positive imprint
      if (isHighQuality) {
        trainStep(eng.network, finalEmbedding, createCorruptedInput(finalEmbedding));
      }

      // Fisher on full catalog — all base knowledge is class-1 (worthy of protection)
      fisherDataset.push({ embedding: finalEmbedding, rating: 0.75 });

      addToReplay(eng.ewc, {
        animeId: anime.mal_id,
        embedding,
        rating,
        timestamp: Date.now(),
        isBaseKnowledge: true,
      });

      trainedCount++;
    } catch {
      continue;
    }
  }

  if (fisherDataset.length >= 5) {
    computeFisher(eng.ewc, eng.network, fisherDataset);
  }

  updateCouplingFromGoodness(eng.kuramoto, 0.6);
  stepKuramoto(eng.kuramoto, 10);
  updateOrderHistory(eng.kuramoto);

  eng.restTrainedAt = Date.now();
  persistEngine(eng);

  const elapsed = Date.now() - startMs;
  console.log(`[Star] Rest training complete: ${trainedCount} anime trained (${highQualityCount} high-quality) in ${elapsed}ms`);

  return {
    animeCount: animeList.length,
    trainedCount,
    highQualityCount,
    elapsedMs: elapsed,
    epoch: eng.network.epoch,
  };
}
