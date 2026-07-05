import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  userEngineState, starLearningState, animeSearched, animeEmbeddings, vibeProfiles,
  userRatings, animeDiscovery, userProfiles,
  userBanList, userWatchState, userPreferences, userChatUsage,
  userOnboarding, userCharacterRatings, animeReasons, userPersonalitySignals,
} from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.warn("[DB] WARNING: DATABASE_URL is not set — database features will not work.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.warn("[DB] Pool error:", err.message);
});

export const db = drizzle(pool);

export async function testConnection(): Promise<void> {
  try {
    await pool.query("SELECT 1");
    console.log("[DB] Connection OK — database is reachable.");
  } catch (err) {
    console.error("[DB] Connection FAILED:", err instanceof Error ? err.message : err);
  }
}

export interface IStorage {
  saveEngineState(userId: string, json: object): Promise<void>;
  loadEngineState(userId: string): Promise<object | null>;

  // Optimistic-concurrency variants used for cross-instance-safe writes.
  // saveEngineStateVersioned only applies the write if the row's current
  // version still matches `expectedVersion` (or no row exists yet, treated
  // as version 0); on success the row's version is incremented and returned.
  saveEngineStateVersioned(
    userId: string,
    json: object,
    expectedVersion: number
  ): Promise<{ ok: true; newVersion: number } | { ok: false }>;
  loadEngineStateVersioned(userId: string): Promise<{ json: object; version: number } | null>;

  saveStarLearningStateVersioned(
    json: object,
    expectedVersion: number
  ): Promise<{ ok: true; newVersion: number } | { ok: false }>;
  loadStarLearningStateVersioned(): Promise<{ json: object; version: number } | null>;

  saveSearchedAnime(malId: number, data: object): Promise<void>;
  getAllSearchedAnime(): Promise<{ malId: number; data: object }[]>;

  saveAnimeEmbedding(malId: number, embedding: number[]): Promise<void>;
  getAllAnimeEmbeddings(): Promise<{ malId: number; embedding: number[] }[]>;

  saveVibeProfile(malId: number, profile: object): Promise<void>;
  getVibeProfile(malId: number): Promise<object | null>;
  getAllVibeProfiles(): Promise<{ malId: number; profile: object }[]>;

  saveRating(userId: string, malId: number, rating: number): Promise<void>;
  getUserRatings(userId: string): Promise<{ malId: number; rating: number }[]>;

  recordDiscovery(malId: number, userId: string, displayName: string): Promise<void>;
  getDiscovery(malId: number): Promise<{ userId: string; displayName: string; discoveredAt: Date } | null>;

  setDisplayName(userId: string, displayName: string, pin?: string): Promise<void>;
  getDisplayName(userId: string): Promise<string | null>;
  isDisplayNameTaken(displayName: string, excludeUserId: string): Promise<boolean>;
  loginWithDisplayName(displayName: string, pin: string): Promise<string | null>;

  registerUser(displayName: string, normalizedName: string, hashedPin: string): Promise<{ userId: string; displayName: string }>;
  getUserProfileByNormalized(normalized: string): Promise<{ userId: string; displayName: string; pin: string | null } | null>;
  updatePin(userId: string, hashedPin: string): Promise<void>;

  addBan(userId: string, ban: { malId?: number; bannedGenre?: string; bannedTrope?: string; reason?: string }): Promise<void>;
  removeBan(userId: string, banId: number): Promise<void>;
  getUserBans(userId: string): Promise<{ id: number; malId: number | null; bannedGenre: string | null; bannedTrope: string | null; reason: string | null }[]>;
  isAnimeBanned(userId: string, malId: number, genres: string[]): Promise<boolean>;

  setWatchState(userId: string, malId: number, state: string): Promise<void>;
  getUserWatchStates(userId: string): Promise<{ malId: number; state: string }[]>;
  getWatchedMalIds(userId: string): Promise<Set<number>>;

  setHiddenGemBias(userId: string, bias: number): Promise<void>;
  getHiddenGemBias(userId: string): Promise<number>;
  setSubDubPreference(userId: string, pref: string): Promise<void>;

