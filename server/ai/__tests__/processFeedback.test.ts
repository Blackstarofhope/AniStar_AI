import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { storage } from "../../storage.js";
import { processFeedback, resetEngine } from "../recommendEngine.js";
import { cleanupTestUser, seedAnimeEmbedding, cleanupAnimeEmbeddings } from "./testHelpers.js";

// These malIds are seeded directly into the shared `animeEmbeddings` table
// (via seedAnimeEmbedding) so processFeedback's getSharedEmbedding() cache
// hits immediately and never falls through to getAllCurrentAnime() /
// embedAnimeWithVibeFallback() — keeping these tests fast and free of any
// dependency on the Jikan/AniList network APIs or the CLIP encoder.
const MAL_IDS = [900001, 900002, 900003, 900004, 900005, 900006];

describe("processFeedback — cross-instance conflict recovery", () => {
  const userId = "vitest-conflict-recovery-user";

  beforeAll(async () => {
    await Promise.all(MAL_IDS.map(seedAnimeEmbedding));
  });

  afterAll(async () => {
    await cleanupAnimeEmbeddings(MAL_IDS);
  });

  afterEach(async () => {
    resetEngine();
    await cleanupTestUser(userId);
  });

  it("retries and folds in an out-of-band write instead of clobbering it, when the DB row is bumped mid-flight", async () => {
    // 1. Seed this user's engine normally (rates one anime), landing at DB version 1.
    await processFeedback(MAL_IDS[0], 1, userId);
    const afterSeed = await storage.loadEngineStateVersioned(userId);
    expect(afterSeed?.version).toBe(1);

    // 2. Simulate a write from ANOTHER instance that this process's in-memory
    // engine cache knows nothing about: load the current row, inject a
    // rating for a different anime as if a completely separate process
    // trained on it, and save it out-of-band via the raw storage API
    // (bypassing recommendEngine's cache entirely). This bumps the DB to
    // version 2 while our cached engine object still thinks it's at version 1.
    const outOfBand = await storage.loadEngineStateVersioned(userId);
    expect(outOfBand).not.toBeNull();
    const outOfBandJson = outOfBand!.json as { ratings: { animeId: number }[] };
    const OUT_OF_BAND_MARKER_ID = MAL_IDS[1];
    outOfBandJson.ratings = [
      ...outOfBandJson.ratings,
      { animeId: OUT_OF_BAND_MARKER_ID, embedding: new Array(outOfBandJson.ratings[0]?.embedding?.length ?? 512).fill(0.01), rating: 1, timestamp: Date.now() },
    ];
    const bump = await storage.saveEngineStateVersioned(userId, outOfBandJson, outOfBand!.version);
    expect(bump.ok).toBe(true);
    expect(bump.ok && bump.newVersion).toBe(2);

    // 3. Now, in THIS process, train on yet another anime. Our cached engine
    // object is still at version 1, so persistEngine's save must conflict
    // against the DB's version 2, forcing a reload + retry.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await processFeedback(MAL_IDS[2], 1, userId);
    const retryWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('"event":"feedback_conflict_retry"') && String(args[0]).includes(userId)
    );
    warnSpy.mockRestore();

    expect(retryWarnings.length).toBeGreaterThanOrEqual(1);
    expect(result.epoch).toBeGreaterThan(0);

    // 4. Final DB state must contain BOTH the out-of-band rating (from "the
    // other instance") AND this process's own new rating — neither writer's
    // work was clobbered.
    const final = await storage.loadEngineStateVersioned(userId);
    const finalRatings = (final!.json as { ratings: { animeId: number }[] }).ratings.map((r) => r.animeId);
    expect(finalRatings).toContain(OUT_OF_BAND_MARKER_ID);
    expect(finalRatings).toContain(MAL_IDS[2]);
  });
});

describe("processFeedback — same-instance queue serialization", () => {
  const userId = "vitest-queue-serialization-user";

  beforeAll(async () => {
    await Promise.all(MAL_IDS.map(seedAnimeEmbedding));
  });

  afterAll(async () => {
    await cleanupAnimeEmbeddings(MAL_IDS);
  });

  afterEach(async () => {
    resetEngine();
    await cleanupTestUser(userId);
  });

  it("serializes N concurrent calls for one user with zero self-conflicts, ending at version N", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await Promise.all(MAL_IDS.map((malId) => processFeedback(malId, 1, userId)));

    const selfConflictWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('"event":"feedback_conflict_retry"') && String(args[0]).includes(userId)
    );
    warnSpy.mockRestore();

    expect(selfConflictWarnings.length).toBe(0);

    const final = await storage.loadEngineStateVersioned(userId);
    expect(final?.version).toBe(MAL_IDS.length);

    const finalRatings = (final!.json as { ratings: { animeId: number }[] }).ratings.map((r) => r.animeId).sort();
    expect(finalRatings).toEqual([...MAL_IDS].sort());
  });
});

