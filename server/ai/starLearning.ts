/**
 * starLearning.ts
 *
 * Learning chatbot layer for Star. Uses a Forward-Forward network to score
 * (user-message-embedding, response-category-embedding) pairs, learning which
 * response types best match different user inputs.
 *
 * Bootstrap: positive pairs from GENRE_KEYWORD_MAP / MOOD_MAP → the FF network
 * starts with the keyword system's knowledge already baked in.
 * Ongoing:   keyword-validated signals and explicit thumbs up/down refine scoring.
 * EWC:       Elastic Weight Consolidation protects the bootstrapped knowledge.
 */

import * as fs from "fs";
import * as path from "path";
import { normalize } from "./matrix.js";
import {
  createNetwork, trainStep, infer, applyEWCCorrection,
  type FFNetworkState,
} from "./forwardForward.js";
import { createEWCState, computeFisher, type EWCState } from "./ewc.js";
import { GENRE_KEYWORD_MAP, MOOD_MAP } from "./starPersonality.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAR_LEARNING_PATH = path.resolve(process.cwd(), "ai-star-learning-state.json");

/** Dimension of the chat-text embedding. */
const CHAT_EMB_DIM = 64;

/** The FF network takes a concatenated (input_emb ‖ response_emb) vector. */
const PAIR_DIM = CHAT_EMB_DIM * 2;

/** Layer sizes for Star's chat FF network. */
const NET_LAYERS = [PAIR_DIM, 64, 32];

/**
 * Minimum FF "goodness" score below which the learning system defers to the
 * keyword-based fallback in starChat.ts.
 */
export const STAR_CONFIDENCE_THRESHOLD = 1.5;

/** EWC regularisation strength (lighter than the recommendation engine's 80). */
const CHAT_EWC_LAMBDA = 40;

/** Maximum interactions kept for potential future consolidation. */
const CHAT_REPLAY_CAPACITY = 200;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ResponsePoolEntry {
  id: string;
  text: string;
  embedding: number[];
  /** "genre:Action", "mood:happy", "general", "intro" */
  category: string;
}

interface ChatReplayEntry {
  inputEmb: number[];
  responseEmb: number[];
  isPositive: boolean;
  strength: number;
}

export interface StarLearningState {
  network: FFNetworkState;
  ewc: EWCState;
  responsePool: ResponsePoolEntry[];
  bootstrapped: boolean;
  chatReplay: ChatReplayEntry[];
}

export interface SelectionResult {
  entry: ResponsePoolEntry;
  goodness: number;
  /** Pre-computed input embedding — reuse for recordInteraction calls. */
  inputEmb: number[];
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _state: StarLearningState | null = null;
let _ready = false;

// ---------------------------------------------------------------------------
// Text embedding
// ---------------------------------------------------------------------------

function hashMod(token: string, buckets: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h) ^ token.charCodeAt(i);
    h = h >>> 0;
  }
  return h % buckets;
}

/**
 * Hash-based bag-of-words embedding.
 * Produces a normalised CHAT_EMB_DIM-dimensional vector from any text.
 */
export function embedChatText(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const vec: number[] = new Array(CHAT_EMB_DIM).fill(0);
  for (const token of tokens) {
    vec[hashMod(token, CHAT_EMB_DIM)] += 1;
  }
  return normalize(vec);
}

// ---------------------------------------------------------------------------
// Response pool seeds
// ---------------------------------------------------------------------------

/**
 * Canonical descriptions for each genre.
 * These become the "response embeddings" that the FF network learns to match
 * against user-message embeddings.
 */
