import type { Db } from "./db";

export async function audit(
  db: Db,
  e: { actorId?: string | null; action: string; targetType?: string; targetId?: string; details?: Record<string, unknown> },
) {
  await db.query(
    "insert into audit_events(actor_id, action, target_type, target_id, details) values ($1,$2,$3,$4,$5)",
    [e.actorId ?? null, e.action, e.targetType ?? null, e.targetId ?? null, JSON.stringify(e.details ?? {})],
  );
}

/** Persisted, audited request state change. Returns false if the request was not in an allowed source state. */
export async function setRequestState(
  db: Db,
  requestId: string,
  to: string,
  opts: { from?: string[]; actor: string; note?: string; errorCode?: string | null } ,
): Promise<boolean> {
  const { rows } = await db.query(
    `update generation_requests r set state = $2, error_code = coalesce($4, case when $2 in ('failed','unknown_submission') then r.error_code else null end),
       ready_at = case when $2 = 'ready' then now() else r.ready_at end, updated_at = now()
     from (select id, state as prev from generation_requests where id = $1 for update) p
     where r.id = p.id and ($3::text[] is null or p.prev = any($3::text[]))
     returning p.prev, r.owner_id`,
    [requestId, to, opts.from ?? null, opts.errorCode ?? null],
  );
  if (!rows.length) return false;
  await db.query(
    "insert into generation_request_events(request_id, owner_id, from_state, to_state, actor, note) values ($1,$2,$3,$4,$5,$6)",
    [requestId, rows[0].owner_id, rows[0].prev, to, opts.actor, opts.note ?? null],
  );
  return true;
}
