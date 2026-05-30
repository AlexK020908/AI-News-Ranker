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
  // Serve the OG banner (public/og.png, referenced from app/layout.tsx metadata)
  // with a long immutable cache. headers() are checked before the filesystem, so
  // this reliably overrides the default static Cache-Control for /public assets —
  // giving social scrapers a fast, cacheable 200 instead of re-fetching the bare
  // EC2 origin on every unfurl. See the note in app/layout.tsx for the full
  // rationale (and the rule to version the filename when the banner changes).
  async headers() {
    return [
      {
        source: "/og.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
