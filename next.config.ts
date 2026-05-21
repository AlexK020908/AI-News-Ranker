import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trims the prod bundle to only the deps the build actually traced — used by
  // the multi-stage Dockerfile to ship a small image (no dev deps, no tailwind,
  // no eslint).
  output: "standalone",
};

export default nextConfig;
