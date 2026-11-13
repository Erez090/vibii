// Smoke test for the Suno agent: runs ONE real headless Claude Code agent for a sample brief.
// Without a Suno sign-in it should end with a clean VIBII_ERROR. With --create it really creates
// (and stores) one song on your Suno account (~10 credits).
// Usage: npx tsx --env-file=.env.local scripts/agent-smoke.ts [--create]
import { buildBrief } from "../src/lib/creative/brief";
import { planAlbum } from "../src/lib/creative/planner";
import { buildAgentPrompt, parseAgentOutput, runClaudeAgent, storeSunoAudio, sunoTag } from "../src/lib/server/suno-agent";

const create = process.argv.includes("--create");
const plan = planAlbum(
  { genres: { value: { genres: ["pop"] }, skipped: false, isPrivate: false }, moments: { value: { moments: ["drive"] }, skipped: false, isPrivate: false } },
  { personalDetails: true, providerProcessing: true },
  1,
);
const slot = plan.slots[1];
const brief = { ...buildBrief(slot), plan: slot };
let prompt = buildAgentPrompt(brief, sunoTag(`smoke:${Date.now()}`));
if (!create) {
  prompt = `SMOKE TEST — do NOT create any song and do not call any tool that creates or spends credits.
Only check whether you have Suno tools available. If you do, list their names and finish with:
VIBII_ERROR {"code":"smoke_ok","message":"<comma-separated Suno tool names>","retryable":false}
If you have no Suno tools, finish with:
VIBII_ERROR {"code":"suno_not_connected","message":"no Suno MCP tools available","retryable":false}`;
}

async function main() {
  const t0 = Date.now();
  const text = await runClaudeAgent(prompt, { timeoutMs: 10 * 60 * 1000 });
  console.log(`agent finished in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(text.slice(-1200));
  try {
    const out = parseAgentOutput(text);
    console.log("RESULT", out);
    if (create) console.log("stored", await storeSunoAudio(out, `agent/smoke-${out.sunoId}.mp3`));
  } catch (e) {
    console.log("OUTCOME", (e as { code?: string }).code, (e as Error).message);
  }
}
main();
