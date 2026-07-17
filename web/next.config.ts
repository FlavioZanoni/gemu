import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so local builds can avoid a .next owned by the docker dev
  // container (NEXT_DIST_DIR=.next-local npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
