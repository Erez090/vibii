import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the E2E server run beside a normal dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    // A stray package-lock.json in the home directory would otherwise make Turbopack watch all of $HOME.
    root: process.cwd(),
  },
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
