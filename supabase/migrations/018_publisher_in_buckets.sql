-- ai-news-feed :: surface publisher overrides in story_buckets + notable_solo_items
--
-- Aggregator sources (Techmeme, etc.) store the real publisher name/slug in
-- items.raw so cards credit the original outlet. This migration exposes those
-- fields in the member JSON returned by both RPCs.
--
-- Shape-compatible: two new nullable keys added to each member object.
-- Safe to re-run.

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
    rt.last_updated_at,
    coalesce(ma.members, '[]'::jsonb) as members
  from ranked_topics rt
  left join members_agg ma on ma.topic_id = rt.id
  order by rt.trending_score desc;
$$;


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
      i.raw ->> 'publisher_name'          as publisher_name,
      i.raw ->> 'publisher_slug'          as publisher_slug,
      s.slug as source_slug,
      s.name as source_name,
      s.kind as source_kind,
      extract(epoch from (now() - i.ingested_at)) / 3600.0
        as age_hours
    from items i
    join sources s on s.id = i.source_id
    where i.duplicate_of is null
      and i.enriched_at is not null
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
        'publisher_name',  e.publisher_name,
        'publisher_slug',  e.publisher_slug,
        'source_slug',     e.source_slug,
        'source_name',     e.source_name,
        'source_kind',     e.source_kind
      )
    )                                                        as members
  from eligible e
  order by trending_score desc
  limit max_rows;
$$;
