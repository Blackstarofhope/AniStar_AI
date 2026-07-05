import { storage } from "../storage.js";
import {
  createNetwork, trainStep, applyEWCCorrection, infer, getTotalNeurons, createCorruptedInput,
  deserializeNetwork, serializeNetwork, type FFNetworkState
} from "./forwardForward.js";
import {
  createKuramotoSystem, stepKuramoto, synchronyIndex,
  updateCouplingFromGoodness, phaseModulatedEmbedding, phaseModulatedVibeEmbedding,
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
  embedAnime, buildUserPreferenceVector,
  EMBEDDING_DIM, embedAnimeWithFallback, embedAnimeWithVibeFallback, type AnimeInfo
} from "./textEmbedder.js";
import { loadCLIP } from "./clipEncoder.js";
import { verifyArtwork, type VerificationResult } from "./visionVerifier.js";
import { loadModelState } from "./modelStore.js";
import { cosineSim, normalize } from "./matrix.js";
import { getAllCurrentAnime, type AnimeScheduleItem } from "./animeData.js";
import { generateVibeProfile, getVibeProfileFromCache } from "./vibeProfiler.js";
import { aiLog } from "./aiLog.js";

const LAYER_SIZES = [EMBEDDING_DIM, 256, 128, 64];
const KURAMOTO_SIZE = 256;

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
  vibe?: { atmosphere: string; tone: string; protagonistArchetype: string };
  discoveredBy?: { userId: string; displayName: string };
  lane?: string;
  reason?: string;
}

export interface ThreeLaneRecommendations {
  safe: Recommendation[];
  stretch: Recommendation[];
  blind: Recommendation[];
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
  isTraining: boolean;
  restTrainedAt: number | null;
  // Optimistic-concurrency counter mirroring userEngineState.version in the
  // DB. Tracks the version this in-memory copy was last loaded/saved at, so
  // persistEngine can detect when another instance (or another request on
  // this instance, absent the write queue below) has saved newer state first.
  version: number;
}

const engines = new Map<string, EngineState>();
const engineAccessTime = new Map<string, number>();
const engineInitPromises = new Map<string, Promise<EngineState>>();
const MAX_USER_ENGINES = 5;
const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes
let clipPreloadDone = false;

// ---------------------------------------------------------------------------
// Per-user write queue
// Optimistic versioning assumes at most one in-flight writer per (instance,
// user): two concurrent calls sharing the same in-memory EngineState object
// would otherwise interleave mutations and both read the same stale
// eng.version, spuriously conflicting with EACH OTHER (not just with other
// instances) on save. This queue serializes state-mutating operations
// (processFeedback, restTrain) per user on this instance. It does NOT protect
// against concurrent writers on different instances — the version check
// itself (in persistEngine/storage.saveEngineStateVersioned) is what handles
// that case.
// ---------------------------------------------------------------------------
const userWriteQueues = new Map<string, Promise<void>>();

function enqueueUserWork<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const prevTail = userWriteQueues.get(userId) ?? Promise.resolve();
  const resultPromise = prevTail.then(work, work);
  userWriteQueues.set(
    userId,
    resultPromise.then(
      () => undefined,
      () => undefined
    )
  );
  return resultPromise;
}

// ---------------------------------------------------------------------------
// Shared anime embedding cache
// Anime embeddings are derived purely from anime content (title/genres/score/
// studio), not from any user's preferences, so they used to be wastefully
// duplicated into every user's EngineState (and thus every userEngineState
// DB row) — identical data copied once per user. They now live in one
// process-local Map backed by the shared `anime_embeddings` table, so every
// user (and, once loaded, every engine on this instance) reads the same
// entries instead of each recomputing/re-storing them independently.
// This does NOT need per-instance sync: a cache miss just re-embeds and
// writes through, which is idempotent and cheap, so different instances
// converging on the same values over time is fine.
// ---------------------------------------------------------------------------
const MAX_SHARED_EMBEDDINGS = 2000;
const sharedAnimeEmbeddings = new Map<number, number[]>();
let sharedEmbeddingsLoadPromise: Promise<void> | null = null;

function ensureSharedEmbeddingsLoaded(): Promise<void> {
  if (!sharedEmbeddingsLoadPromise) {
    sharedEmbeddingsLoadPromise = (async () => {
      try {
        const rows = await storage.getAllAnimeEmbeddings();
        for (const row of rows) {
          if (row.embedding.length === EMBEDDING_DIM) {
            sharedAnimeEmbeddings.set(row.malId, row.embedding);
          }
        }
        console.log(`[AI] Loaded ${sharedAnimeEmbeddings.size} shared anime embeddings from DB.`);
      } catch (e) {
        console.warn("[AI] Failed to load shared anime embeddings from DB:", e instanceof Error ? e.message : e);
      }
    })();
  }
  return sharedEmbeddingsLoadPromise;
}

function getSharedEmbedding(animeId: number): number[] | undefined {
  return sharedAnimeEmbeddings.get(animeId);
}

