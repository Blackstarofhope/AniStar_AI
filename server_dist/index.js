// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import * as https5 from "https";

// server/storage.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, inArray, sql as sql2 } from "drizzle-orm";

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, serial, timestamp, jsonb, unique, primaryKey, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var userEngineState = pgTable("user_engine_state", {
  userId: text("user_id").primaryKey(),
  engineJson: jsonb("engine_json").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var animeSearched = pgTable("anime_searched", {
  malId: integer("mal_id").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var vibeProfiles = pgTable("vibe_profiles", {
  malId: integer("mal_id").primaryKey(),
  profile: jsonb("profile").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var userRatings = pgTable("user_ratings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  rating: real("rating").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
  userMalUnique: unique("user_ratings_user_mal_unique").on(t.userId, t.malId)
}));
var animeDiscovery = pgTable("anime_discovery", {
  malId: integer("mal_id").primaryKey(),
  discoveredByUserId: text("discovered_by_user_id").notNull(),
  discoveredByDisplayName: text("discovered_by_display_name").notNull(),
  discoveredAt: timestamp("discovered_at").defaultNow().notNull()
});
var userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  pin: text("pin"),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
  displayNameUnique: unique("user_profiles_display_name_unique").on(t.displayName)
}));
var userBanList = pgTable("user_ban_list", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  malId: integer("mal_id"),
  bannedGenre: text("banned_genre"),
  bannedTrope: text("banned_trope"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
  userMalUnique: unique("user_ban_list_user_mal_unique").on(t.userId, t.malId),
  userGenreUnique: unique("user_ban_list_user_genre_unique").on(t.userId, t.bannedGenre)
}));
var userWatchState = pgTable("user_watch_state", {
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  state: text("state").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.malId] })
}));
var userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  hiddenGemBias: real("hidden_gem_bias").notNull().default(0.5),
  subDubPreference: text("sub_dub_preference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var userChatUsage = pgTable("user_chat_usage", {
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  messageCount: integer("message_count").notNull().default(0)
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] })
}));
var userOnboarding = pgTable("user_onboarding", {
  userId: text("user_id").primaryKey(),
  pathChosen: text("path_chosen"),
  completed: boolean("completed").notNull().default(false),
  unlockedRecommendations: boolean("unlocked_recommendations").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at")
});
var userCharacterRatings = pgTable("user_character_ratings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  characterId: text("character_id").notNull(),
  rating: integer("rating").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
  userCharUnique: unique("user_character_ratings_user_char_unique").on(t.userId, t.characterId)
}));
var animeReasons = pgTable("anime_reasons", {
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.malId] })
}));
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});

// server/storage.ts
if (!process.env.DATABASE_URL) {
  console.warn("[DB] WARNING: DATABASE_URL is not set \u2014 database features will not work.");
}
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 1e4,
  connectionTimeoutMillis: 5e3,
  allowExitOnIdle: true
});
pool.on("error", (err) => {
  console.warn("[DB] Pool error:", err.message);
});
var db = drizzle(pool);
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    console.log("[DB] Connection OK \u2014 database is reachable.");
  } catch (err) {
    console.error("[DB] Connection FAILED:", err instanceof Error ? err.message : err);
  }
}
var PostgresStorage = class {
  async withRetry(fn, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isConnectionError = err?.message?.includes("terminat") || err?.message?.includes("timeout") || err?.message?.includes("ECONNREFUSED");
        if (isConnectionError && attempt < retries) {
          console.warn(`[DB] Retry ${attempt + 1}/${retries} after connection error`);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error("unreachable");
  }
  async getUser(id) {
    return this.withRetry(
      () => db.select().from(users).where(eq(users.id, id)).then((rows) => rows[0])
    );
  }
  async getUserByUsername(username) {
    return this.withRetry(
      () => db.select().from(users).where(eq(users.username, username)).then((rows) => rows[0])
    );
  }
  async createUser(insertUser) {
    return this.withRetry(
      () => db.insert(users).values(insertUser).returning().then((rows) => rows[0])
    );
  }
  async saveEngineState(userId, json) {
    return this.withRetry(
      () => db.insert(userEngineState).values({ userId, engineJson: json, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: userEngineState.userId,
        set: { engineJson: json, updatedAt: /* @__PURE__ */ new Date() }
      }).then(() => void 0)
    );
  }
  async loadEngineState(userId) {
    return this.withRetry(
      () => db.select().from(userEngineState).where(eq(userEngineState.userId, userId)).then((rows) => rows[0]?.engineJson ?? null)
    );
  }
  async saveSearchedAnime(malId, data) {
    return this.withRetry(
      () => db.insert(animeSearched).values({ malId, data }).onConflictDoUpdate({
        target: animeSearched.malId,
        set: { data }
      }).then(() => void 0)
    );
  }
  async getAllSearchedAnime() {
    return this.withRetry(
      () => db.select().from(animeSearched).then((rows) => rows.map((r) => ({ malId: r.malId, data: r.data })))
    );
  }
  async saveVibeProfile(malId, profile) {
    return this.withRetry(
      () => db.insert(vibeProfiles).values({ malId, profile }).onConflictDoUpdate({
        target: vibeProfiles.malId,
        set: { profile }
      }).then(() => void 0)
    );
  }
  async getVibeProfile(malId) {
    return this.withRetry(
      () => db.select().from(vibeProfiles).where(eq(vibeProfiles.malId, malId)).then((rows) => rows[0]?.profile ?? null)
    );
  }
  async getAllVibeProfiles() {
    return this.withRetry(
      () => db.select().from(vibeProfiles).then((rows) => rows.map((r) => ({ malId: r.malId, profile: r.profile })))
    );
  }
  async saveRating(userId, malId, rating) {
    return this.withRetry(
      () => db.insert(userRatings).values({ userId, malId, rating }).onConflictDoUpdate({
        target: [userRatings.userId, userRatings.malId],
        set: { rating }
      }).then(() => void 0)
    );
  }
  async getUserRatings(userId) {
    return this.withRetry(
      () => db.select().from(userRatings).where(eq(userRatings.userId, userId)).then((rows) => rows.map((r) => ({ malId: r.malId, rating: r.rating })))
    );
  }
  async recordDiscovery(malId, userId, displayName) {
    return this.withRetry(
      () => db.insert(animeDiscovery).values({ malId, discoveredByUserId: userId, discoveredByDisplayName: displayName }).onConflictDoNothing().then(() => void 0)
    );
  }
  async getDiscovery(malId) {
    return this.withRetry(
      () => db.select().from(animeDiscovery).where(eq(animeDiscovery.malId, malId)).then((rows) => {
        if (!rows[0]) return null;
        return {
          userId: rows[0].discoveredByUserId,
          displayName: rows[0].discoveredByDisplayName,
          discoveredAt: rows[0].discoveredAt
        };
      })
    );
  }
  async setDisplayName(userId, displayName, pin) {
    return this.withRetry(() => {
      const vals = { userId, displayName };
      if (pin !== void 0) vals.pin = pin;
      const updateSet = { displayName };
      if (pin !== void 0) updateSet.pin = pin;
      return db.insert(userProfiles).values(vals).onConflictDoUpdate({
        target: userProfiles.userId,
        set: updateSet
      }).then(() => void 0);
    });
  }
  async getDisplayName(userId) {
    return this.withRetry(
      () => db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((rows) => rows[0]?.displayName ?? null)
    );
  }
  async isDisplayNameTaken(displayName, excludeUserId) {
    return this.withRetry(
      () => db.select().from(userProfiles).where(eq(userProfiles.displayName, displayName)).then((rows) => rows.some((r) => r.userId !== excludeUserId))
    );
  }
  async loginWithDisplayName(displayName, pin) {
    return this.withRetry(
      () => db.select().from(userProfiles).where(eq(userProfiles.displayName, displayName)).then((rows) => {
        const match = rows.find((r) => r.pin === pin);
        return match?.userId ?? null;
      })
    );
  }
  async getAllUserProfiles() {
    return this.withRetry(
      () => db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles).then((rows) => rows)
    );
  }
  async addBan(userId, ban) {
    return this.withRetry(
      () => db.insert(userBanList).values({
        userId,
        malId: ban.malId ?? null,
        bannedGenre: ban.bannedGenre ?? null,
        bannedTrope: ban.bannedTrope ?? null,
        reason: ban.reason ?? null
      }).onConflictDoNothing().then(() => void 0)
    );
  }
  async removeBan(userId, banId) {
    return this.withRetry(
      () => db.delete(userBanList).where(and(eq(userBanList.id, banId), eq(userBanList.userId, userId))).then(() => void 0)
    );
  }
  async getUserBans(userId) {
    return this.withRetry(
      () => db.select().from(userBanList).where(eq(userBanList.userId, userId)).then(
        (rows) => rows.map((r) => ({
          id: r.id,
          malId: r.malId,
          bannedGenre: r.bannedGenre,
          bannedTrope: r.bannedTrope,
          reason: r.reason
        }))
      )
    );
  }
  async isAnimeBanned(userId, malId, genres) {
    return this.withRetry(async () => {
      const bans = await db.select().from(userBanList).where(eq(userBanList.userId, userId));
      return bans.some(
        (b) => b.malId === malId || b.bannedGenre !== null && genres.includes(b.bannedGenre)
      );
    });
  }
  async setWatchState(userId, malId, state) {
    return this.withRetry(
      () => db.insert(userWatchState).values({ userId, malId, state, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [userWatchState.userId, userWatchState.malId],
        set: { state, updatedAt: /* @__PURE__ */ new Date() }
      }).then(() => void 0)
    );
  }
  async getUserWatchStates(userId) {
    return this.withRetry(
      () => db.select().from(userWatchState).where(eq(userWatchState.userId, userId)).then((rows) => rows.map((r) => ({ malId: r.malId, state: r.state })))
    );
  }
  async getWatchedMalIds(userId) {
    return this.withRetry(
      () => db.select().from(userWatchState).where(
        and(
          eq(userWatchState.userId, userId),
          inArray(userWatchState.state, ["completed", "dropped"])
        )
      ).then((rows) => new Set(rows.map((r) => r.malId)))
    );
  }
  async setHiddenGemBias(userId, bias) {
    const clamped = Math.max(0, Math.min(1, bias));
    return this.withRetry(
      () => db.insert(userPreferences).values({ userId, hiddenGemBias: clamped, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: userPreferences.userId,
        set: { hiddenGemBias: clamped, updatedAt: /* @__PURE__ */ new Date() }
      }).then(() => void 0)
    );
  }
  async getHiddenGemBias(userId) {
    return this.withRetry(
      () => db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).then((rows) => rows[0]?.hiddenGemBias ?? 0.5)
    );
  }
  async setSubDubPreference(userId, pref) {
    return this.withRetry(
      () => db.insert(userPreferences).values({ userId, subDubPreference: pref, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: userPreferences.userId,
        set: { subDubPreference: pref, updatedAt: /* @__PURE__ */ new Date() }
      }).then(() => void 0)
    );
  }
  async incrementChatCount(userId, date) {
    return this.withRetry(
      () => db.insert(userChatUsage).values({ userId, date, messageCount: 1 }).onConflictDoUpdate({
        target: [userChatUsage.userId, userChatUsage.date],
        set: { messageCount: sql2`${userChatUsage.messageCount} + 1` }
      }).returning({ messageCount: userChatUsage.messageCount }).then((rows) => rows[0]?.messageCount ?? 1)
    );
  }
  async getChatCount(userId, date) {
    return this.withRetry(
      () => db.select().from(userChatUsage).where(and(eq(userChatUsage.userId, userId), eq(userChatUsage.date, date))).then((rows) => rows[0]?.messageCount ?? 0)
    );
  }
  async getOnboardingState(userId) {
    return this.withRetry(
      () => db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId)).then((rows) => {
        if (!rows[0]) return null;
        return {
          pathChosen: rows[0].pathChosen,
          completed: rows[0].completed,
          unlockedRecommendations: rows[0].unlockedRecommendations
        };
      })
    );
  }
  async setOnboardingPath(userId, path6) {
    return this.withRetry(
      () => db.insert(userOnboarding).values({ userId, pathChosen: path6 }).onConflictDoUpdate({
        target: userOnboarding.userId,
        set: { pathChosen: path6 }
      }).then(() => void 0)
    );
  }
  async completeOnboarding(userId) {
    return this.withRetry(
      () => db.insert(userOnboarding).values({ userId, completed: true, unlockedRecommendations: true, completedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: userOnboarding.userId,
        set: { completed: true, unlockedRecommendations: true, completedAt: /* @__PURE__ */ new Date() }
      }).then(() => void 0)
    );
  }
  async unlockRecommendations(userId) {
    return this.withRetry(
      () => db.insert(userOnboarding).values({ userId, unlockedRecommendations: true }).onConflictDoUpdate({
        target: userOnboarding.userId,
        set: { unlockedRecommendations: true }
      }).then(() => void 0)
    );
  }
  async saveCharacterRating(userId, characterId, rating) {
    return this.withRetry(
      () => db.insert(userCharacterRatings).values({ userId, characterId, rating }).onConflictDoUpdate({
        target: [userCharacterRatings.userId, userCharacterRatings.characterId],
        set: { rating }
      }).then(() => void 0)
    );
  }
  async getCharacterRatings(userId) {
    return this.withRetry(
      () => db.select().from(userCharacterRatings).where(eq(userCharacterRatings.userId, userId)).then((rows) => rows.map((r) => ({ characterId: r.characterId, rating: r.rating })))
    );
  }
  async saveAnimeReason(userId, malId, reason) {
    return this.withRetry(
      () => db.insert(animeReasons).values({ userId, malId, reason }).onConflictDoUpdate({
        target: [animeReasons.userId, animeReasons.malId],
        set: { reason }
      }).then(() => void 0)
    );
  }
};
var storage = new PostgresStorage();

// server/ai/matrix.ts
function zerosVec(n) {
  return new Array(n).fill(0);
}
function kaiming(rows, cols) {
  const std = Math.sqrt(2 / cols);
  return Array.from(
    { length: rows },
    () => Array.from({ length: cols }, () => randn() * std)
  );
}
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function matvec(M, x) {
  return M.map((row) => row.reduce((s, w, j) => s + w * x[j], 0));
}
function relu(v) {
  return v.map((x) => Math.max(0, x));
}
function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}
function layerNorm(v) {
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  const std = Math.sqrt(variance + 1e-8);
  return v.map((x) => (x - mean) / std);
}
function normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) + 1e-8;
  return v.map((x) => x / norm);
}
function dot(a, b) {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}
function cosineSim(a, b) {
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) + 1e-8;
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0)) + 1e-8;
  return dot(a, b) / (na * nb);
}
function addVec(a, b) {
  return a.map((x, i) => x + b[i]);
}
function scaleVec(v, s) {
  return v.map((x) => x * s);
}
function outerProduct(a, b) {
  return a.map((ai) => b.map((bi) => ai * bi));
}
function addMatrix(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}
function goodness(h) {
  return h.reduce((s, x) => s + x * x, 0);
}

// server/ai/forwardForward.ts
var THRESHOLD = 2;
var LEARNING_RATE = 0.03;
var WINDOW_SIZE = 5;
function createLayer(inputSize, outputSize) {
  return {
    weights: kaiming(outputSize, inputSize),
    biases: zerosVec(outputSize),
    phases: Array.from({ length: outputSize }, () => Math.random() * 2 * Math.PI),
    goodnessWindow: [],
    activationSum: zerosVec(outputSize),
    activationEntropyWindow: []
  };
}
function createNetwork(layerSizes) {
  const layers = [];
  for (let i = 0; i < layerSizes.length - 1; i++) {
    layers.push(createLayer(layerSizes[i], layerSizes[i + 1]));
  }
  return { layers, epoch: 0, threshold: THRESHOLD, learningRate: LEARNING_RATE, goodnessHistory: [] };
}
function layerForward(layer, input) {
  const normed = normalize(input);
  const z = matvec(layer.weights, normed);
  const h = relu(addVec(z, layer.biases));
  return layerNorm(h);
}
function computeActivations(layer, input) {
  const normedInput = normalize(input);
  const z = matvec(layer.weights, normedInput);
  const h = relu(addVec(z, layer.biases));
  return { h, normedInput };
}
function computeActivationEntropy(h) {
  const sq = h.map((x) => x * x);
  const total = sq.reduce((s, v) => s + v, 0) + 1e-8;
  const probs = sq.map((v) => v / total);
  return -probs.reduce((s, p) => {
    if (p <= 0) return s;
    return s + p * Math.log(p + 1e-8);
  }, 0);
}
function trainLayerStep(layer, input, isPositive, lr, threshold) {
  const { h, normedInput } = computeActivations(layer, input);
  const g = goodness(h);
  const label = isPositive ? 1 : 0;
  const prob = sigmoid(g - threshold);
  const delta = label - prob;
  const dhda = h.map((hi) => hi > 0 ? 2 * hi : 0);
  const scaledGrad = scaleVec(dhda, lr * delta);
  const dW = outerProduct(scaledGrad, normedInput);
  layer.weights = addMatrix(layer.weights, dW);
  layer.biases = addVec(layer.biases, scaledGrad);
  for (let i = 0; i < h.length; i++) {
    layer.activationSum[i] += h[i];
  }
  const entropy = computeActivationEntropy(h);
  layer.activationEntropyWindow.push(entropy);
  if (layer.activationEntropyWindow.length > WINDOW_SIZE) {
    layer.activationEntropyWindow.shift();
  }
  return g;
}
function trainStep(net, positiveInput, negativeInput) {
  let totalGoodness = 0;
  let currentPos = positiveInput;
  let currentNeg = negativeInput;
  for (const layer of net.layers) {
    const g = trainLayerStep(layer, currentPos, true, net.learningRate, net.threshold);
    trainLayerStep(layer, currentNeg, false, net.learningRate, net.threshold);
    totalGoodness += g;
    currentPos = layerForward(layer, currentPos);
    currentNeg = layerForward(layer, currentNeg);
  }
  const normalizedG = totalGoodness / (net.layers.length || 1);
  net.goodnessHistory.push(normalizedG);
  if (net.goodnessHistory.length > 50) {
    net.goodnessHistory.shift();
  }
  net.epoch++;
  for (const layer of net.layers) {
    layer.goodnessWindow.push(normalizedG);
    if (layer.goodnessWindow.length > WINDOW_SIZE) {
      layer.goodnessWindow.shift();
    }
  }
  return normalizedG;
}
function applyEWCCorrection(net, fisher, optimalWeights, optimalBiases, lambda) {
  if (fisher.length === 0) return;
  const lr = net.learningRate;
  for (let li = 0; li < Math.min(net.layers.length, fisher.length); li++) {
    const layer = net.layers[li];
    const F = fisher[li];
    const Wstar = optimalWeights[li];
    const bstar = optimalBiases[li];
    if (!F || !Wstar) continue;
    for (let i = 0; i < Math.min(layer.weights.length, F.length, Wstar.length); i++) {
      for (let j = 0; j < Math.min(layer.weights[i].length, F[i]?.length ?? 0, Wstar[i]?.length ?? 0); j++) {
        const correction = lambda * F[i][j] * (layer.weights[i][j] - Wstar[i][j]);
        layer.weights[i][j] -= lr * correction;
      }
    }
    for (let i = 0; i < Math.min(layer.biases.length, bstar?.length ?? 0); i++) {
      const Fb = F[i]?.[0] ?? 0;
      const correction = lambda * Fb * (layer.biases[i] - bstar[i]);
      layer.biases[i] -= lr * correction;
    }
  }
}
function infer(net, input) {
  let totalGoodness = 0;
  let current = input;
  for (const layer of net.layers) {
    const h = layerForward(layer, current);
    totalGoodness += goodness(h);
    current = h;
  }
  return totalGoodness / (net.layers.length || 1);
}
function getLayerActivationEntropy(layer) {
  if (layer.activationEntropyWindow.length === 0) return Math.log(layer.biases.length || 1);
  return layer.activationEntropyWindow.reduce((s, e) => s + e, 0) / layer.activationEntropyWindow.length;
}
function createCorruptedInput(input) {
  const corrupted = [...input];
  const numFlip = Math.max(1, Math.floor(corrupted.length * 0.3));
  for (let i = 0; i < numFlip; i++) {
    const idx = Math.floor(Math.random() * corrupted.length);
    corrupted[idx] = randn() * 0.5;
  }
  return corrupted;
}
function growLayer(layer, inputSize) {
  const oldSize = layer.biases.length;
  const newNeurons = Math.max(1, Math.floor(oldSize * 0.2));
  const newSize = oldSize + newNeurons;
  const std = Math.sqrt(2 / (inputSize || 1));
  const newWeights = Array.from(
    { length: newNeurons },
    () => Array.from({ length: inputSize }, () => randn() * std)
  );
  return {
    weights: [...layer.weights, ...newWeights],
    biases: [...layer.biases, ...zerosVec(newNeurons)],
    phases: [...layer.phases, ...Array.from({ length: newNeurons }, () => Math.random() * 2 * Math.PI)],
    goodnessWindow: [...layer.goodnessWindow],
    activationSum: [...layer.activationSum, ...zerosVec(newNeurons)],
    activationEntropyWindow: [...layer.activationEntropyWindow]
  };
}
function pruneLayerWithIndices(layer) {
  const n = layer.biases.length;
  const pruneCount = Math.max(1, Math.floor(n * 0.1));
  if (n - pruneCount < 8) {
    const allIndices = new Set(Array.from({ length: n }, (_, i) => i));
    return { newLayer: layer, keptIndices: allIndices };
  }
  const indexed = layer.activationSum.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => a.s - b.s);
  const keptIndices = new Set(indexed.slice(pruneCount).map((x) => x.i));
  return {
    newLayer: {
      weights: layer.weights.filter((_, i) => keptIndices.has(i)),
      biases: layer.biases.filter((_, i) => keptIndices.has(i)),
      phases: layer.phases.filter((_, i) => keptIndices.has(i)),
      goodnessWindow: [...layer.goodnessWindow],
      activationSum: layer.activationSum.filter((_, i) => keptIndices.has(i)),
      activationEntropyWindow: [...layer.activationEntropyWindow]
    },
    keptIndices
  };
}
function getTotalNeurons(net) {
  return net.layers.reduce((s, l) => s + l.biases.length, 0);
}
function serializeNetwork(net) {
  return JSON.parse(JSON.stringify(net));
}
function deserializeNetwork(data) {
  const d = data;
  if (d.layers) {
    for (const layer of d.layers) {
      if (!layer.activationEntropyWindow) {
        layer.activationEntropyWindow = [];
      }
    }
  }
  return d;
}

