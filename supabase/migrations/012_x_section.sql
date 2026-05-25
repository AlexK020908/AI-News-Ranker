-- ai-news-feed :: dedicated X (Twitter) section
--
-- The X surface is kept ISOLATED from the main article feed by construction:
--   * Tweets are normal `items` (so enrich gives them summaries, importance,
--     embeddings) but are EXCLUDED from the article clustering job and from the
--     solo / rising homepage surfaces (see the function replacements below + the
--     source-id exclusion in app/api/jobs/cluster-topics/route.ts).
--   * Tweet-only clustering ("what X is talking about", linking related tweets)
--     lives in its own x_topics / x_topic_members tables, written by
--     app/api/jobs/cluster-tweets and read by the /x page. This guarantees a
--     tweet can never leak into an article topic, and vice-versa, with no
--     surface flag to thread through every existing read path.
--
-- The 'twitter' kind comparisons below use s.kind::text so this file carries no
-- enum literal — it applies cleanly even if pasted in the same transaction as
-- 011 (no "unsafe use of new value"). 011 is still required before seed.sql,
-- which inserts kind='twitter' rows. Safe to re-run.

-- 1. x_topics — mirror of `topics`, scoped to the tweet surface ---------------
create table if not exists x_topics (
  id              uuid primary key default uuid_generate_v4(),
  slug            text unique not null,
  label           text not null,
  summary         text,
  member_count    integer not null default 0,
  avg_importance  float,
  max_importance  integer,
  trending_score  float not null default 0,
  centroid        vector(1024),
  member_hash     text,
  first_seen_at   timestamptz not null default now(),
  last_updated_at timestamptz not null default now()
);

create index if not exists x_topics_trending_idx     on x_topics (trending_score desc);
create index if not exists x_topics_last_updated_idx on x_topics (last_updated_at desc);

create table if not exists x_topic_members (
  topic_id   uuid not null references x_topics(id) on delete cascade,
  item_id    uuid not null references items(id)    on delete cascade,
  similarity float,
  primary key (topic_id, item_id)
);

create index if not exists x_topic_members_item_idx  on x_topic_members (item_id);
create index if not exists x_topic_members_topic_idx on x_topic_members (topic_id);

-- RLS: public read, mirroring topics / topic_members. Writes go through the
-- service-role client in app/api/jobs/cluster-tweets.
alter table x_topics        enable row level security;
alter table x_topic_members enable row level security;

drop policy if exists "public read x_topics" on x_topics;
create policy "public read x_topics" on x_topics for select using (true);

drop policy if exists "public read x_topic_members" on x_topic_members;
create policy "public read x_topic_members" on x_topic_members for select using (true);

-- 2. x_story_buckets — tweet clusters in the same row shape story_buckets uses,
--    so the /x page reuses the existing StoryBucket → StackCluster transform.
create or replace function x_story_buckets(
  max_topics  int default 60,
  max_members int default 8
)
returns table (
  topic_id        uuid,
  topic_slug      text,
  topic_label     text,
  topic_summary   text,
  member_count    integer,
  avg_importance  float,
  max_importance  integer,
  trending_score  float,
  last_updated_at timestamptz,
  members         jsonb
)
language sql stable
as $$
  with ranked_topics as (
    select t.*
      from x_topics t
     where t.member_count >= 2
     order by t.trending_score desc
     limit max_topics
  ),
  member_rows as (
    select
      tm.topic_id,
      i.id                                       as item_id,
      i.url,
      i.title,
      i.summary,
      i.category,
      i.importance,
      i.published_at,
      i.region,
      i.duplicate_count,
      i.s3_storage_id,
      i.raw ->> 'thumbnail_candidate_url'        as thumb_url,
      i.caveman_summary,
      s.slug                                     as source_slug,
      s.name                                     as source_name,
      s.kind                                     as source_kind,
      row_number() over (
        partition by tm.topic_id
        order by coalesce(i.importance, 0) desc, i.published_at desc nulls last
      ) as rn
    from ranked_topics rt
    join x_topic_members tm on tm.topic_id = rt.id
    join items i   on i.id = tm.item_id
    join sources s on s.id = i.source_id
    where i.duplicate_of is null
  ),
  members_agg as (
    select
      mr.topic_id,
      jsonb_agg(
        jsonb_build_object(
          'id',              mr.item_id,
          'url',             mr.url,
          'title',           mr.title,
          'summary',         mr.summary,
          'category',        mr.category,
          'importance',      mr.importance,
          'published_at',    mr.published_at,
          'region',          mr.region,
          'duplicate_count', mr.duplicate_count,
          's3_storage_id',   mr.s3_storage_id,
          'thumb_url',       mr.thumb_url,
          'caveman_summary', mr.caveman_summary,
          'source_slug',     mr.source_slug,
          'source_name',     mr.source_name,
          'source_kind',     mr.source_kind
        )
        order by mr.rn
      ) as members
    from member_rows mr
    where mr.rn <= max_members
    group by mr.topic_id
  )
  select
    rt.id              as topic_id,
    rt.slug            as topic_slug,
    rt.label           as topic_label,
    rt.summary         as topic_summary,
    rt.member_count,
    rt.avg_importance,
    rt.max_importance,
    rt.trending_score,
    rt.last_updated_at,
    coalesce(ma.members, '[]'::jsonb) as members
  from ranked_topics rt
  left join members_agg ma on ma.topic_id = rt.id
  order by rt.trending_score desc;
$$;

