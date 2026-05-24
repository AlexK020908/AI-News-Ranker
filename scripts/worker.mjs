#!/usr/bin/env node
// Background ingest+enrich+cluster worker.
//
// Replaces scripts/loop.ps1 for the Docker stack. Hits the local app's job
// endpoints on a fixed interval. The app and worker share the same image but
// run different commands (see docker-compose.yml).
//
// Env:
//   WORKER_TARGET        Base URL for the app (default http://app:3000)
//   WORKER_INTERVAL_SEC  Loop interval in seconds (default 180 = 3 min)
//                        The ingest route honors sources.poll_interval_sec
//                        per-source, so the worker can tick aggressively
//                        without re-polling slow sources. Sources with
//                        poll_interval_sec=300 will poll every ~5 min;
//                        sources at 3600 still poll hourly.
//   CRON_SECRET          Required — Bearer token for /api/jobs/*
//                        (env var name kept for backward-compat with
//                        existing deploys/schedulers)

const TARGET = process.env.WORKER_TARGET || "http://app:3000";
const INTERVAL_SEC = Math.max(60, Number(process.env.WORKER_INTERVAL_SEC || "180"));
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error("[worker] CRON_SECRET not set — refusing to start");
  process.exit(1);
}

const ENDPOINTS = [
  // Run in order: ingest → enrich → cluster. Each is independent and safe to
  // run alone but the natural pipeline order minimises end-to-end latency.
  // The digest endpoint is idempotent per UTC-day, so calling it every tick
  // is harmless — it no-ops until the next period rolls.
  { name: "ingest",         path: "/api/jobs/ingest",         timeoutMs: 240_000 },
  { name: "enrich",         path: "/api/jobs/enrich",         timeoutMs: 240_000 },
  { name: "cluster-topics", path: "/api/jobs/cluster-topics", timeoutMs: 240_000 },
  { name: "notify",         path: "/api/jobs/notify",         timeoutMs: 60_000  },
  { name: "digest",         path: "/api/jobs/digest",         timeoutMs: 120_000 },
];

async function hit(endpoint) {
  const url = `${TARGET}${endpoint.path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), endpoint.timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error(`[worker] ${endpoint.name} ${resp.status}: ${text.slice(0, 200)}`);
      return;
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log(`[worker] ${endpoint.name}:`, parsed?.summary ?? parsed?.ok ?? "ok");
  } catch (e) {
    console.error(`[worker] ${endpoint.name} failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function once() {
  console.log(`[worker] tick @ ${new Date().toISOString()}`);
  for (const ep of ENDPOINTS) {
    await hit(ep);
  }
}

async function main() {
  console.log(`[worker] target=${TARGET} interval=${INTERVAL_SEC}s`);
  // Run immediately, then on interval — gives a faster signal that the loop is alive.
  await once();
  setInterval(once, INTERVAL_SEC * 1000);
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[worker] received ${sig}, exiting`);
    process.exit(0);
  });
}
