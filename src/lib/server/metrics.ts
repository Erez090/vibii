// Operator metrics with numerators/denominators and date windows. Demo/admin users excluded.
// Targets are experiment configuration, not results.
import { pool } from "./db";

export const TARGETS = {
  onboardingCompletion: 0.7,
  activation: 0.6,
  sameTrackReturn: 0.4,
  weekTwoListening: 0.4,
  renewal: 0.5,
};

export interface Ratio {
  key: keyof typeof TARGETS | "candidateAcceptance";
  label: string;
  numerator: number;
  denominator: number;
  target: number | null;
  from: string;
  to: string;
  note?: string;
}

const REAL = "p.is_demo = false and p.is_admin = false";

export async function computeMetrics(from: Date, to: Date): Promise<{ ratios: Ratio[]; costs: Record<string, unknown>; latency: Record<string, unknown>[] }> {
  const db = pool();
  const f = from.toISOString(), t = to.toISOString();
  const one = async (sql: string) => (await db.query(sql, [f, t])).rows[0];

  const onboarding = await one(`
    select count(*) filter (where o.started_at between $1 and $2)::int as d,
           count(*) filter (where o.started_at between $1 and $2 and o.completed_at is not null)::int as n
    from onboarding_state o join profiles p on p.id = o.owner_id where ${REAL}`);

  // Activation: 60s listened + one liked song within 48h of first track availability.
  const activation = await one(`
    with first_ready as (
      select pl.owner_id, pl.released_at as ready_at from playlists pl join profiles p on p.id = pl.owner_id
      where pl.kind = 'starter' and pl.released_at between $1 and $2 and ${REAL})
    select count(*)::int as d,
      count(*) filter (where
        (select coalesce(sum(listened_seconds),0) from listening_events le where le.owner_id = fr.owner_id and le.occurred_at between fr.ready_at and fr.ready_at + interval '48 hours') >= 60
        and exists (select 1 from feedback fb where fb.owner_id = fr.owner_id and fb.action = 'like' and fb.created_at between fr.ready_at and fr.ready_at + interval '48 hours'))::int as n
    from first_ready fr`);

  const sameTrack = await one(`
    with first_ready as (
      select pl.owner_id, pl.released_at as ready_at from playlists pl join profiles p on p.id = pl.owner_id
      where pl.kind = 'starter' and pl.released_at between $1 and $2 and ${REAL})
    select count(*)::int as d,
      count(*) filter (where exists (
        select 1 from listening_events a join listening_events b on a.track_id = b.track_id and a.owner_id = b.owner_id
        where a.owner_id = fr.owner_id and a.event = 'playback_started' and b.event = 'playback_started'
          and a.occurred_at::date <> b.occurred_at::date
          and a.occurred_at between fr.ready_at and fr.ready_at + interval '14 days'
          and b.occurred_at between fr.ready_at and fr.ready_at + interval '14 days'))::int as n
    from first_ready fr`);

  const weekTwo = await one(`
    with first_ready as (
      select pl.owner_id, pl.released_at as ready_at from playlists pl join profiles p on p.id = pl.owner_id
      where pl.kind = 'starter' and pl.released_at between $1 and $2 and ${REAL})
    select count(*)::int as d,
      count(*) filter (where (select coalesce(sum(listened_seconds),0) from listening_events le where le.owner_id = fr.owner_id
        and le.occurred_at between fr.ready_at + interval '7 days' and fr.ready_at + interval '14 days') >= 120)::int as n
    from first_ready fr`);

  const renewal = await one(`
    select count(distinct e.owner_id) filter (where e.source in ('subscription','pilot_external_payment'))::int as d,
           count(distinct e2.owner_id)::int as n
    from entitlements e join profiles p on p.id = e.owner_id
    left join entitlements e2 on e2.owner_id = e.owner_id and e2.source = e.source and e2.created_at > e.created_at + interval '25 days'
    where e.created_at between $1 and $2 and ${REAL} and e.source in ('subscription','pilot_external_payment')`);

  const candidates = await one(`
    select count(*) filter (where t.status in ('approved','rejected'))::int as d, count(*) filter (where t.status = 'approved')::int as n
    from tracks t join profiles p on p.id = t.owner_id where t.created_at between $1 and $2 and t.source <> 'demo_fixture' and ${REAL}`);

  const costs = await one(`
    select count(*)::int as attempts, coalesce(sum(estimated_cost_credits),0) as estimated_credits,
      coalesce(sum(actual_cost_credits),0) as actual_credits,
      count(*) filter (where monetary_cost_known)::int as attempts_with_known_money,
      coalesce(sum(monetary_cost_usd),0) as known_usd
    from generation_attempts a join profiles p on p.id = a.owner_id where a.created_at between $1 and $2 and a.provider <> 'demo_fixture' and ${REAL}`);

  const latency = (await db.query(`
    with x as (
      select r.provider_mode as mode, extract(epoch from (pl.released_at - o.completed_at)) as final_to_ready,
             extract(epoch from (pl.released_at - o.started_at)) as first_q_to_ready,
             extract(epoch from (o.completed_at - o.started_at)) as interview
      from playlists pl join onboarding_state o on o.owner_id = pl.owner_id join profiles p on p.id = pl.owner_id
      join lateral (select provider_mode from generation_requests where playlist_id = pl.id limit 1) r on true
      where pl.kind = 'starter' and pl.released_at between $1 and $2 and ${REAL})
    select mode, count(*)::int as n,
      percentile_cont(0.5) within group (order by interview) as interview_p50, percentile_cont(0.9) within group (order by interview) as interview_p90,
      percentile_cont(0.5) within group (order by final_to_ready) as final_to_ready_p50, percentile_cont(0.9) within group (order by final_to_ready) as final_to_ready_p90,
      percentile_cont(0.5) within group (order by first_q_to_ready) as first_q_to_ready_p50, percentile_cont(0.9) within group (order by first_q_to_ready) as first_q_to_ready_p90
    from x group by mode`, [f, t])).rows;

  const r = (key: Ratio["key"], label: string, row: { n: number; d: number }, note?: string): Ratio => ({
    key, label, numerator: row.n, denominator: row.d, target: key in TARGETS ? TARGETS[key as keyof typeof TARGETS] : null, from: f, to: t, note,
  });
  return {
    ratios: [
      r("onboardingCompletion", "Onboarding completion (completed / started)", onboarding),
      r("activation", "Activation (≥60s listened + 1 like within 48h of first playlist ready)", activation),
      r("sameTrackReturn", "Same-track return on another day within 14 days", sameTrack),
      r("weekTwoListening", "Week-two listening (≥2 min in days 8–14)", weekTwo),
      r("renewal", "Second-month renewal among eligible subscribers", renewal, "Billing disabled: counts admin-recorded pilot payments only."),
      r("candidateAcceptance", "Candidate acceptance (approved / reviewed)", candidates),
    ],
    costs: { ...costs, monetary_cost_note: "Monetary provider cost is unknown unless recorded per attempt; credit/call caps are enforced instead." },
    latency,
  };
}
