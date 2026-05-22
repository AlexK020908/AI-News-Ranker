-- ai-news-feed :: TrendRadar-inspired additions
--
-- Two additive features (no existing tables modified except `webhooks` which
-- gains a single nullable column for digest opt-in):
--
--   1. digests
--      Stores one row per generated daily briefing. Idempotency is enforced
--      by the unique (period_start, period_end) constraint so a scheduler
--      hammering the endpoint every 15 minutes is harmless — only the first
--      call inside a fresh period actually does work.
--
--   2. item_metric_snapshots + rising_items()
--      Score-velocity table populated by the ingest write path. When an
--      adapter re-emits an already-seen URL we append a snapshot of its
--      current numeric signals (points / stars / comments) rather than
--      silently discarding the row. rising_items() turns that history into
--      a "what's gaining traction" view.
--
-- Safe to re-run.

-- 1. webhooks: digest opt-in flag --------------------------------------
-- A subscriber can want item-level alerts (the existing behavior), the
-- daily digest, or both. Existing rows default to item-only.

alter table webhooks
  add column if not exists is_digest boolean not null default false;

create index if not exists webhooks_is_digest_idx
  on webhooks (is_digest)
  where enabled = true and is_digest = true;

-- 2. digests -----------------------------------------------------------

create table if not exists digests (
  id            uuid primary key default uuid_generate_v4(),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  markdown      text        not null,
  sections      jsonb       not null,
  item_count    integer     not null,
  generated_at  timestamptz not null default now(),
  unique (period_start, period_end)
);

create index if not exists digests_generated_desc on digests (generated_at desc);

alter table digests enable row level security;

drop policy if exists "public read digests" on digests;
create policy "public read digests"
  on digests for select using (true);

-- 3. item_metric_snapshots --------------------------------------------
-- One row per (item, observation). Adapters that surface numeric
-- per-tick signals (HN points/comments, GH stars, Reddit ups/comments)
-- write a snapshot every time the ingest path sees an existing URL.
-- rank_pos is null for our adapters today (we use search APIs, not
-- ranked feeds) but is included so future ranked-list adapters can
-- contribute without another migration.

create table if not exists item_metric_snapshots (
  item_id      uuid        not null references items(id) on delete cascade,
  observed_at  timestamptz not null default now(),
  points       integer,
  comments     integer,
  rank_pos     integer,
  primary key (item_id, observed_at)
);

create index if not exists item_metric_snapshots_recent_idx
  on item_metric_snapshots (item_id, observed_at desc);

create index if not exists item_metric_snapshots_observed_idx
  on item_metric_snapshots (observed_at desc);

alter table item_metric_snapshots enable row level security;

drop policy if exists "public read snapshots" on item_metric_snapshots;
create policy "public read snapshots"
  on item_metric_snapshots for select using (true);

-- 4. rising_items ------------------------------------------------------
-- Returns items whose `points` has grown by at least `min_delta` between
-- the FIRST and LAST observation inside the window. Critically this
-- uses directional growth (last - first by observed_at), NOT the swing
-- (max - min): an item that ran from 50 → 200 → 40 ends down 10 points
-- and should NOT be flagged as rising. HN/Reddit scores can decrease
-- (deleted upvotes, mod actions, vote fuzzing), so the directional
-- formula is the only one that means what the badge says.
--
-- Velocity = delta / hours; the floor of 0.5h prevents an item observed
-- twice within a few seconds from producing an absurd score.
--
-- The result is joined to sources so callers (the singleton-rising UI
-- strip) don't need a follow-up query — these rows are rendered as
-- standalone cards, not as members of a clustered topic.

create or replace function rising_items(
  window_hours int default 12,
  min_delta    int default 20,
  max_rows     int default 30
)
returns table (
  id              uuid,
  source_id       uuid,
  url             text,
  title           text,
  summary         text,
  category        item_category,
  importance      integer,
  duplicate_count integer,
  published_at    timestamptz,
  delta           integer,
  hours           float,
  velocity        float,
  source_slug     text,
  source_name     text,
  source_kind     source_kind
)
language sql stable
as $$
  with bounds as (
    select
      item_id,
      -- earliest non-null points observation in window
      (array_agg(points order by observed_at)
         filter (where points is not null))[1]                                          as first_pts,
      -- latest non-null points observation in window. Postgres has no
      -- array_last; use array_length to index the tail of the array.
      (array_agg(points order by observed_at)
         filter (where points is not null))[
        array_length(
          array_agg(points order by observed_at) filter (where points is not null),
          1
        )
      ]                                                                                 as last_pts,
      extract(epoch from (max(observed_at) - min(observed_at))) / 3600.0                as hours,
      count(*) filter (where points is not null)                                        as n_snapshots
    from item_metric_snapshots
    where observed_at > now() - make_interval(hours => window_hours)
    group by item_id
  )
  select
    i.id,
    i.source_id,
    i.url,
    i.title,
    i.summary,
    i.category,
    i.importance,
    i.duplicate_count,
    i.published_at,
    (b.last_pts - b.first_pts)                                       as delta,
    b.hours,
    (b.last_pts - b.first_pts)::float / greatest(b.hours, 0.5)       as velocity,
    s.slug as source_slug,
    s.name as source_name,
    s.kind as source_kind
  from bounds b
  join items   i on i.id = b.item_id
  join sources s on s.id = i.source_id
  where i.duplicate_of is null
    and i.enriched_at is not null
    and b.n_snapshots > 1
    and (b.last_pts - b.first_pts) >= min_delta
  order by velocity desc
  limit max_rows;
$$;
