import { defineConfig, devices } from "@playwright/test";

const DB = process.env.E2E_DATABASE_URL ?? "postgres:///vibii_e2e";
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  outputDir: "test-results",
  webServer: {
    command: `WATCHPACK_POLLING=true NEXT_DIST_DIR=.next-e2e npx next dev --webpack -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: DB, VIBII_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } } }],
});
