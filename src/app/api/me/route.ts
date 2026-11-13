import { requireUser } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";
import { handle, json, rateLimit } from "@/lib/server/http";
import { asUser, tx } from "@/lib/server/db";
import { balances } from "@/lib/server/ledger";
import { deleteAccount } from "@/lib/server/account";

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    const b = await tx((db) => balances(db, u.id));
    return json({ user: { id: u.id, email: u.email, isAdmin: u.isAdmin, isDemo: u.isDemo, uiLanguage: u.uiLanguage, displayName: u.displayName }, balances: b, authMode: authMode() });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const body = await req.json();
    const lang = body.uiLanguage === "he" ? "he" : body.uiLanguage === "en" ? "en" : null;
    const name = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 40) : null;
    const songLangs = Array.isArray(body.songLanguages) ? body.songLanguages.map(String).slice(0, 3) : null;
    await asUser(u.id, (db) =>
      db.query("update profiles set ui_language = coalesce($2, ui_language), display_name = coalesce($3, display_name), song_languages = coalesce($4, song_languages), updated_at = now() where id = $1", [u.id, lang, name, songLangs]),
    );
    return json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`delete:${u.id}`, 3, 3600);
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== "DELETE") return json({ error: "confirmation_required" }, 400);
    await deleteAccount(u);
    return json({ ok: true });
  });
}
