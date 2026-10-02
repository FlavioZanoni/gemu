import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so local builds can avoid a .next owned by the docker dev
  // container (NEXT_DIST_DIR=.next-local npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: __dirname,
  },
  // Gemu runs as an awful.chat app: any instance may frame it (awful-contract
  // §3). Never send X-Frame-Options; a proxy in front must not add one either.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
