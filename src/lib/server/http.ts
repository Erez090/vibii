import { NextResponse } from "next/server";
import { pool } from "./db";
import { HttpError } from "./auth";
import { AdminError } from "./admin-service";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Maps errors to safe codes. Never echoes secrets, SQL or stack traces to the client. */
export function handle(fn: () => Promise<Response>) {
  return fn().catch((err: unknown) => {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    if (err instanceof AdminError) return json({ error: err.message }, 400);
    if (err instanceof RateLimitError) return json({ error: "rate_limited" }, 429);
    const code = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : "server_error";
    if (code === "server_error") console.error("[vibii] unhandled", err instanceof Error ? err.name : typeof err);
    return json({ error: code }, code === "server_error" ? 500 : 400);
  });
}

export class RateLimitError extends Error {}

/** Fixed-window limiter stored in Postgres (works across serverless instances). */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const { rows } = await pool().query(
    `insert into rate_limits(bucket, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (bucket, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [bucket, windowSeconds],
  );
  if (rows[0].count > limit) throw new RateLimitError();
}