  incrementChatCount(userId: string, date: string): Promise<number>;
  getChatCount(userId: string, date: string): Promise<number>;

  getOnboardingState(userId: string): Promise<{
    pathChosen: string | null;
    completed: boolean;
    unlockedRecommendations: boolean;
    trainingCompleted: boolean;
    favoritesInput: string | null;
    retryCount: number;
  } | null>;
  setOnboardingPath(userId: string, path: string): Promise<void>;
  completeOnboarding(userId: string): Promise<void>;
  unlockRecommendations(userId: string): Promise<void>;
  setTrainingCompleted(userId: string, completed: boolean): Promise<void>;
  saveFavoritesInput(userId: string, input: string): Promise<void>;
  incrementRetryCount(userId: string): Promise<void>;
  getUntrainedUsers(maxRetries: number): Promise<{
    userId: string;
    pathChosen: string | null;
    favoritesInput: string | null;
    retryCount: number;
  }[]>;
  saveCharacterRating(userId: string, characterId: string, rating: number): Promise<void>;
  getCharacterRatings(userId: string): Promise<{ characterId: string; rating: number }[]>;

  saveAnimeReason(userId: string, malId: number, reason: string): Promise<void>;
  getAllUserProfiles(): Promise<{ userId: string; displayName: string }[]>;

  savePersonalitySignal(
    userId: string,
    signalType: string,
    value: string,
    weight?: number,
    source?: string
  ): Promise<void>;
  getPersonalitySignals(
    userId: string
  ): Promise<{ signalType: string; value: string; weight: number; source: string }[]>;
}

class PostgresStorage implements IStorage {
  private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isConnectionError =
          err?.message?.includes("terminat") ||
          err?.message?.includes("timeout") ||
          err?.message?.includes("ECONNREFUSED");
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

