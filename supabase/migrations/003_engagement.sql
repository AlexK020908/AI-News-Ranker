-- ai-news-feed :: engagement migration
-- Tracks per-hour engagement counts per topic.
--
-- Columns are named `unique_hourly_*` because the Redis SET-NX dedup gate in
-- /api/events guarantees each anonymous sid contributes at most one increment
-- per (topic, hour). So the value stored is the *unique-sids-per-hour* count,
-- not raw impressions. Aggregating across hours overcounts cross-hour repeats —
-- a true daily unique count would need HyperLogLog (see README).
--
-- Event flow:
--   1. Client fires sendBeacon to /api/events with { topic_id, sid, kind }.
--   2. Server uses Redis SET-NX on `seen:<kind>:<topic_id>:<hour>:<sid>` to
--      gate duplicate events from the same anonymous session in the same hour.
--   3. First time a (topic, hour, sid) tuple appears, UPSERT this table:
--        +1 to the matching unique_hourly_* column.
--
-- Safe to re-run.

create table if not exists topic_engagement (
  topic_id              uuid not null references topics(id) on delete cascade,
  bucket_start          timestamptz not null,
  unique_hourly_views   integer not null default 0 check (unique_hourly_views  >= 0),
  unique_hourly_clicks  integer not null default 0 check (unique_hourly_clicks >= 0),
  updated_at            timestamptz not null default now(),
  primary key (topic_id, bucket_start)
);

create index if not exists topic_engagement_bucket_idx
  on topic_engagement (bucket_start desc);

create index if not exists topic_engagement_topic_recent_idx
  on topic_engagement (topic_id, bucket_start desc);

alter table topic_engagement enable row level security;

-- Public reads (so the engaged_topics function works under anon).
drop policy if exists "public read topic_engagement" on topic_engagement;
create policy "public read topic_engagement"
  on topic_engagement for select using (true);

-- No insert/update/delete policies — only the service role writes (via the
-- /api/events route handler with SUPABASE_SERVICE_ROLE_KEY).

-- bump_topic_engagement: atomic UPSERT + counter increment for one event.
-- Called by app/api/events/route.ts after the Redis SET-NX dedup gate.
-- in_kind is constrained at the call site to 'view' or 'click'.
create or replace function bump_topic_engagement(
  in_topic_id     uuid,
  in_bucket_start timestamptz,
  in_kind         text
)
returns void
language plpgsql
as $$
begin
  if in_kind not in ('view', 'click') then
    raise exception 'bump_topic_engagement: invalid kind %', in_kind;
  end if;
  insert into topic_engagement (
    topic_id, bucket_start, unique_hourly_views, unique_hourly_clicks, updated_at
  )
  values (
    in_topic_id,
    in_bucket_start,
    case when in_kind = 'view'  then 1 else 0 end,
    case when in_kind = 'click' then 1 else 0 end,
    now()
  )
  on conflict (topic_id, bucket_start) do update set
    unique_hourly_views  = topic_engagement.unique_hourly_views
                           + (case when in_kind = 'view'  then 1 else 0 end),
    unique_hourly_clicks = topic_engagement.unique_hourly_clicks
                           + (case when in_kind = 'click' then 1 else 0 end),
    updated_at           = now();
end;
$$;

-- engaged_topics: per-topic engagement sums over the requested window.
-- Returns a row per topic that has ANY engagement in the window, sorted by
-- views desc. Consumer is lib/stories.ts which joins this into story_buckets()
-- output and adds a logarithmic ranking boost.
--
-- NOTE: aggregating unique_hourly_views over multiple hours overcounts users
-- who return across hour boundaries. Acceptable for ranking; for "daily
-- unique viewers" use HyperLogLog (not implemented).
create or replace function engaged_topics(
  window_hours int default 1
)
returns table (
  topic_id              uuid,
  unique_hourly_views   bigint,
  unique_hourly_clicks  bigint
)
language sql stable
as $$
  select
    topic_id,
    coalesce(sum(unique_hourly_views),  0) as unique_hourly_views,
    coalesce(sum(unique_hourly_clicks), 0) as unique_hourly_clicks
  from topic_engagement
  where bucket_start > now() - make_interval(hours => window_hours)
  group by topic_id
  order by sum(unique_hourly_views) desc;
$$;
