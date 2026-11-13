// Account deletion: removes linked rows (cascade from profiles/auth.users) and private files.
// Hashed one-time-grant identities are retained so re-registration cannot duplicate grants.
// Data already sent to a provider (e.g. a brief entered into Suno by an operator) is subject to that
// provider's own retention/deletion — surfaced to the listener before they confirm.
import { tx } from "./db";
import { deleteObject } from "./storage";
import { authMode } from "./env";
import { createClient } from "@supabase/supabase-js";
import type { SessionUser } from "./auth";

export async function deleteAccount(user: SessionUser) {
  const keys = await tx(async (db) => {
    const { rows } = await db.query(
      "select storage_key from tracks where owner_id = $1 and storage_key is not null and storage_key not like 'fixtures/%'",
      [user.id],
    );
    for (const r of rows) await db.query("insert into deletion_jobs(storage_key) values ($1)", [r.storage_key]);
    await db.query("select set_config('vibii.allow_owner_delete', 'on', true)");
    await db.query("delete from usage_ledger where owner_id = $1", [user.id]);
    await db.query("delete from profiles where id = $1", [user.id]);
    if (authMode() === "local_demo") await db.query("delete from auth.users where id = $1", [user.id]);
    return rows.map((r) => r.storage_key as string);
  });
  await processDeletionJobs(keys);
  if (authMode() === "supabase" && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    await admin.auth.admin.deleteUser(user.id);
  }
}

export async function processDeletionJobs(only?: string[]) {
  const { rows } = await tx((db) =>
    db.query("select id, storage_key from deletion_jobs where done_at is null and ($1::text[] is null or storage_key = any($1)) limit 100", [only ?? null]),
  );
  for (const r of rows) {
    try {
      await deleteObject(r.storage_key);
      await tx((db) => db.query("update deletion_jobs set done_at = now() where id = $1", [r.id]));
    } catch {
      // stays scheduled; the worker retries
    }
  }
}