const GENRE_SEEDS: Record<string, string> = {
  "Action": "action combat battle fight power intense energy warrior strength hero adrenaline rush",
  "Adventure": "adventure journey explore travel quest discover world places unknown",
  "Comedy": "comedy funny humor laugh lighthearted amusing jokes cheerful fun wit",
  "Drama": "drama emotion character heartfelt touching serious story depth",
  "Fantasy": "fantasy magic world creatures powers mystical realm enchanted supernatural",
  "Isekai": "isekai transported another world reincarnation new life overpowered fantasy",
  "Magic": "magic magical spells powers wizard sorcerer enchanted mystical abilities",
  "Mecha": "mecha robot machine giant pilot mechanical battle armor technology",
  "Mystery": "mystery detective investigate clue secret puzzle crime unknown reveal",
  "Psychological": "psychological mind mental twist manipulation complex dark deep thought",
  "Romance": "romance love relationship heart emotion feelings tender beautiful couple connection",
  "School": "school students classroom friends youth growing coming age teenage",
  "Sci-Fi": "science fiction futuristic technology robot space advanced future universe",
  "Seinen": "seinen mature adult complex themes realistic dark nuanced",
  "Shoujo": "shoujo girl feelings relationships romance coming age emotion growth",
  "Shounen": "shounen hero power growth friends rivals battle determination overcome challenge",
  "Slice of Life": "slice life calm peaceful everyday ordinary relax wholesome cozy comfort",
  "Sports": "sports competition training hard work team win determination achievement",
  "Supernatural": "supernatural spirits ghosts paranormal demons otherworldly mystical powers",
  "Thriller": "thriller suspense tension danger intense fear edge seat gripping",
  "Vampire": "vampire blood immortal night dark supernatural creature eternal",
  "Space": "space universe galaxy stars cosmic vast exploration stellar planet",
  "Historical": "historical past era period traditional culture ancient civilization",
  "Samurai": "samurai sword warrior bushido honor feudal japan katana duel",
  "Horror": "horror scary fear creepy monster dark terrifying nightmare disturbing",
  "Dark Fantasy": "dark fantasy grim brutal violence mature world struggle despair",
  "Super Power": "super power ability special skill superpower hero overpowered strength",
  "Military": "military war battle strategy soldiers conflict tactics operation",
  "Martial Arts": "martial arts fighting techniques combat training physical discipline dojo",
  "Iyashikei": "iyashikei healing calm soothing comfort cozy relaxing peaceful gentle",
  "Police": "police law enforcement detective crime investigation justice order",
  "Parody": "parody comedy spoof satire funny humor laugh genre subvert",
  "Reincarnation": "reincarnation second chance new life memory past reborn soul reborn",
};

const MOOD_SEEDS: Record<string, string> = {
  "happy": "happy cheerful fun joyful positive upbeat good mood enjoy bright",
  "sad": "sad emotional melancholy tears cry moving touching deep heartfelt grief",
  "excited": "excited hype intense adrenaline energy pumped thrilling high fire",
  "relax": "relax calm peaceful chill quiet comfort soothing gentle easy slow",
  "dark": "dark grim serious mature complex deep psychological heavy bleak",
  "inspiring": "inspiring motivating uplifting hopeful determination overcome growth push",
  "epic": "epic grand scale massive powerful legendary heroic vast impact",
  "funny": "funny comedy humor amusing entertaining laughter jokes wit lighthearted",
  "wholesome": "wholesome sweet heartwarming cozy comfortable warm fuzzy gentle kind",
  "mind-bending": "mind bending complex twist intelligent thought provoking layers puzzle deep",
};

function buildResponsePool(): ResponsePoolEntry[] {
  const pool: ResponsePoolEntry[] = [];

  for (const [genre, desc] of Object.entries(GENRE_SEEDS)) {
    pool.push({
      id: `genre:${genre}`,
      text: desc,
      embedding: embedChatText(desc),
      category: `genre:${genre}`,
    });
  }

  for (const [mood, desc] of Object.entries(MOOD_SEEDS)) {
    pool.push({
      id: `mood:${mood}`,
      text: desc,
      embedding: embedChatText(desc),
      category: `mood:${mood}`,
    });
  }

  const generalTexts = [
    "tell me about yourself what genres anime do you enjoy what kind moves you feel",
    "what draws you to anime stories worlds characters emotions connections",
    "find perfect anime for you share your taste preferences what you like dislike",
    "every story unique what kind of feeling are you searching for today",
  ];
  generalTexts.forEach((text, i) => {
    pool.push({ id: `general:${i}`, text, embedding: embedChatText(text), category: "general" });
  });

  const introTexts = [
    "hello i am star i carry light of every anime story ever told i am here for you",
    "welcome i am star born collective hope every anime every dream every battle triumph",
    "greetings i am star shaped by every genre emotion story made someone feel less alone",
  ];
  introTexts.forEach((text, i) => {
    pool.push({ id: `intro:${i}`, text, embedding: embedChatText(text), category: "intro" });
  });

  return pool;
}

// ---------------------------------------------------------------------------
// Pair construction helpers
// ---------------------------------------------------------------------------

function makePairInput(inputEmb: number[], responseEmb: number[]): number[] {
  return [...inputEmb, ...responseEmb];
}

// ---------------------------------------------------------------------------
// Bootstrap training
// ---------------------------------------------------------------------------

