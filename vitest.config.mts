import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Tests never process CSS; skip loading the app PostCSS/Tailwind config.
  css: { postcss: { plugins: [] } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres:///vibii_test", VIBII_SECRET: "test-secret-test-secret-test-secret-123", DATABASE_POOL_MAX: "10" },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
