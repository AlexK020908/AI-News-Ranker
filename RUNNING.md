# Running the project

Operational guide for day-to-day dev. Architecture, sources, and stack live
in [README.md](./README.md) — this file just covers "how do I run it".

## TL;DR

```powershell
# Terminal 1 — app
npm install
npm run dev

# Terminal 2 — periodic ingest/enrich/cluster/notify loop
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1
```

Both terminals are required for a working local stack: the dev server hosts
the API endpoints, the loop is what calls them on a schedule.

## Package manager

Standard Next.js scripts — works with npm, pnpm, yarn, or bun.

### npm

```powershell
npm install
npm run dev        # dev server (http://localhost:3000)
npm run build
npm start          # production server
npm run lint
```

### bun

```powershell
bun install        # creates bun.lockb
bun run dev        # or: bun dev
bun run build
bun start
bun run lint
```

Notes:
- `bun run dev` still invokes `next dev` (Node runtime). Bun is just the
  package manager / script runner — not the server runtime.
- If switching from npm → bun, delete `node_modules` and `package-lock.json`
  first to avoid mixed lockfiles.
- This is Next.js 16 with breaking changes (see `AGENTS.md`). Stick with the
  official `next` CLI — don't use experimental `bun --bun next` flags.

## Is this a frontend project?

No — it's a Next.js full-stack app. The split:

- **`app/page.tsx`, `app/item/...`, `app/topic/...`** — UI (Server Components
  by default; `"use client"` files ship to the browser).
- **`app/api/**/route.ts`** — server-side Route Handlers. These run on Node,
  never ship to the browser, and are where secrets (`CRON_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, S3 creds) are used.

The four job endpoints (`/api/jobs/ingest`, `/enrich`, `/cluster-topics`,
`/notify`) live on the same Next.js server as the UI. They're authenticated
with `CRON_SECRET` and meant to be called by an *external scheduler* — not
by the browser.

## What runs ingest?

Ingest is **not** an `npm run` script. It's an HTTP endpoint
(`POST /api/jobs/ingest`) that some scheduler has to hit. You have three
options:

### 1. Local dev — `scripts/loop.ps1`

Long-running PowerShell loop. Reads `CRON_SECRET` from `.env.local` and hits
all four job endpoints every 15 min against `http://localhost:3000`.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1
```

### 2. Docker — `worker` service

`docker compose up` starts a `worker` container running
`node scripts/worker.mjs`. Same loop as `loop.ps1`, but inside the Docker
network hitting `http://app:3000`. Configured via:

- `WORKER_TARGET` — app URL (default `http://app:3000`)
- `WORKER_INTERVAL_SEC` — loop interval, min 60 (default 900 = 15 min)
- `CRON_SECRET` — required bearer token

In production this is what runs ingest. The app stays stateless; the worker
is its own scaling unit.

### 3. External scheduler

The endpoints don't care who calls them. Vercel Cron, GitHub Actions,
Supabase cron, plain cron + curl — any of them works as long as the request
carries `Authorization: Bearer <CRON_SECRET>`.

## Scripts at a glance

| Script | What it does | When to use |
| --- | --- | --- |
| `scripts/loop.ps1` | Continuous loop: ingest → enrich → cluster → notify every 15 min | Local dev, alongside `npm run dev` |
| `scripts/catchup.ps1` | One-shot: drains enrichment backlog (up to 15 rounds of `enrich?limit=100`), then re-clusters | After a long downtime or backfill |
| `scripts/recluster.ps1` | One-shot: re-runs topic clustering | After tuning clustering params |
| `scripts/worker.mjs` | Node version of `loop.ps1` for Docker | Inside the `worker` container |
| `scripts/verify-sources.mjs` | Live-tests every enabled source for reachability + freshness | Before enabling new sources |
| `scripts/verify-pipeline.sql` | Asserts end-to-end pipeline health from the Supabase side | After a full ingest+enrich+cluster cycle |

### Manual single-shot

To hit one endpoint without running the loop:

```powershell
$secret = (Get-Content .env.local | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=',''
Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/ingest" `
  -Headers @{ Authorization = "Bearer $secret" } `
  -TimeoutSec 300
```

Swap `/ingest` for `/enrich`, `/cluster-topics`, or `/notify` as needed.

## Catching up after downtime

The loop is **stateless catch-up by design** — restarting it will pick up
everything published while it was stopped, with two caveats below.

How it works (`lib/ingest/run.ts` + `lib/ingest/write.ts`):

- Every tick re-fetches the *current* feed from every enabled source.
- `upsertItems` uses `onConflict: "url"` with `ignoreDuplicates: true`, so
  already-seen items get silently skipped and new items get inserted.
- There is no "last seen at" cursor — dedup is purely by URL/external_id.

So one fresh tick is enough to backfill everything that's still in each
feed.

### Caveats

1. **Source-side feed window.** RSS / API endpoints only expose the last N
   items (typically 20–50, sometimes only the last 24h). If a high-volume
   source pushed more than its window holds while you were down, the oldest
   items have rolled off the feed and are unrecoverable from this side. For
   a single night offline this is usually fine; for multi-day gaps, expect
   noisy sources (HN, arXiv firehoses) to lose some.
2. **Retention cutoff** (`lib/ingest/retention.ts`). Items with
   `published_at` older than `ITEM_RETENTION_DAYS` (default 14) are filtered
   *before insert* and also pruned from the DB on each ingest tick. Items
   with `published_at = null` are kept (unknown age).

### Recommended catch-up sequence

```powershell
# 1. start the dev server
npm run dev

# 2. one full pipeline tick + enrichment backlog drain
powershell -ExecutionPolicy Bypass -File .\scripts\catchup.ps1

# 3. resume the steady-state loop
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1
```

Note: `catchup.ps1` only re-runs `enrich` and `cluster-topics`. To force a
fresh `ingest` pass first, either hit `/api/jobs/ingest` manually (see
above) or just let `loop.ps1` do its first tick — it runs the full pipeline
immediately on start.

## Required env vars

See `.env.example` for the full list. Minimum for the pipeline to work:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `CRON_SECRET` — must match between `.env.local` and whatever scheduler is
  calling the job endpoints

Optional but recommended: `REDIS_URL` (cache), `S3_*` (thumbnails),
`VOYAGE_API_KEY` (embeddings — without this, semantic dedup falls back to
text-only matching), `DISCORD_WEBHOOK_URL` (high-importance push).
