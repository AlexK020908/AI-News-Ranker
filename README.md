# AI News Ranker

AI-focused news aggregator that ranks, summarizes, deduplicates, and **groups
related coverage** into story panels in real time.

## How it works

StackBrief turns ~130 AI sources into a deduplicated, ranked feed where each
story appears **once** — no matter how many outlets cover it. A worker drives
four job endpoints in sequence; the Next.js app serves the result.

1. **Ingest** (`/api/jobs/ingest`) — Polls every enabled source on its own
   cadence (`poll_interval_sec`): RSS/Atom via `rss-parser`, JS-free HTML via a
   config-driven `cheerio` crawler (headless Chromium for SPAs), plus dedicated
   adapters for arXiv, GitHub trending, Hacker News, and Hugging Face. New items
   are deduped by URL and written to Postgres; anything past the retention
   window (14 days by default) is pruned.

2. **Enrich** (`/api/jobs/enrich`) — Each new item runs through Claude Haiku for
   a summary, category, tags, and a calibrated **0–100 importance score** (papers
   also get a plain-English explainer). A Voyage embedding lands in pgvector, and
   near-identical items ("GPT-5 released," reported by five outlets) are collapsed
   by cosine similarity. A thumbnail is resolved (feed media → page og:image) and
   re-hosted on S3; arXiv items pick up citation signals from Semantic Scholar.

3. **Cluster** (`/api/jobs/cluster-topics`) — Related-but-distinct items are
   grouped into **stories** by embedding similarity and labelled by Claude. A
   story's rank comes from cross-source corroboration, not popularity (below).

4. **Surface** — The homepage reads pre-computed `story_buckets`: one panel per
   story, with the synthesized summary and links to every source covering it.
   Reads are served from a region-keyed Redis cache that falls through to Postgres.

5. **Notify** (`/api/jobs/notify` + daily digest) — Subscribers get per-item
   alerts or a once-a-day briefing (email via Resend, or Discord) for stories
   above the importance threshold they chose.