-- 3. x_solo_tweets — notable tweets not (yet) part of any x_topic cluster, so
--    the /x page has content even before related tweets accumulate. Mirrors
--    notable_solo_items but restricted to kind='twitter' and the x surface.
create or replace function x_solo_tweets(
  days_back      int default 2,
  max_rows       int default 40,
  min_importance int default 35
)
returns table (
  topic_id        uuid,
  topic_slug      text,
  topic_label     text,
  topic_summary   text,
  member_count    integer,
  avg_importance  float,
  max_importance  integer,
  trending_score  float,
  last_updated_at timestamptz,
  members         jsonb
)
language sql stable
as $$
  with eligible as (
    select
      i.id,
      i.url,
      i.title,
      i.summary,
      i.category,
      i.importance,
      i.published_at,
      i.region,
      i.duplicate_count,
      i.s3_storage_id,
      i.raw ->> 'thumbnail_candidate_url' as thumb_url,
      i.caveman_summary,
      s.slug as source_slug,
      s.name as source_name,
      s.kind as source_kind,
      extract(epoch from (now() - i.ingested_at)) / 3600.0 as age_hours
    from items i
    join sources s on s.id = i.source_id
    where s.kind::text = 'twitter'
      and i.duplicate_of is null
      and i.enriched_at is not null
      and i.ingested_at > now() - make_interval(days => days_back)
      and coalesce(i.importance, 0) >= min_importance
      and not exists (
        select 1 from x_topic_members tm where tm.item_id = i.id
      )
  )
  select
    e.id                                                     as topic_id,
    ('x-solo-' || e.id::text)                                as topic_slug,
    e.title                                                  as topic_label,
    e.summary                                                as topic_summary,
    1                                                        as member_count,
    e.importance::float                                      as avg_importance,
    e.importance                                             as max_importance,
    (e.importance::float / power(greatest(e.age_hours, 0) + 2, 1.1))
                                                             as trending_score,
    coalesce(e.published_at, now())                          as last_updated_at,
    jsonb_build_array(
      jsonb_build_object(
        'id',              e.id,
        'url',             e.url,
        'title',           e.title,
        'summary',         e.summary,
        'category',        e.category,
        'importance',      e.importance,
        'published_at',    e.published_at,
        'region',          e.region,
        'duplicate_count', e.duplicate_count,
        's3_storage_id',   e.s3_storage_id,
        'thumb_url',       e.thumb_url,
        'caveman_summary', e.caveman_summary,
        'source_slug',     e.source_slug,
        'source_name',     e.source_name,
        'source_kind',     e.source_kind
      )
    )                                                        as members
  from eligible e
  order by trending_score desc
  limit max_rows;
$$;

-- 4. Exclude tweets from the article-feed item surfaces ----------------------
-- notable_solo_items and rising_items both read straight from `items`, so a
-- tweet would otherwise show up as a homepage card. story_buckets needs no
-- change: it reads from `topics`, and cluster-topics never puts tweets there.
--
-- Bodies are copied verbatim from migrations 009 / 005 with a single added
-- `and s.kind <> 'twitter'` guard. Keep in sync if those originals change.

create or replace function notable_solo_items(
  in_region      text default null,
  days_back      int  default 4,
  max_rows       int  default 32,
  min_importance int  default 45
)
returns table (
  topic_id        uuid,
  topic_slug      text,
  topic_label     text,
  topic_summary   text,
  member_count    integer,
  avg_importance  float,
  max_importance  integer,
  trending_score  float,
  last_updated_at timestamptz,
  members         jsonb
)
language sql stable
as $$
  with eligible as (
    select
      i.id,
      i.url,
      i.title,
      i.summary,
      i.category,
      i.importance,
      i.published_at,
      i.region,
      i.duplicate_count,
      i.s3_storage_id,
      i.raw ->> 'thumbnail_candidate_url' as thumb_url,
      i.caveman_summary,
      s.slug as source_slug,
      s.name as source_name,
      s.kind as source_kind,
      extract(epoch from (now() - i.ingested_at)) / 3600.0
        as age_hours
    from items i
    join sources s on s.id = i.source_id
    where i.duplicate_of is null
      and i.enriched_at is not null
      and s.kind::text <> 'twitter'
      and (in_region is null or i.region = in_region)
      and i.ingested_at > now() - make_interval(days => days_back)
      and coalesce(i.importance, 0) >= min_importance
      and not exists (
        select 1 from topic_members tm where tm.item_id = i.id
      )
  )
  select
    e.id                                                     as topic_id,
    ('solo-' || e.id::text)                                  as topic_slug,
    e.title                                                  as topic_label,
    e.summary                                                as topic_summary,
    1                                                        as member_count,
    e.importance::float                                      as avg_importance,
    e.importance                                             as max_importance,
    (e.importance::float / power(greatest(e.age_hours, 0) + 2, 1.1))
                                                             as trending_score,
    coalesce(e.published_at, now())                          as last_updated_at,
    jsonb_build_array(
      jsonb_build_object(
        'id',              e.id,
        'url',             e.url,
        'title',           e.title,
        'summary',         e.summary,
        'category',        e.category,
        'importance',      e.importance,
        'published_at',    e.published_at,
        'region',          e.region,
        'duplicate_count', e.duplicate_count,
        's3_storage_id',   e.s3_storage_id,
        'thumb_url',       e.thumb_url,
        'caveman_summary', e.caveman_summary,
        'source_slug',     e.source_slug,
        'source_name',     e.source_name,
        'source_kind',     e.source_kind
      )
    )                                                        as members
  from eligible e
  order by trending_score desc
  limit max_rows;
$$;

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
      (array_agg(points order by observed_at)
         filter (where points is not null))[1]                                          as first_pts,
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
    and s.kind <> 'twitter'
    and b.n_snapshots > 1
    and (b.last_pts - b.first_pts) >= min_delta
  order by velocity desc
  limit max_rows;
$$;
