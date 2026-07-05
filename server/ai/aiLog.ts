// Structured JSON logging helper for the AI engine's concurrency/persistence
// code paths (processFeedback, restTrain, starLearning). Keeps `console.*`
// as the transport (not a new library) so existing `vi.spyOn(console, ...)`
// test assertions keep working — only the message shape changes, from ad
// hoc prose strings to a single-line JSON object with a stable `event` key.
export type AILogLevel = "info" | "warn" | "error";

export function aiLog(level: AILogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
