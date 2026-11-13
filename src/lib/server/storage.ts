// Private object storage. Supabase Storage (private bucket) when configured, otherwise a local
// directory outside /public. Callers must verify ownership BEFORE asking for a signed URL.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSecret, storageMode } from "./env";

export const BUCKET = process.env.VIBII_STORAGE_BUCKET ?? "vibii-private";
export const SIGNED_URL_TTL_SECONDS = 300;
const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");

let admin: SupabaseClient | null = null;
function supa() {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
  return key;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  safeKey(key);
  if (storageMode() === "supabase") {
    const { error } = await supa().storage.from(BUCKET).upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`storage_upload_failed: ${error.message}`);
    return;
  }
  const file = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
}

export async function deleteObject(key: string) {
  safeKey(key);
  if (storageMode() === "supabase") {
    const { error } = await supa().storage.from(BUCKET).remove([key]);
    if (error) throw new Error(`storage_delete_failed: ${error.message}`);
    return;
  }
  await rm(path.join(LOCAL_ROOT, key), { force: true });
  await rm(path.join(LOCAL_ROOT, `${key}.meta`), { force: true });
}

function sign(key: string, exp: number) {
  return createHmac("sha256", serverSecret()).update(`media:${key}:${exp}`).digest("base64url");
}

export async function signedUrl(key: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<{ url: string; expiresAt: number }> {
  safeKey(key);
  const expiresAt = Date.now() + ttl * 1000;
  if (storageMode() === "supabase") {
    const { data, error } = await supa().storage.from(BUCKET).createSignedUrl(key, ttl);
    if (error || !data) throw new Error("storage_sign_failed");
    return { url: data.signedUrl, expiresAt };
  }
  const exp = Math.floor(expiresAt / 1000);
  return { url: `/api/media?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`, expiresAt };
}

export function verifyLocalSignature(key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(key, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function readLocalObject(key: string) {
  safeKey(key);
  const file = path.join(LOCAL_ROOT, key);
  const [buf, meta, st] = await Promise.all([
    readFile(file),
    readFile(`${file}.meta`, "utf8").then((m) => JSON.parse(m) as { contentType: string }).catch(() => ({ contentType: "application/octet-stream" })),
    stat(file),
  ]);
  return { buf, contentType: meta.contentType, size: st.size };
}
