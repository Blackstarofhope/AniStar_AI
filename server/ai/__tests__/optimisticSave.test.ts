import { describe, it, expect, vi } from "vitest";
import { saveWithConflictRetry } from "../optimisticSave";

describe("saveWithConflictRetry", () => {
  it("returns saved:true on the first successful save without calling onConflict", async () => {
    const runAttempt = vi.fn(async (attempt: number) => attempt);
    const save = vi.fn(async () => true);
    const onConflict = vi.fn(async () => "stop" as const);

    const { saved, result } = await saveWithConflictRetry({
      maxAttempts: 3,
      runAttempt,
      save,
      onConflict,
    });

    expect(saved).toBe(true);
    expect(result).toBe(0);
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("retries after a conflict when onConflict returns 'retry', then succeeds", async () => {
    const runAttempt = vi.fn(async (attempt: number) => attempt);
    const save = vi.fn(async (result: number) => result === 1);
    const onConflict = vi.fn(async () => "retry" as const);

    const { saved, result } = await saveWithConflictRetry({
      maxAttempts: 3,
      runAttempt,
      save,
      onConflict,
    });

    expect(saved).toBe(true);
    expect(result).toBe(1);
    expect(runAttempt).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledWith({ attempt: 0, maxAttempts: 3, willRetry: true });
  });

  it("stops immediately when onConflict returns 'stop', without exhausting maxAttempts", async () => {
    const runAttempt = vi.fn(async (attempt: number) => attempt);
    const save = vi.fn(async () => false);
    const onConflict = vi.fn(async () => "stop" as const);

    const { saved, result } = await saveWithConflictRetry({
      maxAttempts: 5,
      runAttempt,
      save,
      onConflict,
    });

    expect(saved).toBe(false);
    expect(result).toBe(0);
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledTimes(1);
  });

  it("passes willRetry:false on the final attempt and stops after maxAttempts even if onConflict says 'retry'", async () => {
    const runAttempt = vi.fn(async (attempt: number) => attempt);
    const save = vi.fn(async () => false);
    const onConflict = vi.fn(async () => "retry" as const);

    const { saved, result } = await saveWithConflictRetry({
      maxAttempts: 3,
      runAttempt,
      save,
      onConflict,
    });

    expect(saved).toBe(false);
    expect(result).toBe(2);
    expect(runAttempt).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledTimes(3);
    expect(onConflict).toHaveBeenCalledTimes(3);
    expect(onConflict).toHaveBeenNthCalledWith(3, { attempt: 2, maxAttempts: 3, willRetry: false });
  });
});
