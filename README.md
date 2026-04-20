# AI News Feed

A real-time web dashboard that aggregates **what actually matters in AI** — new models, papers, open-source drops, funding rounds, and announcements — ranked by importance, summarized by Claude, and pushed live.

> Built because keeping up with AI via 15 Twitter lists, 4 Discord servers, HN, and arXiv RSS is unsustainable. This is one pane of glass for frontier AI.

## What's inside

- **25+ sources** out of the box: OpenAI / Anthropic / DeepMind / Meta / NVIDIA blogs, arXiv (cs.AI/LG/CL/CV), GitHub trending (AI/LLM/agents/ML), HuggingFace trending models + datasets, Hacker News (AI-filtered), Reddit (LocalLLaMA, MachineLearning, singularity, OpenAI), TechCrunch AI, VentureBeat, MIT Tech Review, Papers with Code, Mistral, Cohere, and more.
- **Claude Haiku 4.5** summarizes every item and scores it 0–100 for importance (calibrated rubric — reserves 85+ for genuinely big news).
- **Semantic dedup** via Voyage embeddings + pgvector, so "GPT-5 released" from 5 sources collapses to one item.
- **Real-time UI**: Supabase Realtime streams new enriched items to the browser as they drop.
- **No accounts** — it's a public read-only feed. Filter by category, minimum importance, sort by hot/new.

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
2. In the SQL editor, run:
   - `supabase/migrations/001_init.sql` (schema + RLS + realtime)
   - `supabase/seed/sources.sql` (25+ seed sources)

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings → API
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `VOYAGE_API_KEY` — optional; enables semantic dedup
- `CRON_SECRET` — any long random string (used to auth cron endpoints once Phase 2 lands)

### 3. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no data you'll see a setup banner; after Phase 2 ingestion runs, items stream in.

## Roadmap

- [x] **Phase 1 — Foundation**: scaffold, schema, Anthropic/Supabase wiring, feed UI skeleton
- [ ] **Phase 2 — Ingestion core**: RSS / arXiv / GitHub / HN / Reddit / HF adapters + cron worker
- [ ] **Phase 3 — Enrichment**: Haiku summarize/classify/score + Voyage embeddings + semantic dedup
- [ ] **Phase 4 — UI polish**: realtime stream, search, detail pages
- [ ] **Phase 5 — Source expansion**: remaining feeds, custom scrapers where no RSS exists
- [ ] **Phase 6 — Push + deploy**: web-push on importance ≥ 85, Vercel cron, production deploy

## Project layout

```
app/                  Next.js routes (feed, detail, category, API crons)
components/           UI primitives (item card, filter bar, header, …)
lib/
  anthropic/          Claude client, enrichment prompt + parser, embeddings
  supabase/           browser + server + service-role clients
  ingest/             (Phase 2) source adapters + dedup + normalization
  types.ts            shared domain types (Item, Source, Category)
supabase/
  migrations/         schema
  seed/               source registry seed
```

## License

MIT — see [LICENSE](LICENSE).
