import { Client } from "pg";
import { readFileSync } from "node:fs";
import { migrate } from "../../scripts/migrate";
import { putObject } from "../../src/lib/server/storage";
import { DEMO_FIXTURES } from "../../src/lib/server/providers";

export default async function setup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres:///vibii_e2e";
  if (!/vibii_e2e/.test(url)) throw new Error("refusing to reset a non-e2e database");
  const admin = new Client({ connectionString: url.replace(/vibii_e2e/, "postgres") });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = 'vibii_e2e'");
  if (!exists.rowCount) await admin.query("create database vibii_e2e");
  await admin.end();
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;");
  await c.end();
  await migrate(url, () => {});
  process.env.DATABASE_URL = url;
  for (const f of DEMO_FIXTURES) await putObject(f.storageKey, readFileSync(f.file), "audio/mpeg");
}
