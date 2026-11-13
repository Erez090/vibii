import { readLocalObject, verifyLocalSignature } from "@/lib/server/storage";
import { storageMode } from "@/lib/server/env";

// Local-storage signed media with HTTP Range support (seeking). Never cached by shared caches.
export async function GET(req: Request) {
  if (storageMode() !== "local") return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyLocalSignature(key, exp, sig)) return new Response("expired or invalid signature", { status: 403 });
  let obj;
  try {
    obj = await readLocalObject(key);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "content-type": obj.contentType, "accept-ranges": "bytes", "cache-control": "private, no-store",
  };
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, obj.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), obj.size - 1) : obj.size - 1;
    if (start > end || start >= obj.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${obj.size}` } });
    return new Response(new Uint8Array(obj.buf.subarray(start, end + 1)), {
      status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${obj.size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(obj.buf), { headers: { ...headers, "content-length": String(obj.size) } });
}
