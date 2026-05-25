-- ai-news-feed :: twitter source kind
--
-- Adds 'twitter' to the source_kind enum so X/Twitter accounts can be
-- registered as sources and ingested via lib/ingest/twitter.ts (twitterapi.io).
--
-- Kept ALONE in its own migration, mirroring 007 (huggingface_papers): Postgres
-- forbids using a freshly added enum value in the same transaction that adds it.
-- This ALTER must commit before seed.sql inserts kind='twitter' rows. (Migration
-- 012 deliberately uses s.kind::text rather than the 'twitter' enum literal, so
-- it does NOT depend on this having committed first.)
--
-- Safe to re-run.

alter type source_kind add value if not exists 'twitter';
