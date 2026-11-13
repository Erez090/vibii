// Separate worker process: claims jobs from the PostgreSQL queue with a lease, recovers expired
// leases, and processes deletion jobs. Run with: npm run worker (needs DATABASE_URL).
// Manual mode does not need this process at all.
import { randomUUID } from "node:crypto";
import { claimJob, runJob } from "../src/lib/server/pipeline";
import { processDeletionJobs } from "../src/lib/server/account";
import { pool } from "../src/lib/server/db";

const workerId = `worker-${randomUUID().slice(0, 8)}`;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  console.log(`[vibii] ${workerId} started`);
  let idle = 0;
  while (!stopping) {
    const job = await claimJob(workerId).catch((e) => {
      console.error("[vibii] claim failed", e.message);
      return null;
    });
    if (job) {
      idle = 0;
      console.log(`[vibii] job ${job.id} ${job.kind} attempt ${job.attempts}`);
      await runJob(job, workerId);
      continue;
    }
    if (++idle % 30 === 0) await processDeletionJobs().catch(() => {});
    await new Promise((r) => setTimeout(r, Math.min(5000, 500 * idle)));
  }
  await pool().end();
  console.log(`[vibii] ${workerId} stopped`);
}
main();
