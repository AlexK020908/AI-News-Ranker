-- Post-ingest pipeline assertions.
--
-- Run AFTER one successful `docker compose up` cycle (or the equivalent — at
-- least one full pass of /api/jobs/ingest + /api/jobs/enrich + /api/jobs/cluster-topics).
--
-- Each block is independent — you can run them top to bottom in the Supabase
-- SQL editor. A green ✓ means the assertion holds; ✗ means something is wrong.
--
-- These queries assume the migration 002_infra.sql has been applied (region,
-- xml, s3_storage_id columns + story_buckets RPC exist).

\echo '===== 1. Source health ====='
-- Every enabled source should have been polled at least once. Sources with
-- last_polled_at NULL means the worker never reached them.
select
  enabled,
  count(*) filter (where last_polled_at is not null) as polled,
  count(*) filter (where last_polled_at is null)     as never_polled,
  count(*) filter (where last_error is not null)     as has_error
from sources
group by enabled
order by enabled desc;

\echo '===== 2. Items per source (last 24h) ====='
-- A source that polled but ingested 0 items in 24h is a smoke alarm.
select
  s.slug,
  s.kind,
  s.region,
  s.last_polled_at::date as polled_on,
  count(i.id)            as items_24h,
  count(i.id) filter (where i.enriched_at is not null) as enriched_24h,
  count(i.id) filter (where i.duplicate_of is not null) as duplicates_24h
from sources s
left join items i
  on i.source_id = s.id
 and i.ingested_at > now() - interval '24 hours'
where s.enabled = true
group by s.id, s.slug, s.kind, s.region, s.last_polled_at
order by items_24h desc;

\echo '===== 3. Region distribution ====='
-- The region column was added in 002. Every row should have a non-null
-- region (defaulting to 'global'). If you see NULL here, the default isn't
-- being applied — check the upsert path.
select region, count(*) as item_count
from items
group by region
order by item_count desc;

\echo '===== 4. items.xml population ====='
-- RSS + crawler adapters write per-item XML to items.xml. RSS sources should
-- be near 100%; arxiv/github/hackernews/huggingface sources don't write XML
-- so they should be near 0%.
select
  s.kind,
  count(i.id)                                      as items,
  count(i.id) filter (where i.xml is not null)     as with_xml,
  round(
    100.0 * count(i.id) filter (where i.xml is not null) / nullif(count(i.id), 0),
    1
  ) as pct_with_xml
from items i
join sources s on s.id = i.source_id
where i.ingested_at > now() - interval '24 hours'
group by s.kind
order by s.kind;

\echo '===== 5. Thumbnail candidates captured ====='
-- The RSS adapter stashes the thumbnail URL in raw.thumbnail_candidate_url
-- when the feed exposes one. Feeds with media:* extensions or enclosures
-- should populate this.
select
  s.slug,
  count(*) as items,
  count(*) filter (where i.raw ? 'thumbnail_candidate_url') as with_candidate,
  count(*) filter (where i.s3_storage_id is not null)       as uploaded_to_s3
from items i
join sources s on s.id = i.source_id
where s.kind in ('rss', 'crawler')
  and i.ingested_at > now() - interval '24 hours'
group by s.slug
having count(*) > 0
order by with_candidate desc, items desc
limit 30;

\echo '===== 6. Enrichment health ====='
-- After enrich runs, every item should have either enriched_at OR enrich_error
-- set. Items stuck in "neither" mean enrich never reached them — usually a
-- backlog (raise the limit) or a Claude API failure.
select
  count(*)                                                              as total,
  count(*) filter (where enriched_at is not null)                       as enriched,
  count(*) filter (where enrich_error is not null)                      as errored,
  count(*) filter (where enriched_at is null and enrich_error is null)  as pending
from items
where ingested_at > now() - interval '24 hours';

\echo '===== 7. Dedup is firing ====='
-- The enrich step marks duplicates via the embedding-based RPC. If 0 items
-- are duplicate_of, either the corpus is too small or the threshold is wrong.
select
  count(*) filter (where duplicate_of is not null) as marked_duplicates,
  count(*) filter (where duplicate_count > 0)      as canonicals_with_dups,
  max(duplicate_count)                              as max_dup_cluster_size
from items
where enriched_at is not null
  and enriched_at > now() - interval '7 days';

\echo '===== 8. Topic clustering produced output ====='
-- cluster-topics job should be producing topics with >= 2 members.
select
  count(*)               as topic_count,
  avg(member_count)::int as avg_members,
  max(member_count)      as max_members,
  count(*) filter (where last_updated_at > now() - interval '12 hours') as fresh_topics
from topics;

\echo '===== 9. story_buckets RPC returns sane shape ====='
-- Calls the RPC directly and checks: topics returned, member jsonb is an
-- array, members have the expected keys.
with sb as (select * from story_buckets(null, 5, 4))
select
  count(*) as story_count,
  count(*) filter (where jsonb_typeof(members) = 'array') as members_is_array,
  count(*) filter (where members @> '[{"title": null}]'::jsonb) as null_titles_present,
  -- Pluck the first member of the first story for a shape spot-check
  (select members -> 0 ->> 'title' from sb limit 1) as sample_title,
  (select members -> 0 ->> 'source_name' from sb limit 1) as sample_source
from sb;

\echo '===== 10. Crawler adapter produced rows ====='
-- The crawler sources are new. They should have produced rows like any other
-- adapter. If items_count is 0 for an enabled crawler, the selectors are
-- probably stale.
select
  s.slug,
  s.enabled,
  s.last_polled_at,
  s.last_error,
  count(i.id) as items_ever
from sources s
left join items i on i.source_id = s.id
where s.kind = 'crawler'
group by s.id, s.slug, s.enabled, s.last_polled_at, s.last_error
order by s.enabled desc, items_ever desc;

\echo '===== 11. Engagement (unique hourly views/clicks per topic, last 1h) ====='
-- The Redis SET-NX dedup gate guarantees these are unique sids per hour,
-- not raw beacon counts. Populated by /api/events from sendBeacon calls in
-- StoryPanel. If this returns 0 rows the frontend probably isn't firing
-- events — open browser devtools and check the network tab for /api/events.
select
  t.label,
  e.unique_hourly_views  as uniq_views,
  e.unique_hourly_clicks as uniq_clicks
from engaged_topics(1) e
join topics t on t.id = e.topic_id
order by e.unique_hourly_views desc
limit 20;

\echo '===== 12. Sources with persistent errors ====='
-- Run the verifier (scripts/verify-sources.mjs) for the network-facing
-- view; this query shows the *server-side* view of which sources keep
-- failing to ingest.
select slug, kind, last_error, last_polled_at
from sources
where enabled = true and last_error is not null
order by last_polled_at desc nulls last;