function setSharedEmbedding(animeId: number, embedding: number[]): void {
  if (!sharedAnimeEmbeddings.has(animeId) && sharedAnimeEmbeddings.size >= MAX_SHARED_EMBEDDINGS) {
    const oldestKey = sharedAnimeEmbeddings.keys().next().value;
    if (oldestKey !== undefined) sharedAnimeEmbeddings.delete(oldestKey);
  }
  sharedAnimeEmbeddings.set(animeId, embedding);
  // Fire-and-forget is acceptable here (unlike persistEngine): this is a
  // recomputable content cache, not user data. A failed write just means the
  // next request re-embeds this anime — no data loss, only wasted compute.
  storage.saveAnimeEmbedding(animeId, embedding).catch((e) =>
    console.warn(`[AI] Failed to persist shared anime embedding for malId=${animeId}:`, e instanceof Error ? e.message : e)
  );
}

// One-time migration path: old per-user saves (file or DB) carried their own
// allAnimeEmbeddings array. Seed anything not already in the shared cache so
// previously-computed embeddings aren't silently discarded/recomputed.
function seedSharedEmbeddingsFromLegacy(
  entries: { animeId: number; embedding: number[] }[] | undefined
): void {
  if (!entries) return;
  for (const e of entries) {
    if (e.embedding.length === EMBEDDING_DIM && !sharedAnimeEmbeddings.has(e.animeId)) {
      setSharedEmbedding(e.animeId, e.embedding);
    }
  }
}

interface PersistedEngineJson {
  network: FFNetworkState;
  kuramoto: KuramotoState;
  neurogenesis: NeurogenesisState;
  ewc: EWCState;
  ratings: { animeId: number; embedding: number[]; rating: number; timestamp: number }[];
  allAnimeEmbeddings?: { animeId: number; embedding: number[] }[];
  restTrainedAt?: number | null;
}

// Shared deserialization for both the DB path and the legacy-file migration
// path below, so the two stay in sync. Returns null if the persisted network
// shape doesn't match the current architecture (e.g. after a LAYER_SIZES
// change), signaling the caller should fall back to a fresh engine.
function hydrateEngineState(s: PersistedEngineJson, version: number): EngineState | null {
  const firstHiddenSize = s.network?.layers?.[0]?.biases?.length ?? 0;
  if (firstHiddenSize !== LAYER_SIZES[1]) return null;

  const kura = s.kuramoto;
  if (!kura.vibePhases || kura.vibePhases.length !== kura.textPhases.length) {
    kura.vibePhases = Array.from(
      { length: kura.textPhases.length },
      () => Math.random() * 2 * Math.PI
    );
  }
  seedSharedEmbeddingsFromLegacy(s.allAnimeEmbeddings);

  return {
    network: deserializeNetwork(s.network),
    kuramoto: kura,
    neurogenesis: s.neurogenesis,
    ewc: s.ewc,
    ratings: s.ratings || [],
    isTraining: false,
    restTrainedAt: s.restTrainedAt ?? null,
    version,
  };
}

async function initEngine(userId: string): Promise<EngineState> {
  if (!clipPreloadDone) {
    clipPreloadDone = true;
    loadCLIP().catch((e) => console.warn("[CLIP] Failed to preload:", e));
  }

  await ensureSharedEmbeddingsLoaded();

  // The DB is the single source of truth for every user, including
  // "default". The legacy per-instance file (ai-model-state.json) is only
  // consulted below as a one-time migration path when no DB row exists yet.
  try {
    const dbState = await storage.loadEngineStateVersioned(userId);
    if (dbState) {
      const hydrated = hydrateEngineState(dbState.json as PersistedEngineJson, dbState.version);
      if (hydrated) {
        console.log(`[AI] Loaded engine for user "${userId}" from DB (v${dbState.version}).`);
        return hydrated;
      }
      console.log(`[AI] DB engine state for "${userId}" has a network dim mismatch — ignoring.`);
    }
  } catch (e) {
    console.warn(`[AI] Failed to load engine from DB for "${userId}":`, e instanceof Error ? e.message : e);
  }

  // No usable DB row yet. For "default" only, fall back to the legacy file
  // once and migrate it into the DB so this instance and every other
  // instance load through the DB path above from now on.
  if (userId === "default") {
    const saved = loadModelState();
    if (saved) {
      const hydrated = hydrateEngineState(saved as unknown as PersistedEngineJson, 0);
      if (hydrated) {
        const migrated = await persistEngine(userId, hydrated);
        if (migrated) {
          console.log(`[AI] Migrated legacy file-based engine state for "default" into DB (v${hydrated.version}).`);
          return hydrated;
        }
        // Another writer (another instance, or a concurrent request) created
        // the DB row first — re-read the authoritative copy instead of using
        // our now-stale file-based snapshot.
        console.warn(`[AI] Legacy file migration for "default" hit a version conflict — reloading from DB.`);
        try {
          const fresh = await storage.loadEngineStateVersioned(userId);
          if (fresh) {
            const rehydrated = hydrateEngineState(fresh.json as PersistedEngineJson, fresh.version);
            if (rehydrated) return rehydrated;
          }
        } catch (e) {
          console.warn(
            `[AI] Failed to re-load engine from DB for "default" after migration conflict:`,
            e instanceof Error ? e.message : e
          );
        }
        return hydrated;
      }
      console.log(`[AI] Legacy file network dim mismatch — starting fresh for "default".`);
    }
  }

  return {
    network: createNetwork(LAYER_SIZES),
    kuramoto: createKuramotoSystem(KURAMOTO_SIZE),
    neurogenesis: createNeurogenesisState(LAYER_SIZES.length - 1),
    ewc: createEWCState(),
    ratings: [],
    isTraining: false,
    restTrainedAt: null,
    version: 0,
  };
}

