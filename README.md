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
   - `supabase/seed/sources.sql` — 36+ seed sources + reputation weights

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings → API
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `OPENAI_API_KEY` — optional; enables semantic dedup (used only for embeddings via `text-embedding-3-small`)
- `CRON_SECRET` — any long random string (used to auth cron endpoints once Phase 2 lands)
- `SEMANTIC_SCHOLAR_API_KEY` — optional; raises S2 rate limits for paper-citation enrichment

### 3. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no data you'll see a setup banner; after Phase 2 ingestion runs, items stream in.

## Roadmap

- [x] **Phase 1 — Foundation**: scaffold, schema, Anthropic/Supabase wiring, feed UI skeleton
- [x] **Phase 2 — Ingestion core**: RSS / arXiv / GitHub / HN / HF adapters + cron worker
- [x] **Phase 3 — Enrichment**: Haiku summarize/classify/score + Voyage embeddings + semantic dedup
- [x] **Phase 4 — UI polish**: realtime stream, search, detail pages
- [x] **Phase 5 — Source expansion**: +8 high-signal RSS feeds (labs, infra, independent voices)
- [x] **Phase 6 — Trending & Discord push**: duplicate-count velocity signal, trending sort, Discord webhook subscriptions
- [x] **Phase 7 — First-class topics**: embedding-based clustering cron + Haiku cluster labels + topics strip + topic detail page
- [ ] **Phase 8 — Production deploy**: Vercel cron + domain + observability

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
