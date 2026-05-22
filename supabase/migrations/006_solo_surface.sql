-- ai-news-feed :: surface solo items
--
-- Two additive SQL functions that let the homepage show items BEFORE they
-- accumulate the 3-member cluster gate enforced by cluster-topics. The
-- design principle: a cluster isn't a prerequisite for visibility — it's an
-- aggregation that happens when related coverage arrives. Until then,
-- notable solo items still surface on their own.
--
--   1. trending_solo_repos(min_stars, days_back, max_rows)
--      Drives the new "Trending repos" lane on the homepage. Returns
--      GitHub items with stars >= min_stars that aren't already a member
--      of any topic. Ordered by stars desc.
--
--   2. notable_solo_items(in_region, days_back, max_rows, min_importance)
--      Returns enriched items not in any cluster, shaped exactly like the
--      rows from story_buckets so the homepage can merge them with real
--      clusters and sort by trending_score with no special-casing.
--
-- Safe to re-run.
-- =====================================================================

-- 1. trending_solo_repos -----------------------------------------------
-- Solo GitHub repos (not in any cluster) ordered by stars. Used by the
-- Trending Repos strip — surface high-star, recently-pushed repos even
-- on their first sighting (no velocity history required).
--
-- The 3-arg variant is the original shape (no language/topic filters).
-- Drop it so we don't leave an unreachable overload behind when re-running.

drop function if exists trending_solo_repos(int, int, int);
drop function if exists trending_solo_repos(int, int, int, text, text);

create or replace function trending_solo_repos(
  min_stars     int  default 1000,
  days_back     int  default 7,
  max_rows      int  default 12,
  -- Exact-match against raw.language (Python, TypeScript, Rust, …). Null
  -- disables the filter. Case sensitive to match GitHub's canonical casing.
  in_language   text default null,
  -- Membership test against raw.topics (the GitHub topic tags array — not
  -- our internal topic_filter). Uses the jsonb `?` operator. Null disables.
  in_topic      text default null,
  -- Human language of the repo description (the text in items.content, which
  -- carries the original GitHub description before enrichment summarizes it
  -- into English). Detected via Unicode character class regex — cheap and
  -- works retroactively across all ingested items.
  --   'english'  → no CJK / Hangul / Cyrillic / Arabic / Devanagari chars
  --   'chinese'  → contains Han ideographs (covers Simplified + Traditional)
  --   'japanese' → contains Hiragana or Katakana (kanji overlaps with Chinese,
  --                so we require kana to disambiguate)
  --   'korean'   → contains Hangul syllables
  -- Null disables the filter.
  in_human_lang text default null
)
returns table (
  id              uuid,
  url             text,
  title           text,
  summary         text,
  category        item_category,
  importance      integer,
  published_at    timestamptz,
  stars           integer,
  language        text,
  topics          jsonb,
  s3_storage_id   text,
  thumb_url       text,
  source_slug     text,
  source_name     text,
  source_kind     source_kind
)
language sql stable
as $$
  select
    i.id,
    i.url,
    i.title,
    i.summary,
    i.category,
    i.importance,
    i.published_at,
    coalesce((i.raw ->> 'stars')::int, 0)                       as stars,
    i.raw ->> 'language'                                        as language,
    coalesce(i.raw -> 'topics', '[]'::jsonb)                    as topics,
    i.s3_storage_id,
    i.raw ->> 'thumbnail_candidate_url'                         as thumb_url,
    s.slug,
    s.name,
    s.kind
  from items i
  join sources s on s.id = i.source_id
  where s.kind in ('github_trending', 'github_search')
    and i.duplicate_of is null
    and i.published_at is not null
    and i.published_at > now() - make_interval(days => days_back)
    and coalesce((i.raw ->> 'stars')::int, 0) >= min_stars
    and (in_language is null or i.raw ->> 'language' = in_language)
    and (in_topic    is null or (i.raw -> 'topics') ? in_topic)
    and (
      in_human_lang is null
      or (in_human_lang = 'chinese'  and coalesce(i.content, '') ~ '[一-鿿]')
      or (in_human_lang = 'japanese' and coalesce(i.content, '') ~ '[ぁ-ヿ]')
      or (in_human_lang = 'korean'   and coalesce(i.content, '') ~ '[가-힯]')
      or (in_human_lang = 'english'
          and coalesce(i.content, '') !~ '[一-鿿ぁ-ヿ가-힯Ѐ-ӿ؀-ۿ]'
          and coalesce(i.content, '') <> '')
    )
    and not exists (
      select 1 from topic_members tm where tm.item_id = i.id
    )
  order by coalesce((i.raw ->> 'stars')::int, 0) desc, i.published_at desc
  limit max_rows;
$$;

-- 2. notable_solo_items ------------------------------------------------
-- Enriched items not yet in any topic cluster, shaped exactly like
-- story_buckets() output so app/page.tsx can concat + sort by
-- trending_score without branching. Each row is a "pseudo-cluster"
-- containing a single member.
--
-- Trending score formula matches the cluster-topics calculation:
--   impact / (age_hours + 2) ^ 1.1
-- with impact = importance * sqrt(1) = importance. This lets a fresh
-- importance-90 solo item outrank an older importance-70 3-member
-- cluster, which is the intended behavior — newness + signal beats
-- moldy corroboration.

-- 2026-05-22: switched recency anchor from published_at → ingested_at.
-- Slow-moving sources (HuggingFace models, arXiv) carry publish dates
-- days before we see them, so anchoring on publish silently starved the
-- homepage of "model"/"paper" items even though we ingested them today.
-- Anchoring on ingested_at means "what's new in OUR feed" — which is the
-- mental model the homepage advertises.
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
      s.slug as source_slug,
      s.name as source_name,
      s.kind as source_kind,
      -- Hours since WE ingested this. Aligns the ranking anchor with the
      -- filter above so an HF model we just discovered (but with an
      -- older publish date) still ranks high — "new to our feed" beats
      -- "new in the world" for homepage relevance.
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
        'source_slug',     e.source_slug,
        'source_name',     e.source_name,
        'source_kind',     e.source_kind
      )
    )                                                        as members
  from eligible e
  order by trending_score desc
  limit max_rows;
$$;
