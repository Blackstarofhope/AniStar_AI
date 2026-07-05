import { pgTable, text, integer, real, serial, timestamp, jsonb, unique, primaryKey, boolean } from "drizzle-orm/pg-core";

export const userEngineState = pgTable("user_engine_state", {
  userId: text("user_id").primaryKey(),
  engineJson: jsonb("engine_json").notNull(),
  // Optimistic-concurrency counter. Multi-instance deployments can have two
  // instances each holding their own in-memory copy of this user's engine;
  // writes are conditional on `version` matching what the writer last read,
  // so a stale writer gets a conflict instead of silently clobbering newer
  // work. See saveEngineStateVersioned in server/storage.ts.
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Star's chat-personalization learning state (server/ai/starLearning.ts) is a
// single global singleton (not per-user), previously persisted only to a
// per-instance-ephemeral file (ai-star-learning-state.json). A single fixed
// row (id=1) holds it in Postgres instead, with the same optimistic-versioning
// pattern as userEngineState so multi-instance writes don't clobber each other.
export const starLearningState = pgTable("star_learning_state", {
  id: integer("id").primaryKey().default(1),
  stateJson: jsonb("state_json").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const animeSearched = pgTable("anime_searched", {
  malId: integer("mal_id").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Anime embeddings are content-derived (from title/genres/score/etc via CLIP/text
// embedder), not user-specific. They were previously duplicated into every
// user's engine state blob (userEngineState.engineJson), which multiplied
// storage/write cost by the number of users for identical data. Storing them
// once here, shared across all users and instances, fixes that.
export const animeEmbeddings = pgTable("anime_embeddings", {
  malId: integer("mal_id").primaryKey(),
  embedding: jsonb("embedding").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  displayNameNormalized: text("display_name_normalized"),
  pin: text("pin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  displayNameUnique: unique("user_profiles_display_name_unique").on(t.displayName),
  displayNameNormalizedUnique: unique("user_profiles_display_name_normalized_unique").on(t.displayNameNormalized),
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
  subDubPreference: text("sub_dub_preference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userChatUsage = pgTable("user_chat_usage", {
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  messageCount: integer("message_count").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] }),
}));

export const userOnboarding = pgTable("user_onboarding", {
  userId: text("user_id").primaryKey(),
  pathChosen: text("path_chosen"),
  completed: boolean("completed").notNull().default(false),
  unlockedRecommendations: boolean("unlocked_recommendations").notNull().default(false),
  trainingCompleted: boolean("training_completed").notNull().default(false),
  favoritesInput: text("favorites_input"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const userCharacterRatings = pgTable("user_character_ratings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  characterId: text("character_id").notNull(),
  rating: integer("rating").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userCharUnique: unique("user_character_ratings_user_char_unique").on(t.userId, t.characterId),
}));

export const animeReasons = pgTable("anime_reasons", {
  userId: text("user_id").notNull(),
  malId: integer("mal_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.malId] }),
}));

// Chat-extracted preference signals — genre affinities, tone preferences, and
// trope likes/dislikes surfaced from natural-language chat messages.
// signalType: "genre_like" | "genre_dislike" | "mood_genre"
// value: the genre or mood string (e.g. "Action", "dark atmosphere")
// weight: 1.0 default; caller may adjust for confidence
// source: "chat" | "onboarding" for provenance tracking
export const userPersonalitySignals = pgTable("user_personality_signals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  signalType: text("signal_type").notNull(),
  value: text("value").notNull(),
  weight: real("weight").notNull().default(1.0),
  source: text("source").notNull().default("chat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userSignalUnique: unique("user_personality_signals_user_signal_unique").on(
    t.userId, t.signalType, t.value
  ),
}));
