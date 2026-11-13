"use client";
import { useEffect } from "react";

// Registers the shell-only service worker (see public/sw.js). Audio and API responses are never cached.
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