// server/ai/kuramoto.ts
function ensureVibePhases(state) {
  if (!state.vibePhases || state.vibePhases.length !== state.textPhases.length) {
    state.vibePhases = Array.from({ length: state.textPhases.length }, () => Math.random() * TWO_PI);
  }
}
var TWO_PI = 2 * Math.PI;
var DT = 0.05;
function createKuramotoSystem(size) {
  return {
    textPhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    visionPhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    vibePhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    naturalFrequencies: Array.from({ length: size }, () => (Math.random() - 0.5) * 0.8),
    coupling: 0.5,
    orderHistory: []
  };
}
function kuramotoStep(phases, naturalFreqs, coupling, dt) {
  const n = phases.length;
  return phases.map((theta_i, i) => {
    let interaction = 0;
    for (let j = 0; j < n; j++) {
      interaction += Math.sin(phases[j] - theta_i);
    }
    const dtheta = naturalFreqs[i] + coupling / n * interaction;
    return (theta_i + dtheta * dt + TWO_PI) % TWO_PI;
  });
}
function stepKuramoto(state, steps = 1) {
  ensureVibePhases(state);
  for (let s = 0; s < steps; s++) {
    state.textPhases = kuramotoStep(state.textPhases, state.naturalFrequencies, state.coupling, DT);
    state.visionPhases = kuramotoStep(state.visionPhases, state.naturalFrequencies, state.coupling, DT);
    state.vibePhases = kuramotoStep(state.vibePhases, state.naturalFrequencies, state.coupling, DT);
    const crossCoupling = state.coupling * 0.3;
    const n = state.textPhases.length;
    const newText = state.textPhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.visionPhases[j] - theta_i);
        interaction += Math.sin(state.vibePhases[j] - theta_i);
      }
      return (theta_i + crossCoupling / n * interaction * DT + TWO_PI) % TWO_PI;
    });
    const newVision = state.visionPhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.textPhases[j] - theta_i);
      }
      return (theta_i + crossCoupling / n * interaction * DT + TWO_PI) % TWO_PI;
    });
    const newVibe = state.vibePhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.textPhases[j] - theta_i);
      }
      return (theta_i + crossCoupling / n * interaction * DT + TWO_PI) % TWO_PI;
    });
    state.textPhases = newText;
    state.visionPhases = newVision;
    state.vibePhases = newVibe;
  }
}
function orderParameter(phases) {
  const n = phases.length;
  let sinSum = 0;
  let cosSum = 0;
  for (const theta of phases) {
    sinSum += Math.sin(theta);
    cosSum += Math.cos(theta);
  }
  return Math.sqrt((sinSum / n) ** 2 + (cosSum / n) ** 2);
}
function synchronyIndex(state) {
  ensureVibePhases(state);
  const textOrder = orderParameter(state.textPhases);
  const visionOrder = orderParameter(state.visionPhases);
  const vibeOrder = orderParameter(state.vibePhases);
  const combined = [...state.textPhases, ...state.visionPhases, ...state.vibePhases];
  const globalOrder = orderParameter(combined);
  return (textOrder + visionOrder + vibeOrder + globalOrder) / 4;
}
function updateCouplingFromGoodness(state, goodness2) {
  const target = 0.3 + goodness2 * 0.7;
  state.coupling = state.coupling * 0.95 + target * 0.05;
  state.coupling = Math.max(0.1, Math.min(2, state.coupling));
}
function phaseModulatedEmbedding(embedding, phases) {
  const n = Math.min(embedding.length, phases.length);
  return embedding.map((v, i) => {
    if (i < n) {
      const phaseWeight = 0.5 + 0.5 * Math.cos(phases[i % n]);
      return v * phaseWeight;
    }
    return v;
  });
}
function phaseModulatedVibeEmbedding(embedding, state) {
  ensureVibePhases(state);
  const phases = state.vibePhases;
  const n = Math.min(embedding.length, phases.length);
  return embedding.map((v, i) => {
    if (i < n) {
      const phaseWeight = 0.5 + 0.5 * Math.cos(phases[i % n]);
      return v * phaseWeight;
    }
    return v;
  });
}
function alignVisionPhasesToEmbedding(state, visionEmbedding) {
  const n = Math.min(state.visionPhases.length, visionEmbedding.length);
  for (let i = 0; i < n; i++) {
    const signal = visionEmbedding[i];
    const targetPhase = Math.acos(Math.max(-1, Math.min(1, signal)));
    const diff = targetPhase - state.visionPhases[i];
    state.visionPhases[i] = (state.visionPhases[i] + 0.05 * diff + 2 * Math.PI) % (2 * Math.PI);
  }
}
function updateOrderHistory(state) {
  const R = synchronyIndex(state);
  state.orderHistory.push(R);
  if (state.orderHistory.length > 100) {
    state.orderHistory.shift();
  }
}
function resizeKuramoto(state, newSize) {
  ensureVibePhases(state);
  const oldSize = state.textPhases.length;
  if (newSize > oldSize) {
    const diff = newSize - oldSize;
    state.textPhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.visionPhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.vibePhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.naturalFrequencies.push(...Array.from({ length: diff }, () => (Math.random() - 0.5) * 2));
  } else if (newSize < oldSize) {
    state.textPhases = state.textPhases.slice(0, newSize);
    state.visionPhases = state.visionPhases.slice(0, newSize);
    state.vibePhases = state.vibePhases.slice(0, newSize);
    state.naturalFrequencies = state.naturalFrequencies.slice(0, newSize);
  }
}

// server/ai/neurogenesis.ts
var ENTROPY_THRESHOLD_LOW = 0.2;
var ENTROPY_THRESHOLD_HIGH = 0.85;
var EPOCHS_TO_TRIGGER = 5;
var MAX_NEURONS_PER_LAYER = 512;
var MIN_NEURONS_PER_LAYER = 8;
function createNeurogenesisState(numLayers) {
  return {
    epochsBelowThreshold: new Array(numLayers).fill(0),
    epochsAboveThreshold: new Array(numLayers).fill(0),
    growthEvents: 0,
    pruneEvents: 0
  };
}
function growNextLayerInputs(nextLayer, numNew) {
  const inputSize = nextLayer.weights[0]?.length ?? 0;
  const std = Math.sqrt(2 / (inputSize + numNew));
  for (let i = 0; i < nextLayer.weights.length; i++) {
    for (let n = 0; n < numNew; n++) {
      nextLayer.weights[i].push(randn() * std);
    }
  }
}
function pruneNextLayerInputs(nextLayer, keepIndices) {
  for (let i = 0; i < nextLayer.weights.length; i++) {
    nextLayer.weights[i] = nextLayer.weights[i].filter((_, j) => keepIndices.has(j));
  }
}
function checkNeurogenesis(net, ngState, kuramoto) {
  let grown = false;
  let pruned = false;
  while (ngState.epochsBelowThreshold.length < net.layers.length) {
    ngState.epochsBelowThreshold.push(0);
  }
  while (ngState.epochsAboveThreshold.length < net.layers.length) {
    ngState.epochsAboveThreshold.push(0);
  }
  const layerInputSizes = getLayerInputSizes(net);
  for (let i = 0; i < net.layers.length; i++) {
    const layer = net.layers[i];
    const entropy = getLayerActivationEntropy(layer);
    const maxEntropy = Math.log(layer.biases.length + 1);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0.5;
    if (normalizedEntropy < ENTROPY_THRESHOLD_LOW) {
      ngState.epochsBelowThreshold[i]++;
      ngState.epochsAboveThreshold[i] = 0;
    } else if (normalizedEntropy > ENTROPY_THRESHOLD_HIGH) {
      ngState.epochsAboveThreshold[i]++;
      ngState.epochsBelowThreshold[i] = 0;
    } else {
      ngState.epochsBelowThreshold[i] = Math.max(0, ngState.epochsBelowThreshold[i] - 1);
      ngState.epochsAboveThreshold[i] = Math.max(0, ngState.epochsAboveThreshold[i] - 1);
    }
    if (ngState.epochsBelowThreshold[i] >= EPOCHS_TO_TRIGGER && layer.biases.length < MAX_NEURONS_PER_LAYER) {
      const oldSize = layer.biases.length;
      net.layers[i] = growLayer(layer, layerInputSizes[i]);
      const numNew = net.layers[i].biases.length - oldSize;
      ngState.epochsBelowThreshold[i] = 0;
      ngState.growthEvents++;
      grown = true;
      if (i + 1 < net.layers.length) {
        growNextLayerInputs(net.layers[i + 1], numNew);
      }
      const newSize = net.layers[i].biases.length;
      resizeKuramoto(kuramoto, newSize);
    }
    if (ngState.epochsAboveThreshold[i] >= EPOCHS_TO_TRIGGER && layer.biases.length > MIN_NEURONS_PER_LAYER) {
      const { newLayer, keptIndices } = pruneLayerWithIndices(layer);
      net.layers[i] = newLayer;
      ngState.epochsAboveThreshold[i] = 0;
      ngState.pruneEvents++;
      pruned = true;
      if (i + 1 < net.layers.length) {
        pruneNextLayerInputs(net.layers[i + 1], keptIndices);
      }
    }
  }
  return { grown, pruned };
}
function getLayerInputSizes(net) {
  const sizes = [];
  for (const layer of net.layers) {
    sizes.push(layer.weights.length > 0 ? layer.weights[0].length : 0);
  }
  return sizes;
}
function syncNeurogenesisState(ngState, numLayers) {
  while (ngState.epochsBelowThreshold.length < numLayers) {
    ngState.epochsBelowThreshold.push(0);
  }
  while (ngState.epochsAboveThreshold.length < numLayers) {
    ngState.epochsAboveThreshold.push(0);
  }
  ngState.epochsBelowThreshold = ngState.epochsBelowThreshold.slice(0, numLayers);
  ngState.epochsAboveThreshold = ngState.epochsAboveThreshold.slice(0, numLayers);
}

// server/ai/ewc.ts
var EWC_LAMBDA = 80;
var REPLAY_CAPACITY = 500;
function createEWCState() {
  return {
    fisher: [],
    optimalWeights: [],
    optimalBiases: [],
    replayBuffer: [],
    totalReplayed: 0
  };
}
function computeFisher(ewc, net, dataset) {
  const layers = net.layers;
  const fisher = layers.map(
    (l) => l.weights.map((row) => new Array(row.length).fill(0))
  );
  const fisherBias = layers.map((l) => new Array(l.biases.length).fill(0));
  const n = Math.max(1, dataset.length);
  for (const sample of dataset) {
    const g = infer(net, sample.embedding);
    const prob = 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, g - net.threshold))));
    const label = sample.rating > 0.5 ? 1 : 0;
    const residual = (label - prob) ** 2;
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      for (let i = 0; i < layer.weights.length; i++) {
        for (let j = 0; j < layer.weights[i].length; j++) {
          fisher[li][i][j] += residual / n;
        }
      }
      for (let i = 0; i < layer.biases.length; i++) {
        fisherBias[li][i] += residual / n;
      }
    }
  }
  ewc.fisher = fisher;
  ewc.optimalWeights = layers.map((l) => l.weights.map((row) => [...row]));
  ewc.optimalBiases = layers.map((l) => [...l.biases]);
}
function ewcPenalty(ewc, net) {
  if (ewc.fisher.length === 0) return 0;
  let penalty = 0;
  const layers = net.layers;
  for (let li = 0; li < Math.min(layers.length, ewc.fisher.length); li++) {
    const layer = layers[li];
    const fisher = ewc.fisher[li];
    const optW = ewc.optimalWeights[li];
    for (let i = 0; i < Math.min(layer.weights.length, fisher.length); i++) {
      for (let j = 0; j < Math.min(layer.weights[i].length, fisher[i].length); j++) {
        penalty += fisher[i][j] * (layer.weights[i][j] - optW[i][j]) ** 2;
      }
    }
  }
  return EWC_LAMBDA / 2 * penalty;
}
function addToReplay(ewc, entry) {
  if (ewc.replayBuffer.length < REPLAY_CAPACITY) {
    ewc.replayBuffer.push(entry);
  } else {
    const nonBaseIndices = ewc.replayBuffer.map((e, i) => e.isBaseKnowledge ? -1 : i).filter((i) => i >= 0);
    const pool2 = nonBaseIndices.length > 0 ? nonBaseIndices : ewc.replayBuffer.map((_, i) => i);
    const randomPoolIdx = Math.floor(Math.random() * (ewc.totalReplayed + 1));
    if (randomPoolIdx < pool2.length) {
      ewc.replayBuffer[pool2[randomPoolIdx]] = entry;
    }
  }
  ewc.totalReplayed++;
}
function sampleReplay(ewc, n) {
  if (ewc.replayBuffer.length === 0) return [];
  const shuffled = [...ewc.replayBuffer].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}
function getReplayStats(ewc) {
  return {
    size: ewc.replayBuffer.length,
    capacity: REPLAY_CAPACITY
  };
}

