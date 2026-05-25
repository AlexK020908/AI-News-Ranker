-- ai-news-feed :: scope semantic dedup to a single surface
--
-- similar_recent_items (001) had no source-kind filter, so the enrich dedup
-- step could mark a tweet duplicate_of an article (tweet then vanishes from /x)
-- or an article duplicate_of a tweet (article vanishes from the feed) — defeating
-- the X-isolation guarantee at the enrich layer, before any kind-based split.
--
-- Adds an optional `restrict_twitter` partition:
--   null  → match across all items (back-compat; unused now)
--   true  → match only twitter-kind items (tweet dedups against tweets)
--   false → match only non-twitter items (article dedups against articles)
--
-- Uses s.kind::text so the function body carries no 'twitter' enum literal —
-- safe to apply regardless of whether 011 has committed in this session.
-- Safe to re-run.

create or replace function similar_recent_items(
  query_embedding  vector(1024),
  match_threshold  float,
  match_count      int,
  since_hours      int,
  restrict_twitter boolean default null
)
returns table (id uuid, title text, url text, similarity float)
language sql stable
as $$
  select i.id, i.title, i.url, 1 - (i.embedding <=> query_embedding) as similarity
    from items i
    join sources s on s.id = i.source_id
   where i.embedding is not null
     and i.duplicate_of is null
     and i.enriched_at is not null
     and i.enriched_at > now() - make_interval(hours => since_hours)
     and 1 - (i.embedding <=> query_embedding) >= match_threshold
     and (
       restrict_twitter is null
       or (restrict_twitter     and s.kind::text =  'twitter')
       or (not restrict_twitter and s.kind::text <> 'twitter')
     )
   order by i.embedding <=> query_embedding
   limit match_count;
$$;
