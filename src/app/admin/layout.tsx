import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) notFound(); // admin role comes from server-managed data only
  return (
    <div dir="ltr" className="mx-auto min-h-dvh max-w-5xl px-4 py-6 text-[15px]">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <Link href="/admin" className="logo-text text-3xl font-medium">Vibii</Link>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-lavender">operator console</span>
        <nav className="ms-auto flex gap-4 text-sm">
          <Link href="/admin">Requests</Link>
          <Link href="/admin/metrics">Metrics</Link>
          <Link href="/">App</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
