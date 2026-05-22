-- ai-news-feed :: caveman_summary on items
--
-- A plain-English explanation for papers, written like you're explaining
-- the work to a curious friend who doesn't know the jargon. The existing
-- `summary` field stays academic — caveman_summary is the dumbed-down
-- companion shown on paper cards/detail views.
--
-- Populated by the enrich job for items where category='paper'. Null for
-- everything else.
--
-- Safe to re-run.

alter table items
  add column if not exists caveman_summary text;
