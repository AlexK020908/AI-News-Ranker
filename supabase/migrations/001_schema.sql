-- ai-news-feed :: consolidated initial schema
-- Run in a Supabase project's SQL editor, or via `supabase db push`.
-- Seed data (sources + reputation) lives in ../seed/sources.sql.

-- 1. Extensions ----------------------------------------------------------

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pg_trgm;

-- 2. Enums ---------------------------------------------------------------

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

-- 3. sources -------------------------------------------------------------

create table if not exists sources (
  id                 uuid primary key default uuid_generate_v4(),
  slug               text unique not null,
  name               text not null,
  kind               source_kind not null,
  config             jsonb not null default '{}'::jsonb,
  poll_interval_sec  integer not null default 900,
  enabled            boolean not null default true,
  reputation_weight  float not null default 1.0
    check (reputation_weight >= 0 and reputation_weight <= 3.0),
  last_polled_at     timestamptz,
  last_error         text,
  created_at         timestamptz not null default now()
);

-- 4. items ---------------------------------------------------------------

create table if not exists items (
  id                           uuid primary key default uuid_generate_v4(),
  source_id                    uuid not null references sources(id) on delete cascade,
  external_id                  text not null,
  url                          text not null,
  title                        text not null,
  author                       text,
  content                      text,
  content_hash                 text,
  summary                      text,
  category                     item_category,
  tags                         text[] not null default array[]::text[],
  importance                   integer check (importance is null or (importance >= 0 and importance <= 100)),
  embedding                    vector(1024),
  duplicate_of                 uuid references items(id) on delete set null,
  duplicate_count              integer not null default 0,
  engagement_score             integer not null default 0
                                 check (engagement_score between 0 and 100),
  source_weight_sum            float   not null default 1.0,
  topic_size                   integer not null default 0,
  paper_citations              integer,
  paper_influential_citations  integer,
  paper_tldr                   text,
  published_at                 timestamptz,
  ingested_at                  timestamptz not null default now(),
  enriched_at                  timestamptz,
  enrich_error                 text,
  raw                          jsonb,
  constraint items_url_unique             unique (url),
  constraint items_source_external_unique unique (source_id, external_id)
);

create index if not exists items_published_desc     on items (published_at desc nulls last);
create index if not exists items_ingested_desc      on items (ingested_at desc);
create index if not exists items_importance_desc    on items (importance desc nulls last);
create index if not exists items_category           on items (category);
create index if not exists items_unenriched         on items (enriched_at) where enriched_at is null;
create index if not exists items_title_trgm         on items using gin (title gin_trgm_ops);
create index if not exists items_summary_trgm       on items using gin (summary gin_trgm_ops);
create index if not exists items_duplicate_of_idx   on items (duplicate_of) where duplicate_of is not null;
create index if not exists items_duplicate_count_idx on items (duplicate_count desc) where duplicate_of is null;
create index if not exists items_engagement_idx    on items (engagement_score desc) where duplicate_of is null;
create index if not exists items_topic_size_idx    on items (topic_size desc) where duplicate_of is null and topic_size > 0;

-- Vector index — ivfflat requires ANALYZE/data for lists tuning; start conservative.
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'items_embedding_ivf') then
    create index items_embedding_ivf
      on items using ivfflat (embedding vector_cosine_ops)
      with (lists = 100);
  end if;
end $$;

-- 5. webhooks ------------------------------------------------------------

create table if not exists webhooks (
  id                uuid primary key default uuid_generate_v4(),
  url               text unique not null,
  min_importance    integer not null default 80
                      check (min_importance between 0 and 100),
  categories        item_category[] not null default array[]::item_category[],
  enabled           boolean not null default true,
  manage_token      text not null,
  created_at        timestamptz not null default now(),
  last_delivered_at timestamptz,
  delivery_count    integer not null default 0,
  constraint webhooks_url_format check (
    url like 'https://discord.com/api/webhooks/%'
    or url like 'https://discordapp.com/api/webhooks/%'
    or url like 'https://canary.discord.com/api/webhooks/%'
    or url like 'https://ptb.discord.com/api/webhooks/%'
  )
);

create index if not exists webhooks_enabled_idx
  on webhooks (enabled, min_importance)
  where enabled = true;

create table if not exists webhook_deliveries (
  webhook_id   uuid not null references webhooks(id) on delete cascade,
  item_id      uuid not null references items(id)    on delete cascade,
  delivered_at timestamptz not null default now(),
  status       text not null default 'ok',
  primary key (webhook_id, item_id)
);

create index if not exists webhook_deliveries_item_idx
  on webhook_deliveries (item_id);

-- 6. topics --------------------------------------------------------------
-- Clusters of related items computed offline by /api/cron/cluster-topics and
-- surfaced as browsable entities: "Reasoning models · 7 items this week".

create table if not exists topics (
  id              uuid primary key default uuid_generate_v4(),
  slug            text unique not null,
  label           text not null,
  summary         text,
  member_count    integer not null default 0,
  avg_importance  float,
  max_importance  integer,
  trending_score  float not null default 0,
  centroid        vector(1024),
  -- Stable signature of sorted member IDs; lets the cron skip re-labeling an
  -- unchanged cluster on the next run.
  member_hash     text,
  first_seen_at   timestamptz not null default now(),
  last_updated_at timestamptz not null default now()
);

create index if not exists topics_trending_idx     on topics (trending_score desc);
create index if not exists topics_last_updated_idx on topics (last_updated_at desc);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'topics_centroid_ivf') then
    create index topics_centroid_ivf
      on topics using ivfflat (centroid vector_cosine_ops)
      with (lists = 50);
  end if;
