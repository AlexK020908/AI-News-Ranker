-- ai-news-feed :: inline citations for briefs
--
-- Stores the citation map for a brief: keyed by the [n] markers the model emits
-- inline, each pointing at the source post(s) on X. The /x renderer turns each
-- [n] in the prose into a clickable chip (single post → direct link; cluster of
-- N posts → a small flyout of all N). Shape:
--   { "1": { "label": "Codex Expansion", "posts": [{"url":"...","handle":"OpenAI"}, ...] },
--     "2": { "label": "@karpathy",       "posts": [{"url":"...","handle":"karpathy"}] } }
--
-- Nullable: older briefs (and any brief where the model cited nothing) just have
-- no chips. Safe to re-run.

alter table briefs add column if not exists citations jsonb;
