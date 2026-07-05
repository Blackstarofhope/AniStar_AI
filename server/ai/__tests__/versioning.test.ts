import { describe, it, expect, afterEach } from "vitest";
import { storage } from "../../storage.js";
import { cleanupTestUser, snapshotStarLearningRow, restoreStarLearningRow } from "./testHelpers.js";

// Regression tests for the optimistic-concurrency (CAS) bug fixed after the
// T003 architect review: saveEngineStateVersioned's INSERT path used to
// write `version: 0`, identical to the sentinel "no row exists yet" value
// two concurrent first-writers both pass as `expectedVersion`. That made
// both `onConflictDoUpdate ... setWhere: version = 0` clauses match the
// freshly-inserted row, so the second writer's update silently applied
// (lost-update) instead of correctly conflicting. The fix: the insert path
// now writes `version: 1`, so `expectedVersion=0` only ever matches
// "no row" and never matches an existing row.
//
// If the insert path's `version: 1` in saveEngineStateVersioned /
// saveStarLearningStateVersioned is ever changed back to `version: 0`,
// these tests must fail (verified manually while writing them).

describe("saveEngineStateVersioned — first-writer race", () => {
  const userId = "vitest-cas-race-user";

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("lets exactly one of two concurrent first writers (expectedVersion=0) win", async () => {
    const [a, b] = await Promise.all([
      storage.saveEngineStateVersioned(userId, { marker: "writer-a" }, 0),
      storage.saveEngineStateVersioned(userId, { marker: "writer-b" }, 0),
    ]);

    const results = [a, b];
    const oks = results.filter((r) => r.ok);
    const fails = results.filter((r) => !r.ok);

    expect(oks.length).toBe(1);
    expect(fails.length).toBe(1);

    // The row must end up at version 1 (the winner's insert), not 2 — if the
    // bug were present, both writers could "succeed" and the row would be
    // left at some other unexpected version, or the loser's write would
    // silently clobber the winner's content.
    const final = await storage.loadEngineStateVersioned(userId);
    expect(final?.version).toBe(1);
    expect(oks[0].ok && oks[0].newVersion).toBe(1);
  });

  it("rejects a second writer using the stale expectedVersion=0 after a row already exists", async () => {
    const first = await storage.saveEngineStateVersioned(userId, { marker: "seed" }, 0);
    expect(first.ok).toBe(true);

    // Simulates a second instance that read the "row doesn't exist yet"
    // state before the first writer committed, and only now attempts its
    // own first write with expectedVersion=0.
    const second = await storage.saveEngineStateVersioned(userId, { marker: "stale-writer" }, 0);
    expect(second.ok).toBe(false);

    const final = await storage.loadEngineStateVersioned(userId);
    expect(final?.version).toBe(1);
    expect((final?.json as { marker: string }).marker).toBe("seed");
  });

  it("accepts a writer using the correct current version and increments by exactly 1", async () => {
    const first = await storage.saveEngineStateVersioned(userId, { marker: "v1" }, 0);
    expect(first.ok).toBe(true);
    expect(first.ok && first.newVersion).toBe(1);

    const second = await storage.saveEngineStateVersioned(userId, { marker: "v2" }, 1);
    expect(second.ok).toBe(true);
    expect(second.ok && second.newVersion).toBe(2);

    const final = await storage.loadEngineStateVersioned(userId);
    expect(final?.version).toBe(2);
    expect((final?.json as { marker: string }).marker).toBe("v2");
  });
});

describe("saveStarLearningStateVersioned — same CAS fix, singleton row", () => {
  let snapshot: { json: object; version: number } | null = null;

  it("lets exactly one of two concurrent first writers win when no row exists yet", async () => {
    snapshot = await snapshotStarLearningRow();
    // Force the "no row exists" starting condition this test needs,
    // regardless of what the running app has already persisted.
    const { db } = await import("../../storage.js");
    const { starLearningState } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(starLearningState).where(eq(starLearningState.id, 1));

    const [a, b] = await Promise.all([
      storage.saveStarLearningStateVersioned({ marker: "writer-a" }, 0),
      storage.saveStarLearningStateVersioned({ marker: "writer-b" }, 0),
    ]);

    const oks = [a, b].filter((r) => r.ok);
    expect(oks.length).toBe(1);

    const final = await storage.loadStarLearningStateVersioned();
    expect(final?.version).toBe(1);

    await restoreStarLearningRow(snapshot);
    snapshot = null;
  });
});
