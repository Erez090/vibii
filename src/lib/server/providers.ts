// Small provider contract: submit, getStatus, resolveAuthorizedAsset.
// Only the demo (labelled local fixtures) and manual (operator) paths are implemented.
// official_api stays visibly unavailable: Suno's API portal (platform.suno.com, checked 2026-11-01)
// documents no request schema, auth method, pricing or limits for this account, so no endpoint,
// tool name, price or response format is invented here.
import type { Brief } from "../creative/brief";

export type ProviderMode = "demo" | "manual" | "official_api";
export type ProviderId = "demo_fixture" | "suno_manual" | "suno_api";

export interface ProviderCapabilities {
  automated: boolean;
  officialDownload: boolean; // provider grants a permitted download of the audio file
  externalLink: boolean;     // provider can deliver a link to its own player
  idempotency: boolean;      // provider de-duplicates a repeated submission key
  webhook: boolean;
}

export type SubmitResult =
  | { kind: "accepted"; jobId: string }
  | { kind: "awaiting_operator" }
  | { kind: "rejected"; code: string; retryable: boolean };

export type JobStatus =
  | { state: "processing" }
  | { state: "succeeded"; candidates: { ref: string }[] }
  | { state: "failed"; code: string; retryable: boolean };

export type AuthorizedAsset =
  | { kind: "stored"; storageKey: string; mimeType: string; durationSeconds: number; label: string }
  | { kind: "external"; url: string; service: string };

/** Thrown when the transport failed in a way where the provider MAY have accepted the request. */
export class ProviderTransportError extends Error {
  constructor(message: string, readonly maybeAccepted: boolean) {
    super(message);
  }
}

export interface Provider {
  id: ProviderId;
  mode: ProviderMode;
  capabilities: ProviderCapabilities;
  availability(): { ok: boolean; reason?: string };
  submit(input: { brief: Brief; submissionKey: string; slot: number | null }): Promise<SubmitResult>;
  getStatus(jobId: string): Promise<JobStatus>;
  resolveAuthorizedAsset(jobId: string, candidateRef: string): Promise<AuthorizedAsset>;
}

// ------------------------------------------------------------------ demo fixtures
// Locally generated instrumental loops (scripts/make-demo-audio.sh). Not Suno output; labelled in UI.
export const DEMO_FIXTURES = [1, 2, 3, 4, 5].map((n) => ({
  storageKey: `fixtures/demo-loop-${n}.mp3`,
  file: `fixtures/audio/demo-loop-${n}.mp3`,
  durationSeconds: 48,
}));
export const DEMO_LABEL = "Demo loop · locally generated instrumental, not a Suno song";

export const demoProvider: Provider = {
  id: "demo_fixture",
  mode: "demo",
  capabilities: { automated: true, officialDownload: true, externalLink: false, idempotency: true, webhook: false },
  availability: () => ({ ok: true }),
  async submit({ submissionKey, slot }) {
    return { kind: "accepted", jobId: `demo:${slot ?? 0}:${submissionKey}` };
  },
  async getStatus(jobId) {
    return { state: "succeeded", candidates: [{ ref: jobId.split(":")[1] ?? "0" }] };
  },
  async resolveAuthorizedAsset(jobId, ref) {
    let idx = Number(ref) - 1;
    if (!(idx >= 0 && idx < DEMO_FIXTURES.length)) {
      let h = 0;
      for (const c of jobId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      idx = h % DEMO_FIXTURES.length;
    }
    const f = DEMO_FIXTURES[idx];
    return { kind: "stored", storageKey: f.storageKey, mimeType: "audio/mpeg", durationSeconds: f.durationSeconds, label: DEMO_LABEL };
  },
};

export const manualProvider: Provider = {
  id: "suno_manual",
  mode: "manual",
  capabilities: { automated: false, officialDownload: false, externalLink: true, idempotency: false, webhook: false },
  availability: () => ({ ok: true }),
  async submit() {
    return { kind: "awaiting_operator" };
  },
  async getStatus() {
    return { state: "processing" };
  },
  async resolveAuthorizedAsset() {
    throw new Error("manual provider assets are attached by an operator");
  },
};

export const officialApiProvider: Provider = {
  id: "suno_api",
  mode: "official_api",
  capabilities: { automated: true, officialDownload: false, externalLink: false, idempotency: false, webhook: false },
  availability: () => ({
    ok: false,
    reason:
      "Unavailable: no documented Suno API schema, server credentials, limits or provider agreement are recorded for this deployment.",
  }),
  async submit() {
    throw new ProviderTransportError("official_api_unavailable", false);
  },
  async getStatus() {
    return { state: "failed", code: "official_api_unavailable", retryable: false };
  },
  async resolveAuthorizedAsset() {
    throw new Error("official_api_unavailable");
  },
};

const overrides: Partial<Record<ProviderMode, Provider>> = {};
/** Test hook: swap a provider implementation (never used by app code). */
export function __setProviderForTests(mode: ProviderMode, p: Provider | null) {
  if (p) overrides[mode] = p;
  else delete overrides[mode];
}

export function providerFor(mode: ProviderMode): Provider {
  return overrides[mode] ?? (mode === "demo" ? demoProvider : mode === "manual" ? manualProvider : officialApiProvider);
}

// ------------------------------------------------------------------ art provider
export interface ArtProvider {
  render(input: { scene: string; palette: string[]; seed: string }): Promise<{ svg?: string; storageKey?: string }>;
}
let artProvider: ArtProvider | null = null; // none configured; local illustrations are the default
export function __setArtProviderForTests(p: ArtProvider | null) {
  artProvider = p;
}
export function configuredArtProvider() {
  return artProvider;
}
