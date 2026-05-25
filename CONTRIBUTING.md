# Contributing to StackBrief

Thanks for your interest in StackBrief (the AI News Ranker). It ingests ~130 AI sources, enriches each item with Claude, and clusters stories by **cross-source corroboration** so you read each story once. Contributions are welcome — especially new sources, which are the easiest and highest-value way to help.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Before you start](#before-you-start)
- [Ways to contribute](#ways-to-contribute)
- [Submit your contribution through a PR](#submit-your-contribution-through-a-pr)
- [Development environment](#development-environment)
- [Project layout](#project-layout)
- [Coding standards](#coding-standards)
- [Adding a news source](#adding-a-news-source)
- [Data pipeline gotchas](#data-pipeline-gotchas)
- [Reporting bugs](#reporting-bugs)
- [Reporting security issues](#reporting-security-issues)
- [Commit & PR conventions](#commit--pr-conventions)

## Code of conduct

Be kind, be specific, assume good faith. We don't have a long-form CoC yet — until then, the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) is the working standard. Harassment, personal attacks, or bad-faith behaviour will not be tolerated.

## Before you start

Three things to read before you write code:

1. [`AGENTS.md`](./AGENTS.md) — **read this first.** This is Next.js 16 with breaking changes from what you (and your tools) likely remember. The guides under `node_modules/next/dist/docs/` are the source of truth; read the relevant one before touching anything Next-specific.
2. [`README.md`](./README.md) — architecture, the source registry, ranking philosophy, stack, and project layout.
3. [`RUNNING.md`](./RUNNING.md) — how to actually run the app + ingest loop locally.

A note on ranking: cross-source corroboration is the anti-manipulation signal, and engagement metrics are deliberately **not** used for ranking (see the "Camp B" rationale in `README.md`). PRs that wire views/clicks into ranking will be declined without a serious bot-prevention story — open an issue to discuss first.

## Ways to contribute

You don't have to write much code to help:

- **Add a news source** ⭐ — the most valuable and approachable contribution. A working RSS feed is a one-line addition to `supabase/seed.sql`. See [Adding a news source](#adding-a-news-source).
- **New ingest adapters** — support a source type we don't have yet (`lib/ingest/`).
- **Bug reports** with a reproduction (see [Reporting bugs](#reporting-bugs)).
- **Docs, typo fixes, clearer error messages** — always welcome.
- **UI/UX polish** in the Next.js frontend (`app/`, `components/`).
- **Ranking / clustering improvements** — welcome, but expect scrutiny (see the note above).

## Submit your contribution through a PR

1. Fork and clone the repository.
2. Create a feature branch from `main`, e.g. `feature/add-deepmind-blog` or `fix/techmeme-thumbnail`.
3. Make your changes. New sources must pass `scripts/verify-sources.mjs`; code changes must pass lint + typecheck.
4. Include docs/examples for new user-facing behaviour.
5. Open a PR against `main` with a clear title and a description that explains **why**, not just what.

## Development environment

Prerequisites: **Node 22**, a **Supabase** project (Postgres + pgvector), and an **Anthropic API key**. Redis, S3, Voyage, and Resend are optional (the app degrades gracefully without them).

```bash
# 1. Install deps
npm install

# 2. Env — templates ship as .env.example
cp .env.example .env.local
#    Minimum to run the pipeline: NEXT_PUBLIC_SUPABASE_URL,
#    NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#    ANTHROPIC_API_KEY, CRON_SECRET. (Windows PowerShell: cp aliases Copy-Item.)

# 3. Apply the schema + sources to your Supabase project.
#    Run migrations 001 → 010 in order, then seed.sql, in the Supabase SQL
#    editor. (Locally, `supabase db reset` applies migrations then seed.sql
#    automatically.) See "Data pipeline gotchas" below — CI does NOT do this.

# 4. Run the app
npm run dev                       # http://localhost:3000

# 5. In a second terminal, drive the pipeline (ingest → enrich → cluster → notify)
powershell -ExecutionPolicy Bypass -File .\scripts\loop.ps1   # Windows
#    (Docker: the `worker` service runs scripts/worker.mjs against the app.)
```

The dev server hosts the UI **and** the `/api/jobs/*` endpoints; the loop is what calls them on a schedule. Both are needed for a live local stack. Full detail in [`RUNNING.md`](./RUNNING.md).

## Project layout

```
app/                  Next.js routes (feed, item, topic, search) + /api/jobs/*
components/           item cards, story panels, filter bar, topics strip
lib/
  anthropic/          Claude enrichment prompt + parser, embeddings
  ingest/             adapters (rss, crawler, arxiv, github, hackernews,
                      huggingface, hf-papers) + registry.ts + write.ts
  topics/             clustering + Claude cluster labelling
  stories.ts          loader for the story_buckets RPC
  storage/ cache/     S3 thumbnails, Redis (both optional, graceful no-op)
  supabase/           browser + server + service-role clients
  email.ts webhooks.ts  Resend sending + Discord/email subscriber helpers
scripts/
  verify-sources.mjs  liveness/quality probe for every source (run before PRs)
  worker.mjs loop.ps1 ingest loop (Docker / Windows)
supabase/
  migrations/         001 → 010, applied in order
  seed.sql            the source registry — single source of truth for sources
.github/workflows/ci.yml   build + deploy (self-hosted runner)
```

## Coding standards

- **TypeScript**: typecheck and lint must pass — `npx tsc --noEmit` and `npm run lint`. Prefer narrow types over `any`. No new ESLint suppressions without a comment explaining why.
- **Read the Next.js docs first** (`AGENTS.md`). APIs, config keys, and conventions differ from older Next.js — don't assume.
- **Comments explain *why*, not *what*.** Reserve them for non-obvious constraints, invariants, or workarounds. Match the density and style of the surrounding file.
- **No backwards-compatibility shims** for unreleased code — just change it.
- **No emojis in source files** unless they were already there.

## Adding a news source

This is the most common contribution. Sources live in `supabase/seed.sql` and **every enabled source must pass the verifier**.

1. **Pick the adapter.** Most sources are `rss`. If a publisher has no feed but a scrapeable HTML index, use `crawler`. For JS-rendered SPAs, a crawler with `"needs":"playwright"` renders the page headlessly.

2. **Add the row** to the `insert into sources (...) values` block:
   ```sql
   -- RSS
   ('deepmind-blog', 'DeepMind Blog', 'rss', 'global',
     '{"url":"https://deepmind.google/blog/rss.xml"}',                 3600),

   -- Crawler (config-driven cheerio selectors)
   ('example-blog', 'Example Blog', 'crawler', 'global',
     '{"base_url":"https://example.com/blog",
       "item_selector":"a.post-card",
       "title_selector":"h2",
       "date_selector":"time", "date_attr":"datetime",
       "url_prefix":"https://example.com", "max_items":30}',           3600),
   ```
   The last number is `poll_interval_sec` (300 = tier-1 frontier labs … 7200+ = weekly newsletters; see the tier comment at the top of `seed.sql`).

3. **Set a reputation weight** by adding the slug to the appropriate `update sources set reputation_weight = …` block near the bottom of `seed.sql` (1.6 = first-party frontier labs, 1.4 = respected independents/eng blogs, 1.2 = curated newsletters/research, 1.0 = default, 0.8 = broad tech journalism).

4. **Verify it** — this is required:
   ```bash
   node scripts/verify-sources.mjs
   ```
   It asserts the source is reachable, parses, has ≥1 item, that the first 5 items have a title + link, and that the **newest item is ≤ 60 days old** (stale feeds contribute nothing). It also prints sample titles so you can sanity-check AI-relevance. Only `OK` sources should be enabled; the exit code is non-zero otherwise.

Keep the feed **AI-relevant** — this is an AI news product, not general tech. If a source is mostly off-topic, it'll dilute the feed; the verifier's Claude relevance score is a guide.

## Data pipeline gotchas

- **Migrations and `seed.sql` are NOT auto-applied by CI.** The deploy pipeline copies `supabase/` to the host but never executes it. Schema and source changes must be applied to the database manually (Supabase SQL editor, or `supabase db reset` locally). `seed.sql` and the migrations are idempotent (`ON CONFLICT` / `if not exists`), so they're safe to re-run.
- **Crawler `needs:"playwright"` sources require Chromium on the host** — they won't ingest until the browser is installed (see `lib/ingest/crawler.ts`). They fail gracefully (logged `last_error`) otherwise.

## Reporting bugs

Open an issue with: what you did, what you expected, what actually happened, and any relevant logs (the `/api/jobs/*` response, or a row's `last_error` from the `sources` table). Note your OS and Node version.

## Reporting security issues

**Do not open a public GitHub issue for security vulnerabilities.** Email the maintainer at the address in the project's git history (`git log --format='%ae' | head -1`) with a description and a proof-of-concept. We'll acknowledge within a few days. Particularly interested in: anything that lets an unauthenticated caller hit the `/api/jobs/*` endpoints, secret disclosure, or SSRF via a crafted source/crawler config.

## Commit & PR conventions

- **Branch names**: `feature/<short-slug>`, `fix/<short-slug>`, `docs/<short-slug>`.
- **Commit messages**: short imperative subject (≤ 70 chars), optional body explaining *why*. We don't enforce Conventional Commits; clarity matters more than format.
- **PR description**: link the issue if there is one, describe the user-visible change, and flag anything reviewers should look at first.
- **Keep PRs small and focused** — easier to review, easier to revert. Don't bundle unrelated changes.

---

Thanks for helping make a cleaner way to follow AI.
