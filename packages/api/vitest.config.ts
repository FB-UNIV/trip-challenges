import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite boots a WASM Postgres per test file; the first query can take a few seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // server.ts only wires plugins together and listens; every plugin it registers is
      // covered through the route tests.
      exclude: ["src/server.ts"],
      reporter: ["text-summary", "json-summary"],
      // Enforced by `npm test` (and so CI). Raise these as gaps close; don't lower them.
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 85 },
    },
  },
});
