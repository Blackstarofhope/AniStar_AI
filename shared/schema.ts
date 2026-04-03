import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, serial, timestamp, jsonb, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const userEngineState = pgTable("user_engine_state", {
  userId: text("user_id").primaryKey(),
  engineJson: jsonb("engine_json").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const animeSearched = pgTable("anime_searched", {
  malId: integer("mal_id").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vibeProfiles = pgTable("vibe_profiles", {
  malId: integer("mal_id").primaryKey(),
  profile: jsonb("profile").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userRatings = pgTable("user_ratings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  rating: real("rating").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userMalUnique: unique("user_ratings_user_mal_unique").on(t.userId, t.malId),
}));

export const animeDiscovery = pgTable("anime_discovery", {
  malId: integer("mal_id").primaryKey(),
  discoveredByUserId: text("discovered_by_user_id").notNull(),
  discoveredByDisplayName: text("discovered_by_display_name").notNull(),
  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  pin: text("pin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  displayNameUnique: unique("user_profiles_display_name_unique").on(t.displayName),
}));

export const userBanList = pgTable("user_ban_list", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  malId: integer("mal_id"),
  bannedGenre: text("banned_genre"),
  bannedTrope: text("banned_trope"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userMalUnique: unique("user_ban_list_user_mal_unique").on(t.userId, t.malId),
  userGenreUnique: unique("user_ban_list_user_genre_unique").on(t.userId, t.bannedGenre),
}));

export const userWatchState = pgTable("user_watch_state", {
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  state: text("state").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.malId] }),
}));

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  hiddenGemBias: real("hidden_gem_bias").notNull().default(0.5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
