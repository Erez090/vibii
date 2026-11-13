import { Pool, type PoolClient } from "pg";
import { databaseUrl } from "./env";

// One pool per process (survives Next dev hot reloads). The connection uses a privileged role;
// user-facing reads go through asUser(), which drops to the `authenticated` role so Postgres RLS
// enforces owner isolation in addition to the server's own checks.

const g = globalThis as unknown as { __vibiiPool?: Pool };

export function pool(): Pool {
  if (!g.__vibiiPool) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_URL is not configured");
    g.__vibiiPool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return g.__vibiiPool;
}

export type Db = PoolClient;

export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Runs fn as the given user under RLS (role `authenticated`, auth.uid() = userId). */
export async function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
      userId,
    ]);
    await db.query("set local role authenticated");
    return fn(db);
  });
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(text, params);
  return res.rows as T[];
}
