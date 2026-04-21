# AI News Feed

A real-time web dashboard that aggregates **what actually matters in AI** — new models, papers, open-source drops, funding rounds, and announcements — ranked by importance, summarized by Claude, and pushed live.

> Built because keeping up with AI via 15 Twitter lists, 4 Discord servers, HN, and arXiv RSS is unsustainable. This is one pane of glass for frontier AI.

## What's inside

- **32 sources** out of the box: OpenAI / Anthropic (News + Claude Blog + Engineering) / DeepMind / Google AI / Microsoft Research / NVIDIA / Hugging Face / Mistral / Together / Databricks blogs, arXiv (cs.AI/LG/CL/CV), GitHub trending (AI/LLM/agents/ML), HuggingFace trending models + datasets, Hacker News (AI-filtered), TechCrunch AI, VentureBeat, MIT Tech Review, The Verge AI, Jay Alammar, The Gradient, Simon Willison, Jack Clark's Import AI, LessWrong AI, and more. Dead feeds (Meta AI, Cohere, Stability AI, Perplexity, Cerebras, Papers with Code) are retained in schema but disabled.
- **Claude Haiku 4.5** summarizes every item and scores it 0–100 for importance (calibrated rubric — reserves 85+ for genuinely big news).
- **Semantic dedup** via Voyage embeddings (`voyage-3`, 1024-dim) + pgvector, so "GPT-5 released" from 5 sources collapses to one item.
- **Trending rank** blends 5 signals with a time-decay: Claude importance + HN/GitHub/HF engagement + trust-weighted source velocity (primary-lab coverage counts more than a retweet) + topic-cluster size (emerging topic detection via looser-than-dup embedding clustering) + Semantic Scholar citation signals for arXiv papers.
- **First-class topics**: hourly cron unions related items via embedding clustering (single-link, cos-sim ≥ 0.78), asks Claude to label each cluster in 2–5 words, and surfaces them as a Topics strip on the homepage + a detail page at `/topic/[slug]`. Cluster signatures (member-hash + centroid match) let stable topics reuse labels across runs, so Haiku only runs on genuinely new or changed clusters.
- **Real-time UI**: Supabase Realtime streams new enriched items to the browser as they drop.
- **Discord push**: drop a webhook URL in the signup form to get high-importance items posted to your channel. No account required.
- **No accounts** — it's a public read-only feed. Filter by category, minimum importance, sort by hot / new / trending.

## Stack

| Layer         | Tool                                                   |
| ------------- | ------------------------------------------------------ |
| Framework     | Next.js 16 (App Router) + TypeScript                   |
| UI            | Tailwind v4 + custom primitives + lucide-react icons   |
| DB + realtime | Supabase Postgres + pgvector + Realtime                |
| LLM           | Anthropic `claude-haiku-4-5-20251001` (prompt-cached)  |
| Embeddings    | Voyage AI `voyage-3` (1024-dim) — optional             |
| Ingestion     | Vercel Cron → Next.js API routes per source adapter    |
| Deploy        | Vercel (frontend + cron), Supabase (DB)                |

## Getting started

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run (in order):
   - `supabase/migrations/001_schema.sql` — full schema, RLS, realtime, triggers, and RPCs (`similar_items`, `similar_recent_items`, `bump_duplicate_count`, `recompute_topic_sizes`, `trending_items`, `top_topics`)
   - `supabase/seed/sources.sql` — 32 seed sources + reputation weights

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings → API
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `VOYAGE_API_KEY` — optional; enables semantic dedup via `voyage-3` embeddings (200M free tokens on signup)
- `CRON_SECRET` — any long random string; required to call `/api/cron/*` endpoints
- `ITEM_RETENTION_DAYS` — default `14`; items older than this get auto-pruned at ingest time
- `GITHUB_TOKEN` — optional; raises GitHub trending/search rate limits from 60/hr to 5000/hr
- `SEMANTIC_SCHOLAR_API_KEY` — optional; raises S2 rate limits for arXiv citation enrichment

### 3. Run locally

You need **two terminals**: one for the Next.js dev server, one for the ingest/enrich loop. The dev server alone shows an empty feed — new items only flow in when the cron endpoints get hit.

**Terminal 1 — dev server:**
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Empty feed is expected until the loop kicks in.

**Terminal 2 — ingest + enrich loop (every 15 min):**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1
```

`scripts/loop.ps1` reads `CRON_SECRET` from `.env.local`, hits `/api/cron/ingest` then `/api/cron/enrich`, sleeps 15 min, repeats. Leave it running — items start appearing in the feed within a minute.

**Quick one-off test (no loop):**
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/ingest
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/enrich
```

**Survive reboots:** register `scripts/loop.ps1` in Windows Task Scheduler as a "run at logon" task.

### 4. Automate in production (optional)

- **Vercel cron** — `vercel.json` already declares schedules. Requires Vercel Pro ($20/mo) — Hobby's 60s function timeout and daily-only crons won't work here.
- **GitHub Actions** — free (2000 min/mo). Add a workflow that `curl`s the deployed `/api/cron/*` endpoints on a `*/15 * * * *` schedule.

## Project layout

```
app/                  Next.js routes (feed, item detail, topic detail, search, API crons)
components/           UI primitives (item card, filter bar, topics strip, …)
lib/
  anthropic/          Claude client, enrichment prompt + parser, embeddings
  supabase/           browser + server + service-role clients
  ingest/             source adapters + dedup + normalization + engagement scoring
  topics/             cluster.ts (union-find) + label.ts (Claude cluster labeling)
  types.ts            shared domain types (Item, Source, Category)
supabase/
  migrations/         schema
  seed/               source registry seed
```

## License

MIT — see [LICENSE](LICENSE).
