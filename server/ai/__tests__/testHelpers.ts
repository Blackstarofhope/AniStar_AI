import { eq } from "drizzle-orm";
import { db } from "../../storage.js";
import { userEngineState, userRatings, userOnboarding, animeEmbeddings, starLearningState } from "@shared/schema";
import { EMBEDDING_DIM } from "../textEmbedder.js";

// Deterministic pseudo-random normalized embedding, purely a function of
// `seed` — used so tests never depend on network calls (Jikan/AniList) or
// the CLIP encoder to resolve an anime embedding. Callers pre-seed
// animeEmbeddings via seedAnimeEmbedding() below so recommendEngine's
// getSharedEmbedding() cache hits immediately instead of falling through to
// embedAnimeWithFallback/embedAnimeWithVibeFallback.
export function fakeEmbedding(seed: number): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0).map((_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 0.5);
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

export async function seedAnimeEmbedding(malId: number): Promise<void> {
  await db
    .insert(animeEmbeddings)
    .values({ malId, embedding: fakeEmbedding(malId), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: animeEmbeddings.malId,
      set: { embedding: fakeEmbedding(malId), updatedAt: new Date() },
    });
}

// Wipes every table row created for a synthetic test userId, so tests can
// run repeatedly (locally, in CI) without colliding with leftover state
// from a previous run.
export async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(userEngineState).where(eq(userEngineState.userId, userId));
  await db.delete(userRatings).where(eq(userRatings.userId, userId));
  await db.delete(userOnboarding).where(eq(userOnboarding.userId, userId));
}

export async function cleanupAnimeEmbeddings(malIds: number[]): Promise<void> {
  for (const malId of malIds) {
    await db.delete(animeEmbeddings).where(eq(animeEmbeddings.malId, malId));
  }
}

// star_learning_state is a single fixed row (id=1) shared globally — tests
// that touch it must snapshot/restore rather than delete, so they don't
// interfere with the app's real Star chat state.
export async function snapshotStarLearningRow(): Promise<{ json: object; version: number } | null> {
  const rows = await db.select().from(starLearningState).where(eq(starLearningState.id, 1));
  return rows[0] ? { json: rows[0].stateJson as object, version: rows[0].version } : null;
}

export async function restoreStarLearningRow(snapshot: { json: object; version: number } | null): Promise<void> {
  if (!snapshot) {
    await db.delete(starLearningState).where(eq(starLearningState.id, 1));
    return;
  }
  await db
    .update(starLearningState)
    .set({ stateJson: snapshot.json, version: snapshot.version })
    .where(eq(starLearningState.id, 1));
}
