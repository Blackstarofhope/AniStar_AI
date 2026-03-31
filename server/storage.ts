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
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 5,
});

pool.on("error", (err) => {
  console.error("[DB] Idle client error (connection dropped by server):", err.message);
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

  setDisplayName(userId: string, displayName: string): Promise<void>;
  getDisplayName(userId: string): Promise<string | null>;
}

class PostgresStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(insertUser).returning();
    return rows[0];
  }

  async saveEngineState(userId: string, json: object): Promise<void> {
    await db
      .insert(userEngineState)
      .values({ userId, engineJson: json, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userEngineState.userId,
        set: { engineJson: json, updatedAt: new Date() },
      });
  }

  async loadEngineState(userId: string): Promise<object | null> {
    const rows = await db
      .select()
      .from(userEngineState)
      .where(eq(userEngineState.userId, userId));
    return (rows[0]?.engineJson as object) ?? null;
  }

  async saveSearchedAnime(malId: number, data: object): Promise<void> {
    await db
      .insert(animeSearched)
      .values({ malId, data })
      .onConflictDoUpdate({
        target: animeSearched.malId,
        set: { data },
      });
  }

  async getAllSearchedAnime(): Promise<{ malId: number; data: object }[]> {
    const rows = await db.select().from(animeSearched);
    return rows.map((r) => ({ malId: r.malId, data: r.data as object }));
  }

  async saveVibeProfile(malId: number, profile: object): Promise<void> {
    await db
      .insert(vibeProfiles)
      .values({ malId, profile })
      .onConflictDoUpdate({
        target: vibeProfiles.malId,
        set: { profile },
      });
  }

  async getVibeProfile(malId: number): Promise<object | null> {
    const rows = await db
      .select()
      .from(vibeProfiles)
      .where(eq(vibeProfiles.malId, malId));
    return (rows[0]?.profile as object) ?? null;
  }

  async getAllVibeProfiles(): Promise<{ malId: number; profile: object }[]> {
    const rows = await db.select().from(vibeProfiles);
    return rows.map((r) => ({ malId: r.malId, profile: r.profile as object }));
  }

  async saveRating(userId: string, malId: number, rating: number): Promise<void> {
    await db
      .insert(userRatings)
      .values({ userId, malId, rating })
      .onConflictDoUpdate({
        target: [userRatings.userId, userRatings.malId],
        set: { rating },
      });
  }

  async getUserRatings(userId: string): Promise<{ malId: number; rating: number }[]> {
    const rows = await db
      .select()
      .from(userRatings)
      .where(eq(userRatings.userId, userId));
    return rows.map((r) => ({ malId: r.malId, rating: r.rating }));
  }

  async recordDiscovery(malId: number, userId: string, displayName: string): Promise<void> {
    await db
      .insert(animeDiscovery)
      .values({ malId, discoveredByUserId: userId, discoveredByDisplayName: displayName })
      .onConflictDoNothing();
  }

  async getDiscovery(malId: number): Promise<{ userId: string; displayName: string; discoveredAt: Date } | null> {
    const rows = await db
      .select()
      .from(animeDiscovery)
      .where(eq(animeDiscovery.malId, malId));
    if (!rows[0]) return null;
    return {
      userId: rows[0].discoveredByUserId,
      displayName: rows[0].discoveredByDisplayName,
      discoveredAt: rows[0].discoveredAt,
    };
  }

  async setDisplayName(userId: string, displayName: string): Promise<void> {
    try {
      await db
        .insert(userProfiles)
        .values({ userId, displayName })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { displayName },
        });
    } catch (err) {
      console.error("[DB] setDisplayName failed:", err);
      throw err;
    }
  }

  async getDisplayName(userId: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return rows[0]?.displayName ?? null;
  }
}

export const storage = new PostgresStorage();