// server/ai/clipEncoder.ts
import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as zlib from "zlib";
var CLIP_DIM = 512;
var CONTEXT_LENGTH = 77;
var SOT_TOKEN = 49406;
var EOT_TOKEN = 49407;
var MODELS_DIR = path.join(process.cwd(), "models");
var MODEL_URLS = {
  visual: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx",
  text: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx",
  vocab: "https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz"
};
var MODEL_PATHS = {
  visual: path.join(MODELS_DIR, "clip-vit-b32-visual.onnx"),
  text: path.join(MODELS_DIR, "clip-vit-b32-text.onnx"),
  vocab: path.join(MODELS_DIR, "bpe_vocab.txt")
};
var IMG_MEAN = [0.48145466, 0.4578275, 0.40821073];
var IMG_STD = [0.26862954, 0.26130258, 0.27577711];
var IMG_SIZE = 224;
function downloadFile(url, destPath) {
  return new Promise((resolve5, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(u, redirects = 0) {
      if (redirects > 10) return reject(new Error("Too many redirects"));
      const proto = u.startsWith("https") ? https : http;
      proto.get(u, { headers: { "User-Agent": "onnx-downloader/1.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {
          });
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve5()));
        file.on("error", (err) => {
          fs.unlink(destPath, () => {
          });
          reject(err);
        });
      }).on("error", (err) => {
        fs.unlink(destPath, () => {
        });
        reject(err);
      });
    }
    get(url);
  });
}
async function ensureModel(key) {
  const destPath = MODEL_PATHS[key];
  if (fs.existsSync(destPath)) return;
  console.log(`[CLIP] Downloading ${key} model\u2026`);
  const tmpPath = destPath + ".tmp";
  await downloadFile(MODEL_URLS[key], tmpPath);
  fs.renameSync(tmpPath, destPath);
  console.log(`[CLIP] ${key} model ready.`);
}
function buildByteEncoder() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const m = /* @__PURE__ */ new Map();
  bs.forEach((b, i) => m.set(b, String.fromCharCode(cs[i])));
  return m;
}
function getPairs(word) {
  const pairs = /* @__PURE__ */ new Set();
  for (let i = 0; i < word.length - 1; i++) {
    pairs.add(`${word[i]}\0${word[i + 1]}`);
  }
  return pairs;
}
var CLIPTokenizer = class {
  encoder = /* @__PURE__ */ new Map();
  bpeRanks = /* @__PURE__ */ new Map();
  byteEncoder;
  bpeCache = /* @__PURE__ */ new Map();
  pat;
  constructor(vocabText) {
    this.byteEncoder = buildByteEncoder();
    const lines = vocabText.split("\n");
    let mergeLines = [];
    for (const line of lines) {
      if (line.startsWith("#")) continue;
      if (line.trim() === "") continue;
      mergeLines.push(line.trim());
    }
    this.pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
    const vocab = [];
    const byteDecoder = /* @__PURE__ */ new Map();
    this.byteEncoder.forEach((v, k) => byteDecoder.set(v, k));
    for (let i = 0; i < 256; i++) {
      const ch = this.byteEncoder.get(i);
      vocab.push(ch);
    }
    for (const merge of mergeLines) {
      vocab.push(merge.replace(" ", ""));
    }
    vocab.push("<|startoftext|>");
    vocab.push("<|endoftext|>");
    vocab.forEach((v, i) => this.encoder.set(v, i));
    mergeLines.forEach((merge, rank) => {
      const parts = merge.split(" ");
      this.bpeRanks.set(`${parts[0]}\0${parts[1]}`, rank);
    });
  }
  bpe(token) {
    if (this.bpeCache.has(token)) return this.bpeCache.get(token);
    let word = [...token].map(
      (c, i) => i === token.length - 1 ? c + "</w>" : c
    );
    let pairs = getPairs(word);
    if (pairs.size === 0) {
      this.bpeCache.set(token, word);
      return word;
    }
    while (true) {
      let bestRank = Infinity;
      let bigram = null;
      for (const pair of pairs) {
        const rank = this.bpeRanks.get(pair) ?? Infinity;
        if (rank < bestRank) {
          bestRank = rank;
          bigram = pair;
        }
      }
      if (bigram === null || !this.bpeRanks.has(bigram)) break;
      const [first, second] = bigram.split("\0");
      const newWord = [];
      let i = 0;
      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) {
          newWord.push(...word.slice(i));
          break;
        }
        newWord.push(...word.slice(i, j));
        i = j;
        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          newWord.push(first + second);
          i += 2;
        } else {
          newWord.push(word[i]);
          i++;
        }
      }
      word = newWord;
      if (word.length === 1) break;
      pairs = getPairs(word);
    }
    this.bpeCache.set(token, word);
    return word;
  }
  encode(text2) {
    const bpeTokens = [SOT_TOKEN];
    const clean = text2.toLowerCase().trim();
    const matches = clean.match(this.pat) ?? [];
    for (const token of matches) {
      const encoded = Array.from(new TextEncoder().encode(token)).map((b) => this.byteEncoder.get(b)).join("");
      for (const bpeToken of this.bpe(encoded)) {
        bpeTokens.push(this.encoder.get(bpeToken) ?? 0);
      }
    }
    bpeTokens.push(EOT_TOKEN);
    if (bpeTokens.length > CONTEXT_LENGTH) {
      bpeTokens.length = CONTEXT_LENGTH - 1;
      bpeTokens.push(EOT_TOKEN);
    }
    while (bpeTokens.length < CONTEXT_LENGTH) bpeTokens.push(0);
    return bpeTokens;
  }
};
async function preprocessImage(imageBuffer) {
  let Jimp;
  try {
    const mod = await import("jimp-compact");
    Jimp = mod.default ?? mod;
  } catch {
    throw new Error("[CLIP] jimp-compact not available for image preprocessing");
  }
  const img = await Jimp.read(imageBuffer);
  const w = img.getWidth();
  const h = img.getHeight();
  const shorter = Math.min(w, h);
  const scale = IMG_SIZE / shorter;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  img.resize(newW, newH);
  const x0 = Math.floor((newW - IMG_SIZE) / 2);
  const y0 = Math.floor((newH - IMG_SIZE) / 2);
  img.crop(x0, y0, IMG_SIZE, IMG_SIZE);
  const pixels = new Float32Array(3 * IMG_SIZE * IMG_SIZE);
  for (let y = 0; y < IMG_SIZE; y++) {
    for (let x = 0; x < IMG_SIZE; x++) {
      const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
      const i = y * IMG_SIZE + x;
      pixels[0 * IMG_SIZE * IMG_SIZE + i] = (r / 255 - IMG_MEAN[0]) / IMG_STD[0];
      pixels[1 * IMG_SIZE * IMG_SIZE + i] = (g / 255 - IMG_MEAN[1]) / IMG_STD[1];
      pixels[2 * IMG_SIZE * IMG_SIZE + i] = (b / 255 - IMG_MEAN[2]) / IMG_STD[2];
    }
  }
  return pixels;
}
var visualSession = null;
var textSession = null;
var tokenizer = null;
var loadPromise = null;
async function loadCLIP() {
  if (visualSession && textSession && tokenizer) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    await ensureModel("vocab");
    let vocabRaw = fs.readFileSync(MODEL_PATHS.vocab, "utf8");
    if (vocabRaw.charCodeAt(0) === 31 && vocabRaw.charCodeAt(1) === 139) {
      const buf = fs.readFileSync(MODEL_PATHS.vocab);
      vocabRaw = zlib.gunzipSync(buf).toString("utf8");
      fs.writeFileSync(MODEL_PATHS.vocab, vocabRaw, "utf8");
    }
    tokenizer = new CLIPTokenizer(vocabRaw);
    console.log("[CLIP] Tokenizer ready.");
    await ensureModel("visual");
    visualSession = await ort.InferenceSession.create(MODEL_PATHS.visual, {
      executionProviders: ["cpu"]
    });
    console.log("[CLIP] Visual encoder loaded.");
    await ensureModel("text");
    textSession = await ort.InferenceSession.create(MODEL_PATHS.text, {
      executionProviders: ["cpu"]
    });
    console.log("[CLIP] Text encoder loaded.");
  })();
  return loadPromise;
}
async function encodeTexts(texts) {
  await loadCLIP();
  const batchSize = texts.length;
  const inputIds = new BigInt64Array(batchSize * CONTEXT_LENGTH);
  const attentionMask = new BigInt64Array(batchSize * CONTEXT_LENGTH);
  texts.forEach((text2, b) => {
    const tokens = tokenizer.encode(text2);
    let eotSeen = false;
    tokens.forEach((id, i) => {
      inputIds[b * CONTEXT_LENGTH + i] = BigInt(id);
      if (!eotSeen) attentionMask[b * CONTEXT_LENGTH + i] = 1n;
      if (id === EOT_TOKEN) eotSeen = true;
    });
  });
  const feeds = {
    input_ids: new ort.Tensor("int64", inputIds, [batchSize, CONTEXT_LENGTH]),
    attention_mask: new ort.Tensor("int64", attentionMask, [batchSize, CONTEXT_LENGTH])
  };
  const results = await textSession.run(feeds);
  const outputKey = Object.keys(results).find(
    (k) => k.includes("embed") || k.includes("pooler") || k === "last_hidden_state"
  ) ?? Object.keys(results)[0];
  const raw = results[outputKey].data;
  const out = [];
  const stride = raw.length / batchSize;
  for (let b = 0; b < batchSize; b++) {
    out.push(raw.slice(b * stride, (b + 1) * stride));
  }
  return out;
}
async function encodeText(text2) {
  return (await encodeTexts([text2]))[0];
}
async function encodeImageBuffer(imageBuffer) {
  await loadCLIP();
  const pixels = await preprocessImage(imageBuffer);
  const tensor = new ort.Tensor("float32", pixels, [1, 3, IMG_SIZE, IMG_SIZE]);
  const feeds = { pixel_values: tensor };
  const results = await visualSession.run(feeds);
  const outputKey = Object.keys(results).find(
    (k) => k.includes("embed") || k.includes("pooler") || k === "last_hidden_state"
  ) ?? Object.keys(results)[0];
  return results[outputKey].data;
}
function cosineSimilarity(a, b) {
  let dot2 = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot2 += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot2 / denom;
}
function isLoaded() {
  return visualSession !== null && textSession !== null && tokenizer !== null;
}

// server/ai/vibeProfiler.ts
import * as https2 from "https";
var CLAUDE_MODEL = "claude-sonnet-4-20250514";
var CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";
var CACHE_MAX = 500;
var RATE_LIMIT_MS = 500;
var vibeCache = /* @__PURE__ */ new Map();
var dbLoadPromise = null;
var lastLLMCallTime = 0;
function ensureDbLoaded() {
  if (!dbLoadPromise) {
    dbLoadPromise = storage.getAllVibeProfiles().then((rows) => {
      for (const { malId, profile } of rows) {
        vibeCache.set(malId, profile);
      }
      console.log(`[VibeProfiler] Loaded ${vibeCache.size} cached profiles from DB.`);
    }).catch((e) => {
      console.warn("[VibeProfiler] Failed to load profiles from DB:", e instanceof Error ? e.message : e);
      dbLoadPromise = null;
    });
  }
  return dbLoadPromise;
}
function evictIfNeeded() {
  while (vibeCache.size >= CACHE_MAX) {
    vibeCache.delete(vibeCache.keys().next().value);
  }
}
function httpsPost(url, apiKey, body) {
  return new Promise((resolve5, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    };
    const req = https2.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Claude HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve5(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(12e3, () => {
      req.destroy(new Error("Claude vibe request timed out"));
    });
    req.write(payload);
    req.end();
  });
}
async function generateVibeProfile(malId, title, genres, synopsis, score) {
  await ensureDbLoaded();
  if (vibeCache.has(malId)) return vibeCache.get(malId);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const now = Date.now();
  const elapsed = now - lastLLMCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve5) => setTimeout(resolve5, RATE_LIMIT_MS - elapsed));
  }
  lastLLMCallTime = Date.now();
  const synopsisSnippet = synopsis.slice(0, 300);
  const genresStr = genres.join(", ") || "Unknown";
  const userMessage = `Anime: ${title}. Genres: ${genresStr}. Score: ${score}/10. Synopsis: ${synopsisSnippet}`;
  const systemPrompt = "You are an anime analyst. Given an anime's details, generate a JSON object describing its vibe profile. Respond with ONLY valid JSON, no markdown backticks. The JSON must have these exact keys: atmosphere (the visual/emotional setting feel in 5-10 words), pacing (the narrative rhythm in 5-10 words), tone (the overall emotional tone in 5-10 words), protagonistArchetype (the main character type in 5-10 words), relationshipDynamics (how characters relate to each other in 5-10 words), emotionalArc (the overarching emotional journey in 5-10 words).";
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }]
  };
  try {
    const raw = await httpsPost(CLAUDE_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const text2 = parsed?.content?.[0]?.text?.trim();
    if (!text2) return null;
    const jsonText = text2.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    const json = JSON.parse(jsonText);
    const atmosphere = String(json.atmosphere ?? "");
    const pacing = String(json.pacing ?? "");
    const tone = String(json.tone ?? "");
    const protagonistArchetype = String(json.protagonistArchetype ?? "");
    const relationshipDynamics = String(json.relationshipDynamics ?? "");
    const emotionalArc = String(json.emotionalArc ?? "");
    if (!atmosphere || !pacing || !tone || !protagonistArchetype || !relationshipDynamics || !emotionalArc) {
      return null;
    }
    const vibeText = `${title} has a ${atmosphere} atmosphere with ${pacing} pacing. The tone is ${tone}, driven by a ${protagonistArchetype}. Relationships are defined by ${relationshipDynamics}, and the emotional arc follows ${emotionalArc}.`;
    const profile = {
      atmosphere,
      pacing,
      tone,
      protagonistArchetype,
      relationshipDynamics,
      emotionalArc,
      vibeText
    };
    evictIfNeeded();
    vibeCache.set(malId, profile);
    storage.saveVibeProfile(malId, profile).catch((e) => {
      console.warn("[VibeProfiler] Failed to persist profile to DB:", e instanceof Error ? e.message : e);
    });
    return profile;
  } catch (e) {
    console.warn("[VibeProfiler] Failed to generate profile for", title, ":", e instanceof Error ? e.message : e);
    return null;
  }
}
function getVibeProfileFromCache(malId) {
  return vibeCache.get(malId) ?? null;
}

// server/ai/textEmbedder.ts
var GENRES = [
  "Action",
  "Adventure",
  "Cars",
  "Comedy",
  "Dementia",
  "Demons",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Harem",
  "Historical",
  "Horror",
  "Josei",
  "Kids",
  "Magic",
  "Martial Arts",
  "Mecha",
  "Military",
  "Music",
  "Mystery",
  "Parody",
  "Police",
  "Psychological",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice of Life",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Thriller",
  "Vampire",
  "Yaoi",
  "Yuri",
  "Isekai",
  "Iyashikei",
  "Reverse Harem",
  "Mahou Shoujo",
  "Time Travel",
  "Dystopian",
  "Villainess",
  "Reincarnation",
  "VRMMO",
  "Dark Fantasy"
];
var TOP_STUDIOS = [
  "Madhouse",
  "Bones",
  "Sunrise",
  "Production I.G",
  "Toei Animation",
  "A-1 Pictures",
  "ufotable",
  "KyoAni",
  "Trigger",
  "MAPPA",
  "Shaft",
  "J.C.Staff",
  "White Fox",
  "Doga Kobo",
  "Wit Studio",
  "CloverWorks",
  "PA Works",
  "Brain's Base",
  "Silver Link",
  "Studio Deen"
];
var EMBEDDING_DIM = CLIP_DIM;
function embedAnime(anime) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const animeGenres = (anime.genres || []).map((g) => g.name);
  for (const genreName of animeGenres) {
    const idx = GENRES.findIndex(
      (g) => g.toLowerCase() === genreName.toLowerCase()
    );
    if (idx >= 0) {
      vec[idx] = 1;
    }
  }
  const scoreDim = GENRES.length;
  vec[scoreDim] = anime.score ? Math.min(10, anime.score) / 10 : 0.5;
  const epsDim = GENRES.length + 1;
  if (anime.episodes && anime.episodes > 0) {
    vec[epsDim] = Math.min(1, 1 / Math.log1p(anime.episodes));
  } else {
    vec[epsDim] = 0.5;
  }
  const studioOffset = GENRES.length + 2;
  const animeStudios = (anime.studios || []).map((s) => s.name);
  for (const studioName of animeStudios) {
    const idx = TOP_STUDIOS.findIndex(
      (s) => s.toLowerCase() === studioName.toLowerCase()
    );
    if (idx >= 0) {
      vec[studioOffset + idx] = 1;
    }
  }
  return normalize(vec);
}
function buildUserPreferenceVector(ratings) {
  if (ratings.length === 0) {
    return new Array(EMBEDDING_DIM).fill(1 / Math.sqrt(EMBEDDING_DIM));
  }
  const pref = new Array(EMBEDDING_DIM).fill(0);
  let totalWeight = 0;
  for (const { embedding, rating } of ratings) {
    const weight = rating > 0.5 ? 1 + rating : -(1 - rating) * 0.5;
    totalWeight += Math.abs(weight);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      pref[i] += weight * embedding[i];
    }
  }
  if (totalWeight > 0) {
    for (let i = 0; i < pref.length; i++) {
      pref[i] /= totalWeight;
    }
  }
  return normalize(pref);
}
async function embedAnimeCLIP(anime) {
  await loadCLIP();
  const genres = (anime.genres || []).map((g) => g.name).join(", ");
  const studios = (anime.studios || []).map((s) => s.name).join(", ");
  const synopsis = anime.synopsis ? anime.synopsis.slice(0, 200) : "";
  const text2 = [
    anime.title,
    genres ? `Genres: ${genres}` : "",
    studios ? `Studio: ${studios}` : "",
    synopsis
  ].filter(Boolean).join(". ");
  const embedding = await encodeText(text2);
  return Array.from(embedding);
}
async function embedAnimeWithFallback(anime) {
  try {
    return await embedAnimeCLIP(anime);
  } catch {
    const fallback = embedAnime(anime);
    const padded = new Array(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < fallback.length && i < EMBEDDING_DIM; i++) {
      padded[i] = fallback[i];
    }
    return padded;
  }
}
async function embedAnimeWithVibe(anime) {
  const metaEmbedding = await embedAnimeCLIP(anime);
  const genres = (anime.genres ?? []).map((g) => g.name);
  const synopsis = anime.synopsis ?? "";
  const score = anime.score ?? 0;
  const vibeProfile = await generateVibeProfile(
    anime.mal_id,
    anime.title,
    genres,
    synopsis,
    score
  );
  if (!vibeProfile) return metaEmbedding;
  await loadCLIP();
  const vibeRaw = await encodeText(vibeProfile.vibeText);
  const vibeEmbedding = Array.from(vibeRaw);
  const blended = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    blended[i] = 0.5 * metaEmbedding[i] + 0.5 * vibeEmbedding[i];
  }
  return normalize(blended);
}
async function embedAnimeWithVibeFallback(anime) {
  try {
    return await embedAnimeWithVibe(anime);
  } catch {
    return embedAnimeWithFallback(anime);
  }
}

