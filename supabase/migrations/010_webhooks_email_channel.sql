-- stackBrief :: multi-channel subscribers
--
-- The webhooks table started life as Discord-only. To support email
-- subscribers (with double opt-in) we extend it in-place rather than fork a
-- parallel table — notify/digest jobs already scan one table and the
-- semantics (categories, min_importance, manage_token, is_digest, enabled,
-- delivery counts) are identical regardless of delivery channel.
--
-- New shape per row:
--   kind         'discord' | 'email'             (default 'discord')
--   url          Discord webhook URL              (required when kind='discord')
--   email        recipient address                (required when kind='email')
--   confirmed_at timestamptz                      (set after double-opt-in click)
--
-- Existing Discord rows keep working: kind defaults to 'discord' and the
-- relaxed URL check still validates discord.com / discordapp.com / canary /
-- ptb host prefixes for those rows.
--
-- Safe to re-run.

alter table webhooks
  add column if not exists kind text not null default 'discord',
  add column if not exists email text,
  add column if not exists confirmed_at timestamptz;

-- The old check was Discord-only and would explode on insert of an email
-- row. The replacement is kind-aware and enforces exactly-one channel
-- target per row.
alter table webhooks drop constraint if exists webhooks_url_format;
alter table webhooks drop constraint if exists webhooks_kind_check;
alter table webhooks add constraint webhooks_kind_check
  check (kind in ('discord', 'email'));

-- Email rows don't have a url; allow null and enforce shape through the
-- channel-target check below.
alter table webhooks alter column url drop not null;

alter table webhooks drop constraint if exists webhooks_channel_target;
alter table webhooks add constraint webhooks_channel_target check (
  (
    kind = 'discord'
    and email is null
    and url is not null
    and (
      url like 'https://discord.com/api/webhooks/%'
      or url like 'https://discordapp.com/api/webhooks/%'
      or url like 'https://canary.discord.com/api/webhooks/%'
      or url like 'https://ptb.discord.com/api/webhooks/%'
    )
  )
  or
  (
    kind = 'email'
    and url is null
    and email is not null
    and position('@' in email) > 1
    and length(email) <= 254
  )
);

-- Unique on email so we don't re-subscribe the same address twice. This MUST
-- be a plain (non-partial) unique constraint, NOT a partial index: the
-- subscribe upsert uses `ON CONFLICT (email)` with no predicate, and Postgres
-- refuses to infer a PARTIAL index as the conflict arbiter without its WHERE
-- predicate ("there is no unique or exclusion constraint matching the ON
-- CONFLICT specification"). A plain unique still allows multiple NULL emails
-- (Discord rows), so it's equivalent for dedup. Drop the old partial index if
-- a prior version of this migration created it.
drop index if exists webhooks_email_unique;
alter table webhooks drop constraint if exists webhooks_email_unique;
alter table webhooks add constraint webhooks_email_unique unique (email);

-- Delivery-side query helper: notify/digest jobs fetch confirmed email
-- subs and skip pending ones. This index makes that scan cheap.
create index if not exists webhooks_email_confirmed_idx
  on webhooks (enabled, confirmed_at)
  where kind = 'email' and enabled = true and confirmed_at is not null;
