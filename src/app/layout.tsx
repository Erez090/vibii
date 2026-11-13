import type { Metadata, Viewport } from "next";
import { Quicksand, Rubik } from "next/font/google";
import { cookies } from "next/headers";
import { dirFor, type Lang } from "@/lib/i18n";
import { LangProvider } from "@/components/LangProvider";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin", "hebrew"], display: "swap" });
const quicksand = Quicksand({ variable: "--font-quicksand", subsets: ["latin"], weight: ["500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Vibii",
  description: "Your life. Your sound. Just press play.",
  applicationName: "Vibii",
  appleWebApp: { capable: true, title: "Vibii", statusBarStyle: "black-translucent" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#120d1f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang: Lang = (await cookies()).get("vibii_lang")?.value === "he" ? "he" : "en";
  return (
    <html lang={lang} dir={dirFor(lang)} className={`${rubik.variable} ${quicksand.variable}`}>
      <body className="min-h-dvh antialiased">
        <LangProvider lang={lang}>{children}</LangProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
