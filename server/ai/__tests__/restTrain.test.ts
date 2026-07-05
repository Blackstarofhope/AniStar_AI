import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { storage } from "../../storage.js";
import { cleanupTestUser, seedAnimeEmbedding, cleanupAnimeEmbeddings } from "./testHelpers.js";

// restTrain iterates the full current-season catalog via getAllCurrentAnime().
// Mocked here to a tiny, fixed catalog so the test is fast and deterministic
// instead of depending on the real Jikan/AniList network calls.
const MAL_IDS = [900101, 900102, 900103];
vi.mock("../animeData.js", () => ({
  getAllCurrentAnime: vi.fn(async () =>
    MAL_IDS.map((mal_id) => ({ mal_id, title: `Test Anime ${mal_id}`, score: 8.0 }))
  ),
}));

const { restTrain, processFeedback, resetEngine } = await import("../recommendEngine.js");

describe("restTrain — skip duplicate run when another writer already finished", () => {
  const userId = "vitest-resttrain-skip-user";

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

  it("skips re-running the full catalog pass when a conflict reveals restTrainedAt already set by another writer", async () => {
    // 1. Seed a fresh, real engine for this user (not yet rest-trained) by
    // running one normal training step — this produces a fully valid
    // PersistedEngineJson (network/kuramoto/neurogenesis/ewc all real,
    // hydrateEngineState-compatible) at DB version 1, and also warms this
    // process's in-memory engine cache with that same object.
    await processFeedback(MAL_IDS[0], 1, userId);
    const seeded = await storage.loadEngineStateVersioned(userId);
    expect(seeded?.version).toBe(1);
    expect((seeded!.json as { restTrainedAt: number | null }).restTrainedAt).toBeNull();

    // 2. Simulate another instance completing rest-training out-of-band:
    // load the current row, mark restTrainedAt, and save it directly via the
    // raw storage API (bypassing recommendEngine's in-memory cache), bumping
    // the DB to version 2. This process's about-to-run restTrain() still
    // only knows about version 1.
    const current = await storage.loadEngineStateVersioned(userId);
    expect(current).not.toBeNull();
    const outOfBandJson = { ...(current!.json as object), restTrainedAt: Date.now() };
    const bump = await storage.saveEngineStateVersioned(userId, outOfBandJson, current!.version);
    expect(bump.ok).toBe(true);
    expect(bump.ok && bump.newVersion).toBe(2);

    // 3. Run restTrain() in this process. Its first attempt trains the full
    // (mocked, 3-anime) catalog, then tries to save at expectedVersion=1 —
    // which must conflict against the DB's version 2. On reload it should
    // see restTrainedAt already set and skip attempt 2 (no second catalog
    // pass), logging the "already completed" message instead of the
    // "retrying" warning.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await restTrain(userId);

    const skippedLog = logSpy.mock.calls.some((args) =>
      String(args[0]).includes('"event":"resttrain_skip_duplicate"') && String(args[0]).includes(userId)
    );
    const retryWarning = warnSpy.mock.calls.some((args) =>
      String(args[0]).includes('"event":"resttrain_conflict_retry"') && String(args[0]).includes(userId)
    );
    logSpy.mockRestore();
    warnSpy.mockRestore();

    expect(skippedLog).toBe(true);
    expect(retryWarning).toBe(false);
    expect(result.animeCount).toBe(MAL_IDS.length);

    // The DB row must still reflect the out-of-band writer's save (this
    // process never got to persist its own, stale-relative-to-v2 attempt) —
    // no lost update or clobber of the "other instance"'s completed state.
    const final = await storage.loadEngineStateVersioned(userId);
    expect(final?.version).toBe(2);
  });
});
