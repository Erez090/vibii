// Applies SQL migrations in order. Locally it first installs the auth shim when no Supabase
// auth schema exists. Usage: DATABASE_URL=... npx tsx scripts/migrate.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

export async function migrate(databaseUrl: string, log = console.log) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select to_regclass('auth.users') is not null as has_auth",
    );
    if (!rows[0].has_auth) {
      log("auth schema missing → applying local shim (not for Supabase)");
      await client.query(readFileSync(path.join(process.cwd(), "db/local/000_auth_shim.sql"), "utf8"));
    }
    await client.query(
      "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const dir = path.join(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const done = await client.query("select 1 from public.schema_migrations where name = $1", [file]);
      if (done.rowCount) continue;
      log(`applying ${file}`);
      await client.query("begin");
      try {
        await client.query(readFileSync(path.join(dir, file), "utf8"));
        await client.query("insert into public.schema_migrations(name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  migrate(url).then(() => console.log("migrations complete"), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
