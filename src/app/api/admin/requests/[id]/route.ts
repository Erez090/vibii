import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import {
  attachExternalLink, attachUpload, cancelRequest, exportBriefText, reconcileUnknown, recordProviderJob,
  requestDetail, retryAudio, retryCover,
} from "@/lib/server/admin-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const d = await requestDetail(id);
    if (!d) return json({ error: "not_found" }, 404);
    return json({ ...d, exportText: exportBriefText(d.brief) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "file_required" }, 400);
      const trackId = await attachUpload(admin, id, { buf: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name }, {
        source: form.get("source") === "operator_upload" ? "operator_upload" : "suno_manual",
        downloadEvidence: String(form.get("downloadEvidence") ?? ""),
        generationReference: String(form.get("generationReference") ?? "") || undefined,
      });
      return json({ ok: true, trackId });
    }
    const b = await req.json();
    switch (b.action) {
      case "record_job":
        return json({ ok: true, attemptId: await recordProviderJob(admin, id, { providerJobId: String(b.providerJobId ?? ""), note: b.note }) });
      case "external_link":
        return json({ ok: true, trackId: await attachExternalLink(admin, id, String(b.url ?? ""), b.generationReference) });
      case "reconcile":
        await reconcileUnknown(admin, id, { accepted: Boolean(b.accepted), providerJobId: b.providerJobId });
        return json({ ok: true });
      case "cancel":
        await cancelRequest(admin, id);
        return json({ ok: true });
      case "retry_audio":
        await retryAudio(admin, id);
        return json({ ok: true });
      case "retry_cover":
        await retryCover(admin, id);
        return json({ ok: true });
      default:
        return json({ error: "unknown_action" }, 400);
    }
  });
}
