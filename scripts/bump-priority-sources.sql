-- One-shot: tier the live sources by polling priority.
-- Paste into the Supabase SQL editor (Dashboard → SQL → Run).
-- Idempotent — re-running is safe; values just get re-set to the same numbers.
--
-- Tier definitions:
--   300s  = tier-1: frontier-lab announcements + HN front page (~5 min cadence)
--   900s  = tier-2: fast first-party news (~15 min)
--   1800s = tier-3: standard outlets (~30 min)
--   3600s = tier-4: papers, technical blogs (~1 hr)
--   7200s+ = tier-5: long-tail / weekly newsletters
--
-- The new lib/ingest/run.ts:isDue gate respects these per-source. The worker
-- ticks every ~3 min (WORKER_INTERVAL_SEC=180 default in scripts/worker.mjs),
-- so each source polls at its own interval, not the worker's.

update sources
set poll_interval_sec = 300
where slug in (
  'openai-blog',
  'anthropic-news',
  'claude-blog',
  'deepmind-blog',
  'google-ai-blog',
  'hackernews-ai'
);

-- Verify
select slug, poll_interval_sec, last_polled_at
from sources
where enabled = true
order by poll_interval_sec, slug;