end $$;

create table if not exists topic_members (
  topic_id   uuid not null references topics(id) on delete cascade,
  item_id    uuid not null references items(id)  on delete cascade,
  similarity float,
  primary key (topic_id, item_id)
);

create index if not exists topic_members_item_idx  on topic_members (item_id);
create index if not exists topic_members_topic_idx on topic_members (topic_id);

-- 7. RLS -----------------------------------------------------------------

alter table sources            enable row level security;
alter table items              enable row level security;
alter table webhooks           enable row level security;
alter table webhook_deliveries enable row level security;
alter table topics             enable row level security;
alter table topic_members      enable row level security;

drop policy if exists "public read enabled sources" on sources;
create policy "public read enabled sources"
  on sources for select
  using (enabled = true);

drop policy if exists "public read enriched items" on items;
create policy "public read enriched items"
  on items for select
  using (enriched_at is not null);

drop policy if exists "public read topics" on topics;
create policy "public read topics"
  on topics for select using (true);

drop policy if exists "public read topic_members" on topic_members;
create policy "public read topic_members"
  on topic_members for select using (true);

-- webhooks / webhook_deliveries: no policies → anon + authenticated have zero
-- access. Registration/delete/notify go through server routes (service role).

-- 8. Realtime ------------------------------------------------------------
-- Publish inserts/updates to `items` so the feed stays live.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table items;
  end if;
end $$;

-- 9. Triggers ------------------------------------------------------------
-- Initialize source_weight_sum from the source's reputation on every insert.

create or replace function init_item_weight() returns trigger
language plpgsql
as $$
begin
  select reputation_weight into new.source_weight_sum
    from sources where id = new.source_id;
  if new.source_weight_sum is null then new.source_weight_sum := 1.0; end if;
  return new;
end;
$$;

drop trigger if exists items_init_weight on items;
create trigger items_init_weight
  before insert on items
  for each row execute function init_item_weight();

-- 10. Functions ----------------------------------------------------------

-- Nearest-neighbour search across all items.
create or replace function similar_items(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int
)
returns table (id uuid, title text, url text, similarity float)
language sql stable
as $$
  select i.id, i.title, i.url, 1 - (i.embedding <=> query_embedding) as similarity
    from items i
   where i.embedding is not null
     and 1 - (i.embedding <=> query_embedding) >= match_threshold
   order by i.embedding <=> query_embedding
   limit match_count;
$$;

-- Like similar_items, but constrained to enriched non-duplicates in the last
-- N hours. Used during enrichment to collapse cross-source duplicates.
create or replace function similar_recent_items(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int,
  since_hours     int
)
returns table (id uuid, title text, url text, similarity float)
language sql stable
as $$
  select i.id, i.title, i.url, 1 - (i.embedding <=> query_embedding) as similarity
    from items i
   where i.embedding is not null
     and i.duplicate_of is null
     and i.enriched_at is not null
     and i.enriched_at > now() - make_interval(hours => since_hours)
     and 1 - (i.embedding <=> query_embedding) >= match_threshold
   order by i.embedding <=> query_embedding
   limit match_count;
$$;

-- Atomic, weight-aware dup bump. Called from /api/cron/enrich after marking a
-- new item as a duplicate of canonical_id. dup_weight comes from the source's
-- reputation so primary-lab dups count more than community echoes.
create or replace function bump_duplicate_count(
  canonical_id uuid,
  dup_weight   float default 1.0
)
returns integer
language sql
as $$
  update items
     set duplicate_count   = duplicate_count + 1,
         source_weight_sum = source_weight_sum + dup_weight
   where id = canonical_id
     and duplicate_of is null
  returning duplicate_count;
$$;

-- Count near-neighbours for every non-duplicate enriched item in the last
-- window_hours; stored in items.topic_size. Looser than the dup threshold so
-- it catches related-but-distinct items (e.g. 5 different reasoning-model papers).
create or replace function recompute_topic_sizes(
  window_hours    int   default 48,
  topic_threshold float default 0.72
)
returns integer
language plpgsql
as $$
declare affected int;
begin
  with recent as (
    select id, embedding
      from items
     where embedding is not null
       and duplicate_of is null
       and enriched_at is not null
       and enriched_at > now() - make_interval(hours => window_hours)
  ),
  sizes as (
    select a.id, count(*) filter (where a.id <> b.id) as neighbors
      from recent a
      join recent b
        on 1 - (a.embedding <=> b.embedding) >= topic_threshold
     group by a.id
  )
  update items i
     set topic_size = coalesce(s.neighbors, 0)
    from sizes s
   where i.id = s.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Per-item trending score. Blends importance, engagement, trust-weighted
-- cross-source velocity, topic-cluster size, and paper citation bonus, then
-- decays by age. `source_kinds` is the UI tab filter (papers/github/huggingface/
-- discussion/news) — null means "all kinds".
create or replace function trending_items(
  min_importance int    default 0,
  cat            text   default null,
  source_kinds   text[] default null,
  max_rows       int    default 60,
  dup_weight     float  default 10.0,
  topic_weight   float  default 3.0,
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

-- Top trending topics for the homepage strip.
create or replace function top_topics(max_rows int default 12)
returns table (
  id              uuid,
  slug            text,
  label           text,
  summary         text,
  member_count    integer,
  avg_importance  float,
  max_importance  integer,
  trending_score  float,
  last_updated_at timestamptz
)
language sql stable
as $$
  select id, slug, label, summary, member_count, avg_importance,
         max_importance, trending_score, last_updated_at
    from topics
   where member_count >= 3
   order by trending_score desc
   limit max_rows;
$$;
