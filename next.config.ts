import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trims the prod bundle to only the deps the build actually traced — used by
  // the multi-stage Dockerfile to ship a small image (no dev deps, no tailwind,
  // no eslint).
  output: "standalone",
  // The crawler reaches Playwright via a dynamic import() that the tracer can
  // miss, so force its JS into the ingest route's standalone bundle. The
  // Chromium *binary* lives outside node_modules (PLAYWRIGHT_BROWSERS_PATH /
  // ~/.cache/ms-playwright) and is NOT traced — it must be installed on the
  // host (`npx playwright install chromium`). See lib/ingest/crawler.ts.
  outputFileTracingIncludes: {
    "/api/jobs/ingest": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
};

export default nextConfig;
