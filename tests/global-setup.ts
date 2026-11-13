import { Client } from "pg";
import { readFileSync } from "node:fs";
import { migrate } from "../scripts/migrate";
import { DEMO_FIXTURES } from "../src/lib/server/providers";

// Fresh schema for every test run (local test database only).
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres:///vibii_test";
  if (!/vibii_test/.test(url)) throw new Error("refusing to reset a non-test database");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;");
  await c.end();
  await migrate(url, () => {});
  process.env.DATABASE_URL = url;
  process.env.VIBII_SECRET = "test-secret-test-secret-test-secret-123";
  const { putObject } = await import("../src/lib/server/storage");
  for (const f of DEMO_FIXTURES) await putObject(f.storageKey, readFileSync(f.file), "audio/mpeg");
}