async function getEngine(userId: string): Promise<EngineState> {
  const existing = engines.get(userId);
  if (existing) {
    engineAccessTime.set(userId, Date.now());
    return existing;
  }

  let initPromise = engineInitPromises.get(userId);
  if (!initPromise) {
    initPromise = (async () => {
      if (engines.size >= MAX_USER_ENGINES) {
        let oldestKey = "";
        let oldestTime = Infinity;
        for (const [key, t] of engineAccessTime) {
          if (t < oldestTime) { oldestTime = t; oldestKey = key; }
        }
        if (oldestKey) {
          const evicted = engines.get(oldestKey);
          if (evicted) {
            // persistEngine never throws (see its definition) — failures and
            // version conflicts are logged internally.
            persistEngine(oldestKey, evicted);
          }
          engines.delete(oldestKey);
          engineAccessTime.delete(oldestKey);
        }
      }
      const eng = await initEngine(userId);
      engines.set(userId, eng);
      return eng;
    })();
    engineInitPromises.set(userId, initPromise);
    initPromise.finally(() => engineInitPromises.delete(userId));
  }

  engineAccessTime.set(userId, Date.now());
  return initPromise;
}

// Conditionally persists `eng` to the DB using optimistic-concurrency
// versioning: the write only applies if `eng.version` still matches the
// row's current version in the DB. On success, eng.version is bumped in
// place to match the new row version and this resolves true. On a version
// conflict (another writer — another instance, or the same instance without
// going through the write queue — saved first) or any other failure, this
// resolves false and leaves `eng` untouched; the in-memory copy should then
// be treated as stale by the caller. This function never throws.
async function persistEngine(userId: string, eng: EngineState): Promise<boolean> {
  const json = {
    version: 2,
    network: serializeNetwork(eng.network),
    kuramoto: eng.kuramoto,
    neurogenesis: eng.neurogenesis,
    ewc: eng.ewc,
    ratings: eng.ratings,
    restTrainedAt: eng.restTrainedAt ?? null,
  };

  let saved = false;
  try {
    const result = await storage.saveEngineStateVersioned(userId, json, eng.version);
    if (result.ok) {
      eng.version = result.newVersion;
      saved = true;
    } else {
      aiLog("warn", "engine_save_conflict", { userId, localVersion: eng.version });
    }
  } catch (e) {
    aiLog("error", "engine_save_failed", { userId, message: e instanceof Error ? e.message : String(e) });
  }

  // "default" is now DB-first end-to-end (see initEngine's one-time file
  // migration) — the legacy ai-model-state.json file is no longer written.

  return saved;
}

// Inactivity eviction: persist and remove engines idle for > 5 minutes.
// A version conflict here just means another writer already saved newer
// data for this user — the evicted in-memory copy is stale, so dropping it
// without retrying is correct (there's nothing new to contribute).
setInterval(() => {
  const now = Date.now();
  for (const [userId, lastAccess] of engineAccessTime) {
    if (now - lastAccess > INACTIVITY_MS) {
      const eng = engines.get(userId);
      if (eng) {
        persistEngine(userId, eng);
      }
      engines.delete(userId);
      engineAccessTime.delete(userId);
    }
  }
}, 60_000).unref();

function buildRecommendationItem(
  anime: AnimeScheduleItem,
  score: number,
  verification: { verified: boolean; score: number; visionEmbedding: number[] }
): Recommendation {
  const imageUrl = anime.images?.jpg?.large_image_url || "";
  const artworkBoost = verification.verified ? 1.05 : 0.95;
  const finalConfidence = Math.min(1, Math.max(0, score * artworkBoost));

  // Use cache-only — never block the response on a Gemini call.
  // If the profile is not yet cached, fire a background prefetch so the
  // next request will find it in the cache.
  const cachedProfile = getVibeProfileFromCache(anime.mal_id);
  let vibe: Recommendation["vibe"] | undefined;
  if (cachedProfile) {
    vibe = {
      atmosphere: cachedProfile.atmosphere,
      tone: cachedProfile.tone,
      protagonistArchetype: cachedProfile.protagonistArchetype,
    };
  } else {
    generateVibeProfile(
      anime.mal_id,
      anime.title,
      (anime.genres ?? []).map((g) => g.name),
      anime.synopsis ?? "",
      anime.score ?? 0
    ).catch(() => { /* background prefetch — ignore errors */ });
  }

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
    vibe,
  };
}

const UNVERIFIED: { verified: boolean; score: number; visionEmbedding: number[] } = { verified: false, score: 0, visionEmbedding: [] };

// ---------------------------------------------------------------------------
// Shared hard-filter helper — deduplicates filter logic between both rec paths
// ---------------------------------------------------------------------------
type BanRow = { malId: number | null; bannedGenre: string | null };

