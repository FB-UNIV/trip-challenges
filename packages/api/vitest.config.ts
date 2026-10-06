import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite boots a WASM Postgres per test file; the first query can take a few seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Each test file boots its own WASM Postgres; too many at once starves the CPU and
    // setup hooks time out (seen with 11 workers on a 12-core machine).
    maxWorkers: 4,
    minWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // server.ts only wires plugins together and listens; every plugin it registers is
      // covered through the route tests.
      exclude: ["src/server.ts"],
      reporter: ["text-summary", "json-summary"],
      // Enforced by `npm test` (and so CI). Raise these as gaps close; don't lower them.
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 92 },
    },
  },
});
