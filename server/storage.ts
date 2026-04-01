import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import {
  users, userEngineState, animeSearched, vibeProfiles,
  userRatings, animeDiscovery, userProfiles,
  type InsertUser, type User,
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
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  saveEngineState(userId: string, json: object): Promise<void>;
  loadEngineState(userId: string): Promise<object | null>;

  saveSearchedAnime(malId: number, data: object): Promise<void>;
  getAllSearchedAnime(): Promise<{ malId: number; data: object }[]>;

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

  async getUser(id: string): Promise<User | undefined> {
    return this.withRetry(() =>
      db.select().from(users).where(eq(users.id, id)).then((rows) => rows[0])
    );
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.withRetry(() =>
      db.select().from(users).where(eq(users.username, username)).then((rows) => rows[0])
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.withRetry(() =>
      db.insert(users).values(insertUser).returning().then((rows) => rows[0])
    );
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

  async setDisplayName(userId: string, displayName: string, pin?: string): Promise<void> {
    return this.withRetry(() => {
      const vals: { userId: string; displayName: string; pin?: string } = { userId, displayName };
      if (pin !== undefined) vals.pin = pin;
      const updateSet: { displayName: string; pin?: string } = { displayName };
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
}

export const storage = new PostgresStorage();
