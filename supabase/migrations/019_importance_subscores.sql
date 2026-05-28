-- ai-news-feed :: importance sub-scores
--
-- Stores the raw 1-5 ordinal axis ratings Claude returns during enrichment
-- (novelty / impact / credibility / actionability). The final `importance`
-- 0-100 integer is computed deterministically from these axes plus row
-- signals (engagement_score, source.reputation_weight, paper citations)
-- in lib/anthropic/scoring.ts at enrich time, then stored on items.importance
-- so all downstream consumers (trending_items, item-card tiers, subscriber
-- min_importance gates) keep reading the same column unchanged.
--
-- JSONB rather than four int columns so the axis set can evolve without
-- another migration. No index — sorting/filtering still happens on
-- items.importance via items_importance_desc.
--
-- Old rows leave sub_scores NULL and retain their existing importance value
-- until /api/jobs/enrich?backfill_importance=1 re-runs Claude on them.
--
-- Safe to re-run.

alter table items
  add column if not exists sub_scores jsonb;
