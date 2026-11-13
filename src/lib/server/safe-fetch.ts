// Server-side download of PERMITTED provider files only. Explicit host allowlist, https only,
// no internal/private IPs, redirects re-validated hop by hop, timeout and size limits.
// Arbitrary listener-supplied reference URLs are never fetched.
import { lookup } from "node:dns/promises";
import net from "node:net";

export const DOWNLOAD_ALLOWLIST = (process.env.VIBII_DOWNLOAD_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

export function isPrivateAddress(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

export async function assertSafeUrl(raw: string, allowlist = DOWNLOAD_ALLOWLIST) {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("https_required");
  if (u.username || u.password) throw new Error("credentials_in_url");
  if (!allowlist.includes(u.hostname)) throw new Error("host_not_allowed");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private_address");
  return u;
}

export async function safeDownload(raw: string, opts: { maxBytes: number; timeoutMs: number; allowlist?: string[] }) {
  let url = raw;
  for (let hop = 0; hop < 3; hop++) {
    await assertSafeUrl(url, opts.allowlist);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, { redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("bad_redirect");
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > opts.maxBytes) throw new Error("too_large");
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          ctrl.abort();
          throw new Error("too_large");
        }
        chunks.push(value);
      }
      return { buf: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "" };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too_many_redirects");
}
