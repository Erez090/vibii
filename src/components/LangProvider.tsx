"use client";
import { createContext, useContext } from "react";
import { t as translate, type Lang, type TKey } from "@/lib/i18n";

const LangCtx = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

export function useT() {
  const lang = useContext(LangCtx);
  return { lang, t: (k: TKey) => translate(lang, k) };
}
