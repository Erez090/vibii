import { cookies } from "next/headers";
import { getUser } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { recommend, verifiedLinks } from "@/lib/catalog";
import { t, type Lang } from "@/lib/i18n";
import { External } from "@/components/Icons";

export default async function MyVibes() {
  const user = await getUser();
  const lang: Lang = (await cookies()).get("vibii_lang")?.value === "he" ? "he" : "en";
  const answers = user
    ? await tx(async (db) => (await db.query("select category, value from onboarding_answers where owner_id = $1 and category in ('genres','moments') and not skipped", [user.id])).rows)
    : [];
  const genres = (answers.find((a) => a.category === "genres")?.value.genres as string[]) ?? [];
  const moments = (answers.find((a) => a.category === "moments")?.value.moments as string[]) ?? [];
  const items = recommend({ genres, moments });

  return (
    <section>
      <p className="mb-4 text-sm text-muted">{t(lang, "vibesIntro")}</p>
      <ul className="space-y-3">
        {items.map((item) => {
          const links = verifiedLinks(item);
          return (
            <li key={item.id} className="overflow-hidden rounded-2xl border border-line bg-white/[0.04]">
              {item.art && (
                <figure className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.art.src} alt={`${item.title} — concept illustration`} className="aspect-[16/10] w-full object-cover object-center" />
                  <figcaption className="absolute start-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-lavender">{t(lang, "conceptArt")}</figcaption>
                </figure>
              )}
              <div className="p-4">
                <h2 className="text-xl font-semibold">{item.title}</h2>
                <p className="text-lavender">{item.artist}</p>
                <p className="mt-2 text-sm text-muted">{item.reason[lang]}</p>
                <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted">
                  {[...item.genres, item.energy, ...item.moments].map((tag) => (
                    <span key={tag} className="rounded-full border border-line px-2 py-0.5">{tag.replace("_", " ")}</span>
                  ))}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {links.length ? links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm hover:bg-white/5">
                      <External width={16} height={16} /> {t(lang, "openIn")} {l.service}
                    </a>
                  )) : <span className="text-xs text-muted">{t(lang, "unverifiedLink")}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
