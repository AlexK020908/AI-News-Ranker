# Email Subscription Setup (Resend)

> Status as of 2026-05-24: **NOT working end-to-end.** No sending email/domain configured yet.

## TL;DR

The entire email path (confirmation emails, item alerts, digests) runs through
**Resend** in `lib/email.ts`. It will not send anything until you:

1. Set `RESEND_API_KEY`
2. Verify a sending domain in Resend (DNS records)
3. Point `EMAIL_FROM` at an address on that verified domain

## The two hard requirements

### 1. `RESEND_API_KEY`
`sendEmail()` bails immediately if it's missing:
```ts
if (!apiKey) return { ok: false, status: 0, error: "RESEND_API_KEY not set" };
```

### 2. A verified sending domain
The `from` address defaults to:
```ts
const DEFAULT_FROM = "StackBrief <noreply@stackbrief.tech>";
```
(overridable via `EMAIL_FROM`). Resend **rejects** any send from a domain you
haven't verified with DNS records (SPF/DKIM). That's the "source email."

## What happens on subscribe right now

Flow in `app/api/email/subscribe/route.ts`:

1. Validate email → **upsert a row into `webhooks`** with `confirmed_at: null`
2. Send a confirmation email
3. Return success only if the email sent

Without Resend configured:
- Step 2 fails → endpoint returns **502 "failed to send confirmation email"**
- The DB row IS created (so a later retry won't hit the unique-email constraint),
  but `confirmed_at` stays `null`
- The notify/digest jobs only send to **confirmed** subscribers, so nothing ever
  goes out

Net effect: the frontend form attempts a signup but shows an error, and no email
is delivered.

## To make it work

1. Create a Resend account, get an API key → set `RESEND_API_KEY`
2. Verify a domain you control in Resend (add their DNS records)
3. Set `EMAIL_FROM` to an address on that verified domain
   (e.g. `StackBrief <noreply@yourdomain>`), **or** rename so `stackbrief.tech`
   is the verified domain

## Relevant files

- `lib/email.ts` — Resend client, `sendEmail()`, email templates
- `app/api/email/subscribe/route.ts` — subscribe endpoint
- `app/api/email/confirm/route.ts` — confirmation link handler
- `app/api/jobs/notify/route.ts` — per-item alert sending
- `app/api/jobs/digest/route.ts` — digest sending
