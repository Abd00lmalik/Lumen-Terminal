import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Several suites exercise REAL bounded retry/backoff timers (transport resilience); under
    // full-suite parallel load a sub-second test can exceed vitest's 5s default and fail for
    // load reasons rather than behavior. 15s keeps genuine hangs caught while removing that
    // flakiness. Individual long-running tests still set their own explicit budget.
    testTimeout: 15_000,
  },
});
