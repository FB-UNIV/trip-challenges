import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { apiEnv, API_URL, API_PORT, WEB_PORT, WEB_URL } from "./support/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const CI = !!process.env.CI;

// Data services (Postgres, MinIO, Vault, Mailpit) must already be up:
//   npm run e2e:services          (docker compose + wait)
// Playwright then boots the real API and the Vite dev server itself.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true, // every test creates its own trip, teachers and students
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    // Teachers use a desktop browser; specs open student contexts as phones
    // (see support/actors.ts), so mobile layouts are covered in the same run.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm run build --workspace @trip/shared && npx tsx packages/api/src/server.ts",
      cwd: root,
      url: `${API_URL}/api/readyz`,
      env: apiEnv,
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: `${root}packages/web`,
      url: WEB_URL,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
