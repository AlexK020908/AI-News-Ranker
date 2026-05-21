-- ai-news-feed :: expose thumbnail data to the frontend.
-- Story buckets now include:
--   s3_storage_id  — set when the enrich step uploaded a thumbnail to S3.
--                    Composed into a URL by the frontend via S3_PUBLIC_BASE_URL.
--   thumb_url      — the original publisher CDN URL captured by the RSS
--                    adapter (raw.thumbnail_candidate_url). Used as a fallback
--                    when s3_storage_id is null (i.e. S3_BUCKET unconfigured).
--
-- The frontend prefers s3_storage_id when present (durable, hotlink-safe),
-- falls back to thumb_url, and finally to the design's CSS-gradient panel.
--
-- Safe to re-run — replaces the function in place.

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
