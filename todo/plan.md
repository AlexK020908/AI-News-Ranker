# Plan — TrendRadar-inspired additions

Two features lifted in spirit from [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar)
and adapted to our Next.js 16 + Supabase + Anthropic stack.

## Reality checks

These shaped both designs — TrendRadar's rank-snapshot mechanic assumes ranked
list endpoints, but our adapters mostly hit search APIs:

- We pull HN via `search_by_date` (not the ranked front page) → we know `points`
  + `num_comments` per item, not list position.
- We pull GitHub via the search API sorted by stars → we know lifetime
  `stargazers_count`, not "stars gained today."
- arXiv / RSS have no native ranking — for those, "velocity" would have to come
  from cross-source mentions or `paper_citations` deltas.

So "rank-velocity" really means "score-velocity" for our shape — same idea,
different signal.

---

## 1. Score-velocity ("rising fast")

### Schema

New table, additive — no changes to existing tables:

```sql
create table item_metric_snapshots (
  item_id      uuid not null references items(id) on delete cascade,
  observed_at  timestamptz not null default now(),
  points       integer,           -- HN points / GH stars / Reddit upvotes
  comments     integer,           -- HN comments / Reddit comments
  rank_pos     integer,           -- list position when available (null for HN search/GH search)
  primary key (item_id, observed_at)
);
create index on item_metric_snapshots (item_id, observed_at desc);
```

### Ingest change

`lib/ingest/write.ts`: when an adapter returns an item we've already seen
(URL conflict), don't silently drop the row — write a snapshot row from
`raw.points` / `raw.stars` / `raw.num_comments`. Adapters already populate
`raw`; the upsert just needs to branch on "new vs already-exists" and append a
snapshot in the existing case.

This is the *only* invasive bit — our current dedup is `upsert with
ignoreDuplicates: true`; we'd switch to "select id, then either insert or
snapshot." Load-bearing infra change, but not a lot of code.

### Eligible adapters (v1)

- **HackerNews** — `points`, `num_comments` from `raw`
- **GitHub trending/search** — `stargazers_count` from `raw.stars`
- **Reddit** — when we add it (`ups`, `num_comments`)
- **arXiv / RSS / HuggingFace** — skipped; no per-tick numeric signal

### Velocity function

```sql
-- (current_points - earliest_points_in_window) / hours_since
-- Items with >1 snapshot in last 12h and positive delta get a "rising" badge.
create or replace function rising_items(
  window_hours int default 12,
  min_delta    int default 20,
  max_rows     int default 30
)
returns table (id uuid, title text, url text, velocity float)
language sql stable
as $$
  with windowed as (
    select item_id,
           max(points) - min(points) as delta,
           extract(epoch from (max(observed_at) - min(observed_at))) / 3600 as hours
      from item_metric_snapshots
     where observed_at > now() - make_interval(hours => window_hours)
     group by item_id
    having count(*) > 1 and max(points) - min(points) >= min_delta
  )
  select i.id, i.title, i.url, w.delta / greatest(w.hours, 0.5) as velocity
    from windowed w
    join items i on i.id = w.item_id
   where i.duplicate_of is null
   order by velocity desc
   limit max_rows;
$$;
```

### UI

A "rising" filter tab or a flame badge on existing cards. No new page needed —
feed already lists items.

### Cost

One extra row per re-seen item per ingest tick. With ~15 min cadence and ~500
items in flight, that's ~50k rows/day at the high end. Cheap with a 7-day TTL
prune (add to `lib/ingest/retention.ts`).

### Tradeoff

Changes the "fetch once, dedup by URL" mental model. The upsert path becomes
"upsert + maybe snapshot." Not a lot of code, but it's load-bearing
infrastructure — needs a soak period before the UI surfaces it.

---

## 2. Daily AI briefing

### Schema

```sql
create table digests (
  id            uuid primary key default uuid_generate_v4(),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  markdown      text not null,
  sections      jsonb not null,   -- { core_trends, sentiment, signals, deep_dives, outlook }
  item_count    integer not null,
  generated_at  timestamptz not null default now(),
  unique (period_start, period_end)
);

create index on digests (generated_at desc);
```

### Endpoint

`app/api/jobs/digest/route.ts`:

1. Bail if a row already exists for the current period (idempotent).
2. Pull top ~50 from `trending_items(min_importance => 60)` over the last 24h.
3. Group by `category` for input structure.
4. Single Claude call with a TrendRadar-style 5-section system prompt
   (`lib/anthropic/digest-prompt.ts`).
5. Parse JSON → write a `digests` row.
6. Post markdown to Discord webhooks (existing `webhooks` table, optionally
   filtered by a new `is_digest_subscriber` flag) + email if `EMAIL_PROVIDER`
   env is set.

Auth: `isAuthorizedJob(req)` like the rest of the job endpoints. Bearer
`CRON_SECRET`.

### Scheduler

Add a 7th line to `scripts/loop.ps1` and `scripts/worker.mjs` that hits
`/api/jobs/digest` once per day at a fixed UTC hour. The endpoint's
idempotency check means a loop firing it every 15 min is also safe — it'll
no-op until the next period.

### Prompt structure

Lifted from TrendRadar's `config/ai_analysis_prompt.txt`, adapted for our
AI-news domain:

1. **Core trends** — what dominated the AI feed today (top categories +
   recurring themes)
2. **Controversy / signals** — items with high comment-to-importance ratio,
   high duplicate_count across heterogeneous sources
3. **Weak signals** — low-volume but high-importance items (small N, niche
   sources, papers with first influential citations)
4. **Deep dives** — top 3 items with extended commentary using their
   `summary` + `paper_tldr`
5. **Outlook** — what to watch this week (recurring topic clusters,
   open threads)

Output as strict JSON with the five string fields, parsed and stored both as
structured `sections` and a flat `markdown` field for direct push.

### Cost

One Claude call/day (~$0.10 with Sonnet on a 50-item context). One row/day.
Zero changes to existing ingest/enrich/cluster pipeline.

### Tradeoff

Low. The only real question is whether the Discord push should be a *new*
"digest" webhook subscription or piggyback on the existing high-importance
webhook table — they have different semantics (item-level alerts vs
daily roll-ups). Cleanest: add an `is_digest` boolean to `webhooks` and let
subscribers opt into one, the other, or both.

---

## Recommended order

1. **Digest first** — additive, zero risk to ingest, ships in a session.
2. **Score-velocity second** — needs the write-path change and ~1 day of bake
   time to see if the snapshot table grows sanely before wiring it into
   `trending_items` / the UI.

## Not lifting from TrendRadar

For the record, these were considered and skipped:

- **NewsNow aggregator API** — Chinese-platform-focused (Weibo, Zhihu,
  Bilibili rankings). Wrong audience for an AI-domain feed.
- **Frequency-word DSL** (`+required` / `!exclude` / `/regex/`) — duplicates
  what our LLM enrichment already does; would be a second config surface.
- **8-channel push** (WeChat / Lark / DingTalk / Bark / ntfy / Telegram /
  Slack / email) — Discord covers our audience. Email is the only
  realistically-useful addition and is implied by the digest design above.
- **NL `interests.txt` → AI tag extraction** — only valuable if we add
  per-subscriber personalization. Park until then.
- **MCP server wrapping the feed** — cool demo, not a differentiator. Defer.
