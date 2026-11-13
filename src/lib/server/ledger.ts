// Entitlements and the append-only usage ledger. Every entry has a unique event_key, so retries,
// concurrent sessions and duplicate callbacks cannot apply a grant/reserve/consume/release twice.
import type { Db } from "./db";
import { CREDITS_PER_CATEGORY, CREDITS_PER_SONG, WELCOME_CREDITS } from "../onboarding";

export type Unit = "starter_album" | "song" | "credit";

export async function insertLedger(
  db: Db,
  e: { ownerId: string; unit: Unit; entry: string; amount: number; requestId?: string | null; key: string; note?: string },
): Promise<boolean> {
  const res = await db.query(
    `insert into usage_ledger(owner_id, unit, entry, amount, request_id, event_key, note)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (event_key) do nothing`,
    [e.ownerId, e.unit, e.entry, e.amount, e.requestId ?? null, e.key, e.note ?? null],
  );
  return res.rowCount === 1;
}

export interface Balances {
  songsAvailable: number;
  songsReserved: number;
  credits: number;
  starterAvailable: number;
}

export async function balances(db: Db, ownerId: string): Promise<Balances> {
  const { rows } = await db.query(
    `select unit, entry, coalesce(sum(amount),0)::int as total from usage_ledger where owner_id = $1 group by unit, entry`,
    [ownerId],
  );
  const v = (unit: string, entry: string) => rows.find((r) => r.unit === unit && r.entry === entry)?.total ?? 0;
  const reservedSongs = v("song", "reserve") - v("song", "consume") - v("song", "release");
  return {
    songsAvailable: v("song", "grant") - v("song", "reserve") + v("song", "release"),
    songsReserved: Math.max(0, reservedSongs),
    credits: v("credit", "award") - v("credit", "spend"),
    starterAvailable: v("starter_album", "grant") - v("starter_album", "reserve") + v("starter_album", "release"),
  };
}

/** Serialises ledger decisions per owner inside the current transaction. */
export async function lockOwner(db: Db, ownerId: string) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`ledger:${ownerId}`]);
}

/** One-time grants keyed by verified identity (survives account deletion + re-registration). */
async function claimIdentityGrant(db: Db, identityKey: string, grantKey: string) {
  const res = await db.query(
    "insert into grant_identities(identity_key, grant_key) values ($1,$2) on conflict do nothing",
    [identityKey, grantKey],
  );
  return res.rowCount === 1;
}

export async function awardWelcomeCredits(db: Db, ownerId: string, identityKey: string) {
  if (!(await claimIdentityGrant(db, identityKey, "welcome_credits"))) return false;
  return insertLedger(db, { ownerId, unit: "credit", entry: "award", amount: WELCOME_CREDITS, key: `welcome:${identityKey}`, note: "welcome" });
}

export async function awardCategoryCredits(db: Db, ownerId: string, identityKey: string, category: string) {
  if (!(await claimIdentityGrant(db, identityKey, `category:${category}`))) return false;
  return insertLedger(db, {
    ownerId, unit: "credit", entry: "award", amount: CREDITS_PER_CATEGORY, key: `category:${identityKey}:${category}`, note: category,
  });
}

/** Starter album entitlement: once per verified identity. Returns false if already granted. */
export async function grantAndReserveStarter(db: Db, ownerId: string, identityKey: string, playlistId: string) {
  await lockOwner(db, ownerId);
  if (await claimIdentityGrant(db, identityKey, "starter_album")) {
    await insertLedger(db, { ownerId, unit: "starter_album", entry: "grant", amount: 1, key: `starter_grant:${identityKey}` });
  }
  const b = await balances(db, ownerId);
  if (b.starterAvailable < 1) return false;
  return insertLedger(db, { ownerId, unit: "starter_album", entry: "reserve", amount: 1, key: `starter_reserve:${playlistId}` });
}

export async function grantSongs(
  db: Db,
  e: { ownerId: string; quantity: number; source: string; grantKey: string; period?: string; note?: string; grantedBy?: string },
) {
  const res = await db.query(
    `insert into entitlements(owner_id, kind, source, quantity, period, grant_key, note, granted_by)
     values ($1,'song',$2,$3,$4,$5,$6,$7) on conflict (grant_key) do nothing`,
    [e.ownerId, e.source, e.quantity, e.period ?? null, e.grantKey, e.note ?? null, e.grantedBy ?? null],
  );
  if (res.rowCount !== 1) return false;
  return insertLedger(db, { ownerId: e.ownerId, unit: "song", entry: "grant", amount: e.quantity, key: `grant:${e.grantKey}` });
}

/** Spend 100 wallet credits for one song entitlement. */
export async function redeemCredits(db: Db, ownerId: string, redemptionKey: string) {
  await lockOwner(db, ownerId);
  const b = await balances(db, ownerId);
  if (b.credits < CREDITS_PER_SONG) return { ok: false as const, reason: "insufficient_credits" };
  const spent = await insertLedger(db, { ownerId, unit: "credit", entry: "spend", amount: CREDITS_PER_SONG, key: `redeem:${redemptionKey}` });
  if (!spent) return { ok: true as const, duplicate: true };
  await grantSongs(db, { ownerId, quantity: 1, source: "credit_redemption", grantKey: `redeem:${redemptionKey}` });
  return { ok: true as const, duplicate: false };
}

export async function reserveSong(db: Db, ownerId: string, requestId: string) {
  await lockOwner(db, ownerId);
  const b = await balances(db, ownerId);
  if (b.songsAvailable < 1) return false;
  return insertLedger(db, { ownerId, unit: "song", entry: "reserve", amount: 1, requestId, key: `reserve:${requestId}` });
}

/** Consume exactly once; never after a release. */
export async function consumeReservation(db: Db, ownerId: string, requestId: string, unit: "song" | "starter_album", reserveKey: string) {
  await lockOwner(db, ownerId);
  const { rows } = await db.query(
    "select event_key from usage_ledger where event_key = any($1)",
    [[reserveKey, `release:${requestId}`, `consume:${requestId}`]],
  );
  const keys = new Set(rows.map((r) => r.event_key));
  if (!keys.has(reserveKey) || keys.has(`release:${requestId}`)) return false;
  return insertLedger(db, { ownerId, unit, entry: "consume", amount: 1, requestId, key: `consume:${requestId}` });
}

/** Release exactly once on terminal failure/cancel; never after a consume. */
export async function releaseReservation(db: Db, ownerId: string, requestId: string, unit: "song" | "starter_album", reserveKey: string) {
  await lockOwner(db, ownerId);
  const { rows } = await db.query(
    "select event_key from usage_ledger where event_key = any($1)",
    [[reserveKey, `release:${requestId}`, `consume:${requestId}`]],
  );
  const keys = new Set(rows.map((r) => r.event_key));
  if (!keys.has(reserveKey) || keys.has(`consume:${requestId}`)) return false;
  return insertLedger(db, { ownerId, unit, entry: "release", amount: 1, requestId, key: `release:${requestId}` });
}

export async function consumeStarter(db: Db, ownerId: string, playlistId: string) {
  await lockOwner(db, ownerId);
  return insertLedger(db, { ownerId, unit: "starter_album", entry: "consume", amount: 1, key: `starter_consume:${playlistId}` });
}
