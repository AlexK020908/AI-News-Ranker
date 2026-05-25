-- ai-news-feed :: synthesized briefs (X, later YC)
--
-- A `brief` is an AI-written synthesis of a surface's recent activity — the
-- "just tell me what's happening" read that sits on top of the cluster grid.
-- Generic on `surface` so the same machinery serves /x now and /yc later.
-- One row per generation; readers take the most recent for a surface.
--
-- Mirrors the `digests` table (005) but decoupled from the UTC-day email claim:
-- briefs regenerate on their own cadence (see /api/jobs/x-brief).
-- Safe to re-run.

create table if not exists briefs (
  id           uuid primary key default uuid_generate_v4(),
  surface      text        not null,   -- 'x' | 'yc' | ...
  period_start timestamptz not null,
  period_end   timestamptz not null,
  markdown     text        not null,
  sections     jsonb,
  model        text,
  item_count   integer     not null default 0,
  generated_at timestamptz not null default now()
);

create index if not exists briefs_surface_generated_idx
  on briefs (surface, generated_at desc);

alter table briefs enable row level security;

drop policy if exists "public read briefs" on briefs;
create policy "public read briefs" on briefs for select using (true);