function applyHardFilters(
  rawAnimeList: AnimeScheduleItem[],
  bans: BanRow[],
  seenIds: Set<number>
): { filtered: AnimeScheduleItem[]; bannedMalIds: Set<number>; bannedGenreSet: Set<string> } {
  const bannedMalIds = new Set<number>(
    bans.filter((b) => b.malId !== null).map((b) => b.malId!)
  );
  const bannedGenreSet = new Set<string>(
    bans.filter((b) => b.bannedGenre !== null).map((b) => b.bannedGenre!)
  );
  const filtered = rawAnimeList.filter((anime) => {
    if (bannedMalIds.has(anime.mal_id)) return false;
    if (seenIds.has(anime.mal_id)) return false;
    const genres = (anime.genres ?? []).map((g) => g.name);
    if (genres.length > 0 && genres.every((g) => bannedGenreSet.has(g))) return false;
    return true;
  });
  return { filtered, bannedMalIds, bannedGenreSet };
}

async function scoreAnimeList(
  eng: Awaited<ReturnType<typeof getEngine>>,
  animeList: AnimeScheduleItem[],
  userPref: number[],
  limit: number,
  hiddenGemBias: number
): Promise<{ anime: AnimeScheduleItem; score: number; embedding: number[]; cosSim: number; ffScore: number }[]> {
  const scored: { anime: AnimeScheduleItem; score: number; embedding: number[]; cosSim: number; ffScore: number }[] = [];

  await Promise.all(
    animeList.map(async (anime) => {
      try {
        let embedding = getSharedEmbedding(anime.mal_id);
        if (!embedding) {
          embedding = await embedAnimeWithVibeFallback(anime as AnimeInfo);
          setSharedEmbedding(anime.mal_id, embedding);
        }

        const textModulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
        const vibeModulated = phaseModulatedVibeEmbedding(embedding, eng.kuramoto);
        const blended = textModulated.map((v, i) => (v + vibeModulated[i]) / 2);
        const finalEmbedding = normalize(blended);
        const ffScore = infer(eng.network, finalEmbedding);
        const cosSim = cosineSim(finalEmbedding, userPref);
        // ffScore is already bounded (0, 1) — no tanh squashing needed.
        // (cosSim + 1) / 2 maps cosine similarity from [−1, 1] → [0, 1].
        // Combined score is therefore in [0, 1] with no saturation risk.
        const combinedScore = 0.6 * ffScore + 0.4 * (cosSim + 1) / 2;
        const popularityFactor = anime.score ? (anime.score / 10) : 0.5;
        const biasAdjustment = (hiddenGemBias - 0.5) * 0.4;
        const adjustedScore = combinedScore - (biasAdjustment * popularityFactor) + (biasAdjustment * (1 - popularityFactor));
        scored.push({ anime, score: adjustedScore, embedding, cosSim, ffScore });
      } catch {
        return;
      }
    })
  );

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function getRecommendations(userId: string, limit = 10, deadlineMs = 12000): Promise<Recommendation[]> {
  const eng = await getEngine(userId);
  const deadline = Date.now() + deadlineMs;

  const partialResults: Recommendation[] = [];

  const coreWork = async (): Promise<Recommendation[]> => {
    const [rawAnimeList, bans, seenIds, hiddenGemBias] = await Promise.all([
      getAllCurrentAnime(),
      storage.getUserBans(userId),
      storage.getWatchedMalIds(userId),
      storage.getHiddenGemBias(userId),
    ]);
    if (rawAnimeList.length === 0) return [];

    const { filtered: animeList } = applyHardFilters(rawAnimeList, bans, seenIds);

    const userPref = buildUserPreferenceVector(
      eng.ratings.map((r) => ({ embedding: r.embedding, rating: r.rating }))
    );

    const topAnime = await scoreAnimeList(eng, animeList, userPref, limit, hiddenGemBias);

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

    // Attach discovery attribution non-blockingly — failures are silently ignored.
    const discoveryResults = await Promise.allSettled(
      recommendations.map((r) => storage.getDiscovery(r.mal_id))
    );
    for (let i = 0; i < recommendations.length; i++) {
      const d = discoveryResults[i];
      if (d.status === "fulfilled" && d.value) {
        recommendations[i].discoveredBy = {
          userId: d.value.userId,
          displayName: d.value.displayName,
        };
      }
    }

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

export async function getThreeLaneRecommendations(
  userId: string,
  deadlineMs = 15000
): Promise<ThreeLaneRecommendations> {
  const eng = await getEngine(userId);
  const deadline = Date.now() + deadlineMs;
  const emptyResult: ThreeLaneRecommendations = { safe: [], stretch: [], blind: [] };

  const coreWork = async (): Promise<ThreeLaneRecommendations> => {
    const [rawAnimeList, bans, seenIds, hiddenGemBias] = await Promise.all([
      getAllCurrentAnime(),
      storage.getUserBans(userId),
      storage.getWatchedMalIds(userId),
      storage.getHiddenGemBias(userId),
    ]);

    // Issue 2: shared filter helper — same logic as getRecommendations
    const { filtered: animeList } = applyHardFilters(rawAnimeList, bans, seenIds);
    if (animeList.length === 0) return emptyResult;

    const userPref = buildUserPreferenceVector(
      eng.ratings.map((r) => ({ embedding: r.embedding, rating: r.rating }))
    );

    // Build liked genre set from historical positive ratings
    const animeGenreMap = new Map<number, string[]>();
    for (const a of rawAnimeList) {
      animeGenreMap.set(a.mal_id, (a.genres ?? []).map((g) => g.name));
    }
    const likedGenreSet = new Set<string>();
    for (const r of eng.ratings) {
      if (r.rating > 0.5) {
        const genres = animeGenreMap.get(r.animeId);
        if (genres) for (const g of genres) likedGenreSet.add(g);
      }
    }

    const scored = await scoreAnimeList(eng, animeList, userPref, 50, hiddenGemBias);
    if (scored.length === 0) return emptyResult;

    type ScoredItem = typeof scored[0];
    let safeItems: ScoredItem[];
    let stretchItems: ScoredItem[];
    let blindItems: ScoredItem[];

    // Issue 1: cold-start — cosine similarity is meaningless with < 3 ratings,
    // so the preference vector is near-zero and everything would score cosSim ≈ 0.
    // Use a positional fallback instead of lane classification.
    const isColdStart = eng.ratings.length < 3;

    if (isColdStart) {
      safeItems = scored.slice(0, 3);
      stretchItems = scored.slice(3, 6);
      // 2 random picks from the bottom half for the "blind" surprise lane
      const bottomHalf = scored.slice(Math.floor(scored.length / 2));
      const shuffled = [...bottomHalf].sort(() => Math.random() - 0.5);
      blindItems = shuffled.slice(0, 2);
    } else {
      // Classify into lanes — BLIND first (broadest exclusion), then SAFE, then STRETCH
      const safePool: ScoredItem[] = [];
      const stretchPool: ScoredItem[] = [];
      const blindPool: ScoredItem[] = [];

      for (const item of scored) {
        const genres = (item.anime.genres ?? []).map((g) => g.name);
        // Issue 4: if the user has no positive ratings yet, likedGenreSet is empty
        // and every genre looks novel. Treat novelty = 0 so items go to safe/stretch
        // based on cosine similarity alone, instead of all collapsing into blind.
        const genreNovelty =
          likedGenreSet.size === 0
            ? 0
            : genres.filter((g) => !likedGenreSet.has(g)).length;

        if (item.cosSim < 0.3 || genreNovelty >= 2) {
          blindPool.push(item);
        } else if (item.cosSim > 0.6 && genreNovelty === 0) {
          safePool.push(item);
        } else {
          stretchPool.push(item);
        }
      }

      safePool.sort((a, b) => b.score - a.score);
      stretchPool.sort((a, b) => b.score - a.score);
      blindPool.sort((a, b) => b.ffScore - a.ffScore);

      safeItems = safePool.slice(0, 3);
      stretchItems = stretchPool.slice(0, 3);
      blindItems = blindPool.slice(0, 2);

      // Fill empty lanes from nearest overflow
      if (safeItems.length === 0) safeItems = stretchPool.slice(3, 6);
      if (stretchItems.length === 0) stretchItems = safePool.slice(3, 6);
      if (blindItems.length === 0) blindItems = stretchPool.slice(3, 5);
    }

    // Issue 5: verification respects the same deadline pattern as getRecommendations
    const allItems = [...safeItems, ...stretchItems, ...blindItems];
    const verificationMap = new Map<number, { verified: boolean; score: number; visionEmbedding: number[] }>();
    const verificationPromises = allItems.map(async ({ anime }) => {
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

    stepKuramoto(eng.kuramoto, 3);
    updateOrderHistory(eng.kuramoto);

    function buildReason(item: ScoredItem, lane: string): string {
      const genres = (item.anime.genres ?? []).map((g) => g.name);
      const cachedVibe = getVibeProfileFromCache(item.anime.mal_id);
      if (lane === "safe") {
        const matchingGenres = genres.filter((g) => likedGenreSet.has(g));
        const topGenres = matchingGenres.slice(0, 2).join(" & ");
        return `Matches your taste in ${topGenres || "your favourite genres"}`;
      }
      if (lane === "stretch") {
        const unfamiliar = genres.find((g) => !likedGenreSet.has(g)) ?? genres[0] ?? "new territory";
        const vibeAttr = cachedVibe?.atmosphere ?? "vibe";
        return `New territory — ${unfamiliar} — but the ${vibeAttr} aligns with what you love`;
      }
      const vibeAttr = cachedVibe?.atmosphere ?? "something unexpected";
      return `This one's a gamble. The vibe says ${vibeAttr} — trust it or skip it`;
    }

    function toRecommendations(items: ScoredItem[], lane: string): Recommendation[] {
      return items.map((item) => {
        const verification = verificationMap.get(item.anime.mal_id) ?? UNVERIFIED;
        const rec = buildRecommendationItem(item.anime, item.score, verification);
        rec.lane = lane;
        rec.reason = buildReason(item, lane);
        return rec;
      });
    }

    const safe = toRecommendations(safeItems, "safe");
    const stretch = toRecommendations(stretchItems, "stretch");
    const blind = toRecommendations(blindItems, "blind");

    // Attach discovery attribution
    const allRecs = [...safe, ...stretch, ...blind];
    const discoveryResults = await Promise.allSettled(
      allRecs.map((r) => storage.getDiscovery(r.mal_id))
    );
    for (let i = 0; i < allRecs.length; i++) {
      const d = discoveryResults[i];
      if (d.status === "fulfilled" && d.value) {
        allRecs[i].discoveredBy = { userId: d.value.userId, displayName: d.value.displayName };
      }
    }

    return { safe, stretch, blind };
  };

  // Issue 5: full deadline guard — if the entire coreWork is still running when
  // the deadline fires, return empty lanes rather than hanging the HTTP response.
  const timeoutGuard = new Promise<ThreeLaneRecommendations>((resolve) => {
    setTimeout(() => {
      stepKuramoto(eng.kuramoto, 3);
      updateOrderHistory(eng.kuramoto);
      resolve(emptyResult);
    }, Math.max(0, deadline - Date.now()));
  });

  return Promise.race([coreWork(), timeoutGuard]);
}

// ---------------------------------------------------------------------------
// Hard-negative helpers (T003)
// Instead of always using corrupted random noise as the FF negative, try to
// source a real embedding from the opposite end of the user's rating history.
// Falls back to corrupted input when the history pool is too small.
// ---------------------------------------------------------------------------

function sampleHardNegative(
  ratings: EngineState["ratings"],
  excludeId: number
): number[] | null {
  const pool = ratings.filter((r) => r.animeId !== excludeId && r.rating < 0.3);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)].embedding;
}

function sampleHardPositive(
  ratings: EngineState["ratings"],
  excludeId: number
): number[] | null {
  const pool = ratings.filter((r) => r.animeId !== excludeId && r.rating > 0.7);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)].embedding;
}

// ---------------------------------------------------------------------------
// processFeedback
// trainingEmbeddingOverride (T004): callers (Path 1 reason blending, Path 2
// character trait blending) may supply a pre-blended embedding for FF training.
// The override goes into eng.ratings (shaping the user preference vector) but
// the canonical anime embedding still goes into the shared embedding cache
// (used for recommendation cosine scoring), keeping the two concerns separate.
// ---------------------------------------------------------------------------

export async function processFeedback(
  malId: number,
  rating: number,
  userId = "default",
  trainingEmbeddingOverride?: number[]
): Promise<{ epoch: number; goodness: number; justUnlocked: boolean }> {
  // Serialized per-user: see enqueueUserWork above for why this is required
  // on top of the version check itself.
  return enqueueUserWork(userId, () =>
    processFeedbackLocked(malId, rating, userId, trainingEmbeddingOverride)
  );
}

async function processFeedbackLocked(
  malId: number,
  rating: number,
  userId: string,
  trainingEmbeddingOverride: number[] | undefined
): Promise<{ epoch: number; goodness: number; justUnlocked: boolean }> {
  const MAX_ATTEMPTS = 3;
  let eng = await getEngine(userId);
  eng.isTraining = true;

  let avgGoodness = 0;
  let saved = false;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Always resolve the canonical anime embedding from the shared cache.
      let animeEmbedding = getSharedEmbedding(malId);

      if (!animeEmbedding) {
        const animeList = await getAllCurrentAnime();
        const anime = animeList.find((a) => a.mal_id === malId);
        if (anime) {
          animeEmbedding = await embedAnimeWithVibeFallback(anime as AnimeInfo);
          setSharedEmbedding(malId, animeEmbedding);
        } else {
          const vec = new Array(EMBEDDING_DIM).fill(0.1);
          animeEmbedding = normalize(vec);
        }
      }

      // trainingRaw: what actually shapes the user preference vector.
      // When a caller provides an override (e.g. character trait or reason blend),
      // that richer signal is used for training; otherwise fall back to the anime embedding.
      const trainingRaw = trainingEmbeddingOverride ?? animeEmbedding;

      // Inline phase-modulation helper — avoids repeating the three-step blend.
      const modulate = (emb: number[]): number[] => {
        const t = phaseModulatedEmbedding(emb, eng.kuramoto.textPhases);
        const v = phaseModulatedVibeEmbedding(emb, eng.kuramoto);
        return normalize(t.map((x, i) => (x + v[i]) / 2));
      };

      const finalEmbedding = modulate(trainingRaw);

      const replaySamples = sampleReplay(eng.ewc, 4);
      const trainingBatch: { embedding: number[]; rating: number }[] = [
        { embedding: finalEmbedding, rating },
        ...replaySamples.map((r) => ({
          embedding: modulate(r.embedding),
          rating: r.rating,
        })),
      ];

      let totalGoodness = 0;
      for (const sample of trainingBatch) {
        const liked = sample.rating > 0.5;

        let positive: number[];
        let negative: number[];

        if (liked) {
          positive = sample.embedding;
          // Prefer a real disliked embedding as the hard negative so the
          // FF decision boundary aligns with actual content the user rejected.
          // Fall back to corrupted noise when no low-rated history exists yet.
          const rawHardNeg = sampleHardNegative(eng.ratings, malId);
          negative = rawHardNeg
            ? modulate(rawHardNeg)
            : createCorruptedInput(sample.embedding);
        } else {
          // Prefer a real liked embedding as the hard positive.
          const rawHardPos = sampleHardPositive(eng.ratings, malId);
          positive = rawHardPos
            ? modulate(rawHardPos)
            : createCorruptedInput(sample.embedding);
          negative = sample.embedding;
        }

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
      avgGoodness = totalGoodness / trainingBatch.length;

      updateCouplingFromGoodness(eng.kuramoto, Math.tanh(avgGoodness / 5));
      stepKuramoto(eng.kuramoto, 5);

      syncNeurogenesisState(eng.neurogenesis, eng.network.layers.length);
      const { grown, pruned } = checkNeurogenesis(eng.network, eng.neurogenesis, eng.kuramoto);

      if (grown || pruned) {
        if (eng.ratings.length >= 5) {
          computeFisher(eng.ewc, eng.network, eng.ratings);
        }
      }

      // Store trainingRaw (not animeEmbedding) so the user preference vector
      // reflects trait/reason nuance when an override was provided.
      const replayEntry: ReplayEntry = {
        animeId: malId,
        embedding: trainingRaw,
        rating,
        timestamp: Date.now(),
      };
      addToReplay(eng.ewc, replayEntry);

      // Dedup by animeId: mirrors user_ratings in the DB (which upserts on
      // [userId, malId]) so a later event for the same anime (e.g. a
      // thumbs-up followed by a watchstate "completed" event) replaces the
      // old in-memory entry instead of stacking a second one. Without this,
      // buildUserPreferenceVector would sum both entries and double-count
      // that anime's embedding with potentially conflicting weights, and it
      // would also skew hard-negative/positive sampling.
      eng.ratings = eng.ratings.filter((r) => r.animeId !== malId);
      eng.ratings.push({ animeId: malId, embedding: trainingRaw, rating, timestamp: Date.now() });
      if (eng.ratings.length > 1000) eng.ratings.shift();

      if (eng.ratings.length >= 10 && eng.network.epoch % 10 === 0) {
        computeFisher(eng.ewc, eng.network, eng.ratings);
      }

      saved = await persistEngine(userId, eng);
      if (saved) break;

      // Version conflict: this instance's in-memory copy was stale relative
      // to the DB (another instance, or a concurrent request that bypassed
      // the write queue, saved first). If another attempt remains, drop the
      // stale copy, reload the authoritative latest state, and redo training
      // against the fresh copy — training is stochastic, so re-running it is
      // safe and correctly folds in whatever the other writer contributed
      // instead of clobbering it. On the FINAL attempt, skip the reload: it
      // would only discard the trained-but-unsaved `eng` we're about to
      // return goodness/epoch from, for no benefit (the loop is about to end
      // either way).
      const willRetry = attempt < MAX_ATTEMPTS - 1;
      aiLog("warn", "feedback_conflict_retry", { userId, malId, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, willRetry });
      if (!willRetry) break;
      engines.delete(userId);
      engineAccessTime.delete(userId);
      eng = await getEngine(userId);
      eng.isTraining = true;
    }

    if (!saved) {
      aiLog("error", "feedback_retries_exhausted", { userId, malId, maxAttempts: MAX_ATTEMPTS });
    }

    // Side effects below run exactly once, after the retry loop, regardless
    // of how many training attempts it took: saveRating is an upsert
    // (idempotent on [userId, malId]) and the onboarding unlock check reads
    // authoritative DB state, so neither needs to be repeated per attempt.

    // Persist rating to user_ratings table (T001: this call was missing).
    // user_ratings is the source of truth for the Path 3 unlock check below.
    // MUST be awaited: it was previously fire-and-forget, which raced against
    // getUserRatings() below — storage.withRetry() backs off up to 500ms*attempt
    // on connection errors, so the unlock check could read the table before
    // this insert committed, undercounting ratings and delaying the unlock.
    try {
      await storage.saveRating(userId, malId, rating);
    } catch (e) {
      // The FF network already trained on this rating (weights updated above,
      // added to eng.ratings/replay buffer) and cannot be rolled back, so we
      // don't fail the whole request. But this rating is now permanently
      // missing from user_ratings — model state and the DB are inconsistent,
      // and the Path 3 unlock counter will legitimately undercount it. Logged
      // at error level (not warn) so this isn't silently lost in production.
      // If this surfaces repeatedly, consider an outbox/retry-queue for
      // failed rating writes instead of a single best-effort attempt.
      aiLog("error", "save_rating_failed", {
        userId, malId, message: e instanceof Error ? e.message : String(e),
      });
    }

    let justUnlocked = false;
    try {
      const onboarding = await storage.getOnboardingState(userId);
      if (onboarding?.pathChosen === "manual" && !onboarding.unlockedRecommendations) {
        const ratings = await storage.getUserRatings(userId);
        if (ratings.length >= 10) {
          await storage.unlockRecommendations(userId);
          await storage.completeOnboarding(userId);
          justUnlocked = true;
          aiLog("info", "path3_unlocked", { userId, ratingCount: ratings.length });
        }
      }
    } catch (e) {
      aiLog("warn", "path3_onboarding_check_failed", { userId, message: e instanceof Error ? e.message : String(e) });
    }

    return { epoch: eng.network.epoch, goodness: avgGoodness, justUnlocked };
  } finally {
    eng.isTraining = false;
  }
}

