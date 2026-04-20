-- ai-news-feed :: semantic dedup
-- Adds duplicate_of pointer + time-windowed similarity RPC used during enrichment.

alter table items
  add column if not exists duplicate_of uuid references items(id) on delete set null;

create index if not exists items_duplicate_of_idx
  on items(duplicate_of)
  where duplicate_of is not null;

-- Like similar_items, but constrained to enriched non-duplicates in the last N hours.
-- Used during enrichment to collapse cross-source duplicates of the same story.
create or replace function similar_recent_items(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int,
  since_hours     int
)
returns table (
  id         uuid,
  title      text,
  url        text,
  similarity float
)
language sql stable
as $$
  select
    i.id,
    i.title,
    i.url,
    1 - (i.embedding <=> query_embedding) as similarity
  from items i
  where i.embedding is not null
    and i.duplicate_of is null
    and i.enriched_at is not null
    and i.enriched_at > now() - make_interval(hours => since_hours)
    and 1 - (i.embedding <=> query_embedding) >= match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
