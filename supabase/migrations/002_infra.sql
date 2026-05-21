-- ai-news-feed :: infra migration
-- Adds the columns + enum values required by the new architecture:
--
--   ARTICLE schema (per design doc):
--     publisher id (existing → source_id)
--     guid         (existing → external_id)
--     region       (NEW)
--     xml          (NEW — raw RSS payload, stored inline)
--     published_at (existing)
--     s3_storage_id (NEW — thumbnail blob key in S3; S3 stores ONLY thumbnails)
--
-- Other additions:
--   * Redis caches feed listings keyed by region (no schema impact — runtime only)
--   * 'crawler' source_kind for publishers that lack RSS but expose a scrapeable index
--   * story_buckets RPC: topics joined with their member items for grouped UI
--
-- Safe to re-run.

-- 1. Enum extension --------------------------------------------------------
-- Postgres doesn't support `if not exists` on enum values prior to PG14, but
-- Supabase runs >=14 so the literal `if not exists` form works.
alter type source_kind add value if not exists 'crawler';

-- 2. items columns ---------------------------------------------------------
-- region         : routing key for the Redis listing cache.
-- xml            : raw RSS payload as ingested (text — preserves whatever the publisher served).
-- s3_storage_id  : S3 object key for the article's thumbnail. NULL means no thumbnail
--                  was found/uploaded for this item.

alter table items
  add column if not exists region          text not null default 'global',
  add column if not exists xml             text,
  add column if not exists s3_storage_id   text;

create index if not exists items_region_idx on items (region);

-- Composite region + recency for the homepage's per-region listing query.
create index if not exists items_region_published_idx
  on items (region, published_at desc nulls last)
  where duplicate_of is null and enriched_at is not null;

-- 3. sources columns -------------------------------------------------------
-- region: default region for any item this source produces (overridable per-item).
-- crawl_config: free-form jsonb consumed by the crawler adapter (base_url, selectors, etc.)

alter table sources
  add column if not exists region       text not null default 'global',
  add column if not exists crawl_config jsonb not null default '{}'::jsonb;

-- 4. story_buckets RPC -----------------------------------------------------
-- Returns topics joined with their top-N member items, ranked by trending_score.
-- The frontend renders each row as a "story panel": topic label + summary +
-- the list of related articles. Read-only, public-facing.

create or replace function story_buckets(
  in_region   text default null,
  max_topics  int  default 12,
  max_members int  default 8
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
      from topics t
     where t.member_count >= 2
     order by t.trending_score desc
     limit max_topics
  ),
  -- Join ranked_topics into member_rows so the row_number partition only
  -- scans the ~max_topics topics we'll return — not all of topic_members.
  member_rows as (
    select
      tm.topic_id,
      i.id            as item_id,
      i.url,
      i.title,
      i.summary,
      i.category,
      i.importance,
      i.published_at,
      i.region,
      i.duplicate_count,
      s.slug          as source_slug,
      s.name          as source_name,
      s.kind          as source_kind,
      row_number() over (
        partition by tm.topic_id
        order by coalesce(i.importance, 0) desc, i.published_at desc nulls last
      ) as rn
    from ranked_topics rt
    join topic_members tm on tm.topic_id = rt.id
    join items i  on i.id = tm.item_id
    join sources s on s.id = i.source_id
    where i.duplicate_of is null
      and (in_region is null or i.region = in_region)
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

-- 5. Backfill --------------------------------------------------------------
-- Existing rows get region='global' from the default; nothing else to do.
