import { truncate } from "@/lib/utils";
import type { Adapter, IngestContext } from "./types";
import { USER_AGENT } from "./types";
import { readStringConfig, readNumberConfig } from "./http";
import { twitterEngagement } from "./engagement";

// X / Twitter ingest via twitterapi.io — a third-party read API that proxies
// X's data without the official API's cost/quota. We deliberately do NOT use a
// logged-in cookie session (birdclaw's approach): on a hosted product that
// risks suspending a real account and breaks whenever X changes its GraphQL.
//
// Cost model: twitterapi.io bills per tweet RETURNED (~$0.15 / 1k). This
// endpoint has no since_id — every poll re-returns the latest page — so the
// cost dial is purely poll cadence × accounts × page size. We fetch ONE page
// (≤20 tweets) per poll and lean on sources.poll_interval_sec (see seed.sql) to
// keep spend predictable. Storage-side dedup is free (items.url unique), but it
// does not reduce API cost.
//
// Config (sources.config):
//   userName          X handle without '@' (required unless userId given)
//   userId            numeric X user id (optional; takes precedence at the API)
//   include_replies   include the account's replies (default false)
//   include_retweets  include retweets/quote-only posts (default false)
//   max_tweets        cap per poll (default 20, the page size)

const API_URL = "https://api.twitterapi.io/twitter/user/last_tweets";

interface TweetAuthor {
  userName?: string | null;
  name?: string | null;
}

interface Tweet {
  id?: string;
  url?: string | null;
  text?: string | null;
  createdAt?: string | null;
  lang?: string | null;
  likeCount?: number | null;
  retweetCount?: number | null;
  replyCount?: number | null;
  quoteCount?: number | null;
  viewCount?: number | null;
  isReply?: boolean | null;
  author?: TweetAuthor | null;
  retweeted_tweet?: unknown;
}

interface LastTweetsResponse {
  status?: string;
  code?: number;
  msg?: string;
  message?: string;
  error?: string;
  // The live user/last_tweets endpoint nests the tweet list under `data`
  // ({status, code, data:{pin_tweet, tweets}}) — despite the public docs
  // showing `tweets` at the top level. Read data.tweets.
  data?: {
    tweets?: Tweet[];
    pin_tweet?: unknown;
  };
}

function readBoolConfig(ctx: IngestContext, key: string, fallback: boolean): boolean {
  const v = ctx.config[key];
  return typeof v === "boolean" ? v : fallback;
}

// Engagement is normalized to 0-100 by twitterEngagement() — items.engagement_score
// is CHECK (0..100), so the raw like/RT counts MUST be scaled or the INSERT throws.

// Twitter timestamps come as "Tue Dec 10 07:00:00 +0000 2024". Date can parse
// that, but guard against the occasional null/garbage rather than emitting an
// "Invalid Date" → null published_at (treated as unknown-age downstream).
function parsePublishedAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function tweetTitle(text: string, handle: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return `Tweet by @${handle}`;
  // The card headline is a single line; the full text rides along in `content`
  // for enrich to summarize.
  return truncate(oneLine, 200);
}

export const twitterAdapter: Adapter = async (ctx) => {
  const apiKey = process.env.TWITTERAPI_IO_KEY;
  // Degrade to a clean no-op when the key isn't configured, mirroring how
  // lib/email.ts handles a missing RESEND_API_KEY. Return NO error: run.ts
  // persists any adapter error to sources.last_error, so returning one here
  // would paint all ~28 X sources permanently red until the key is set,
  // masking genuine ingest failures. The empty result is the signal instead.
  if (!apiKey) {
    return { items: [] };
  }

  const userName = readStringConfig(ctx, "userName");
  const userId = readStringConfig(ctx, "userId");
  if (!userName && !userId) {
    return { items: [], error: "twitter: config needs userName or userId" };
  }
  const includeReplies = readBoolConfig(ctx, "include_replies", false);
  const includeRetweets = readBoolConfig(ctx, "include_retweets", false);
  const maxTweets = readNumberConfig(ctx, "max_tweets", 20);

  const u = new URL(API_URL);
  if (userId) u.searchParams.set("userId", userId);
  else u.searchParams.set("userName", userName);
  u.searchParams.set("includeReplies", includeReplies ? "true" : "false");
  // NOTE: the last_tweets endpoint has no server-side retweet toggle, so
  // include_retweets is enforced client-side below (filtering t.retweeted_tweet).
  // Retweets are still RETURNED by the API and billed — a retweet-heavy account
  // costs the same per page even though most posts get discarded.

  try {
    const res = await fetch(u.toString(), {
      headers: {
        "X-API-Key": apiKey,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { items: [], error: `twitter: ${res.status} ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as LastTweetsResponse;
    // Success envelope is {status:"success", code:0, data:{tweets}}. Treat ANY
    // non-zero code (not just -1), an `error` string, or status:"error" as a
    // failure — otherwise a {code:2,msg:"rate limited"} HTTP-200 body would be
    // swallowed as a clean empty result and the source would silently stop.
    if (
      json.error
      || json.status === "error"
      || (typeof json.code === "number" && json.code !== 0)
    ) {
      return { items: [], error: `twitter: ${json.message ?? json.error ?? json.msg ?? `code ${json.code}`}` };
    }

    const tweets = json.data?.tweets ?? [];
    const handle = userName || tweets[0]?.author?.userName || "";
    const items = tweets
      .filter((t) => t && t.id && t.text)
      .filter((t) => includeRetweets || !t.retweeted_tweet)
      .filter((t) => includeReplies || !t.isReply)
      // Honor max_tweets:0 as "ingest nothing" (a way to pause an account
      // without disabling the row); clamp negatives to 0.
      .slice(0, Math.max(0, maxTweets))
      .map((t) => {
        const authorHandle = t.author?.userName || handle;
        const text = (t.text ?? "").trim();
        const metrics = `${Number(t.likeCount) || 0} likes · ${Number(t.retweetCount) || 0} reposts · ${Number(t.replyCount) || 0} replies`;
        return {
          external_id: `twitter:${t.id}`,
          url: t.url || `https://x.com/${authorHandle}/status/${t.id}`,
          title: tweetTitle(text, authorHandle),
          author: authorHandle ? `@${authorHandle}` : null,
          content: truncate([text, metrics].filter(Boolean).join("\n\n"), 4000) || null,
          published_at: parsePublishedAt(t.createdAt),
          engagement_score: twitterEngagement(
            Number(t.likeCount) || 0,
            Number(t.retweetCount) || 0,
            Number(t.replyCount) || 0,
          ),
          raw: {
            tweet_id: t.id,
            handle: authorHandle,
            like_count: Number(t.likeCount) || 0,
            retweet_count: Number(t.retweetCount) || 0,
            reply_count: Number(t.replyCount) || 0,
            quote_count: Number(t.quoteCount) || 0,
            view_count: Number(t.viewCount) || 0,
            lang: t.lang ?? null,
          },
        };
      });
    return { items };
  } catch (e) {
    return { items: [], error: `twitter: ${(e as Error).message}` };
  }
};
