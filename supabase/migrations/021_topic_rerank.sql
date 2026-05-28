-- ai-news-feed :: front-page listwise re-rank support.
--
-- Stage 3 of the ranking redesign. The trending_score that orders the homepage
-- is built from a per-item importance that's ultimately an LLM scoring each
-- item IN ISOLATION — exactly what LLMs are worst at. This adds a periodic
-- COMPARATIVE pass: app/api/jobs/rerank pulls the day's top topics and asks
-- Claude to ORDER them relative to each other (a judgment LLMs are reliable
-- at), writing the result here.
--
--   rerank_rank  — 1-based position from the last listwise pass (1 = most
--                  important). NULL = not ranked in the latest pass.
--   reranked_at  — when this rank was written. The loader honors a rank only
--                  while it's fresh (see RERANK_FRESH_HOURS in home-loader),
--                  so a stale rank silently falls back to trending_score with
--                  no cleanup job required.
--
-- Both columns are additive + nullable; existing rows and the cluster job are
-- unaffected. Safe to re-run.

alter table topics add column if not exists rerank_rank int;
alter table topics add column if not exists reranked_at timestamptz;

-- story_buckets gains rerank_rank + reranked_at in its output so the loader can
-- apply the comparative order. Everything else is identical to migration 018;
-- the function still LIMITs the candidate set by trending_score and the loader
-- does the final rerank-aware sort (it needs now() for the freshness check).
--
-- Adding columns to a RETURNS TABLE changes the function's return type, which
-- CREATE OR REPLACE refuses ("cannot change return type of existing function"),
-- so drop the old signature first. Arg list is unchanged: (text, int, int).
drop function if exists story_buckets(text, int, int);

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
  rerank_rank     integer,
  reranked_at     timestamptz,
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
      i.raw ->> 'publisher_name'                 as publisher_name,
      i.raw ->> 'publisher_slug'                 as publisher_slug,
      s.slug                                     as source_slug,
      s.name                                     as source_name,
      s.kind                                     as source_kind,
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
          's3_storage_id',   mr.s3_storage_id,
          'thumb_url',       mr.thumb_url,
          'caveman_summary', mr.caveman_summary,
          'publisher_name',  mr.publisher_name,
          'publisher_slug',  mr.publisher_slug,
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
    rt.rerank_rank,
    rt.reranked_at,
    rt.last_updated_at,
    coalesce(ma.members, '[]'::jsonb) as members
  from ranked_topics rt
  left join members_agg ma on ma.topic_id = rt.id
  order by rt.trending_score desc;
$$;
