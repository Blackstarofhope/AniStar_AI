// Shared combinator for the "train/build in memory, attempt a versioned
// save, handle conflicts" pattern used by processFeedback, restTrain, and
// starLearning's persistState. Each call site keeps its own conflict
// semantics (retry vs. stop, whether to reload/retrain) via `onConflict` —
// this helper only owns the attempt-counting loop, not the policy.
export interface ConflictContext {
  attempt: number; // 0-indexed attempt number that just failed to save
  maxAttempts: number;
  willRetry: boolean; // true if attempt < maxAttempts - 1 (another attempt will run)
}

export async function saveWithConflictRetry<T>(o: {
  maxAttempts: number;
  runAttempt: (attempt: number) => Promise<T>;
  save: (result: T) => Promise<boolean>;
  onConflict: (ctx: ConflictContext) => Promise<"retry" | "stop">;
}): Promise<{ saved: boolean; result: T }> {
  let lastResult: T | undefined;
  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    const result = await o.runAttempt(attempt);
    lastResult = result;
    const saved = await o.save(result);
    if (saved) {
      return { saved: true, result };
    }
    const willRetry = attempt < o.maxAttempts - 1;
    const decision = await o.onConflict({ attempt, maxAttempts: o.maxAttempts, willRetry });
    if (decision === "stop") {
      return { saved: false, result };
    }
  }
  // Loop only falls through here if every onConflict call returned "retry"
  // (including on the final attempt, where willRetry was false) — the
  // helper still stops because maxAttempts is exhausted.
  return { saved: false, result: lastResult as T };
}
