-- ai-news-feed :: elevate cross-source corroboration in the per-item feed.
--
-- Part of the ranking redesign that leans LESS on the LLM-derived `importance`
-- number and MORE on observable signals. Cross-source corroboration (how many
-- independent reputable outlets covered the same story, carried here as
-- topic_size + source_weight_sum) is the gold-standard, hard-to-game signal
-- (see lib/stories.ts). The only change vs. the 001 definition is the
-- topic_weight default: 3.0 -> 6.0, so a story corroborated by several sources
-- outranks a solo item whose high score is a single model's opinion.
--
-- This function powers the digest + category/tab feeds. The homepage cluster
-- ordering has the analogous change in code: topicTrending() in
-- app/api/jobs/cluster-topics/route.ts raised its member_count exponent 0.5->0.6.
--
-- Idempotent: create-or-replace, same signature except the default value, so
-- existing callers that pass topic_weight explicitly are unaffected.

create or replace function trending_items(
  min_importance int    default 0,
  cat            text   default null,
  source_kinds   text[] default null,
  max_rows       int    default 60,
  dup_weight     float  default 10.0,
  topic_weight   float  default 6.0,
  decay_exponent float  default 1.5
)
returns table (
  id                          uuid,
  source_id                   uuid,
  external_id                 text,
  url                         text,
  title                       text,
  author                      text,
  content                     text,
  content_hash                text,
  summary                     text,
  category                    item_category,
  tags                        text[],
  importance                  integer,
  engagement_score            integer,
  source_weight_sum           float,
  topic_size                  integer,
  paper_citations             integer,
  paper_influential_citations integer,
  paper_tldr                  text,
  published_at                timestamptz,
  ingested_at                 timestamptz,
  enriched_at                 timestamptz,
  enrich_error                text,
  duplicate_of                uuid,
  duplicate_count             integer,
  trending_score              float
)
language sql stable
as $$
  select
    i.id, i.source_id, i.external_id, i.url, i.title, i.author, i.content,
    i.content_hash, i.summary, i.category, i.tags, i.importance,
    i.engagement_score, i.source_weight_sum, i.topic_size,
    i.paper_citations, i.paper_influential_citations, i.paper_tldr,
    i.published_at, i.ingested_at, i.enriched_at, i.enrich_error,
    i.duplicate_of, i.duplicate_count,
    (
      coalesce(i.importance, 0)::float
      + i.engagement_score::float * 0.3
      + i.source_weight_sum * dup_weight
      + i.topic_size::float * topic_weight
      + case
          when i.paper_influential_citations is null then 0
          when i.paper_influential_citations = 0    then 0
          else 20 + least(i.paper_influential_citations * 5, 40)
        end
    ) / power(
      greatest(
        extract(epoch from (now() - coalesce(i.published_at, i.ingested_at))) / 3600.0,
        0
      ) + 2.0,
      decay_exponent
    ) as trending_score
  from items i
  join sources s on s.id = i.source_id
  where i.enriched_at is not null
    and i.duplicate_of is null
    and (min_importance <= 0 or coalesce(i.importance, 0) >= min_importance)
    and (cat is null or i.category::text = cat)
    and (source_kinds is null or s.kind::text = any(source_kinds))
  order by trending_score desc
  limit max_rows;
$$;
