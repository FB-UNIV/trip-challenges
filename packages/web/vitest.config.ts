// Separate from vite.config.ts so tests don't load the PWA plugin.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // main.tsx only mounts the router on #root; the route table it uses is covered.
      exclude: ["src/main.tsx"],
      reporter: ["text-summary", "json-summary"],
      // Enforced by `npm test` (and so CI). Raise these as gaps close; don't lower them.
      thresholds: { statements: 98, lines: 98, functions: 90, branches: 90 },
    },
  },
});