export async function getAIStatus(userId = "default"): Promise<AIStatus> {
  const eng = await getEngine(userId);
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
  engines.clear();
  engineAccessTime.clear();
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

// userId is no longer used for anything (embeddings are shared across all
// users), but the parameter is kept so existing call sites don't need to change.
export async function addAnimeEmbeddings(
  _userId: string,
  entries: { animeId: number; embedding: number[] }[]
): Promise<void> {
  await ensureSharedEmbeddingsLoaded();
  for (const entry of entries) {
    if (!sharedAnimeEmbeddings.has(entry.animeId)) {
      setSharedEmbedding(entry.animeId, entry.embedding);
    }
  }
}

export async function hasRestTrained(userId = "default"): Promise<boolean> {
  const eng = await getEngine(userId);
  return eng.restTrainedAt !== null;
}

// Unlike hasRestTrained(), this bypasses the in-memory engine cache and reads
// straight from the DB. Used immediately before kicking off the (expensive,
// long-running) auto rest-train pass, so a cold-start instance doesn't act on
// a stale cached engine loaded seconds earlier — reducing (though, given the
// cache, not eliminating) the odds two instances both run the full pass at
// once. The versioned save + conflict retry in restTrainLocked() is still the
// actual correctness guarantee; this is purely a waste-reduction guard.
export async function hasRestTrainedFresh(userId = "default"): Promise<boolean> {
  const row = await storage.loadEngineStateVersioned(userId);
  if (!row) return false;
  const json = row.json as { restTrainedAt?: number | null };
  return json.restTrainedAt != null;
}

export interface RestTrainResult {
  animeCount: number;
  trainedCount: number;
  highQualityCount: number;
  elapsedMs: number;
  epoch: number;
}

export async function restTrain(userId = "default"): Promise<RestTrainResult> {
  // Serialized per-user, same as processFeedback — restTrain and
  // processFeedback must never run concurrently against the same in-memory
  // engine object for one user.
  return enqueueUserWork(userId, () => restTrainLocked(userId));
}

async function restTrainLocked(userId: string): Promise<RestTrainResult> {
  let eng = await getEngine(userId);
  const startMs = Date.now();

  aiLog("info", "resttrain_start", { userId });

  const animeList = await getAllCurrentAnime();
  if (animeList.length === 0) {
    return { animeCount: 0, trainedCount: 0, highQualityCount: 0, elapsedMs: Date.now() - startMs, epoch: eng.network.epoch };
  }

  // Unlike processFeedback, restTrain is a long, low-frequency, one-time-ish
  // bootstrap pass over the whole catalog (potentially thousands of trainStep
  // calls) — version-checking per catalog item would mean hundreds of DB
  // round trips for a single logical operation. Instead: train fully in
  // memory, then attempt ONE versioned save at the end. If that conflicts,
  // reload the latest state — if another writer already completed
  // rest-training in the meantime (restTrainedAt is set), skip re-running
  // the whole pass; otherwise retry it once against the fresh state.
  for (let attempt = 0; attempt < 2; attempt++) {
    let trainedCount = 0;
    let highQualityCount = 0;
    const fisherDataset: { embedding: number[]; rating: number }[] = [];

    for (const anime of animeList) {
      try {
        let embedding = getSharedEmbedding(anime.mal_id);
        if (!embedding) {
          embedding = await embedAnimeWithFallback(anime as AnimeInfo);
          setSharedEmbedding(anime.mal_id, embedding);
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
    const saved = await persistEngine(userId, eng);
    const elapsed = Date.now() - startMs;

    if (saved) {
      aiLog("info", "resttrain_complete", { userId, trainedCount, highQualityCount, elapsedMs: elapsed });
      return {
        animeCount: animeList.length,
        trainedCount,
        highQualityCount,
        elapsedMs: elapsed,
        epoch: eng.network.epoch,
      };
    }

    // Conflict: reload the latest state and check whether another writer
    // already finished rest-training in the meantime.
    engines.delete(userId);
    engineAccessTime.delete(userId);
    eng = await getEngine(userId);
    if (eng.restTrainedAt !== null) {
      aiLog("info", "resttrain_skip_duplicate", { userId });
      return {
        animeCount: animeList.length,
        trainedCount,
        highQualityCount,
        elapsedMs: Date.now() - startMs,
        epoch: eng.network.epoch,
      };
    }
    aiLog("warn", "resttrain_conflict_retry", { userId });
  }

  // Both attempts conflicted without another writer having finished either —
  // extremely unlikely (would require two competing rest-training runs on
  // different instances at the exact same time). Log and return rather than
  // throwing, since the caller can retry via a fresh request.
  aiLog("error", "resttrain_retries_exhausted", { userId });
  return {
    animeCount: animeList.length,
    trainedCount: 0,
    highQualityCount: 0,
    elapsedMs: Date.now() - startMs,
    epoch: eng.network.epoch,
  };
}