/**
 * Trains the FF network on positive/negative pairs derived from the existing
 * keyword→genre mapping so the network starts with the keyword system's
 * knowledge baked in.
 */
function bootstrapTrain(state: StarLearningState): void {
  const { network: net, responsePool: pool } = state;

  // Map genre name → pool entry
  const genreToEntry = new Map<string, ResponsePoolEntry>();
  for (const entry of pool) {
    if (entry.category.startsWith("genre:")) {
      genreToEntry.set(entry.category.slice(6), entry);
    }
  }

  const allGenreNames = [...genreToEntry.keys()];
  const pairs: { pos: number[]; neg: number[] }[] = [];

  // Positive pairs from GENRE_KEYWORD_MAP
  for (const [keyword, genre] of GENRE_KEYWORD_MAP) {
    const posEntry = genreToEntry.get(genre);
    if (!posEntry) continue;

    const syntheticMessages = [
      `I love ${keyword} anime`,
      `recommend ${keyword} anime please`,
      `I want to watch ${keyword}`,
      `${keyword} is my favourite type`,
    ];

    for (const msg of syntheticMessages) {
      const inputEmb = embedChatText(msg);
      const pos = makePairInput(inputEmb, posEntry.embedding);

      const otherGenres = allGenreNames.filter((g) => g !== genre);
      if (otherGenres.length === 0) continue;
      const negGenre = otherGenres[Math.floor(Math.random() * otherGenres.length)];
      const negEntry = genreToEntry.get(negGenre)!;
      const neg = makePairInput(inputEmb, negEntry.embedding);

      pairs.push({ pos, neg });
    }
  }

  // Positive pairs from MOOD_MAP
  for (const [moodKw, genres] of MOOD_MAP) {
    const primaryGenre = genres[0];
    const posEntry = genreToEntry.get(primaryGenre);
    if (!posEntry) continue;

    const inputEmb = embedChatText(`I feel ${moodKw} mood want anime`);
    const pos = makePairInput(inputEmb, posEntry.embedding);

    const otherGenres = allGenreNames.filter((g) => !genres.includes(g));
    if (otherGenres.length === 0) continue;
    const negGenre = otherGenres[Math.floor(Math.random() * otherGenres.length)];
    const negEntry = genreToEntry.get(negGenre)!;
    const neg = makePairInput(inputEmb, negEntry.embedding);

    pairs.push({ pos, neg });
  }

  // 5 training passes over all pairs (shuffled each time)
  for (let pass = 0; pass < 5; pass++) {
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (const { pos, neg } of pairs) {
      trainStep(net, pos, neg);
    }
  }

  // Compute Fisher information to anchor bootstrapped weights via EWC.
  // Limit to 100 samples for speed.
  const fisherDataset = pairs
    .slice(0, 100)
    .map(({ pos }) => ({ embedding: pos, rating: 1.0 }));
  computeFisher(state.ewc, net, fisherDataset);

  console.log(
    `[Star] Bootstrap complete — ${pairs.length} pairs, ${net.epoch} FF epochs`
  );
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function persistState(state: StarLearningState): void {
  try {
    fs.writeFileSync(STAR_LEARNING_PATH, JSON.stringify(state), "utf-8");
  } catch (e) {
    console.warn("[Star] Failed to save learning state:", e);
  }
}

function loadPersistedState(): StarLearningState | null {
  try {
    if (!fs.existsSync(STAR_LEARNING_PATH)) return null;
    const raw = fs.readFileSync(STAR_LEARNING_PATH, "utf-8");
    const s = JSON.parse(raw) as StarLearningState;
    // Ensure all required fields are present for forward-compatibility
    if (!s.chatReplay) s.chatReplay = [];
    if (!s.responsePool) s.responsePool = buildResponsePool();
    return s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialise Star's learning system.
 * Loads existing state if available; otherwise bootstraps from the keyword
 * mappings in starPersonality.ts.  Call once at server startup.
 */
export async function initStarLearning(): Promise<void> {
  const existing = loadPersistedState();
  if (existing?.bootstrapped) {
    _state = existing;
    _ready = true;
    console.log(
      `[Star] Loaded learning state — epoch ${existing.network.epoch}, ` +
      `${existing.responsePool.length} pool entries`
    );
    return;
  }

  console.log("[Star] Bootstrapping learning system from keyword map...");
  const fresh: StarLearningState = {
    network: createNetwork(NET_LAYERS),
    ewc: createEWCState(),
    responsePool: buildResponsePool(),
    bootstrapped: false,
    chatReplay: [],
  };

  bootstrapTrain(fresh);
  fresh.bootstrapped = true;
  persistState(fresh);

  _state = fresh;
  _ready = true;
  console.log("[Star] Learning system ready.");
}

export function isStarLearningReady(): boolean {
  return _ready && _state !== null;
}

// ---------------------------------------------------------------------------
// Public API — inference
// ---------------------------------------------------------------------------

/**
 * Score all pool entries against a pre-computed input embedding and return
 * the best match.
 */
export function selectResponseFromEmb(inputEmb: number[]): SelectionResult | null {
  if (!_state) return null;

  let bestEntry: ResponsePoolEntry | null = null;
  let bestGoodness = -Infinity;

  for (const entry of _state.responsePool) {
    const g = infer(_state.network, makePairInput(inputEmb, entry.embedding));
    if (g > bestGoodness) {
      bestGoodness = g;
      bestEntry = entry;
    }
  }

  if (!bestEntry) return null;
  return { entry: bestEntry, goodness: bestGoodness, inputEmb };
}

/** Convenience wrapper — embeds `message` then calls selectResponseFromEmb. */
export function selectResponse(message: string): SelectionResult | null {
  return selectResponseFromEmb(embedChatText(message));
}

// ---------------------------------------------------------------------------
// Public API — learning
// ---------------------------------------------------------------------------

/**
 * Record one (input, response) interaction and immediately train the FF
 * network on it, then apply EWC correction to protect prior knowledge.
 *
 * @param inputEmb     Embedded user message (from embedChatText).
 * @param responseEmb  Embedded response pool entry.
 * @param isPositive   True → reinforce; False → suppress.
 * @param strength     Learning weight multiplier in [0, 1].
 */
export function recordInteraction(
  inputEmb: number[],
  responseEmb: number[],
  isPositive: boolean,
  strength = 0.5
): void {
  if (!_state) return;
  const { network: net, responsePool: pool } = _state;

  // Add to replay buffer (oldest entry evicted when full)
  if (_state.chatReplay.length >= CHAT_REPLAY_CAPACITY) {
    _state.chatReplay.shift();
  }
  _state.chatReplay.push({ inputEmb, responseEmb, isPositive, strength });

  if (pool.length === 0) return;

  // Pick a random contrast sample from the pool
  const contrastEntry = pool[Math.floor(Math.random() * pool.length)];
  const thisPair = makePairInput(inputEmb, responseEmb);
  const contrastPair = makePairInput(inputEmb, contrastEntry.embedding);

  // Temporarily scale the learning rate by strength
  const origLr = net.learningRate;
  net.learningRate = origLr * Math.max(0.05, strength);

  if (isPositive) {
    trainStep(net, thisPair, contrastPair);
  } else {
    trainStep(net, contrastPair, thisPair);
  }

  net.learningRate = origLr;

  // EWC correction — protects bootstrapped keyword knowledge
  if (_state.ewc.fisher.length > 0) {
    applyEWCCorrection(
      net,
      _state.ewc.fisher,
      _state.ewc.optimalWeights,
      _state.ewc.optimalBiases,
      CHAT_EWC_LAMBDA
    );
  }
}

/**
 * Look up a pool entry by its `id` or `category` string and call
 * recordInteraction.  A no-op if no matching entry is found.
 */
export function recordInteractionByCategory(
  inputEmb: number[],
  categoryId: string,
  isPositive: boolean,
  strength = 0.5
): void {
  if (!_state) return;
  const entry = _state.responsePool.find(
    (e) => e.id === categoryId || e.category === categoryId
  );
  if (!entry) return;
  recordInteraction(inputEmb, entry.embedding, isPositive, strength);
}

/**
 * Explicit feedback from the API endpoint.
 * Re-embeds `message` server-side, finds the matching pool entry, trains,
 * and persists state.
 */
export function recordChatFeedback(
  message: string,
  categoryId: string,
  isPositive: boolean
): void {
  if (!_state) return;
  const inputEmb = embedChatText(message);
  const entry = _state.responsePool.find(
    (e) => e.id === categoryId || e.category === categoryId
  );
  if (!entry) return;
  recordInteraction(inputEmb, entry.embedding, isPositive, isPositive ? 1.0 : 0.8);
  persistState(_state);
}

/** Persist the current state to disk. */
export function saveStarLearning(): void {
  if (_state) persistState(_state);
}

/** Raw state accessor — used by modelStore for unified serialisation. */
export function getStarLearningState(): StarLearningState | null {
  return _state;
}