  async saveEngineState(userId: string, json: object): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userEngineState)
        .values({ userId, engineJson: json, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userEngineState.userId,
          set: { engineJson: json, updatedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async loadEngineState(userId: string): Promise<object | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userEngineState)
        .where(eq(userEngineState.userId, userId))
        .then((rows) => (rows[0]?.engineJson as object) ?? null)
    );
  }

  // Single round-trip conditional upsert: if no row exists yet, the INSERT
  // path succeeds unconditionally (equivalent to "expected version 0"). If a
  // row exists, the UPDATE only applies (and increments version) when the
  // row's current version still equals `expectedVersion`; otherwise the
  // ON CONFLICT DO UPDATE ... WHERE guard suppresses the update and
  // .returning() yields zero rows, which we treat as a version conflict —
  // some other instance/request wrote first and this caller's in-memory
  // state is stale.
  //
  // IMPORTANT: the insert path writes version 1 (not 0). If it wrote 0, a
  // real first-ever row would be indistinguishable from "no row exists" —
  // a second concurrent first-writer (also passing expectedVersion=0) would
  // match `setWhere: version = 0` against that real row and silently
  // clobber it instead of conflicting. Starting real rows at version 1
  // means expectedVersion=0 only ever matches "no row" (insert succeeds)
  // and never matches an existing row (update guard can't hit).
  async saveEngineStateVersioned(
    userId: string,
    json: object,
    expectedVersion: number
  ): Promise<{ ok: true; newVersion: number } | { ok: false }> {
    return this.withRetry(async () => {
      const rows = await db
        .insert(userEngineState)
        .values({ userId, engineJson: json, version: 1, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userEngineState.userId,
          set: {
            engineJson: json,
            version: sql`${userEngineState.version} + 1`,
            updatedAt: new Date(),
          },
          setWhere: eq(userEngineState.version, expectedVersion),
        })
        .returning({ version: userEngineState.version });

      if (rows.length === 0) return { ok: false };
      return { ok: true, newVersion: rows[0].version };
    });
  }

  async loadEngineStateVersioned(userId: string): Promise<{ json: object; version: number } | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userEngineState)
        .where(eq(userEngineState.userId, userId))
        .then((rows) =>
          rows[0] ? { json: rows[0].engineJson as object, version: rows[0].version } : null
        )
    );
  }

  // See saveEngineStateVersioned() above for why the insert path writes
  // version 1, not 0 — same first-writer race, same fix.
  async saveStarLearningStateVersioned(
    json: object,
    expectedVersion: number
  ): Promise<{ ok: true; newVersion: number } | { ok: false }> {
    return this.withRetry(async () => {
      const rows = await db
        .insert(starLearningState)
        .values({ id: 1, stateJson: json, version: 1, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: starLearningState.id,
          set: {
            stateJson: json,
            version: sql`${starLearningState.version} + 1`,
            updatedAt: new Date(),
          },
          setWhere: eq(starLearningState.version, expectedVersion),
        })
        .returning({ version: starLearningState.version });

      if (rows.length === 0) return { ok: false };
      return { ok: true, newVersion: rows[0].version };
    });
  }

  async loadStarLearningStateVersioned(): Promise<{ json: object; version: number } | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(starLearningState)
        .where(eq(starLearningState.id, 1))
        .then((rows) =>
          rows[0] ? { json: rows[0].stateJson as object, version: rows[0].version } : null
        )
    );
  }

  async saveSearchedAnime(malId: number, data: object): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(animeSearched)
        .values({ malId, data })
        .onConflictDoUpdate({
          target: animeSearched.malId,
          set: { data },
        })
        .then(() => undefined)
    );
  }

  async getAllSearchedAnime(): Promise<{ malId: number; data: object }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(animeSearched)
        .then((rows) => rows.map((r) => ({ malId: r.malId, data: r.data as object })))
    );
  }

  async saveAnimeEmbedding(malId: number, embedding: number[]): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(animeEmbeddings)
        .values({ malId, embedding, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: animeEmbeddings.malId,
          set: { embedding, updatedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async getAllAnimeEmbeddings(): Promise<{ malId: number; embedding: number[] }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(animeEmbeddings)
        .then((rows) => rows.map((r) => ({ malId: r.malId, embedding: r.embedding as number[] })))
    );
  }

  async saveVibeProfile(malId: number, profile: object): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(vibeProfiles)
        .values({ malId, profile })
        .onConflictDoUpdate({
          target: vibeProfiles.malId,
          set: { profile },
        })
        .then(() => undefined)
    );
  }

  async getVibeProfile(malId: number): Promise<object | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(vibeProfiles)
        .where(eq(vibeProfiles.malId, malId))
        .then((rows) => (rows[0]?.profile as object) ?? null)
    );
  }

  async getAllVibeProfiles(): Promise<{ malId: number; profile: object }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(vibeProfiles)
        .then((rows) => rows.map((r) => ({ malId: r.malId, profile: r.profile as object })))
    );
  }

  async saveRating(userId: string, malId: number, rating: number): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userRatings)
        .values({ userId, malId, rating })
        .onConflictDoUpdate({
          target: [userRatings.userId, userRatings.malId],
          set: { rating },
        })
        .then(() => undefined)
    );
  }

  async getUserRatings(userId: string): Promise<{ malId: number; rating: number }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(userRatings)
        .where(eq(userRatings.userId, userId))
        .then((rows) => rows.map((r) => ({ malId: r.malId, rating: r.rating })))
    );
  }

  async recordDiscovery(malId: number, userId: string, displayName: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(animeDiscovery)
        .values({ malId, discoveredByUserId: userId, discoveredByDisplayName: displayName })
        .onConflictDoNothing()
        .then(() => undefined)
    );
  }

  async getDiscovery(malId: number): Promise<{ userId: string; displayName: string; discoveredAt: Date } | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(animeDiscovery)
        .where(eq(animeDiscovery.malId, malId))
        .then((rows) => {
          if (!rows[0]) return null;
          return {
            userId: rows[0].discoveredByUserId,
            displayName: rows[0].discoveredByDisplayName,
            discoveredAt: rows[0].discoveredAt,
          };
        })
    );
  }

  async setDisplayName(userId: string, displayName: string, pin?: string, displayNameNormalized?: string): Promise<void> {
    return this.withRetry(() => {
      const vals: { userId: string; displayName: string; displayNameNormalized?: string; pin?: string } = { userId, displayName };
      if (displayNameNormalized !== undefined) vals.displayNameNormalized = displayNameNormalized;
      if (pin !== undefined) vals.pin = pin;
      const updateSet: { displayName: string; displayNameNormalized?: string; pin?: string } = { displayName };
      if (displayNameNormalized !== undefined) updateSet.displayNameNormalized = displayNameNormalized;
      if (pin !== undefined) updateSet.pin = pin;
      return db
        .insert(userProfiles)
        .values(vals)
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: updateSet,
        })
        .then(() => undefined);
    });
  }

  async getDisplayName(userId: string): Promise<string | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .then((rows) => rows[0]?.displayName ?? null)
    );
  }

  async isDisplayNameTaken(displayName: string, excludeUserId: string): Promise<boolean> {
    return this.withRetry(() =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.displayName, displayName))
        .then((rows) => rows.some((r) => r.userId !== excludeUserId))
    );
  }

  async loginWithDisplayName(displayName: string, pin: string): Promise<string | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.displayName, displayName))
        .then((rows) => {
          const match = rows.find((r) => r.pin === pin);
          return match?.userId ?? null;
        })
    );
  }

  async registerUser(
    displayName: string,
    normalizedName: string,
    hashedPin: string
  ): Promise<{ userId: string; displayName: string }> {
    const userId = randomUUID();
    await this.withRetry(() =>
      db
        .insert(userProfiles)
        .values({ userId, displayName, displayNameNormalized: normalizedName, pin: hashedPin })
        .then(() => undefined)
    );
    return { userId, displayName };
  }

  async getUserProfileByNormalized(
    normalized: string
  ): Promise<{ userId: string; displayName: string; pin: string | null } | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.displayNameNormalized, normalized))
        .then((rows) =>
          rows[0]
            ? { userId: rows[0].userId, displayName: rows[0].displayName, pin: rows[0].pin ?? null }
            : null
        )
    );
  }

  async updatePin(userId: string, hashedPin: string): Promise<void> {
    return this.withRetry(() =>
      db
        .update(userProfiles)
        .set({ pin: hashedPin })
        .where(eq(userProfiles.userId, userId))
        .then(() => undefined)
    );
  }

  async getAllUserProfiles(): Promise<{ userId: string; displayName: string }[]> {
    return this.withRetry(() =>
      db
        .select({ userId: userProfiles.userId, displayName: userProfiles.displayName })
        .from(userProfiles)
        .then((rows) => rows)
    );
  }

  async addBan(
    userId: string,
    ban: { malId?: number; bannedGenre?: string; bannedTrope?: string; reason?: string }
  ): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userBanList)
        .values({
          userId,
          malId: ban.malId ?? null,
          bannedGenre: ban.bannedGenre ?? null,
          bannedTrope: ban.bannedTrope ?? null,
          reason: ban.reason ?? null,
        })
        .onConflictDoNothing()
        .then(() => undefined)
    );
  }

  async removeBan(userId: string, banId: number): Promise<void> {
    return this.withRetry(() =>
      db
        .delete(userBanList)
        .where(and(eq(userBanList.id, banId), eq(userBanList.userId, userId)))
        .then(() => undefined)
    );
  }

  async getUserBans(userId: string): Promise<{ id: number; malId: number | null; bannedGenre: string | null; bannedTrope: string | null; reason: string | null }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(userBanList)
        .where(eq(userBanList.userId, userId))
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            malId: r.malId,
            bannedGenre: r.bannedGenre,
            bannedTrope: r.bannedTrope,
            reason: r.reason,
          }))
        )
    );
  }

  async isAnimeBanned(userId: string, malId: number, genres: string[]): Promise<boolean> {
    return this.withRetry(async () => {
      const bans = await db
        .select()
        .from(userBanList)
        .where(eq(userBanList.userId, userId));
      return bans.some(
        (b) =>
          b.malId === malId ||
          (b.bannedGenre !== null && genres.includes(b.bannedGenre))
      );
    });
  }

  async setWatchState(userId: string, malId: number, state: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userWatchState)
        .values({ userId, malId, state, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [userWatchState.userId, userWatchState.malId],
          set: { state, updatedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async getUserWatchStates(userId: string): Promise<{ malId: number; state: string }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(userWatchState)
        .where(eq(userWatchState.userId, userId))
        .then((rows) => rows.map((r) => ({ malId: r.malId, state: r.state })))
    );
  }

  async getWatchedMalIds(userId: string): Promise<Set<number>> {
    return this.withRetry(() =>
      db
        .select()
        .from(userWatchState)
        .where(
          and(
            eq(userWatchState.userId, userId),
            inArray(userWatchState.state, ["completed", "dropped"])
          )
        )
        .then((rows) => new Set(rows.map((r) => r.malId)))
    );
  }

  async setHiddenGemBias(userId: string, bias: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, bias));
    return this.withRetry(() =>
      db
        .insert(userPreferences)
        .values({ userId, hiddenGemBias: clamped, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: { hiddenGemBias: clamped, updatedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async getHiddenGemBias(userId: string): Promise<number> {
    return this.withRetry(() =>
      db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .then((rows) => rows[0]?.hiddenGemBias ?? 0.5)
    );
  }

  async setSubDubPreference(userId: string, pref: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userPreferences)
        .values({ userId, subDubPreference: pref, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: { subDubPreference: pref, updatedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async incrementChatCount(userId: string, date: string): Promise<number> {
    return this.withRetry(() =>
      db
        .insert(userChatUsage)
        .values({ userId, date, messageCount: 1 })
        .onConflictDoUpdate({
          target: [userChatUsage.userId, userChatUsage.date],
          set: { messageCount: sql`${userChatUsage.messageCount} + 1` },
        })
        .returning({ messageCount: userChatUsage.messageCount })
        .then((rows) => rows[0]?.messageCount ?? 1)
    );
  }

  async getChatCount(userId: string, date: string): Promise<number> {
    return this.withRetry(() =>
      db
        .select()
        .from(userChatUsage)
        .where(and(eq(userChatUsage.userId, userId), eq(userChatUsage.date, date)))
        .then((rows) => rows[0]?.messageCount ?? 0)
    );
  }

  async getOnboardingState(userId: string): Promise<{
    pathChosen: string | null;
    completed: boolean;
    unlockedRecommendations: boolean;
    trainingCompleted: boolean;
    favoritesInput: string | null;
    retryCount: number;
  } | null> {
    return this.withRetry(() =>
      db
        .select()
        .from(userOnboarding)
        .where(eq(userOnboarding.userId, userId))
        .then((rows) => {
          if (!rows[0]) return null;
          return {
            pathChosen: rows[0].pathChosen,
            completed: rows[0].completed,
            unlockedRecommendations: rows[0].unlockedRecommendations,
            trainingCompleted: rows[0].trainingCompleted,
            favoritesInput: rows[0].favoritesInput ?? null,
            retryCount: rows[0].retryCount,
          };
        })
    );
  }

  async setOnboardingPath(userId: string, path: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userOnboarding)
        .values({ userId, pathChosen: path })
        .onConflictDoUpdate({
          target: userOnboarding.userId,
          set: { pathChosen: path },
        })
        .then(() => undefined)
    );
  }

  async completeOnboarding(userId: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userOnboarding)
        .values({ userId, completed: true, unlockedRecommendations: true, completedAt: new Date() })
        .onConflictDoUpdate({
          target: userOnboarding.userId,
          set: { completed: true, unlockedRecommendations: true, completedAt: new Date() },
        })
        .then(() => undefined)
    );
  }

  async unlockRecommendations(userId: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userOnboarding)
        .values({ userId, unlockedRecommendations: true })
        .onConflictDoUpdate({
          target: userOnboarding.userId,
          set: { unlockedRecommendations: true },
        })
        .then(() => undefined)
    );
  }

  async saveCharacterRating(userId: string, characterId: string, rating: number): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userCharacterRatings)
        .values({ userId, characterId, rating })
        .onConflictDoUpdate({
          target: [userCharacterRatings.userId, userCharacterRatings.characterId],
          set: { rating },
        })
        .then(() => undefined)
    );
  }

  async getCharacterRatings(userId: string): Promise<{ characterId: string; rating: number }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(userCharacterRatings)
        .where(eq(userCharacterRatings.userId, userId))
        .then((rows) => rows.map((r) => ({ characterId: r.characterId, rating: r.rating })))
    );
  }

  async saveAnimeReason(userId: string, malId: number, reason: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(animeReasons)
        .values({ userId, malId, reason })
        .onConflictDoUpdate({
          target: [animeReasons.userId, animeReasons.malId],
          set: { reason },
        })
        .then(() => undefined)
    );
  }

  async setTrainingCompleted(userId: string, completed: boolean): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userOnboarding)
        .values({ userId, trainingCompleted: completed })
        .onConflictDoUpdate({
          target: userOnboarding.userId,
          set: { trainingCompleted: completed },
        })
        .then(() => undefined)
    );
  }

  async saveFavoritesInput(userId: string, input: string): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userOnboarding)
        .values({ userId, favoritesInput: input })
        .onConflictDoUpdate({
          target: userOnboarding.userId,
          set: { favoritesInput: input },
        })
        .then(() => undefined)
    );
  }

  async incrementRetryCount(userId: string): Promise<void> {
    return this.withRetry(() =>
      db
        .update(userOnboarding)
        .set({ retryCount: sql`${userOnboarding.retryCount} + 1` })
        .where(eq(userOnboarding.userId, userId))
        .then(() => undefined)
    );
  }

  async getUntrainedUsers(maxRetries: number): Promise<{
    userId: string;
    pathChosen: string | null;
    favoritesInput: string | null;
    retryCount: number;
  }[]> {
    return this.withRetry(() =>
      db
        .select({
          userId: userOnboarding.userId,
          pathChosen: userOnboarding.pathChosen,
          favoritesInput: userOnboarding.favoritesInput,
          retryCount: userOnboarding.retryCount,
        })
        .from(userOnboarding)
        .where(
          and(
            eq(userOnboarding.trainingCompleted, false),
            lt(userOnboarding.retryCount, maxRetries),
            isNotNull(userOnboarding.favoritesInput)
          )
        )
        .limit(10)
        .then((rows) =>
          rows.map((r) => ({
            userId: r.userId,
            pathChosen: r.pathChosen,
            favoritesInput: r.favoritesInput ?? null,
            retryCount: r.retryCount,
          }))
        )
    );
  }

  async savePersonalitySignal(
    userId: string,
    signalType: string,
    value: string,
    weight = 1.0,
    source = "chat"
  ): Promise<void> {
    return this.withRetry(() =>
      db
        .insert(userPersonalitySignals)
        .values({ userId, signalType, value, weight, source })
        .onConflictDoUpdate({
          target: [
            userPersonalitySignals.userId,
            userPersonalitySignals.signalType,
            userPersonalitySignals.value,
          ],
          set: { weight, source },
        })
        .then(() => undefined)
    );
  }

  async getPersonalitySignals(
    userId: string
  ): Promise<{ signalType: string; value: string; weight: number; source: string }[]> {
    return this.withRetry(() =>
      db
        .select()
        .from(userPersonalitySignals)
        .where(eq(userPersonalitySignals.userId, userId))
        .then((rows) =>
          rows.map((r) => ({
            signalType: r.signalType,
            value: r.value,
            weight: r.weight,
            source: r.source,
          }))
        )
    );
  }
}

export const storage = new PostgresStorage();
