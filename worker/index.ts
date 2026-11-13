// Separate worker process: claims jobs from the PostgreSQL queue with a lease, recovers expired
// leases, and processes deletion jobs. Run with: npm run worker (needs DATABASE_URL).
// With VIBII_AGENT_RUNNER=on it also runs the Suno agent jobs (one headless Claude Code agent per song),
// VIBII_WORKER_CONCURRENCY loops in parallel (default 3), each bounded by provider_configuration caps.
import { randomUUID } from "node:crypto";
import { claimJob, runJob } from "../src/lib/server/pipeline";
import { processDeletionJobs } from "../src/lib/server/account";
import { pool } from "../src/lib/server/db";
import { agentRunnerEnabled } from "../src/lib/server/suno-agent";

const base = `worker-${randomUUID().slice(0, 8)}`;
const loops = Math.max(1, Math.min(8, Number(process.env.VIBII_WORKER_CONCURRENCY ?? 3)));
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function loop(i: number) {
  const workerId = `${base}-${i}`;
  let idle = 0;
  while (!stopping) {
    const job = await claimJob(workerId).catch((e) => {
      console.error(`[vibii] ${workerId} claim failed`, e.message);
      return null;
    });
    if (job) {
      idle = 0;
      const t0 = Date.now();
      console.log(`[vibii] ${workerId} job ${job.id} ${job.kind} request ${job.request_id} attempt ${job.attempts}`);
      await runJob(job, workerId);
      console.log(`[vibii] ${workerId} job ${job.id} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
      continue;
    }
    if (i === 0 && ++idle % 30 === 0) await processDeletionJobs().catch(() => {});
    else if (i !== 0) idle++;
    await new Promise((r) => setTimeout(r, Math.min(5000, 500 * idle)));
  }
}

async function main() {
  console.log(`[vibii] ${base} started: ${loops} loops, Suno agent ${agentRunnerEnabled() ? "ON" : "off"}`);
  await Promise.all(Array.from({ length: loops }, (_, i) => loop(i)));
  await pool().end();
  console.log(`[vibii] ${base} stopped`);
}
main();
