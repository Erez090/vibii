// After a commit: render local covers (cheap, deterministic, no external call) and, in demo mode,
// run one bounded queue tick so demo fixtures are assigned without an always-on worker.
// Real provider work belongs to the separate worker process (npm run worker) or the cron route.
import { pool } from "./db";
import { processCover, tick } from "./pipeline";

export async function kickPipeline() {
  try {
    const { rows } = await pool().query("select request_id from covers where state = 'pending' order by updated_at limit 10");
    for (const r of rows) await processCover(r.request_id);
    // Bounded: demo fixtures are assigned instantly; paid providers are capped by provider_configuration.
    await tick(20); // a seven-song album queues 14 jobs (7 audio + 7 cover)
  } catch (err) {
    console.error("[vibii] kick failed", err instanceof Error ? err.message : "error");
  }
}