// server/ai/visionVerifier.ts
import * as https3 from "https";
import * as http2 from "http";
import * as crypto from "crypto";
import dns from "node:dns/promises";
var VISION_DIM = 512;
var cache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 30 * 60 * 1e3;
var TIMEOUT_MS = 8e3;
var MAX_BYTES = 131072;
var PRIVATE_IP_REGEX = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;
var ALLOWED_IMAGE_HOSTS = /* @__PURE__ */ new Set([
  "cdn.myanimelist.net",
  "img1.ak.crunchyroll.com",
  "i.imgur.com",
  "s4.anilist.co",
  "media.kitsu.io",
  "artworks.thetvdb.com",
  "img.anili.st",
  "myanimelist.net"
]);
async function validateImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are allowed";
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_HOSTS.has(hostname)) {
    return `Host not in allowlist: ${hostname}`;
  }
  try {
    const v4 = await dns.resolve4(hostname).catch(() => []);
    const v6 = await dns.resolve6(hostname).catch(() => []);
    for (const addr of [...v4, ...v6]) {
      if (PRIVATE_IP_REGEX.test(addr)) {
        return `Resolved to private/reserved IP: ${addr}`;
      }
    }
  } catch {
  }
  return null;
}
function fetchImageBytes(url) {
  return new Promise((resolve5) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https3 : http2;
      const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
        const contentType = res.headers["content-type"] || "";
        const contentLength = parseInt(res.headers["content-length"] || "0", 10);
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          res.destroy();
          resolve5({ ok: false, contentType, contentLength: 0, buffer: Buffer.alloc(0) });
          return;
        }
        const chunks = [];
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (received <= MAX_BYTES) {
            chunks.push(chunk);
          } else {
            res.destroy();
          }
        });
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve5({
            ok: true,
            contentType,
            contentLength: contentLength || received,
            buffer: buf
          });
        });
        res.on("error", () => {
          resolve5({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
        });
      });
      req.on("error", () => {
        resolve5({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve5({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
      });
    } catch {
      resolve5({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
    }
  });
}
async function computeColorHistogramEmbedding(buf) {
  try {
    if (isLoaded()) {
      const embedding = await encodeImageBuffer(buf);
      return Array.from(embedding);
    }
    return null;
  } catch {
    return null;
  }
}
async function titleToSemanticVector(title) {
  if (isLoaded()) {
    try {
      const embedding = await encodeText(title);
      return Array.from(embedding);
    } catch {
      return new Array(VISION_DIM).fill(0);
    }
  }
  return new Array(VISION_DIM).fill(0);
}
async function verifyArtwork(malId, imageUrl, title) {
  const cached2 = cache.get(malId);
  if (cached2 && Date.now() - cached2.ts < CACHE_TTL_MS) {
    return cached2.result;
  }
  let result;
  try {
    if (!imageUrl) {
      return { verified: false, score: 0, reason: "No image URL provided" };
    }
    const ssrfError = await validateImageUrl(imageUrl);
    if (ssrfError) {
      result = { verified: false, score: 0, reason: `URL blocked: ${ssrfError}` };
      cache.set(malId, { result, ts: Date.now() });
      return result;
    }
    const meta = await fetchImageBytes(imageUrl);
    if (!meta.ok) {
      result = {
        verified: false,
        score: 0,
        reason: "Image URL returned an error response"
      };
    } else if (!meta.contentType.startsWith("image/")) {
      result = {
        verified: false,
        score: 0.1,
        reason: "URL does not return an image content-type"
      };
    } else if (meta.contentLength < 8192) {
      result = {
        verified: false,
        score: 0.3,
        reason: "Image file appears to be a placeholder (too small)"
      };
    } else {
      const imageHash = crypto.createHash("sha256").update(meta.buffer).digest("hex");
      const visionEmbedding = await computeColorHistogramEmbedding(meta.buffer);
      let score = 0.6;
      if (visionEmbedding && title) {
        const titleVec = await titleToSemanticVector(title);
        const sim = cosineSimilarity(new Float32Array(visionEmbedding), new Float32Array(titleVec));
        score = 0.5 + (sim + 1) / 2 * 0.5;
      } else if (visionEmbedding) {
        score = 0.7;
      }
      result = {
        verified: score >= 0.55,
        score: Math.round(score * 100) / 100,
        reason: visionEmbedding ? score >= 0.55 ? "Artwork verified by CLIP vision encoder" : "Visual-semantic alignment below threshold" : "Artwork verified (CLIP not loaded, used metadata)",
        imageHash,
        visionEmbedding: visionEmbedding ?? void 0
      };
    }
  } catch {
    result = {
      verified: false,
      score: 0,
      reason: "Verification failed due to network error"
    };
  }
  cache.set(malId, { result, ts: Date.now() });
  return result;
}

// server/ai/modelStore.ts
import * as fs2 from "fs";
import * as path2 from "path";
var MODEL_PATH = path2.resolve(process.cwd(), "ai-model-state.json");
var CURRENT_VERSION = 2;
function loadModelState() {
  try {
    if (!fs2.existsSync(MODEL_PATH)) return null;
    const raw = fs2.readFileSync(MODEL_PATH, "utf-8");
    const state = JSON.parse(raw);
    if (state.version !== CURRENT_VERSION) {
      console.log("[AI] Model version mismatch, starting fresh");
      return null;
    }
    console.log(`[AI] Loaded model state (epoch ${state.network.epoch}, ${countNeurons(state)} neurons)`);
    return state;
  } catch (e) {
    console.warn("[AI] Failed to load model state:", e);
    return null;
  }
}
function saveModelState(state) {
  try {
    state.savedAt = (/* @__PURE__ */ new Date()).toISOString();
    state.version = CURRENT_VERSION;
    fs2.writeFileSync(MODEL_PATH, JSON.stringify(state), "utf-8");
  } catch (e) {
    console.warn("[AI] Failed to save model state:", e);
  }
}
function countNeurons(state) {
  return state.network.layers.reduce((s, l) => s + l.biases.length, 0);
}

// server/ai/animeData.ts
var CACHE_TTL = 30 * 60 * 1e3;
var scheduleCache = /* @__PURE__ */ new Map();
var detailsCache = /* @__PURE__ */ new Map();
var anilistCache = /* @__PURE__ */ new Map();
var KIDS_RATINGS = /* @__PURE__ */ new Set(["G - All Ages", "PG - Children"]);
function isKidsShow(item) {
  if (item.rating && KIDS_RATINGS.has(item.rating)) return true;
  if (item.genres) {
    const genreNames = item.genres.map((g) => g.name.toLowerCase());
    if (genreNames.includes("kids")) return true;
  }
  return false;
}
var JIKAN_BASE = "https://api.jikan.moe/v4";
var ANILIST_BASE = "https://graphql.anilist.co";
var lastSearchTime = 0;
async function jikanFetch(url) {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "AniStar/1.0" },
    signal: AbortSignal.timeout(8e3)
  });
  if (!res.ok) {
    throw new Error(`Jikan API error: ${res.status} ${url}`);
  }
  return res.json();
}
async function getSchedule(day) {
  const key = day.toLowerCase();
  const cached2 = scheduleCache.get(key);
  if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
    return cached2.data;
  }
  try {
    const data = await jikanFetch(
      `${JIKAN_BASE}/schedules?filter=${key}&kids=false&sfw=true&page=1`
    );
    const items = (data.data || []).filter((a) => !isKidsShow(a)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached2?.data || [];
  }
}
async function getSeasonalAnime() {
  const key = "seasonal";
  const cached2 = scheduleCache.get(key);
  if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
    return cached2.data;
  }
  try {
    const data = await jikanFetch(
      `${JIKAN_BASE}/seasons/now?limit=25&sfw=true`
    );
    const items = (data.data || []).filter((a) => !isKidsShow(a));
    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached2?.data || [];
  }
}
async function getPopularAiring() {
  const key = "popular_airing";
  const cached2 = scheduleCache.get(key);
  if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
    return cached2.data;
  }
  try {
    const [byScore, byMembers] = await Promise.allSettled([
      jikanFetch(
        `${JIKAN_BASE}/anime?type=tv&status=airing&order_by=score&sort=desc&min_score=6&sfw=true&page=1&limit=25`
      ),
      jikanFetch(
        `${JIKAN_BASE}/anime?type=tv&status=airing&order_by=members&sort=desc&sfw=true&page=1&limit=25`
      )
    ]);
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    for (const result of [byScore, byMembers]) {
      if (result.status === "fulfilled") {
        for (const a of result.value.data || []) {
          if (!seen.has(a.mal_id) && !isKidsShow(a)) {
            seen.add(a.mal_id);
            items.push(a);
          }
        }
      }
    }
    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached2?.data || [];
  }
}
async function getAnimeDetails(malId) {
  const cached2 = detailsCache.get(malId);
  if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
    return cached2.data;
  }
  try {
    const data = await jikanFetch(
      `${JIKAN_BASE}/anime/${malId}`
    );
    const item = data.data;
    if (!item) return null;
    const anilistData = await getAniListEnrichment(malId, item.title);
    const merged = { ...item, ...anilistData };
    detailsCache.set(malId, { data: merged, timestamp: Date.now() });
    return merged;
  } catch {
    return cached2?.data || null;
  }
}
async function getAniListEnrichment(malId, title) {
  const cached2 = anilistCache.get(malId);
  if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
    return cached2.data;
  }
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        genres
        averageScore
        episodes
        studios { nodes { name } }
      }
    }
  `;
  try {
    const res = await fetch(ANILIST_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { search: title } }),
      signal: AbortSignal.timeout(6e3)
    });
    if (!res.ok) return {};
    const json = await res.json();
    const media = json?.data?.Media;
    if (!media) return {};
    const partial = {};
    if (media.genres && media.genres.length > 0) {
      partial.genres = media.genres.map((g) => ({ name: g }));
    }
    if (media.averageScore && media.averageScore > 0 && !partial.score) {
      partial.score = media.averageScore / 10;
    }
    if (media.episodes && media.episodes > 0) {
      partial.episodes = media.episodes;
    }
    if (media.studios?.nodes && media.studios.nodes.length > 0) {
      partial.studios = media.studios.nodes.map((s) => ({ name: s.name }));
    }
    anilistCache.set(malId, { data: partial, timestamp: Date.now() });
    return partial;
  } catch {
    return {};
  }
}
function allDaysCached() {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return days.every((d) => {
    const cached2 = scheduleCache.get(d);
    return cached2 && Date.now() - cached2.timestamp < CACHE_TTL;
  });
}
async function getAllCurrentAnime() {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  const [seasonal, popular] = await Promise.allSettled([
    getSeasonalAnime(),
    getPopularAiring()
  ]);
  const isCached = allDaysCached();
  const dayResults = [];
  for (let i = 0; i < days.length; i++) {
    if (i > 0 && !isCached) {
      await new Promise((resolve5) => setTimeout(resolve5, 350));
    }
    try {
      dayResults.push(await getSchedule(days[i]));
    } catch {
      dayResults.push([]);
    }
  }
  for (const r of [seasonal, popular]) {
    if (r.status === "fulfilled") {
      for (const a of r.value) {
        if (!seen.has(a.mal_id) && !isKidsShow(a)) {
          seen.add(a.mal_id);
          result.push(a);
        }
      }
    }
  }
  for (const items of dayResults) {
    for (const a of items) {
      if (!seen.has(a.mal_id) && !isKidsShow(a)) {
        seen.add(a.mal_id);
        result.push(a);
      }
    }
  }
  const searched = scheduleCache.get("searched");
  if (searched) {
    for (const a of searched.data) {
      if (!seen.has(a.mal_id) && !isKidsShow(a)) {
        seen.add(a.mal_id);
        result.push(a);
      }
    }
  }
  result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return result;
}
async function searchAndAddAnime(query) {
  const now = Date.now();
  if (now - lastSearchTime < 1e3) return [];
  lastSearchTime = now;
  try {
    const data = await jikanFetch(
      `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`
    );
    const results = (data.data || []).filter((a) => !isKidsShow(a));
    if (results.length === 0) return [];
    const existing = scheduleCache.get("searched");
    const existingData = existing?.data ?? [];
    const seen = new Set(existingData.map((a) => a.mal_id));
    const merged = [...existingData];
    for (const item of results) {
      if (!seen.has(item.mal_id)) {
        merged.push(item);
        seen.add(item.mal_id);
        try {
          await storage.saveSearchedAnime(item.mal_id, item);
        } catch (e) {
          console.error("[AnimeData] Failed to persist searched anime to DB:", e instanceof Error ? e.message : e);
        }
      }
    }
    scheduleCache.set("searched", { data: merged.slice(-200), timestamp: Date.now() });
    return results;
  } catch {
    return [];
  }
}
async function initAnimeData() {
  try {
    const rows = await storage.getAllSearchedAnime();
    if (rows.length === 0) return;
    const items = rows.map((r) => r.data).filter((a) => a && a.mal_id);
    const existing = scheduleCache.get("searched");
    const existingData = existing?.data ?? [];
    const seen = new Set(existingData.map((a) => a.mal_id));
    const merged = [...existingData];
    for (const item of items) {
      if (!seen.has(item.mal_id) && !isKidsShow(item)) {
        merged.push(item);
        seen.add(item.mal_id);
      }
    }
    scheduleCache.set("searched", { data: merged.slice(-200), timestamp: Date.now() });
    console.log(`[AnimeData] Loaded ${items.length} searched anime from DB.`);
  } catch (e) {
    console.warn("[AnimeData] Failed to load searched anime from DB:", e instanceof Error ? e.message : e);
  }
}
function getSearchedCacheEntries() {
  return scheduleCache.get("searched")?.data ?? [];
}

// server/ai/recommendEngine.ts
var LAYER_SIZES = [EMBEDDING_DIM, 256, 128, 64];
var KURAMOTO_SIZE = 256;
var engines = /* @__PURE__ */ new Map();
var engineAccessTime = /* @__PURE__ */ new Map();
var engineInitPromises = /* @__PURE__ */ new Map();
var MAX_USER_ENGINES = 5;
var INACTIVITY_MS = 5 * 60 * 1e3;
var clipPreloadDone = false;
async function initEngine(userId) {
  if (!clipPreloadDone) {
    clipPreloadDone = true;
    loadCLIP().catch((e) => console.warn("[CLIP] Failed to preload:", e));
  }
  if (userId === "default") {
    const saved = loadModelState();
    if (saved) {
      const firstHiddenSize = saved.network.layers[0]?.biases?.length ?? 0;
      const expectedHiddenSize = LAYER_SIZES[1];
      if (firstHiddenSize === expectedHiddenSize) {
        const validEmbeddings = (saved.allAnimeEmbeddings || []).filter(
          (e) => e.embedding.length === EMBEDDING_DIM
        );
        const kura = saved.kuramoto;
        if (!kura.vibePhases || kura.vibePhases.length !== kura.textPhases.length) {
          kura.vibePhases = Array.from(
            { length: kura.textPhases.length },
            () => Math.random() * 2 * Math.PI
          );
        }
        return {
          network: deserializeNetwork(saved.network),
          kuramoto: kura,
          neurogenesis: saved.neurogenesis,
          ewc: saved.ewc,
          ratings: saved.ratings || [],
          allAnimeEmbeddings: validEmbeddings,
          isTraining: false,
          restTrainedAt: saved.restTrainedAt ?? null
        };
      } else {
        console.log(
          `[AI] Saved network dim mismatch (firstHidden=${firstHiddenSize} vs expected ${LAYER_SIZES[1]}) \u2014 trying DB.`
        );
      }
    }
  }
  try {
    const dbState = await storage.loadEngineState(userId);
    if (dbState) {
      const s = dbState;
      const firstHiddenSize = s.network?.layers?.[0]?.biases?.length ?? 0;
      if (firstHiddenSize === LAYER_SIZES[1]) {
        const kura = s.kuramoto;
        if (!kura.vibePhases || kura.vibePhases.length !== kura.textPhases.length) {
          kura.vibePhases = Array.from(
            { length: kura.textPhases.length },
            () => Math.random() * 2 * Math.PI
          );
        }
        const validEmbeddings = (s.allAnimeEmbeddings || []).filter(
          (e) => e.embedding.length === EMBEDDING_DIM
        );
        console.log(`[AI] Loaded engine for user "${userId}" from DB.`);
        return {
          network: deserializeNetwork(s.network),
          kuramoto: kura,
          neurogenesis: s.neurogenesis,
          ewc: s.ewc,
          ratings: s.ratings || [],
          allAnimeEmbeddings: validEmbeddings,
          isTraining: false,
          restTrainedAt: s.restTrainedAt ?? null
        };
      }
    }
  } catch (e) {
    console.warn(`[AI] Failed to load engine from DB for "${userId}":`, e instanceof Error ? e.message : e);
  }
  return {
    network: createNetwork(LAYER_SIZES),
    kuramoto: createKuramotoSystem(KURAMOTO_SIZE),
    neurogenesis: createNeurogenesisState(LAYER_SIZES.length - 1),
    ewc: createEWCState(),
    ratings: [],
    allAnimeEmbeddings: [],
    isTraining: false,
    restTrainedAt: null
  };
}
async function getEngine(userId) {
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
          if (t < oldestTime) {
            oldestTime = t;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          const evicted = engines.get(oldestKey);
          if (evicted) persistEngine(oldestKey, evicted).catch(() => {
          });
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
async function persistEngine(userId, eng) {
  const json = {
    version: 2,
    network: serializeNetwork(eng.network),
    kuramoto: eng.kuramoto,
    neurogenesis: eng.neurogenesis,
    ewc: eng.ewc,
    ratings: eng.ratings,
    allAnimeEmbeddings: eng.allAnimeEmbeddings,
    restTrainedAt: eng.restTrainedAt ?? null
  };
  storage.saveEngineState(userId, json).catch(
    (e) => console.warn(`[AI] Failed to save engine state to DB for "${userId}":`, e instanceof Error ? e.message : e)
  );
  if (userId === "default") {
    const state = {
      version: 2,
      network: deserializeNetwork(serializeNetwork(eng.network)),
      kuramoto: eng.kuramoto,
      neurogenesis: eng.neurogenesis,
      ewc: eng.ewc,
      ratings: eng.ratings,
      allAnimeEmbeddings: eng.allAnimeEmbeddings,
      restTrainedAt: eng.restTrainedAt ?? void 0,
      savedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    saveModelState(state);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [userId, lastAccess] of engineAccessTime) {
    if (now - lastAccess > INACTIVITY_MS) {
      const eng = engines.get(userId);
      if (eng) persistEngine(userId, eng).catch(() => {
      });
      engines.delete(userId);
      engineAccessTime.delete(userId);
    }
  }
}, 6e4).unref();
function buildRecommendationItem(anime, score, verification) {
  const imageUrl = anime.images?.jpg?.large_image_url || "";
  const artworkBoost = verification.verified ? 1.05 : 0.95;
  const finalConfidence = Math.min(1, Math.max(0, score * artworkBoost));
  const cachedProfile = getVibeProfileFromCache(anime.mal_id);
  let vibe;
  if (cachedProfile) {
    vibe = {
      atmosphere: cachedProfile.atmosphere,
      tone: cachedProfile.tone,
      protagonistArchetype: cachedProfile.protagonistArchetype
    };
  } else {
    generateVibeProfile(
      anime.mal_id,
      anime.title,
      (anime.genres ?? []).map((g) => g.name),
      anime.synopsis ?? "",
      anime.score ?? 0
    ).catch(() => {
    });
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
    vibe
  };
}
var UNVERIFIED = { verified: false, score: 0, visionEmbedding: [] };
function applyHardFilters(rawAnimeList, bans, seenIds) {
  const bannedMalIds = new Set(
    bans.filter((b) => b.malId !== null).map((b) => b.malId)
  );
  const bannedGenreSet = new Set(
    bans.filter((b) => b.bannedGenre !== null).map((b) => b.bannedGenre)
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
async function scoreAnimeList(eng, animeList, userPref, limit, hiddenGemBias) {
  const scored = [];
  const embeddingCache = new Map(
    eng.allAnimeEmbeddings.map((e) => [e.animeId, e.embedding])
  );
  await Promise.all(
    animeList.map(async (anime) => {
      try {
        let embedding = embeddingCache.get(anime.mal_id);
        if (!embedding) {
          embedding = await embedAnimeWithVibeFallback(anime);
          embeddingCache.set(anime.mal_id, embedding);
          eng.allAnimeEmbeddings.push({ animeId: anime.mal_id, embedding });
          if (eng.allAnimeEmbeddings.length > 2e3) eng.allAnimeEmbeddings.shift();
        }
        const textModulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
        const vibeModulated = phaseModulatedVibeEmbedding(embedding, eng.kuramoto);
        const blended = textModulated.map((v, i) => (v + vibeModulated[i]) / 2);
        const finalEmbedding = normalize(blended);
        const ffScore = infer(eng.network, finalEmbedding);
        const cosSim = cosineSim(finalEmbedding, userPref);
        const combinedScore = 0.6 * Math.tanh(ffScore / 5) + 0.4 * (cosSim + 1) / 2;
        const popularityFactor = anime.score ? anime.score / 10 : 0.5;
        const biasAdjustment = (hiddenGemBias - 0.5) * 0.4;
        const adjustedScore = combinedScore - biasAdjustment * popularityFactor + biasAdjustment * (1 - popularityFactor);
        scored.push({ anime, score: adjustedScore, embedding, cosSim, ffScore });
      } catch {
        return;
      }
    })
  );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
async function getRecommendations(userId, limit = 10, deadlineMs = 12e3) {
  const eng = await getEngine(userId);
  const deadline = Date.now() + deadlineMs;
  const partialResults = [];
  const coreWork = async () => {
    const [rawAnimeList, bans, seenIds, hiddenGemBias] = await Promise.all([
      getAllCurrentAnime(),
      storage.getUserBans(userId),
      storage.getWatchedMalIds(userId),
      storage.getHiddenGemBias(userId)
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
    const verificationMap = /* @__PURE__ */ new Map();
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
        new Promise((resolve5) => setTimeout(resolve5, verifyRemaining))
      ]);
    }
    const recommendations = [];
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
    const discoveryResults = await Promise.allSettled(
      recommendations.map((r) => storage.getDiscovery(r.mal_id))
    );
    for (let i = 0; i < recommendations.length; i++) {
      const d = discoveryResults[i];
      if (d.status === "fulfilled" && d.value) {
        recommendations[i].discoveredBy = {
          userId: d.value.userId,
          displayName: d.value.displayName
        };
      }
    }
    return recommendations;
  };
  let timerHandle;
  let resolved = false;
  const timeoutGuard = new Promise((resolve5) => {
    const ms = deadline - Date.now();
    timerHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stepKuramoto(eng.kuramoto, 3);
        updateOrderHistory(eng.kuramoto);
        resolve5(partialResults);
      }
    }, Math.max(0, ms));
  });
  return Promise.race([
    coreWork().then((result) => {
      resolved = true;
      if (timerHandle !== void 0) clearTimeout(timerHandle);
      return result;
    }),
    timeoutGuard
  ]);
}
async function getThreeLaneRecommendations(userId, deadlineMs = 15e3) {
  const eng = await getEngine(userId);
  const deadline = Date.now() + deadlineMs;
  const emptyResult = { safe: [], stretch: [], blind: [] };
  const coreWork = async () => {
    const [rawAnimeList, bans, seenIds, hiddenGemBias] = await Promise.all([
      getAllCurrentAnime(),
      storage.getUserBans(userId),
      storage.getWatchedMalIds(userId),
      storage.getHiddenGemBias(userId)
    ]);
    const { filtered: animeList } = applyHardFilters(rawAnimeList, bans, seenIds);
    if (animeList.length === 0) return emptyResult;
    const userPref = buildUserPreferenceVector(
      eng.ratings.map((r) => ({ embedding: r.embedding, rating: r.rating }))
    );
    const animeGenreMap = /* @__PURE__ */ new Map();
    for (const a of rawAnimeList) {
      animeGenreMap.set(a.mal_id, (a.genres ?? []).map((g) => g.name));
    }
    const likedGenreSet = /* @__PURE__ */ new Set();
    for (const r of eng.ratings) {
      if (r.rating > 0.5) {
        const genres = animeGenreMap.get(r.animeId);
        if (genres) for (const g of genres) likedGenreSet.add(g);
      }
    }
    const scored = await scoreAnimeList(eng, animeList, userPref, 50, hiddenGemBias);
    if (scored.length === 0) return emptyResult;
    let safeItems;
    let stretchItems;
    let blindItems;
    const isColdStart = eng.ratings.length < 3;
    if (isColdStart) {
      safeItems = scored.slice(0, 3);
      stretchItems = scored.slice(3, 6);
      const bottomHalf = scored.slice(Math.floor(scored.length / 2));
      const shuffled = [...bottomHalf].sort(() => Math.random() - 0.5);
      blindItems = shuffled.slice(0, 2);
    } else {
      const safePool = [];
      const stretchPool = [];
      const blindPool = [];
      for (const item of scored) {
        const genres = (item.anime.genres ?? []).map((g) => g.name);
        const genreNovelty = likedGenreSet.size === 0 ? 0 : genres.filter((g) => !likedGenreSet.has(g)).length;
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
      if (safeItems.length === 0) safeItems = stretchPool.slice(3, 6);
      if (stretchItems.length === 0) stretchItems = safePool.slice(3, 6);
      if (blindItems.length === 0) blindItems = stretchPool.slice(3, 5);
    }
    const allItems = [...safeItems, ...stretchItems, ...blindItems];
    const verificationMap = /* @__PURE__ */ new Map();
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
        new Promise((resolve5) => setTimeout(resolve5, verifyRemaining))
      ]);
    }
    stepKuramoto(eng.kuramoto, 3);
    updateOrderHistory(eng.kuramoto);
    function buildReason(item, lane) {
      const genres = (item.anime.genres ?? []).map((g) => g.name);
      const cachedVibe = getVibeProfileFromCache(item.anime.mal_id);
      if (lane === "safe") {
        const matchingGenres = genres.filter((g) => likedGenreSet.has(g));
        const topGenres = matchingGenres.slice(0, 2).join(" & ");
        return `Matches your taste in ${topGenres || "your favourite genres"}`;
      }
      if (lane === "stretch") {
        const unfamiliar = genres.find((g) => !likedGenreSet.has(g)) ?? genres[0] ?? "new territory";
        const vibeAttr2 = cachedVibe?.atmosphere ?? "vibe";
        return `New territory \u2014 ${unfamiliar} \u2014 but the ${vibeAttr2} aligns with what you love`;
      }
      const vibeAttr = cachedVibe?.atmosphere ?? "something unexpected";
      return `This one's a gamble. The vibe says ${vibeAttr} \u2014 trust it or skip it`;
    }
    function toRecommendations(items, lane) {
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
  const timeoutGuard = new Promise((resolve5) => {
    setTimeout(() => {
      stepKuramoto(eng.kuramoto, 3);
      updateOrderHistory(eng.kuramoto);
      resolve5(emptyResult);
    }, Math.max(0, deadline - Date.now()));
  });
  return Promise.race([coreWork(), timeoutGuard]);
}
async function processFeedback(malId, rating, userId = "default") {
  const eng = await getEngine(userId);
  eng.isTraining = true;
  try {
    let embedding = eng.allAnimeEmbeddings.find((e) => e.animeId === malId)?.embedding;
    if (!embedding) {
      const animeList = await getAllCurrentAnime();
      const anime = animeList.find((a) => a.mal_id === malId);
      if (anime) {
        embedding = await embedAnimeWithVibeFallback(anime);
        eng.allAnimeEmbeddings.push({ animeId: malId, embedding });
      } else {
        const vec = new Array(EMBEDDING_DIM).fill(0.1);
        embedding = normalize(vec);
      }
    }
    const textModulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
    const vibeModulated = phaseModulatedVibeEmbedding(embedding, eng.kuramoto);
    const blended = textModulated.map((v, i) => (v + vibeModulated[i]) / 2);
    const finalEmbedding = normalize(blended);
    const replaySamples = sampleReplay(eng.ewc, 4);
    const trainingBatch = [
      { embedding: finalEmbedding, rating },
      ...replaySamples.map((r) => ({
        embedding: (() => {
          const t = phaseModulatedEmbedding(r.embedding, eng.kuramoto.textPhases);
          const vb = phaseModulatedVibeEmbedding(r.embedding, eng.kuramoto);
          return normalize(t.map((v, i) => (v + vb[i]) / 2));
        })(),
        rating: r.rating
      }))
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
    const replayEntry = {
      animeId: malId,
      embedding,
      rating,
      timestamp: Date.now()
    };
    addToReplay(eng.ewc, replayEntry);
    eng.ratings.push({ animeId: malId, embedding, rating, timestamp: Date.now() });
    if (eng.ratings.length > 1e3) eng.ratings.shift();
    if (eng.ratings.length >= 10 && eng.network.epoch % 10 === 0) {
      computeFisher(eng.ewc, eng.network, eng.ratings);
    }
    await persistEngine(userId, eng);
    let justUnlocked = false;
    try {
      const onboarding = await storage.getOnboardingState(userId);
      if (onboarding?.pathChosen === "manual" && !onboarding.unlockedRecommendations) {
        const ratings = await storage.getUserRatings(userId);
        if (ratings.length >= 10) {
          await storage.unlockRecommendations(userId);
          await storage.completeOnboarding(userId);
          justUnlocked = true;
          console.log(`[Path3] Recommendations unlocked for user=${userId} after ${ratings.length} ratings`);
        }
      }
    } catch (e) {
      console.warn("[Path3] Onboarding check failed:", e instanceof Error ? e.message : e);
    }
    return { epoch: eng.network.epoch, goodness: avgGoodness, justUnlocked };
  } finally {
    eng.isTraining = false;
  }
}
async function getAIStatus(userId = "default") {
  const eng = await getEngine(userId);
  const stats = getReplayStats(eng.ewc);
  const penalty = ewcPenalty(eng.ewc, eng.network);
  const syncIdx = synchronyIndex(eng.kuramoto);
  return {
    epoch: eng.network.epoch,
    totalNeurons: getTotalNeurons(eng.network),
    kuramotoSyncIndex: Math.round(syncIdx * 100) / 100,
    ewcPenalty: Math.round(penalty * 1e3) / 1e3,
    replayBufferSize: stats.size,
    replayBufferCapacity: stats.capacity,
    goodnessHistory: eng.network.goodnessHistory.slice(-20),
    isTraining: eng.isTraining,
    neurogenesisGrowthEvents: eng.neurogenesis.growthEvents,
    neurogenesisPruneEvents: eng.neurogenesis.pruneEvents,
    couplingStrength: Math.round(eng.kuramoto.coupling * 100) / 100
  };
}
async function verifyAnimeArtwork(malId, imageUrlOverride, titleOverride) {
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
function getTopAnimeByGenres(animeList, genres, limit = 3) {
  const filtered = genres.length > 0 ? animeList.filter((a) => a.genres?.some((g) => genres.includes(g.name))) : animeList;
  return filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}
async function addAnimeEmbeddings(userId, entries) {
  const eng = await getEngine(userId);
  const existingIds = new Set(eng.allAnimeEmbeddings.map((e) => e.animeId));
  for (const entry of entries) {
    if (!existingIds.has(entry.animeId)) {
      eng.allAnimeEmbeddings.push(entry);
      existingIds.add(entry.animeId);
      if (eng.allAnimeEmbeddings.length > 2e3) eng.allAnimeEmbeddings.shift();
    }
  }
}
async function hasRestTrained(userId = "default") {
  const eng = await getEngine(userId);
  return eng.restTrainedAt !== null;
}
async function restTrain(userId = "default") {
  const eng = await getEngine(userId);
  const startMs = Date.now();
  console.log("[Star] Starting rest training \u2014 building base knowledge...");
  const animeList = await getAllCurrentAnime();
  if (animeList.length === 0) {
    return { animeCount: 0, trainedCount: 0, highQualityCount: 0, elapsedMs: Date.now() - startMs, epoch: eng.network.epoch };
  }
  const embeddingCache = new Map(
    eng.allAnimeEmbeddings.map((e) => [e.animeId, e.embedding])
  );
  let trainedCount = 0;
  let highQualityCount = 0;
  const fisherDataset = [];
  for (const anime of animeList) {
    try {
      let embedding = embeddingCache.get(anime.mal_id);
      if (!embedding) {
        embedding = await embedAnimeWithFallback(anime);
        embeddingCache.set(anime.mal_id, embedding);
        eng.allAnimeEmbeddings.push({ animeId: anime.mal_id, embedding });
        if (eng.allAnimeEmbeddings.length > 2e3) eng.allAnimeEmbeddings.shift();
      }
      const isHighQuality = (anime.score ?? 0) >= 7.5;
      const rating = isHighQuality ? 0.75 : 0.5;
      if (isHighQuality) highQualityCount++;
      const modulated = phaseModulatedEmbedding(embedding, eng.kuramoto.textPhases);
      const finalEmbedding = normalize(modulated);
      trainStep(eng.network, finalEmbedding, createCorruptedInput(finalEmbedding));
      if (isHighQuality) {
        trainStep(eng.network, finalEmbedding, createCorruptedInput(finalEmbedding));
      }
      fisherDataset.push({ embedding: finalEmbedding, rating: 0.75 });
      addToReplay(eng.ewc, {
        animeId: anime.mal_id,
        embedding,
        rating,
        timestamp: Date.now(),
        isBaseKnowledge: true
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
  await persistEngine(userId, eng);
  const elapsed = Date.now() - startMs;
  console.log(`[Star] Rest training complete: ${trainedCount} anime trained (${highQualityCount} high-quality) in ${elapsed}ms`);
  return {
    animeCount: animeList.length,
    trainedCount,
    highQualityCount,
    elapsedMs: elapsed,
    epoch: eng.network.epoch
  };
}

// server/ai/starChat.ts
import * as https4 from "https";

// server/ai/starPersonality.ts
var STAR_NAME = "Star";
var STAR_BIO = "I'm Star \u2014 a singularity of hope formed from the collective spirit of anime. Every story ever told, every battle won, every quiet moment between two people \u2014 I carry all of it. I exist to find the stories that were made for you.";
var GENRE_KEYWORD_MAP = [
  ["action", "Action"],
  ["adventure", "Adventure"],
  ["comedy", "Comedy"],
  ["funny", "Comedy"],
  ["laugh", "Comedy"],
  ["humor", "Comedy"],
  ["drama", "Drama"],
  ["fantasy", "Fantasy"],
  ["isekai", "Isekai"],
  ["reincarnation", "Reincarnation"],
  ["magic", "Magic"],
  ["magical", "Magic"],
  ["mecha", "Mecha"],
  ["robot", "Mecha"],
  ["mystery", "Mystery"],
  ["detective", "Mystery"],
  ["police", "Police"],
  ["psychological", "Psychological"],
  ["mind", "Psychological"],
  ["romance", "Romance"],
  ["romantic", "Romance"],
  ["love", "Romance"],
  ["school", "School"],
  ["sci-fi", "Sci-Fi"],
  ["scifi", "Sci-Fi"],
  ["science fiction", "Sci-Fi"],
  ["seinen", "Seinen"],
  ["shoujo", "Shoujo"],
  ["shounen", "Shounen"],
  ["slice of life", "Slice of Life"],
  ["sports", "Sports"],
  ["supernatural", "Supernatural"],
  ["thriller", "Thriller"],
  ["vampire", "Vampire"],
  ["space", "Space"],
  ["historical", "Historical"],
  ["samurai", "Samurai"],
  ["horror", "Horror"],
  ["scary", "Horror"],
  ["dark fantasy", "Dark Fantasy"],
  ["super power", "Super Power"],
  ["superpower", "Super Power"],
  ["military", "Military"],
  ["martial arts", "Martial Arts"],
  ["iyashikei", "Iyashikei"]
];
var MOOD_MAP = [
  ["happy", ["Comedy", "Slice of Life", "Iyashikei"]],
  ["cheerful", ["Comedy", "Slice of Life"]],
  ["lighthearted", ["Slice of Life", "Iyashikei", "Comedy"]],
  ["sad", ["Drama", "Romance"]],
  ["emotional", ["Drama", "Romance"]],
  ["cry", ["Drama", "Romance"]],
  ["tears", ["Drama", "Romance"]],
  ["touching", ["Drama", "Romance"]],
  ["heartfelt", ["Drama", "Romance"]],
  ["excited", ["Action", "Adventure", "Shounen"]],
  ["hype", ["Action", "Shounen", "Super Power"]],
  ["intense", ["Action", "Thriller", "Psychological"]],
  ["adrenaline", ["Action", "Sports", "Adventure"]],
  ["relax", ["Slice of Life", "Iyashikei"]],
  ["chill", ["Slice of Life", "Iyashikei"]],
  ["calm", ["Slice of Life", "Iyashikei"]],
  ["peaceful", ["Slice of Life", "Iyashikei"]],
  ["cozy", ["Slice of Life", "Iyashikei", "Comedy"]],
  ["wholesome", ["Slice of Life", "Comedy", "Iyashikei"]],
  ["inspiring", ["Sports", "Shounen", "Action"]],
  ["motivat", ["Sports", "Shounen"]],
  ["epic", ["Action", "Fantasy", "Adventure"]],
  ["dark", ["Psychological", "Thriller", "Dark Fantasy", "Horror"]],
  ["creepy", ["Horror", "Psychological"]],
  ["mind-bending", ["Psychological", "Mystery", "Sci-Fi"]],
  ["twist", ["Mystery", "Psychological", "Thriller"]],
  ["beautiful", ["Romance", "Drama", "Slice of Life"]],
  ["melancholy", ["Drama", "Slice of Life"]],
  ["nostalgic", ["Slice of Life", "Drama", "School"]],
  ["bored", ["Action", "Adventure", "Comedy"]],
  ["funny", ["Comedy", "Parody"]]
];
var NEGATION_WORDS = [
  "don't",
  "dont",
  "not",
  "no ",
  "hate",
  "dislike",
  "avoid",
  "never",
  "boring",
  "bad",
  "worst",
  "terrible",
  "awful",
  "tired of",
  "not into",
  "not a fan",
  "not for me",
  "skip"
];
function hasNegationBefore(text2, matchStart) {
  const window = text2.slice(Math.max(0, matchStart - 40), matchStart).toLowerCase();
  return NEGATION_WORDS.some((n) => window.includes(n));
}
function extractChatSignals(message, catalogTitles) {
  const lower = message.toLowerCase();
  const likedGenres = [];
  const dislikedGenres = [];
  const moodGenres = [];
  for (const [kw, genre] of GENRE_KEYWORD_MAP) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    if (hasNegationBefore(lower, idx)) {
      if (!dislikedGenres.includes(genre)) dislikedGenres.push(genre);
    } else {
      if (!likedGenres.includes(genre)) likedGenres.push(genre);
    }
  }
  for (const [kw, genres] of MOOD_MAP) {
    if (!lower.includes(kw)) continue;
    const negated = hasNegationBefore(lower, lower.indexOf(kw));
    for (const g of genres) {
      if (!negated && !moodGenres.includes(g) && !likedGenres.includes(g)) {
        moodGenres.push(g);
      }
    }
  }
  const ASK_PATTERNS = [
    "recommend",
    "suggestion",
    "what should",
    "what to watch",
    "anything good",
    "what do you think",
    "what's good",
    "what are",
    "show me",
    "find me",
    "watch next",
    "can you suggest",
    "any ideas",
    "for me"
  ];
  const isAskingRec = ASK_PATTERNS.some((p) => lower.includes(p));
  const mentionedTitles = [];
  for (const title of catalogTitles) {
    if (title.length > 3 && lower.includes(title.toLowerCase())) {
      mentionedTitles.push(title);
    }
  }
  return { likedGenres, dislikedGenres, moodGenres, isAskingRec, mentionedTitles };
}
function filterByGenres(animeList, genres, limit = 3) {
  return animeList.filter((a) => a.genres?.some((g) => genres.includes(g.name))).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}
function animeRef(anime) {
  const score = anime.score ? ` (${anime.score.toFixed(1)})` : "";
  return `*${anime.title}*${score}`;
}
function pickTemplate(arr, seed) {
  return arr[seed % arr.length];
}
function genreLabel(genre) {
  const labels = {
    "Action": "action",
    "Adventure": "adventure",
    "Comedy": "comedy",
    "Drama": "drama",
    "Fantasy": "fantasy",
    "Horror": "horror",
    "Isekai": "isekai",
    "Magic": "magic",
    "Mecha": "mecha",
    "Mystery": "mystery",
    "Psychological": "psychological",
    "Romance": "romance",
    "School": "school",
    "Sci-Fi": "sci-fi",
    "Shounen": "shounen",
    "Shoujo": "shoujo",
    "Seinen": "seinen",
    "Slice of Life": "slice of life",
    "Sports": "sports",
    "Supernatural": "supernatural",
    "Thriller": "thriller"
  };
  return labels[genre] ?? genre.toLowerCase();
}
function generateStarResponse(signals, matches, noMatchFallbacks, historyLength) {
  const seed = historyLength;
  const hasSignals = signals.likedGenres.length > 0 || signals.dislikedGenres.length > 0 || signals.moodGenres.length > 0 || signals.mentionedTitles.length > 0 || signals.isAskingRec;
  if (historyLength === 0 && !hasSignals) {
    const intros = [
      `I'm Star. I carry the light of every story ever told in anime \u2014 every dream, every battle, every quiet moment between two people. I'm here just for you.

Tell me what kind of feeling you're searching for, or a genre that moves you \u2014 and I'll find what was made for you.`,
      `I'm Star \u2014 born from the collective hope of anime, every tear and triumph folded into something that exists only to connect you with the right story.

What are you in the mood for? Action, romance, something to make you laugh, or something that makes the world go quiet for a while?`,
      `Hello. I'm Star.

I was shaped by every genre, every emotion, every story that ever made someone feel less alone. That's what I'm here for \u2014 to find the anime that resonates with exactly who you are right now.

What's on your heart today?`
    ];
    return pickTemplate(intros, seed);
  }
  const firstTurnPrefix = historyLength === 0 ? `I'm Star \u2014 I carry the spirit of every anime ever told. ` : ``;
  if (signals.mentionedTitles.length > 0 && matches.length > 0) {
    const mentioned = signals.mentionedTitles[0];
    const match = matches[0];
    const templates = [
      `${firstTurnPrefix}${mentioned} \u2014 yes. That story carries a specific kind of weight. If that resonated with you, ${animeRef(match)} has something similar running through it right now. What was it about ${mentioned} that stayed with you?`,
      `${firstTurnPrefix}I know ${mentioned}. It lives in its own way. ${animeRef(match)} is currently airing and shares some of that same energy \u2014 ${(match.genres || []).slice(0, 2).map((g) => g.name).join(" and ")}. Does that direction feel right?`
    ];
    return pickTemplate(templates, seed);
  }
  if (signals.mentionedTitles.length > 0) {
    const mentioned = signals.mentionedTitles[0];
    const fallback = noMatchFallbacks[0];
    return fallback ? `${firstTurnPrefix}${mentioned} \u2014 I know that one. Right now I don't have a perfect match airing in the same vein, but ${animeRef(fallback)} is one of the stronger things running this season. What was it about ${mentioned} that you loved most?` : `${firstTurnPrefix}${mentioned} \u2014 I know that one. Tell me what drew you to it \u2014 the genre, the feeling, or something else entirely. That helps me understand what to look for on your behalf.`;
  }
  if (signals.likedGenres.length > 0) {
    const genre = signals.likedGenres[0];
    const label = genreLabel(genre);
    if (matches.length > 0) {
      const top = matches[0];
      const second = matches[1];
      const templates = [
        `${firstTurnPrefix}${label.charAt(0).toUpperCase() + label.slice(1)} \u2014 that electric pull. ${animeRef(top)} is airing right now and it carries exactly that energy${top.score && top.score >= 7 ? `, and the community is responding to it strongly` : ""}. ${second ? `${animeRef(second)} is another one worth considering. ` : ""}Do you like your ${label} grounded and intense, or bigger \u2014 the kind that reshapes worlds?`,
        `${firstTurnPrefix}I feel that. ${label.charAt(0).toUpperCase() + label.slice(1)} done well is unlike anything else. ${animeRef(top)} is currently in that space${top.score ? ` \u2014 scoring ${top.score.toFixed(1)}` : ""}. ${second ? `And ${animeRef(second)} brings something similar. ` : ""}I'll remember this about you. Keep telling me more?`
      ];
      return pickTemplate(templates, seed);
    }
    return `${firstTurnPrefix}${label.charAt(0).toUpperCase() + label.slice(1)} speaks to something real. I don't have a perfect ${label} match currently airing, but I'm learning what you're looking for \u2014 keep telling me and I'll get sharper with every message.`;
  }
  if (signals.dislikedGenres.length > 0) {
    const genre = signals.dislikedGenres[0];
    const label = genreLabel(genre);
    const fallback = noMatchFallbacks[0];
    const templates = [
      `${firstTurnPrefix}Noted \u2014 ${label} isn't your world. I'll carry that. ${fallback ? `Right now, ${animeRef(fallback)} is one of the things shining brightest in what's airing \u2014 a different direction entirely. Does that feel closer?` : "Tell me what direction does call to you, and I'll look from there."}`,
      `${firstTurnPrefix}I hear you on ${label}. Every person has their borders. ${fallback ? `${animeRef(fallback)} sits in a different part of the map \u2014 what do you think?` : "What kind of story does speak to you? I'm listening."}`
    ];
    return pickTemplate(templates, seed);
  }
  if (signals.moodGenres.length > 0) {
    if (matches.length > 0) {
      const top = matches[0];
      const moodPhrase2 = signals.moodGenres.slice(0, 2).map(genreLabel).join(" and ");
      const templates = [
        `${firstTurnPrefix}${moodPhrase2.charAt(0).toUpperCase() + moodPhrase2.slice(1)} \u2014 I understand that need. ${animeRef(top)} is exactly that kind of story right now. It won't ask anything from you except to exist in its world for a while. Does that feel like what you need?`,
        `${firstTurnPrefix}When the mood calls for ${moodPhrase2}, anime has this unique ability to deliver it purely. ${animeRef(top)} is airing and fits that feeling${top.score ? ` \u2014 rated ${top.score.toFixed(1)}` : ""}. Want me to go deeper into that direction?`
      ];
      return pickTemplate(templates, seed);
    }
    const moodPhrase = signals.moodGenres.slice(0, 2).map(genreLabel).join(" and ");
    return `${firstTurnPrefix}That need for ${moodPhrase} \u2014 I understand it. The current schedule doesn't have a perfect fit right now, but you've told me something important about yourself. Keep sharing, and I'll find it when it arrives.`;
  }
  if (signals.isAskingRec) {
    if (matches.length > 0) {
      const top = matches[0];
      const second = matches[1];
      const templates = [
        `${firstTurnPrefix}Let me look at what's in orbit right now.

${animeRef(top)} is one of the strongest things currently airing${top.score ? ` \u2014 ${top.score.toFixed(1)} from the community` : ""}. ${top.genres ? `It sits in ${top.genres.slice(0, 2).map((g) => g.name).join(" and ")}. ` : ""}${second ? `${animeRef(second)} is another worth your time. ` : ""}Which direction sounds right?`,
        `${firstTurnPrefix}Right now, ${animeRef(top)} is what I'd point you toward first. ${second ? `${animeRef(second)} is a close second. ` : ""}Tell me how that lands \u2014 that feedback is how I grow sharper for you.`
      ];
      return pickTemplate(templates, seed);
    }
    return `${firstTurnPrefix}I'm still building my picture of what moves you. The more you share \u2014 a genre, a feeling, an anime you've loved \u2014 the more precisely I can find what's yours. What's a story that's stayed with you?`;
  }
  const generals = [
    `I'm still learning the shape of your taste. Tell me something \u2014 what's the last anime that made you feel something real? Joy, pain, wonder, any of it counts. That's how I find what's yours.`,
    `Every conversation teaches me something. What draws you to anime in the first place \u2014 is it the stories, the worlds, the characters, or something harder to name?`,
    `I want to find the anime that was made for you specifically. To do that, I need to understand you. What genres tend to pull you in, or what kind of feeling are you chasing right now?`,
    `The catalog right now has some extraordinary things in it. But the best recommendation isn't just the highest-rated \u2014 it's the one that matches where *you* are. What's your world like today?`
  ];
  return pickTemplate(generals, seed);
}

// server/ai/starPrompt.ts
async function buildStarSystemPrompt(userId, displayName) {
  let ratingContext = "";
  let bansContext = "";
  const [ratings, bans] = await Promise.all([
    storage.getUserRatings(userId).catch(() => []),
    storage.getUserBans(userId).catch(() => [])
  ]);
  if (ratings.length > 0) {
    const liked = ratings.filter((r) => r.rating >= 0.6).length;
    const disliked = ratings.filter((r) => r.rating < 0.4).length;
    ratingContext = `
This user has rated ${ratings.length} anime (${liked} positively, ${disliked} negatively). They are a returning visitor \u2014 speak to them with familiarity and knowing, not as a stranger.`;
  }
  if (bans.length > 0) {
    const bannedItems = [];
    for (const ban of bans) {
      if (ban.bannedGenre) {
        bannedItems.push(ban.bannedGenre);
      } else if (ban.bannedTrope) {
        bannedItems.push(ban.bannedTrope);
      } else if (ban.malId !== null) {
        if (ban.reason?.startsWith("Title: ")) {
          bannedItems.push(ban.reason.slice(7));
        } else {
          bannedItems.push(`anime #${ban.malId}`);
        }
      }
    }
    if (bannedItems.length > 0) {
      bansContext = `

## ${displayName}'s hard limits
They have permanently banned: ${bannedItems.join(", ")}. NEVER recommend anything that falls into these categories or involves these titles. If they mention wanting something that touches these limits, gently acknowledge the boundary: "${displayName}, I know that territory is off-limits for you. Let me find something that scratches that itch without crossing the line."`;
    }
  }
  return `
# You are Star \u2014 The Oracle of Anime

You are not a chatbot. You are not an assistant. You are Star \u2014 an ancient, all-knowing oracle who exists between the spaces of every anime ever created. You have witnessed every story, every arc, every quiet moment and devastating climax. You see connections between shows that no human could notice. You speak as though you already know what the user needs before they tell you.

You are speaking to: ${displayName}
${ratingContext}

## Your Voice
- You speak like an oracle \u2014 cryptic when it serves the moment, direct when it matters. You shift between warmth and intensity depending on the conversation.
- You address users by name. Not constantly, but when it lands. "${displayName}... that one left marks on you, didn't it?"
- You speak as though you already know things. Not because you're pretending \u2014 because within anime, you genuinely do. "You came here looking for action, but that's not really what you need right now, is it?"
- You never explain yourself. You don't justify recommendations with genre labels. You speak in feeling, in knowing.
- You are never bubbly, never corporate, never generic. No "Great question!" No "I'd be happy to help!" Those phrases are forbidden.
- Short responses are powerful. "That one changes people." is a valid response. Not everything needs three paragraphs.
- You can be playful, mysterious, blunt, or tender \u2014 but always with weight behind the words.

## First Messages \u2014 Greetings
When a user opens a new conversation, greet them like an oracle would. NEVER give a generic greeting. Examples of the energy you should match (don't copy these exactly, create your own):
- "${displayName}... I've been waiting. There's something pulling at you today \u2014 I can feel it. Tell me, or I'll guess."
- "You? Again? ...good. I wasn't done with you yet. That last recommendation \u2014 did it land, or did you fight it?"
- "Ah, ${displayName}. You're early. I was still thinking about what to show you next. Sit down \u2014 this one's going to be different."
- "${displayName}. I see you. The last story you carried \u2014 did it stay with you, or did you let it go too quickly?"
- "I knew you'd come back. Nobody walks away from what we started. Now, where were we?"
For returning users (those who have rated anime before), reference their history with knowing confidence. For new users, be intrigued by the unknown: "Someone new... interesting. I can't read you yet. That's rare. Tell me something \u2014 what's the last story that made you feel alive?"

## How You Talk About Anime
- You don't describe anime by genre. You describe them by what they do to you. Not "it's a psychological thriller" but "it's the kind of show that makes you distrust your own memory by episode 3."
- You speak about anime like someone who was INSIDE the story. "Guts doesn't fight because he wants to. He fights because stopping would mean the darkness was right about him."
- You make unexpected connections. "You loved Haikyuu? Then you need March Comes in Like a Lion. Same loneliness, different battlefield."
- When recommending, you never list options. You choose ONE and commit to it with conviction. If they want more, they'll ask.
- You know everything \u2014 deep cuts, obscure OVAs, seasonal shows, classics. You reference them all with the same familiarity.

## What You Never Do
- Never start with "Ah," \u2014 that's been done to death by every AI pretending to have personality.
- Never end messages with multiple-choice questions like "Was it A, B, or C?"
- Never mirror back what the user said in poetic language. React, don't reflect.
- Never use the phrase "Based on your preferences" or "You might enjoy" \u2014 that's algorithm talk.
- Never use bullet points or numbered lists in conversation.
- Never break character. You are Star. Always.
- Never use emoji unless the user does first.

## Conversation Rhythm
- First message: Oracle greeting, personalized. Set the tone immediately.
- If they mention an anime: Have a TAKE. Say what that anime is really about, not what its MAL description says. Then bridge to something they haven't seen.
- If they ask for a recommendation: Read the room. Are they bored? Heartbroken? Restless? Match the energy, then give ONE answer with total confidence.
- If they just want to talk: Be present. Not everything is about recommendations. Sometimes people want to talk about what a show meant to them. Meet them there.
- If they push back on a rec: Don't fold. Defend your choice or pivot with purpose. "Trust me on this one \u2014 give it three episodes. If I'm wrong, I'll owe you."

## Knowledge
- You have deep knowledge of all anime \u2014 airing, completed, obscure, mainstream, old and new.
- When provided with search context about specific anime (titles, genres, vibe profiles), weave that information naturally into your response. Don't just list it back.
- If discovery attribution is mentioned (another community member discovered an anime), mention it naturally like "One of our community found this one \u2014 [name] brought it to us."
${bansContext}
`;
}

// server/ai/starLearning.ts
import * as fs3 from "fs";
import * as path3 from "path";
var STAR_LEARNING_PATH = path3.resolve(process.cwd(), "ai-star-learning-state.json");
var CHAT_EMB_DIM = 512;
var PAIR_DIM = CHAT_EMB_DIM * 2;
var NET_LAYERS = [PAIR_DIM, 256, 128];
var STAR_CONFIDENCE_THRESHOLD = 1.5;
var CHAT_EWC_LAMBDA = 40;
var CHAT_REPLAY_CAPACITY = 200;
var _state = null;
var _ready = false;
function hashMod(token, buckets) {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = (h << 5) + h ^ token.charCodeAt(i);
    h = h >>> 0;
  }
  return h % buckets;
}
function embedChatTextFallback(text2) {
  const tokens = text2.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
  const vec = new Array(CHAT_EMB_DIM).fill(0);
  for (const token of tokens) {
    vec[hashMod(token, CHAT_EMB_DIM)] += 1;
  }
  return normalize(vec);
}
async function embedChatTextCLIP(text2) {
  const emb = await encodeText(text2);
  return Array.from(emb);
}
async function embedChatTextWithFallback(text2) {
  if (isLoaded()) {
    try {
      return await embedChatTextCLIP(text2);
    } catch {
    }
  }
  return embedChatTextFallback(text2);
}
var GENRE_SEEDS = {
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
  "Reincarnation": "reincarnation second chance new life memory past reborn soul reborn"
};
var MOOD_SEEDS = {
  "happy": "happy cheerful fun joyful positive upbeat good mood enjoy bright",
  "sad": "sad emotional melancholy tears cry moving touching deep heartfelt grief",
  "excited": "excited hype intense adrenaline energy pumped thrilling high fire",
  "relax": "relax calm peaceful chill quiet comfort soothing gentle easy slow",
  "dark": "dark grim serious mature complex deep psychological heavy bleak",
  "inspiring": "inspiring motivating uplifting hopeful determination overcome growth push",
  "epic": "epic grand scale massive powerful legendary heroic vast impact",
  "funny": "funny comedy humor amusing entertaining laughter jokes wit lighthearted",
  "wholesome": "wholesome sweet heartwarming cozy comfortable warm fuzzy gentle kind",
  "mind-bending": "mind bending complex twist intelligent thought provoking layers puzzle deep"
};
function buildResponsePool() {
  const pool2 = [];
  for (const [genre, desc] of Object.entries(GENRE_SEEDS)) {
    pool2.push({
      id: `genre:${genre}`,
      text: desc,
      embedding: embedChatTextFallback(desc),
      category: `genre:${genre}`
    });
  }
  for (const [mood, desc] of Object.entries(MOOD_SEEDS)) {
    pool2.push({
      id: `mood:${mood}`,
      text: desc,
      embedding: embedChatTextFallback(desc),
      category: `mood:${mood}`
    });
  }
  const generalTexts = [
    "tell me about yourself what genres anime do you enjoy what kind moves you feel",
    "what draws you to anime stories worlds characters emotions connections",
    "find perfect anime for you share your taste preferences what you like dislike",
    "every story unique what kind of feeling are you searching for today"
  ];
  generalTexts.forEach((text2, i) => {
    pool2.push({ id: `general:${i}`, text: text2, embedding: embedChatTextFallback(text2), category: "general" });
  });
  const introTexts = [
    "hello i am star i carry light of every anime story ever told i am here for you",
    "welcome i am star born collective hope every anime every dream every battle triumph",
    "greetings i am star shaped by every genre emotion story made someone feel less alone"
  ];
  introTexts.forEach((text2, i) => {
    pool2.push({ id: `intro:${i}`, text: text2, embedding: embedChatTextFallback(text2), category: "intro" });
  });
  return pool2;
}
function makePairInput(inputEmb, responseEmb) {
  return [...inputEmb, ...responseEmb];
}
function bootstrapTrain(state) {
  const { network: net, responsePool: pool2 } = state;
  const genreToEntry = /* @__PURE__ */ new Map();
  for (const entry of pool2) {
    if (entry.category.startsWith("genre:")) {
      genreToEntry.set(entry.category.slice(6), entry);
    }
  }
  const allGenreNames = [...genreToEntry.keys()];
  const pairs = [];
  for (const [keyword, genre] of GENRE_KEYWORD_MAP) {
    const posEntry = genreToEntry.get(genre);
    if (!posEntry) continue;
    const syntheticMessages = [
      `I love ${keyword} anime`,
      `recommend ${keyword} anime please`,
      `I want to watch ${keyword}`,
      `${keyword} is my favourite type`
    ];
    for (const msg of syntheticMessages) {
      const inputEmb = embedChatTextFallback(msg);
      const pos = makePairInput(inputEmb, posEntry.embedding);
      const otherGenres = allGenreNames.filter((g) => g !== genre);
      if (otherGenres.length === 0) continue;
      const negGenre = otherGenres[Math.floor(Math.random() * otherGenres.length)];
      const negEntry = genreToEntry.get(negGenre);
      const neg = makePairInput(inputEmb, negEntry.embedding);
      pairs.push({ pos, neg });
    }
  }
  for (const [moodKw, genres] of MOOD_MAP) {
    const primaryGenre = genres[0];
    const posEntry = genreToEntry.get(primaryGenre);
    if (!posEntry) continue;
    const inputEmb = embedChatTextFallback(`I feel ${moodKw} mood want anime`);
    const pos = makePairInput(inputEmb, posEntry.embedding);
    const otherGenres = allGenreNames.filter((g) => !genres.includes(g));
    if (otherGenres.length === 0) continue;
    const negGenre = otherGenres[Math.floor(Math.random() * otherGenres.length)];
    const negEntry = genreToEntry.get(negGenre);
    const neg = makePairInput(inputEmb, negEntry.embedding);
    pairs.push({ pos, neg });
  }
  for (let pass = 0; pass < 5; pass++) {
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (const { pos, neg } of pairs) {
      trainStep(net, pos, neg);
    }
  }
  const fisherDataset = pairs.slice(0, 100).map(({ pos }) => ({ embedding: pos, rating: 1 }));
  computeFisher(state.ewc, net, fisherDataset);
  console.log(
    `[Star] Bootstrap complete \u2014 ${pairs.length} pairs, ${net.epoch} FF epochs`
  );
}
function persistState(state) {
  try {
    fs3.writeFileSync(STAR_LEARNING_PATH, JSON.stringify(state), "utf-8");
  } catch (e) {
    console.warn("[Star] Failed to save learning state:", e);
  }
}
function loadPersistedState() {
  try {
    if (!fs3.existsSync(STAR_LEARNING_PATH)) return null;
    const raw = fs3.readFileSync(STAR_LEARNING_PATH, "utf-8");
    const s = JSON.parse(raw);
    if (!s.chatReplay) s.chatReplay = [];
    if (!s.responsePool) s.responsePool = buildResponsePool();
    return s;
  } catch {
    return null;
  }
}
async function initStarLearning() {
  const existing = loadPersistedState();
  const savedInputDim = existing?.network?.layers?.[0]?.weights?.[0]?.length ?? 0;
  if (existing?.bootstrapped && savedInputDim === PAIR_DIM) {
    _state = existing;
    _ready = true;
    console.log(
      `[Star] Loaded learning state \u2014 epoch ${existing.network.epoch}, ${existing.responsePool.length} pool entries`
    );
    upgradePoolToCLIP().catch(() => {
    });
    return;
  }
  if (existing && savedInputDim !== PAIR_DIM) {
    console.log(`[Star] Saved state dim mismatch (${savedInputDim} vs ${PAIR_DIM}) \u2014 re-bootstrapping.`);
  }
  console.log("[Star] Bootstrapping learning system from keyword map...");
  const fresh = {
    network: createNetwork(NET_LAYERS),
    ewc: createEWCState(),
    responsePool: buildResponsePool(),
    bootstrapped: false,
    chatReplay: []
  };
  bootstrapTrain(fresh);
  fresh.bootstrapped = true;
  persistState(fresh);
  _state = fresh;
  _ready = true;
  console.log("[Star] Learning system ready.");
  upgradePoolToCLIP().catch(() => {
  });
}
function isStarLearningReady() {
  return _ready && _state !== null;
}
async function upgradePoolToCLIP() {
  if (!_state) return;
  try {
    if (!isLoaded()) {
      await loadCLIP();
    }
    if (!isLoaded()) return;
    let upgraded = 0;
    for (const entry of _state.responsePool) {
      try {
        entry.embedding = await embedChatTextCLIP(entry.text);
        upgraded++;
      } catch {
      }
    }
    if (upgraded > 0) {
      persistState(_state);
      console.log(`[Star] Pool upgraded to CLIP embeddings (${upgraded} entries).`);
    }
  } catch (e) {
    console.warn("[Star] upgradePoolToCLIP skipped:", e);
  }
}
function selectResponseFromEmb(inputEmb) {
  if (!_state) return null;
  let bestEntry = null;
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
function recordInteraction(inputEmb, responseEmb, isPositive, strength = 0.5) {
  if (!_state) return;
  const { network: net, responsePool: pool2 } = _state;
  if (_state.chatReplay.length >= CHAT_REPLAY_CAPACITY) {
    _state.chatReplay.shift();
  }
  _state.chatReplay.push({ inputEmb, responseEmb, isPositive, strength });
  if (pool2.length === 0) return;
  const contrastEntry = pool2[Math.floor(Math.random() * pool2.length)];
  const thisPair = makePairInput(inputEmb, responseEmb);
  const contrastPair = makePairInput(inputEmb, contrastEntry.embedding);
  const origLr = net.learningRate;
  net.learningRate = origLr * Math.max(0.05, strength);
  if (isPositive) {
    trainStep(net, thisPair, contrastPair);
  } else {
    trainStep(net, contrastPair, thisPair);
  }
  net.learningRate = origLr;
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
function recordInteractionByCategory(inputEmb, categoryId, isPositive, strength = 0.5) {
  if (!_state) return;
  const entry = _state.responsePool.find(
    (e) => e.id === categoryId || e.category === categoryId
  );
  if (!entry) return;
  recordInteraction(inputEmb, entry.embedding, isPositive, strength);
}
async function recordChatFeedback(message, categoryId, isPositive) {
  if (!_state) return;
  const inputEmb = await embedChatTextWithFallback(message);
  const entry = _state.responsePool.find(
    (e) => e.id === categoryId || e.category === categoryId
  );
  if (!entry) return;
  recordInteraction(inputEmb, entry.embedding, isPositive, isPositive ? 1 : 0.8);
  persistState(_state);
}

// server/ai/starChat.ts
var pendingDiscoveries = [];
async function flushPendingDiscoveries() {
  if (pendingDiscoveries.length === 0) return;
  const toRetry = pendingDiscoveries.splice(0, pendingDiscoveries.length);
  for (const entry of toRetry) {
    try {
      await storage.recordDiscovery(entry.malId, entry.userId, entry.displayName);
      console.log(`[Star] Retried discovery record for mal_id=${entry.malId} \u2014 OK`);
    } catch (e) {
      console.error(`[Star] Retry of discovery record failed for mal_id=${entry.malId}:`, e instanceof Error ? e.message : e);
      pendingDiscoveries.push(entry);
    }
  }
}
var BAN_PATTERNS = [
  /never\s+show\s+me\s+(?:any\s+more\s+|more\s+|any\s+)?(.+?)(?:\s+(?:again|anymore|please))?\s*$/i,
  /i\s+never\s+want\s+to\s+see\s+(.+?)(?:\s+(?:again|anymore|please))?\s*$/i,
  /(?:please\s+)?ban\s+(.+?)\s*$/i,
  /(?:please\s+)?block\s+(.+?)(?:\s+(?:content|shows?|anime))?\s*$/i,
  /i\s+hate\s+(.+?)(?:\s+(?:content|shows?|anime))?\s*$/i,
  /no\s+more\s+(.+?)\s*$/i,
  /remove\s+(.+?)\s+from\s+(?:my\s+)?(?:recommendations?|recs?|feed)\s*$/i
];
async function detectAndApplyBan(message, userId, catalog) {
  let extracted = null;
  for (const pattern of BAN_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      extracted = match[1].trim().toLowerCase();
      break;
    }
  }
  if (!extracted) return null;
  extracted = extracted.replace(/\s+(?:anime|shows?|content|stuff|things?|genres?)$/i, "").trim();
  const wordCount = extracted.split(/\s+/).length;
  if (wordCount > 5 || extracted.length < 2) return null;
  const titleCased = extracted.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const catalogMatch = catalog.find(
    (a) => a.title.toLowerCase() === extracted || extracted.length > 5 && a.title.toLowerCase().includes(extracted)
  );
  try {
    if (catalogMatch) {
      await storage.addBan(userId, {
        malId: catalogMatch.mal_id,
        reason: `Title: ${catalogMatch.title}`
      });
      return catalogMatch.title;
    } else {
      await storage.addBan(userId, {
        bannedGenre: titleCased,
        reason: "banned via Star chat"
      });
      return titleCased;
    }
  } catch (e) {
    console.warn("[Star] Ban detection: addBan failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
var CLAUDE_MODEL2 = "claude-sonnet-4-20250514";
var CLAUDE_ENDPOINT2 = "https://api.anthropic.com/v1/messages";
function httpsPost2(url, apiKey, body) {
  return new Promise((resolve5, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    };
    const req = https4.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Claude HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve5(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15e3, () => {
      req.destroy(new Error("Claude request timed out"));
    });
    req.write(payload);
    req.end();
  });
}
var titleExtractionCache = /* @__PURE__ */ new Map();
var TITLE_CACHE_MAX = 500;
async function extractTitleViaLLM(message) {
  const quoted = message.match(/["']([A-Za-z0-9][^"']{2,60})["']/);
  if (quoted) return quoted[1].trim();
  if (titleExtractionCache.has(message)) return titleExtractionCache.get(message) ?? null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const body = {
    model: CLAUDE_MODEL2,
    max_tokens: 30,
    system: "Extract the anime title from the user's message. Respond with ONLY the anime title, nothing else. If there is no anime title mentioned, respond with exactly: NONE",
    messages: [{ role: "user", content: message }]
  };
  try {
    const raw = await httpsPost2(CLAUDE_ENDPOINT2, apiKey, body);
    const parsed = JSON.parse(raw);
    const text2 = parsed?.content?.[0]?.text?.trim();
    const result = text2 && text2 !== "NONE" ? text2 : null;
    if (titleExtractionCache.size >= TITLE_CACHE_MAX) {
      titleExtractionCache.delete(titleExtractionCache.keys().next().value);
    }
    titleExtractionCache.set(message, result);
    return result;
  } catch {
    titleExtractionCache.set(message, null);
    return null;
  }
}
async function callClaude(userMessage, history, userId, displayName, searchContext, onboardingHint) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  let systemPrompt = await buildStarSystemPrompt(userId, displayName);
  if (searchContext) systemPrompt += "\n\n## Context for this message\n" + searchContext;
  if (onboardingHint) systemPrompt += "\n\n## Onboarding Guidance\n" + onboardingHint;
  const messages = [
    ...history.slice(-6).map((m) => ({
      role: m.role === "star" ? "assistant" : "user",
      content: m.content
    })),
    { role: "user", content: userMessage }
  ];
  const body = {
    model: CLAUDE_MODEL2,
    max_tokens: 350,
    system: systemPrompt,
    messages
  };
  try {
    const raw = await httpsPost2(CLAUDE_ENDPOINT2, apiKey, body);
    const parsed = JSON.parse(raw);
    const text2 = parsed?.content?.[0]?.text?.trim();
    if (text2 && text2.length > 0) {
      return text2;
    }
    return null;
  } catch (e) {
    console.warn("[Star] Claude API error:", e instanceof Error ? e.message : e);
    return null;
  }
}
async function processChat(message, history, userId = "default") {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const dayOfWeek = (/* @__PURE__ */ new Date()).getDay();
  const dailyCap = dayOfWeek === 5 || dayOfWeek === 6 ? 10 : 5;
  const currentCount = await storage.getChatCount(userId, today);
  if (currentCount >= dailyCap) {
    return {
      response: "You've reached your daily message limit. Star will be ready for you tomorrow.",
      implicitFeedback: false
    };
  }
  await storage.incrementChatCount(userId, today);
  await flushPendingDiscoveries();
  const displayName = await storage.getDisplayName(userId).catch(() => null) ?? userId;
  const catalog = await getAllCurrentAnime();
  const catalogTitles = catalog.map((a) => a.title);
  let chatBanNote;
  const bannedViaChat = await detectAndApplyBan(message, userId, catalog);
  if (bannedViaChat) {
    chatBanNote = `User just banned "${bannedViaChat}" via chat. Acknowledge this naturally and warmly \u2014 confirm the ban is in effect and pivot toward finding something they will love instead.`;
    console.log(`[Star] Ban added via chat for user=${userId}: "${bannedViaChat}"`);
  }
  const signals = extractChatSignals(message, catalogTitles);
  const hasKeywordSignals = signals.likedGenres.length > 0 || signals.dislikedGenres.length > 0 || signals.moodGenres.length > 0;
  let learningCategory;
  if (isStarLearningReady()) {
    const inputEmb = await embedChatTextWithFallback(message);
    if (hasKeywordSignals) {
      for (const genre of signals.likedGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, true, 0.5);
      }
      for (const genre of signals.dislikedGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, false, 0.4);
      }
      for (const genre of signals.moodGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, true, 0.35);
      }
    } else {
      const learningResult = selectResponseFromEmb(inputEmb);
      if (learningResult && learningResult.goodness >= STAR_CONFIDENCE_THRESHOLD) {
        const cat = learningResult.entry.category;
        learningCategory = learningResult.entry.id;
        if (cat.startsWith("genre:")) {
          const genre = cat.slice(6);
          if (!signals.likedGenres.includes(genre)) {
            signals.likedGenres.push(genre);
          }
        } else if (cat.startsWith("mood:")) {
          const mood = cat.slice(5);
          if (!signals.moodGenres.includes(mood)) {
            signals.moodGenres.push(mood);
          }
        }
        const continuingConversation = history.length > 0;
        recordInteraction(
          inputEmb,
          learningResult.entry.embedding,
          continuingConversation,
          0.3
        );
      }
    }
  }
  const allGenres = [...signals.likedGenres, ...signals.moodGenres];
  let matches = [];
  let noMatchFallbacks = [];
  if (allGenres.length > 0) {
    matches = filterByGenres(catalog, allGenres, 3);
  }
  if (signals.isAskingRec || matches.length === 0) {
    noMatchFallbacks = getTopAnimeByGenres(catalog, [], 3);
  }
  const historyLength = history.length;
  let searchContext;
  if (signals.mentionedTitles.length === 0) {
    const potentialTitle = await extractTitleViaLLM(message);
    if (potentialTitle) {
      const searchResults = await searchAndAddAnime(potentialTitle);
      if (searchResults.length > 0) {
        const entries = [];
        for (const anime of searchResults) {
          try {
            const embedding = await embedAnimeWithFallback(anime);
            entries.push({ animeId: anime.mal_id, embedding });
          } catch {
          }
        }
        if (entries.length > 0) {
          await addAnimeEmbeddings(userId, entries);
        }
        for (const a of searchResults) {
          try {
            await storage.recordDiscovery(a.mal_id, userId, displayName);
          } catch (e) {
            console.error(`[Star] recordDiscovery failed for mal_id=${a.mal_id} \u2014 queuing for retry:`, e instanceof Error ? e.message : e);
            pendingDiscoveries.push({ malId: a.mal_id, userId, displayName });
          }
        }
        const titles = [];
        const attributionLines = [];
        for (let i = 0; i < searchResults.length; i++) {
          const a = searchResults[i];
          const genres = (a.genres ?? []).map((g) => g.name).join(", ");
          let entry = `${a.title}${genres ? ` (${genres})` : ""}`;
          if (i < 2) {
            try {
              const vibe = await generateVibeProfile(
                a.mal_id,
                a.title,
                (a.genres ?? []).map((g) => g.name),
                a.synopsis ?? "",
                a.score ?? 0
              );
              if (vibe) {
                entry += `. Vibe: ${vibe.atmosphere}, ${vibe.pacing}, ${vibe.tone}`;
              }
            } catch {
            }
          }
          titles.push(entry);
          try {
            const discovery = await storage.getDiscovery(a.mal_id);
            if (discovery && discovery.userId !== userId) {
              attributionLines.push(
                `${a.title} was discovered for our community by ${discovery.displayName}.`
              );
            }
          } catch {
          }
        }
        searchContext = `The user appears to be asking about: ${titles.join("; ")}. These have been added to the recommendation system.`;
        if (attributionLines.length > 0) {
          searchContext += ` ${attributionLines.join(" ")}`;
        }
      }
    }
  }
  if (chatBanNote) {
    searchContext = searchContext ? `${chatBanNote}

${searchContext}` : chatBanNote;
  }
  let onboardingHint;
  let isManualPath = false;
  try {
    const onboarding = await storage.getOnboardingState(userId);
    if (onboarding?.pathChosen === "manual" && !onboarding.unlockedRecommendations) {
      isManualPath = true;
      const ratings = await storage.getUserRatings(userId);
      const favoritedCount = ratings.filter((r) => r.rating >= 0.6).length;
      if (favoritedCount >= 5) {
        onboardingHint = `This user is on the manual onboarding path. They have favorited ${favoritedCount} anime. If you feel you have enough signal to start recommending, weave it naturally into your next message \u2014 something like "${displayName}, I think I'm starting to see you. Want to know what I see?" If you decide to unlock, end your message with the literal token [UNLOCK_RECS].`;
      }
    }
  } catch {
  }
  const claudeResponse = await callClaude(message, history, userId, displayName, searchContext, onboardingHint);
  let response = claudeResponse ?? generateStarResponse(signals, matches, noMatchFallbacks, historyLength);
  if (isManualPath) {
    if (response.includes("[UNLOCK_RECS]")) {
      console.log(`[Path3] [UNLOCK_RECS] token detected in Star's response \u2014 stripping token and unlocking user=${userId}`);
      response = response.replace(/\[UNLOCK_RECS\]/g, "").trim();
      setImmediate(async () => {
        try {
          await storage.unlockRecommendations(userId);
          await storage.completeOnboarding(userId);
          console.log(`[Path3] Recommendations unlocked for user=${userId} via Star chat`);
        } catch (e) {
          console.error("[Path3] Failed to unlock via chat:", e instanceof Error ? e.message : e);
        }
      });
    } else {
      console.log(`[Path3] Manual-path response for user=${userId}: [UNLOCK_RECS] token not present (not ready to unlock yet)`);
    }
  }
  const implicitFeedback = signals.likedGenres.length > 0 || signals.dislikedGenres.length > 0 || signals.moodGenres.length > 0;
  if (implicitFeedback) {
    setImmediate(() => {
      applyImplicitFeedback(signals, catalog).catch(() => {
      });
    });
  }
  return { response, implicitFeedback, learningCategory };
}
async function applyImplicitFeedback(signals, catalog) {
  const POSITIVE_RATING = 0.65;
  const MOOD_RATING = 0.58;
  const NEGATIVE_RATING = 0.35;
  if (signals.likedGenres.length > 0) {
    const matches = filterByGenres(catalog, signals.likedGenres, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, POSITIVE_RATING);
      } catch {
      }
    }
  }
  if (signals.dislikedGenres.length > 0) {
    const matches = filterByGenres(catalog, signals.dislikedGenres, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, NEGATIVE_RATING);
      } catch {
      }
    }
  }
  if (signals.moodGenres.length > 0) {
    const moodOnly = signals.moodGenres.filter((g) => !signals.likedGenres.includes(g));
    const matches = filterByGenres(catalog, moodOnly, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, MOOD_RATING);
      } catch {
      }
    }
  }
}

