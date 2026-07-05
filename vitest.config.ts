import { defineConfig } from "vitest/config";
import path from "path";

// Regression tests for the AI recommendation engine's cross-instance
// concurrency safety (T004). These tests run against the REAL Postgres
// database (DATABASE_URL) — there is no mock DB layer in this project — so
// file execution is kept sequential (fileParallelism: false) to avoid
// cross-file interference on shared tables and to keep the total number of
// pool connections bounded (server/storage.ts caps the pg Pool at 3).
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