**Ranking = cross-source corroboration, not clicks.** A story covered by many
independent, reputable publishers ranks higher — the same signal Techmeme and
Google News use, and one you can't bot. The dominant term is the sum of publisher
reputation weights on a story, plus cluster size, Claude's importance score, and
recency decay. Views/clicks are collected for analytics but **never** feed
ranking (see the "Camp B" rationale under [Features](#features)).

## Architecture

```
                                                    L7 LB (nginx)
client ──────────────────────────────────────────────► nginx ──► next.js app(s)
                                                                    │
                                  ┌─────────────────────────────────┼─────────────────────┐
                                  ▼                                 ▼                     ▼
                              supabase                           redis                   s3
                              (postgres + pgvector +             (region-keyed           (thumbnails only)
                               realtime; source of               listing cache;
                               truth for articles)               read-through)

         worker (separate container, same image)
           └─► /api/jobs/{ingest, enrich, cluster-topics, notify}
                  │
                  ├─► RSS parsing (rss-parser)
                  ├─► Web crawler (cheerio) — for publishers without RSS
                  └─► writes to supabase + uploads thumbnails to s3
```

- **Single load balancer slot** today (`upstream ai_news_app` in
  `nginx/nginx.conf` lists `app:3000`). Adding replicas is one line per
  replica plus a duplicate `app2`/`app3` service in `docker-compose.yml` —
  **no app-code change needed**.
- **Redis is optional but recommended.** Cache misses fall through to
  Supabase; if Redis is down, the app keeps serving.
- **S3 stores only thumbnails.** Raw RSS XML lives inline in `items.xml`
  (per the design doc's article schema).
- **CDN omitted for the POC.** When you're ready: front the S3 bucket with
  CloudFront/R2 public, then set `S3_PUBLIC_BASE_URL` to the CDN domain.

## Source list & audit

The seed registry (`supabase/seed.sql`)
ships an audited set of sources spanning frontier labs, infra vendors,
researcher blogs, newsletters, safety orgs, arXiv, GitHub trending, and
Hugging Face.

**Every enabled source passes `scripts/verify-sources.mjs`**, which is
stricter than a liveness check. For each source it asserts:

1. The URL is reachable (HTTP 2xx).
2. The body parses as RSS/Atom (or HTML, for crawlers).
3. The feed contains ≥1 item.
4. The **first 5 sampled items** each have a non-empty title + link.
5. The **newest sampled item is no older than 60 days** — a feed whose
   newest post is past the retention window contributes nothing to the
   live feed even though it "works".
6. (Informational) **Claude Haiku** scores AI-relevance on sampled titles
   in a single batched call — model names change every week (Seedance,
   Kimi K2.6, Mythos…) so a static keyword list goes stale immediately.
   Cost is ~$0.001 per audit run. Set `SKIP_RELEVANCE=1` to opt out, or
   omit `ANTHROPIC_API_KEY` and the call is silently skipped.

Run any time:

```bash
node scripts/verify-sources.mjs
# OK    = passes all checks
# WARN  = some sampled items have missing fields
# STALE = newest item past retention threshold
# EMPTY = feed has 0 items
# FAIL  = unreachable or unparseable
# exit code is non-zero if any enabled source is not OK
```

### Sources that didn't survive the audit

- **xAI, Perplexity, Cohere, Stability, Inflection** — JS-rendered SPAs or
  403 raw requests. Live in the registry as **disabled crawler stubs** with
  a `"needs":"playwright"` flag.
- **All r/* subreddits** — 403, Reddit moved subreddit RSS behind OAuth.
- **phil-schmid** — no RSS feed exists.
- **gwern** — `/feed` serves a 2021 newsletter archive, not new posts.
- **Stale publishers** (chip-huyen 490d, jay-alammar 421d, lilian-weng 385d,
  synced-review 280d, karpathy 98d, fast-ai 94d, the-gradient 91d) — feeds
  parse cleanly but the newest post is past retention. Disabled until the
  publisher resumes posting. jay-alammar's last post says "Moving to
  Substack" — needs a URL update before re-enabling.

### What the verifier still does NOT catch

The verifier is network-side: it proves we *can* ingest these feeds. It does
NOT prove the full pipeline works end-to-end. After running the worker for
one cycle, run `scripts/verify-pipeline.sql` against the Supabase project to
assert: items.xml is populated, regions default correctly, thumbnails are
captured into S3, dedup is firing, the story_buckets RPC returns sane shapes,
and crawler sources actually produced rows.

## Features

- Aggregates AI news from **~50 verified sources** across labs, infra
  vendors, researcher blogs, newsletters, safety orgs, arXiv, GitHub
  trending, and Hugging Face. **No stale URLs**: every URL is live-tested
  before being enabled.
- **Story panels**: related coverage from multiple sources collapses into
  one panel on the homepage with a Claude-generated summary and links to
  every source.
- Semantic deduplication via Voyage embeddings + pgvector (collapses
  "GPT-5 released" from 5 sources into one item).
- Importance scoring with Claude Haiku 4.5 (calibrated 0–100 rubric).
- Topic clustering with automatic cluster labeling.
- Real-time UI via Supabase Realtime — new items stream live.
- Generic **web crawler adapter** for publishers without RSS — config-driven
  selectors stored on each source row (`crawl_config` jsonb).
- Region-keyed Redis cache for hot read paths.
- **Ranking philosophy**: cross-source corroboration only. The same approach
  TechMeme and Google News use — a story covered by N independent reputable
  publishers ranks higher, regardless of how many people clicked. View counts
  are NOT a ranking signal here, because they're trivial to bot and reward
  clickbait. The signals that matter:
  - `source_weight_sum` — sum of publisher reputation weights covering the
    story (the dominant term in `trending_score`)
  - `topic_size` — number of related items clustered together
  - Claude's 0–100 importance score
  - Recency decay
  Engagement events (views, clicks) ARE still collected via `/api/events` →
  the `topic_engagement` table — purely for analytics / future tooltips,
  never folded into ranking.
- Discord webhook push for high-importance items.

## Stack

| Layer         | Tool                                                   |
| ------------- | ------------------------------------------------------ |
| Framework     | Next.js 16 (App Router) + TypeScript                   |
| UI            | Tailwind v4 + custom primitives + lucide-react icons   |
| DB + realtime | Supabase Postgres + pgvector + Realtime                |
| Cache         | Redis (ioredis)                                        |
| Blob storage  | S3-compatible (AWS / R2 / MinIO; thumbnails only)      |
| Reverse proxy | Nginx (upstream block scales to L7 LB by adding lines) |
| LLM           | Anthropic `claude-haiku-4-5-20251001` (prompt-cached)  |
| Embeddings    | Voyage AI `voyage-3` (1024-dim) — optional             |
| Ingestion     | Worker container hitting job endpoints                 |
| Deploy        | Docker Compose (POC) → swap to k8s when needed         |

## Quickstart with Docker Compose

```bash
cp .env.example .env.local
# Fill in: Supabase keys, ANTHROPIC_API_KEY, CRON_SECRET, S3_* (optional).
# REDIS_URL is set automatically by docker-compose.

docker compose up --build
```

Visit http://localhost (nginx fronts everything; the app is on port 3000
internally, never exposed directly).

The `worker` container hits `/api/jobs/{ingest,enrich,cluster-topics,notify}`
every `WORKER_INTERVAL_SEC` seconds (default 900 = 15 min).

### Scaling to multi-replica

1. In `docker-compose.yml`, copy the `app` service to `app2`, `app3`.
2. In `nginx/nginx.conf`, add `server app2:3000;` and `server app3:3000;`
   to the `upstream ai_news_app { … }` block.
3. Optional: uncomment `least_conn;` for fewest-in-flight scheduling.
4. `docker compose up -d --build`.

Nothing else changes — Redis and Supabase are shared; the worker keeps
hitting `app:3000` (which round-robins through the new replicas via nginx).

## Run locally (no Docker)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run (in order):
   - `supabase/migrations/001_schema.sql` — base schema, RLS, realtime, triggers, RPCs.
   - `supabase/migrations/002_infra.sql` — adds `region`, `xml`, `s3_storage_id`, `crawler` source kind, and the `story_buckets` RPC.
   - `supabase/migrations/003_engagement.sql` — adds `topic_engagement` table + `engaged_topics()` + `bump_topic_engagement()` RPCs.
   - `supabase/seed.sql` — full source registry (~80 entries, audited). Auto-applied by `supabase db reset` after migrations.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the required keys (see `.env.example` for descriptions). Redis and S3
are both optional — without them the app still runs, just slower (no cache)
and without thumbnails.

### 3. Dev server + ingest loop

You need **two terminals**: one for the Next.js dev server, one for the loop.

```bash
# Terminal 1
npm install
npm run dev

# Terminal 2 — Windows
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1

# Terminal 2 — POSIX
WORKER_TARGET=http://localhost:3000 \
WORKER_INTERVAL_SEC=900 \
CRON_SECRET=$(grep ^CRON_SECRET .env.local | cut -d= -f2) \
  node scripts/worker.mjs
```

## Project layout

```
app/                  Next.js routes (feed, item, topic, search, API jobs)
components/
  story-panels.tsx    NEW — grouped story UI (multi-source coverage panels)
  …                   item card, filter bar, topics strip, etc.
lib/
  anthropic/          Claude client, enrichment prompt + parser, embeddings
  cache/redis.ts      NEW — Redis client with graceful no-op fallback
  storage/s3.ts       NEW — S3 thumbnail upload (AWS/R2/MinIO compatible)
  stories.ts          NEW — loader for the story_buckets RPC
  supabase/           browser + server + service-role clients
  ingest/
    crawler.ts        NEW — config-driven HTML scraping adapter
    rss.ts            UPDATED — captures per-item XML + thumbnail candidates
    write.ts          UPDATED — persists region + xml columns
    …                 arxiv, github, hackernews, huggingface adapters
  topics/             cluster.ts + label.ts (Claude cluster labeling)
nginx/nginx.conf      Reverse proxy; upstream block ready for multi-replica
scripts/
  worker.mjs          NEW — Node ingest loop for Docker
  loop.ps1            Existing Windows-host loop
supabase/
  migrations/
    001_schema.sql       Base schema
    002_infra.sql        region + xml + s3 + crawler + story_buckets()
    003_engagement.sql   topic_engagement table + RPCs
  seed.sql               Full source registry (auto-applied by `supabase db reset`)
Dockerfile            Multi-stage Next.js image (used by app + worker)
docker-compose.yml    nginx + app + worker + redis stack
```

## License

Apache 2.0 — see [LICENSE](LICENSE). Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