describe("processFeedback — dedup by animeId", () => {
  const userId = "vitest-dedup-user";

  beforeAll(async () => {
    await seedAnimeEmbedding(MAL_IDS[0]);
  });

  afterAll(async () => {
    await cleanupAnimeEmbeddings([MAL_IDS[0]]);
  });

  afterEach(async () => {
    resetEngine();
    await cleanupTestUser(userId);
  });

  it("replaces the in-memory rating entry instead of stacking a duplicate when the same anime is rated twice", async () => {
    await processFeedback(MAL_IDS[0], 0, userId);
    await processFeedback(MAL_IDS[0], 1, userId);

    const final = await storage.loadEngineStateVersioned(userId);
    const entries = (final!.json as { ratings: { animeId: number; rating: number }[] }).ratings.filter(
      (r) => r.animeId === MAL_IDS[0]
    );

    expect(entries.length).toBe(1);
    expect(entries[0].rating).toBe(1);
  });
});

describe("processFeedback — MAX_ATTEMPTS exhaustion", () => {
  const userId = "vitest-max-attempts-user";

  beforeAll(async () => {
    await seedAnimeEmbedding(MAL_IDS[0]);
  });

  afterAll(async () => {
    await cleanupAnimeEmbeddings([MAL_IDS[0]]);
  });

  afterEach(async () => {
    resetEngine();
    await cleanupTestUser(userId);
  });

  it("does not throw when every save attempt conflicts, logs the failure, and still runs saveRating/unlock side effects exactly once", async () => {
    await storage.setOnboardingPath(userId, "manual");

    const saveSpy = vi.spyOn(storage, "saveEngineStateVersioned").mockResolvedValue({ ok: false });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await processFeedback(MAL_IDS[0], 1, userId);

    const attemptsMade = saveSpy.mock.calls.length;
    const exhaustedError = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes('"event":"feedback_retries_exhausted"') && String(args[0]).includes(userId)
    );

    saveSpy.mockRestore();
    errorSpy.mockRestore();

    expect(attemptsMade).toBe(3);
    expect(exhaustedError).toBe(true);
    // T005 fix: the final attempt's reload is now gated on "is there another
    // attempt left" (there isn't, on attempt 3/3), so the returned epoch/
    // goodness reflect the trained-3x-but-unsaved engine, not a wastefully
    // reloaded fresh one.
    expect(result.epoch).toBeGreaterThan(0);
    expect(result.goodness).not.toBeNaN();

    // saveRating (an upsert, called exactly once regardless of retry count)
    // still ran despite every versioned-save attempt conflicting.
    const ratings = await storage.getUserRatings(userId);
    expect(ratings.length).toBe(1);
    expect(ratings[0].malId).toBe(MAL_IDS[0]);
  });
});

describe("processFeedback — Path3 unlock counter ordering", () => {
  const userId = "vitest-unlock-order-user";
  const UNLOCK_MAL_IDS = [900201, 900202, 900203, 900204, 900205, 900206, 900207, 900208, 900209, 900210];

  beforeAll(async () => {
    await Promise.all(UNLOCK_MAL_IDS.map(seedAnimeEmbedding));
  });

  afterAll(async () => {
    await cleanupAnimeEmbeddings(UNLOCK_MAL_IDS);
  });

  afterEach(async () => {
    resetEngine();
    await cleanupTestUser(userId);
  });

  it("unlocks on exactly the 10th distinct rating, never earlier — saveRating must be awaited before the getUserRatings count check", async () => {
    await storage.setOnboardingPath(userId, "manual");

    const unlockFlags: boolean[] = [];
    for (const malId of UNLOCK_MAL_IDS) {
      const result = await processFeedback(malId, 1, userId);
      unlockFlags.push(result.justUnlocked);
    }

    expect(unlockFlags.slice(0, 9)).toEqual(new Array(9).fill(false));
    expect(unlockFlags[9]).toBe(true);

    const onboarding = await storage.getOnboardingState(userId);
    expect(onboarding?.unlockedRecommendations).toBe(true);
    expect(onboarding?.completed).toBe(true);

    const ratings = await storage.getUserRatings(userId);
    expect(ratings.length).toBe(10);
  });
});
