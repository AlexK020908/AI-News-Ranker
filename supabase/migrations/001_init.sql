-- ai-news-feed :: initial schema
-- Run in a Supabase project's SQL editor, or via `supabase db push` if using CLI.

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pg_trgm;

-- Enums ---------------------------------------------------------------

do $$ begin
  create type item_category as enum (
    'paper','model','release','repo','funding',
    'announcement','discussion','tool','news','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_kind as enum (
    'rss','arxiv','github_trending','github_search',
    'hackernews','reddit','huggingface_models','huggingface_datasets','custom'
  );
exception when duplicate_object then null; end $$;

-- sources -------------------------------------------------------------

create table if not exists sources (
  id                uuid primary key default uuid_generate_v4(),
  slug              text unique not null,
  name              text not null,
  kind              source_kind not null,
  config            jsonb not null default '{}'::jsonb,
  poll_interval_sec integer not null default 900,
  enabled           boolean not null default true,
  last_polled_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

-- items ---------------------------------------------------------------

create table if not exists items (
  id            uuid primary key default uuid_generate_v4(),
  source_id     uuid not null references sources(id) on delete cascade,
  external_id   text not null,
  url           text not null,
  title         text not null,
  author        text,
  content       text,
  content_hash  text,
  summary       text,
  category      item_category,
  tags          text[] not null default array[]::text[],
  importance    integer check (importance is null or (importance >= 0 and importance <= 100)),
  embedding     vector(1024),
  published_at  timestamptz,
  ingested_at   timestamptz not null default now(),
  enriched_at   timestamptz,
  enrich_error  text,
  raw           jsonb,
  constraint items_url_unique unique (url),
  constraint items_source_external_unique unique (source_id, external_id)
);

create index if not exists items_published_desc
  on items (published_at desc nulls last);
create index if not exists items_ingested_desc
  on items (ingested_at desc);
create index if not exists items_importance_desc
  on items (importance desc nulls last);
create index if not exists items_category
  on items (category);
create index if not exists items_unenriched
  on items (enriched_at)
  where enriched_at is null;
create index if not exists items_title_trgm
  on items using gin (title gin_trgm_ops);
create index if not exists items_summary_trgm
  on items using gin (summary gin_trgm_ops);

-- Vector index — ivfflat requires ANALYZE/data for lists tuning; start conservative.
do $$ begin
  if not exists (
    select 1 from pg_indexes where indexname = 'items_embedding_ivf'
  ) then
    create index items_embedding_ivf
      on items using ivfflat (embedding vector_cosine_ops)
      with (lists = 100);
  end if;
end $$;

-- Row-level security --------------------------------------------------

alter table sources enable row level security;
alter table items   enable row level security;

drop policy if exists "public read enabled sources" on sources;
create policy "public read enabled sources"
  on sources for select
  using (enabled = true);

drop policy if exists "public read enriched items" on items;
create policy "public read enriched items"
  on items for select
  using (enriched_at is not null);

-- Realtime: publish inserts/updates to `items` so the feed stays live.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table items;
  end if;
end $$;

-- Helper RPC: similar_items(embedding, threshold, limit)
create or replace function similar_items(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int
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
    and 1 - (i.embedding <=> query_embedding) >= match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
