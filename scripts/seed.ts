// Seeds safe demo content: uploads the five locally generated demo loops to private storage
// (shared, non-personal fixtures) and optionally sets the provider mode.
// Usage: npx tsx scripts/seed.ts [--mode demo|manual] [--admin <user-id>]
import { readFileSync } from "node:fs";
import { DEMO_FIXTURES } from "../src/lib/server/providers";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, putObject } from "../src/lib/server/storage";
import { pool } from "../src/lib/server/db";
import { storageMode } from "../src/lib/server/env";

async function ensurePrivateBucket() {
  if (storageMode() !== "supabase") return;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) {
    if (data.public) throw new Error(`bucket ${BUCKET} is public — make it private before storing personal audio`);
    return;
  }
  const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "25MB" });
  if (error) throw new Error(`could not create bucket: ${error.message}`);
  console.log(`created private bucket ${BUCKET}`);
}

async function main() {
  await ensurePrivateBucket();
  for (const f of DEMO_FIXTURES) {
    await putObject(f.storageKey, readFileSync(f.file), "audio/mpeg");
    console.log(`stored ${f.storageKey}`);
  }
  const args = process.argv.slice(2);
  const mode = args[args.indexOf("--mode") + 1];
  if (args.includes("--mode") && ["demo", "manual"].includes(mode)) {
    await pool().query("update provider_configuration set mode = $1, updated_at = now() where id = 1", [mode]);
    console.log(`provider mode → ${mode}`);
  }
  if (args.includes("--admin")) {
    const id = args[args.indexOf("--admin") + 1];
    const r = await pool().query("update profiles set is_admin = true where id = $1", [id]);
    console.log(r.rowCount ? `admin granted to ${id}` : `no profile ${id}`);
  }
  await pool().end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