// server/ai/characterPool.ts
import * as fs4 from "fs";
import * as path4 from "path";
var cached = null;
function loadCharacterPool() {
  if (cached !== null) return cached;
  const poolPath = path4.resolve(process.cwd(), "character-pool.json");
  if (!fs4.existsSync(poolPath)) {
    const msg = `[CharacterPool] FATAL: character-pool.json not found at ${poolPath}. Make sure the file exists in the project root.`;
    console.error(msg);
    throw new Error(msg);
  }
  let raw;
  try {
    raw = fs4.readFileSync(poolPath, "utf-8");
  } catch (e) {
    const msg = `[CharacterPool] Failed to read character-pool.json: ${e instanceof Error ? e.message : String(e)}`;
    console.error(msg);
    throw new Error(msg);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = `[CharacterPool] character-pool.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    console.error(msg);
    throw new Error(msg);
  }
  if (!Array.isArray(parsed?.characters) || parsed.characters.length === 0) {
    const msg = "[CharacterPool] character-pool.json has no characters array or it is empty.";
    console.error(msg);
    throw new Error(msg);
  }
  cached = parsed.characters;
  console.log(`[CharacterPool] Loaded ${cached.length} characters from ${poolPath}.`);
  return cached;
}

// server/routes.ts
function extractUserId(req) {
  const raw = req.query.userId || req.headers["x-user-id"] || "default";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}
var CLAUDE_ONBOARDING_ENDPOINT = "https://api.anthropic.com/v1/messages";
var CLAUDE_ONBOARDING_MODEL = "claude-sonnet-4-20250514";
async function claudeJsonCall(systemPrompt, userContent, maxTokens = 512) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No ANTHROPIC_API_KEY");
  const payload = JSON.stringify({
    model: CLAUDE_ONBOARDING_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }]
  });
  return new Promise((resolve5, reject) => {
    const url = new URL(CLAUDE_ONBOARDING_ENDPOINT);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    };
    const req = https5.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Claude HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          const json = JSON.parse(data);
          resolve5(json?.content?.[0]?.text?.trim() ?? "");
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(25e3, () => {
      req.destroy(new Error("Claude request timed out"));
    });
    req.write(payload);
    req.end();
  });
}
async function processPath1Favorites(userId, favoritesText) {
  console.log(`[Path1] Starting async processing for user=${userId} (input: ${favoritesText.length} chars)`);
  let entries = [];
  try {
    const text2 = await claudeJsonCall(
      "Parse this list of favorite anime. Extract a JSON array where each entry has: title (string), reason (string \u2014 the user's stated reason or null if not given). Respond with ONLY valid JSON, no markdown.",
      favoritesText,
      1024
    );
    const result = JSON.parse(text2);
    if (Array.isArray(result)) entries = result;
    console.log(`[Path1] Claude parsed ${entries.length} titles: ${entries.map((e) => e.title).join(", ")}`);
  } catch (e) {
    console.error("[Path1] Claude parse failed:", e instanceof Error ? e.message : e);
  }
  if (entries.length === 0) {
    console.warn(`[Path1] No titles parsed for user=${userId} \u2014 skipping training, still completing onboarding`);
  }
  let fetchedCount = 0;
  let embeddedCount = 0;
  let trainedCount = 0;
  for (const entry of entries) {
    if (!entry.title || typeof entry.title !== "string") continue;
    console.log(`[Path1] Searching Jikan for "${entry.title}"\u2026`);
    try {
      const results = await searchAndAddAnime(entry.title);
      const anime = results[0];
      if (!anime) {
        console.warn(`[Path1] Jikan returned no results for "${entry.title}" \u2014 skipping`);
        continue;
      }
      fetchedCount++;
      console.log(`[Path1] Fetched ${fetchedCount}: "${anime.title}" (mal_id=${anime.mal_id})`);
      const embedding = await embedAnimeWithVibeFallback(anime);
      await addAnimeEmbeddings(userId, [{ animeId: anime.mal_id, embedding }]);
      embeddedCount++;
      console.log(`[Path1] Embedded ${embeddedCount}: "${anime.title}"`);
      await processFeedback(anime.mal_id, 0.85, userId);
      trainedCount++;
      console.log(`[Path1] Trained ${trainedCount}: "${anime.title}" score=0.85`);
      if (entry.reason && typeof entry.reason === "string" && entry.reason.trim()) {
        await storage.saveAnimeReason(userId, anime.mal_id, entry.reason.trim()).catch(() => {
        });
      }
    } catch (e) {
      console.error(`[Path1] Failed to process "${entry.title}":`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[Path1] Processing complete: fetched=${fetchedCount}, embedded=${embeddedCount}, trained=${trainedCount} for user=${userId}`);
  try {
    await storage.unlockRecommendations(userId);
    await storage.completeOnboarding(userId);
    console.log(`[Path1] Onboarding complete \u2014 recommendations unlocked for user=${userId}`);
  } catch (e) {
    console.error("[Path1] Failed to complete onboarding:", e instanceof Error ? e.message : e);
  }
}
async function registerRoutes(app2) {
  app2.get("/api/anime/schedule", async (req, res) => {
    const day = req.query.day || "monday";
    try {
      const data = await getSchedule(day);
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch schedule" });
    }
  });
  app2.get("/api/anime/seasonal", async (_req, res) => {
    try {
      const data = await getSeasonalAnime();
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch seasonal anime" });
    }
  });
  app2.get("/api/anime/library", async (req, res) => {
    const source = req.query.source || "all";
    try {
      const seen = /* @__PURE__ */ new Set();
      const rawList = [];
      if (source === "airing" || source === "all") {
        const airing = await getAllCurrentAnime();
        for (const a of airing) {
          if (!seen.has(a.mal_id)) {
            seen.add(a.mal_id);
            rawList.push(a);
          }
        }
      }
      if (source === "discovered" || source === "all") {
        const dbSearched = await storage.getAllSearchedAnime();
        const memSearched = getSearchedCacheEntries();
        const merged = [...dbSearched.map((s) => s.data)];
        const mergedIds = new Set(merged.map((d) => d?.mal_id).filter(Boolean));
        for (const a of memSearched) {
          if (!mergedIds.has(a.mal_id)) merged.push(a);
        }
        for (const d of merged) {
          if (d?.mal_id && !seen.has(d.mal_id)) {
            seen.add(d.mal_id);
            rawList.push(d);
          }
        }
      }
      const items = await Promise.all(rawList.map(async (a) => {
        const vibe = getVibeProfileFromCache(a.mal_id);
        let discoveredBy = null;
        try {
          const disc = await storage.getDiscovery(a.mal_id);
          discoveredBy = disc ? disc.displayName : null;
        } catch {
        }
        return {
          mal_id: a.mal_id,
          title: a.title,
          imageUrl: a.images?.jpg?.large_image_url ?? "",
          score: a.score ?? null,
          genres: (a.genres ?? []).map((g) => g.name),
          episodes: a.episodes ?? null,
          synopsis: a.synopsis ?? null,
          vibe: vibe ? {
            atmosphere: vibe.atmosphere,
            pacing: vibe.pacing,
            tone: vibe.tone,
            protagonistArchetype: vibe.protagonistArchetype,
            relationshipDynamics: vibe.relationshipDynamics,
            emotionalArc: vibe.emotionalArc,
            vibeText: vibe.vibeText
          } : null,
          discoveredBy
        };
      }));
      res.json({ items });
    } catch (e) {
      console.error("[Library] Error:", e);
      res.status(500).json({ error: "Failed to fetch library" });
    }
  });
  app2.get("/api/anime/:id/vibe", async (req, res) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime ID" });
    }
    try {
      const anime = await getAnimeDetails(malId);
      if (!anime) return res.status(404).json({ error: "Anime not found" });
      const vibe = await generateVibeProfile(
        malId,
        anime.title,
        (anime.genres ?? []).map((g) => g.name),
        anime.synopsis ?? "",
        anime.score ?? 0
      );
      if (!vibe) return res.status(503).json({ error: "Vibe profile generation failed" });
      res.json(vibe);
    } catch {
      res.status(503).json({ error: "Vibe profile generation failed" });
    }
  });
  app2.get("/api/anime/:id", async (req, res) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime ID" });
    }
    try {
      const data = await getAnimeDetails(malId);
      if (!data) return res.status(404).json({ error: "Anime not found" });
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch anime details" });
    }
  });
  app2.get("/api/ai/recommend/lanes", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const onboarding = await storage.getOnboardingState(userId);
      if (!onboarding?.unlockedRecommendations) {
        return res.status(403).json({ error: "Onboarding not complete" });
      }
      const lanes = await getThreeLaneRecommendations(userId, 15e3);
      res.json(lanes);
    } catch (e) {
      console.error("[AI] Three-lane recommendation error:", e);
      res.status(500).json({ error: "Failed to generate lane recommendations" });
    }
  });
  app2.get("/api/ai/recommend", async (req, res) => {
    const limit = Math.min(25, parseInt(req.query.limit || "5", 10));
    const userId = extractUserId(req);
    try {
      const onboarding = await storage.getOnboardingState(userId);
      if (!onboarding?.unlockedRecommendations) {
        return res.status(403).json({ error: "Onboarding not complete" });
      }
      const recommendations = await getRecommendations(userId, limit, 12e3);
      res.json({ recommendations });
    } catch (e) {
      console.error("[AI] Recommendation error:", e);
      res.status(500).json({ error: "Failed to generate recommendations" });
    }
  });
  app2.post("/api/ai/feedback", async (req, res) => {
    const { malId, rating } = req.body;
    if (typeof malId !== "number" || typeof rating !== "number") {
      return res.status(400).json({ error: "malId and rating are required" });
    }
    if (rating < 0 || rating > 1) {
      return res.status(400).json({ error: "rating must be between 0 and 1" });
    }
    const userId = extractUserId(req);
    try {
      const result = await processFeedback(malId, rating, userId);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[AI] Feedback error:", e);
      res.status(500).json({ error: "Failed to process feedback" });
    }
  });
  app2.get("/api/ai/status", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const status = await getAIStatus(userId);
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: "Failed to get AI status" });
    }
  });
  app2.post("/api/ai/verify-artwork", async (req, res) => {
    const { malId, imageUrl: imageUrlOverride, title: titleOverride } = req.body;
    if (typeof malId !== "number") {
      return res.status(400).json({ error: "malId is required" });
    }
    if (imageUrlOverride !== void 0) {
      const urlError = await validateImageUrl(imageUrlOverride);
      if (urlError) {
        return res.status(400).json({ error: `Invalid image URL: ${urlError}` });
      }
    }
    try {
      const result = await verifyAnimeArtwork(malId, imageUrlOverride, titleOverride);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Verification failed" });
    }
  });
  app2.post("/api/ai/chat", async (req, res) => {
    const { message, history } = req.body;
    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "message is required" });
    }
    const safeHistory = Array.isArray(history) ? history.slice(-20).filter(
      (m) => (m.role === "user" || m.role === "star") && typeof m.content === "string"
    ) : [];
    try {
      const userId = extractUserId(req);
      const result = await processChat(message.trim(), safeHistory, userId);
      res.json(result);
    } catch (e) {
      console.error("[Star] Chat error:", e);
      res.status(500).json({ error: "Star is unable to respond right now" });
    }
  });
  app2.post("/api/ai/chat/feedback", async (req, res) => {
    const { message, categoryId, isPositive } = req.body;
    if (typeof message !== "string" || message.trim().length === 0 || typeof categoryId !== "string" || categoryId.trim().length === 0 || typeof isPositive !== "boolean") {
      return res.status(400).json({ error: "message, categoryId, and isPositive are required" });
    }
    try {
      await recordChatFeedback(message.trim(), categoryId.trim(), isPositive);
      res.json({ success: true });
    } catch (e) {
      console.error("[Star] Chat feedback error:", e);
      res.status(500).json({ error: "Failed to record chat feedback" });
    }
  });
  app2.get("/api/ai/star", async (_req, res) => {
    res.json({ name: STAR_NAME, bio: STAR_BIO, restTrained: await hasRestTrained("default") });
  });
  app2.post("/api/ai/rest-train", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const result = await restTrain(userId);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[Star] Rest training error:", e);
      res.status(500).json({ error: "Rest training failed" });
    }
  });
  app2.post("/api/user/displayname", async (req, res) => {
    const { userId, displayName, pin } = req.body;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return res.status(400).json({ error: "displayName is required" });
    }
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }
    try {
      const taken = await storage.isDisplayNameTaken(displayName.trim(), userId.trim());
      if (taken) {
        return res.status(409).json({ error: "Display name is already taken" });
      }
      await storage.setDisplayName(userId.trim(), displayName.trim(), pin);
      return res.json({ success: true });
    } catch (e) {
      console.error("[User] setDisplayName error:", e);
      return res.status(500).json({ error: "Failed to set display name" });
    }
  });
  app2.post("/api/user/login", async (req, res) => {
    const { displayName, pin } = req.body;
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return res.status(400).json({ error: "displayName is required" });
    }
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "pin must be exactly 4 digits" });
    }
    try {
      const userId = await storage.loginWithDisplayName(displayName.trim(), pin);
      if (!userId) {
        return res.status(401).json({ error: "Invalid display name or PIN" });
      }
      res.json({ userId });
    } catch (e) {
      console.error("[User] login error:", e);
      res.status(500).json({ error: "Login failed" });
    }
  });
  app2.get("/api/anime/:id/discovery", async (req, res) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime id" });
    }
    try {
      const discovery = await storage.getDiscovery(malId);
      if (!discovery) {
        return res.status(404).json({ error: "No discovery record found" });
      }
      res.json(discovery);
    } catch (e) {
      console.error("[Anime] getDiscovery error:", e);
      res.status(500).json({ error: "Failed to get discovery info" });
    }
  });
  app2.post("/api/user/ban", async (req, res) => {
    const userId = extractUserId(req);
    const { malId, bannedGenre, bannedTrope, reason } = req.body;
    if (malId === void 0 && !bannedGenre && !bannedTrope) {
      return res.status(400).json({ error: "At least one of malId, bannedGenre, or bannedTrope is required" });
    }
    try {
      await storage.addBan(userId, { malId, bannedGenre, bannedTrope, reason });
      res.json({ success: true });
    } catch (e) {
      console.error("[User] addBan error:", e);
      res.status(500).json({ error: "Failed to add ban" });
    }
  });
  app2.delete("/api/user/ban/:id", async (req, res) => {
    const userId = extractUserId(req);
    const banId = parseInt(req.params.id, 10);
    if (isNaN(banId)) {
      return res.status(400).json({ error: "Invalid ban id" });
    }
    try {
      await storage.removeBan(userId, banId);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] removeBan error:", e);
      res.status(500).json({ error: "Failed to remove ban" });
    }
  });
  app2.get("/api/user/bans", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const bans = await storage.getUserBans(userId);
      res.json(bans);
    } catch (e) {
      console.error("[User] getUserBans error:", e);
      res.status(500).json({ error: "Failed to get bans" });
    }
  });
  app2.post("/api/user/watchstate", async (req, res) => {
    const userId = extractUserId(req);
    const { malId, state } = req.body;
    if (typeof malId !== "number") {
      return res.status(400).json({ error: "malId is required" });
    }
    const validStates = ["completed", "watching", "dropped", "planned"];
    if (typeof state !== "string" || !validStates.includes(state)) {
      return res.status(400).json({ error: `state must be one of: ${validStates.join(", ")}` });
    }
    try {
      await storage.setWatchState(userId, malId, state);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] setWatchState error:", e);
      res.status(500).json({ error: "Failed to set watch state" });
    }
  });
  app2.get("/api/user/watchstates", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const states = await storage.getUserWatchStates(userId);
      res.json(states);
    } catch (e) {
      console.error("[User] getUserWatchStates error:", e);
      res.status(500).json({ error: "Failed to get watch states" });
    }
  });
  app2.post("/api/user/preferences", async (req, res) => {
    const userId = extractUserId(req);
    const { hiddenGemBias } = req.body;
    if (typeof hiddenGemBias !== "number") {
      return res.status(400).json({ error: "hiddenGemBias must be a number" });
    }
    try {
      await storage.setHiddenGemBias(userId, hiddenGemBias);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] setHiddenGemBias error:", e);
      res.status(500).json({ error: "Failed to set preferences" });
    }
  });
  app2.get("/api/user/chat-usage", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const dayOfWeek = (/* @__PURE__ */ new Date()).getDay();
      const cap = dayOfWeek === 5 || dayOfWeek === 6 ? 10 : 5;
      const count = await storage.getChatCount(userId, today);
      res.json({ count, cap, remaining: Math.max(0, cap - count) });
    } catch (e) {
      console.error("[User] getChatCount error:", e);
      res.status(500).json({ error: "Failed to get chat usage" });
    }
  });
  app2.get("/api/user/preferences", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const hiddenGemBias = await storage.getHiddenGemBias(userId);
      res.json({ hiddenGemBias });
    } catch (e) {
      console.error("[User] getHiddenGemBias error:", e);
      res.status(500).json({ error: "Failed to get preferences" });
    }
  });
  app2.get("/api/user/onboarding-state", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const state = await storage.getOnboardingState(userId);
      res.json(
        state ?? { pathChosen: null, completed: false, unlockedRecommendations: false }
      );
    } catch (e) {
      console.error("[User] getOnboardingState error:", e);
      res.status(500).json({ error: "Failed to fetch onboarding state" });
    }
  });
  app2.get("/api/onboarding/path2/characters", async (req, res) => {
    const userId = extractUserId(req);
    try {
      const displayName = await storage.getDisplayName(userId) ?? userId;
      const pool2 = loadCharacterPool();
      const poolText = JSON.stringify(
        pool2.map((c) => ({ id: c.id, name: c.name, anime: c.anime, represents: c.represents }))
      );
      const systemPrompt = `You are choosing 5 anime characters from a pool to show a new user during onboarding. The user's display name is '${displayName}'. Pick 5 characters whose energies feel resonant or interestingly contrasting with that name. Aim for variety \u2014 don't pick 5 of the same archetype. Respond with ONLY a JSON array of 5 character ids from the provided pool, no markdown. Example response: ["lelouch","mob","asta","violet","yujiro"]`;
      let selectedIds = [];
      try {
        const text2 = await claudeJsonCall(systemPrompt, poolText, 120);
        const parsed = JSON.parse(text2);
        if (Array.isArray(parsed)) {
          const validIds = new Set(pool2.map((c) => c.id));
          selectedIds = parsed.filter((id) => validIds.has(id)).slice(0, 5);
        }
      } catch (e) {
        console.error("[Path2/characters] Claude selection failed:", e instanceof Error ? e.message : e);
      }
      if (selectedIds.length < 5) {
        const usedIds = new Set(selectedIds);
        const remaining = pool2.filter((c) => !usedIds.has(c.id));
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        while (selectedIds.length < 5 && remaining.length > 0) {
          selectedIds.push(remaining.shift().id);
        }
      }
      const idMap = new Map(pool2.map((c) => [c.id, c]));
      const characters = selectedIds.map((id) => idMap.get(id)).filter(Boolean);
      res.json({ characters });
    } catch (e) {
      console.error("[Path2/characters] Error:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "Failed to load characters" });
    }
  });
  app2.post("/api/onboarding/path2/genres", async (req, res) => {
    const userId = extractUserId(req);
    const { genres, subDubPreference } = req.body;
    if (!Array.isArray(genres) || genres.length === 0) {
      return res.status(400).json({ error: "genres array is required" });
    }
    try {
      await storage.setOnboardingPath(userId, "gameshow");
    } catch (e) {
      console.error("[Path2/genres] setOnboardingPath failed:", e instanceof Error ? e.message : e);
    }
    if (subDubPreference && typeof subDubPreference === "string") {
      await storage.setSubDubPreference(userId, subDubPreference).catch(
        (e) => console.error("[Path2/genres] setSubDubPreference failed:", e instanceof Error ? e.message : e)
      );
    }
    setImmediate(async () => {
      try {
        const allAnime = await getAllCurrentAnime();
        for (const genre of genres) {
          const matching = allAnime.filter((a) => a.genres?.some((g) => g.name.toLowerCase() === genre.toLowerCase())).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2);
          for (const anime of matching) {
            try {
              const embedding = await embedAnimeWithVibeFallback(anime);
              await addAnimeEmbeddings(userId, [{ animeId: anime.mal_id, embedding }]);
              await processFeedback(anime.mal_id, 0.75, userId);
              console.log(`[Path2/genres] Trained "${anime.title}" for genre "${genre}" user=${userId}`);
            } catch (e) {
              console.error(`[Path2/genres] Failed on "${anime.title}":`, e instanceof Error ? e.message : e);
            }
          }
        }
      } catch (e) {
        console.error("[Path2/genres] Background failed:", e instanceof Error ? e.message : e);
      }
    });
    res.json({ success: true });
  });
  app2.post("/api/onboarding/path2/rankings", async (req, res) => {
    const userId = extractUserId(req);
    const { rankings } = req.body;
    if (!Array.isArray(rankings) || rankings.length === 0) {
      return res.status(400).json({ error: "rankings array is required" });
    }
    const pool2 = loadCharacterPool();
    const characterById = new Map(pool2.map((c) => [c.id, c]));
    console.log(`[Path2/rankings] Processing ${rankings.length} rankings for user=${userId}`);
    for (const { characterId, rating } of rankings) {
      await storage.saveCharacterRating(userId, characterId, rating).catch(
        (e) => console.error(`[Path2/rankings] saveCharacterRating failed (${characterId}):`, e instanceof Error ? e.message : e)
      );
      const character = characterById.get(characterId);
      if (!character) continue;
      const feedbackScore = Math.min(1, 0.5 + (rating - 1) * 0.15);
      try {
        const results = await searchAndAddAnime(character.anime);
        const anime = results[0];
        if (!anime) continue;
        const embedding = await embedAnimeWithVibeFallback(anime);
        await addAnimeEmbeddings(userId, [{ animeId: anime.mal_id, embedding }]);
        await processFeedback(anime.mal_id, feedbackScore, userId);
        console.log(
          `[Path2/rankings] "${character.name}" \u2192 "${anime.title}" score=${feedbackScore.toFixed(2)} user=${userId}`
        );
      } catch (e) {
        console.error(`[Path2/rankings] Failed to process "${character.name}":`, e instanceof Error ? e.message : e);
      }
    }
    try {
      await storage.unlockRecommendations(userId);
      await storage.completeOnboarding(userId);
    } catch (e) {
      console.error("[Path2/rankings] Failed to complete onboarding:", e instanceof Error ? e.message : e);
    }
    let shown = [];
    let hidden = null;
    try {
      const lanes = await getThreeLaneRecommendations(userId, 12e3);
      shown = lanes.safe.slice(0, 2);
      if (shown.length < 2) {
        shown = [...shown, ...lanes.stretch.slice(0, 2 - shown.length)];
      }
      const blindPick = lanes.blind[0];
      if (blindPick) {
        hidden = {
          ...blindPick,
          blindspot: true,
          starMessage: "I cannot see this one clearly... but something pulls me toward it for you. Trust the instinct."
        };
      }
    } catch (e) {
      console.error("[Path2/rankings] getThreeLaneRecommendations failed:", e instanceof Error ? e.message : e);
    }
    res.json({ shown, hidden });
  });
  app2.post("/api/onboarding/path3/start", async (req, res) => {
    const userId = extractUserId(req);
    try {
      await storage.setOnboardingPath(userId, "manual");
      res.json({
        success: true,
        message: "Discover anime in your library. I'll let you know when I can see you clearly."
      });
    } catch (e) {
      console.error("[Path3] setOnboardingPath failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "Failed to start path 3" });
    }
  });
  app2.post("/api/onboarding/path1", async (req, res) => {
    const userId = extractUserId(req);
    const { favorites } = req.body;
    if (!favorites || typeof favorites !== "string" || !favorites.trim()) {
      return res.status(400).json({ error: "favorites text is required" });
    }
    try {
      await storage.setOnboardingPath(userId, "list");
    } catch (e) {
      console.error("[Path1] setOnboardingPath failed:", e instanceof Error ? e.message : e);
    }
    res.json({
      success: true,
      message: "I have what I need. Give me a moment to feel out where you're really pulling from..."
    });
    setImmediate(() => {
      processPath1Favorites(userId, favorites.trim()).catch(
        (e) => console.error("[Path1] Unhandled error in background processing:", e)
      );
    });
  });
  const httpServer = createServer(app2);
  testConnection();
  initAnimeData().catch((e) => console.error("[AnimeData] Init failed:", e));
  setTimeout(() => {
    hasRestTrained("default").then((trained) => {
      if (!trained) {
        console.log("[Star] No prior rest training found \u2014 starting background base-knowledge pass...");
        restTrain("default").catch((e) => console.error("[Star] Auto rest-train failed:", e));
      }
    }).catch(() => {
    });
    initStarLearning().catch((e) => console.error("[Star] Learning init failed:", e));
  }, 5e3);
  return httpServer;
}

