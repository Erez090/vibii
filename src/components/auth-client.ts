"use client";

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" });
  window.location.href = "/login";
}

export async function setLanguage(lang: "en" | "he") {
  document.cookie = `vibii_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
  await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ uiLanguage: lang }) }).catch(() => {});
  window.location.reload();
}