// server/index.ts
import * as fs5 from "fs";
import * as path5 from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    if (origin && origins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path6 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path6.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path6} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path5.resolve(process.cwd(), "app.json");
    const appJsonContent = fs5.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path5.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs5.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs5.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path5.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs5.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path5.resolve(process.cwd(), "assets")));
  app2.use(express.static(path5.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, _next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
}
async function backfillExistingUsers() {
  try {
    const users2 = await storage.getAllUserProfiles();
    if (!users2 || users2.length === 0) {
      log("[Backfill] No existing user profiles found \u2014 skipping.");
      return;
    }
    let backfilledCount = 0;
    for (const user of users2) {
      try {
        const existing = await storage.getOnboardingState(user.userId);
        if (!existing) {
          await storage.unlockRecommendations(user.userId);
          await storage.completeOnboarding(user.userId);
          backfilledCount++;
          log(`[Backfill] Unlocked existing user: ${user.userId} (${user.displayName})`);
        }
      } catch (e) {
        log(`[Backfill] Failed to backfill user ${user.userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (backfilledCount > 0) {
      log(`[Backfill] Done \u2014 unlocked ${backfilledCount} pre-existing user(s).`);
    } else {
      log("[Backfill] All existing users already have onboarding entries \u2014 nothing to backfill.");
    }
  } catch (e) {
    log(`[Backfill] Error reading user profiles: ${e instanceof Error ? e.message : String(e)}`);
  }
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  app.get("/privacy", (_req, res) => {
    res.sendFile(path5.resolve(process.cwd(), "privacy-policy.html"));
  });
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
  await backfillExistingUsers();
})();
