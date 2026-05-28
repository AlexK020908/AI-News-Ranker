# StackBrief Launch Plan

Where to post for exposure (Hacker News + Reddit) and how to do it without
getting flagged.

---

## Phase 0 — Pre-flight (do before posting anything)

These are the things that kill a launch. Knock them out first.

1. **Lock the source number.** Run `node scripts/verify-sources.mjs`, count the
   `OK` lines, and update the README (the opening paragraph says ~130, the
   Features section says ~50 — they disagree, and the seed defines ~170 rows).
   Pick the one accurate "live/enabled" number and use it everywhere. Someone
   will fact-check you.
2. **Make the live site bulletproof for cold visitors:**
   - Homepage loads with **fresh** items (run the worker the morning of launch —
     a stale feed reads as "abandoned").
   - No login wall on the feed.
   - Works on mobile (half of HN/Reddit clicks are phone).
   - Survives a traffic spike — Redis is optional and falls through to Postgres;
     make sure Postgres won't fall over. Warm the cache before posting.
3. **Add a one-line "how ranking works" blurb visible on the site itself** — the
   corroboration angle is your differentiator; don't make people read GitHub to
   find it.
4. **Decide: bare app link, or blog post?** Strong recommendation: **write the
   blog post** (Phase 1). It's reusable, survives moderation, and ranks better
   than a Show HN with zero traction.

## Phase 1 — Write the anchor asset (1–2 hrs)

One technical blog post: **"Why I rank AI news by cross-source corroboration,
not clicks."**

- Open with the problem: engagement-ranked feeds reward clickbait and are
  trivially botted.
- Explain your signal: `source_weight_sum` + cluster size + Claude importance +
  recency decay.
- Show the dedup example (GPT-5 from 5 outlets → one panel).
- Be honest about one limitation (e.g. corroboration lags on a genuine scoop
  covered by only one outlet).
- End with a link to the live app + GitHub.

This post is what you submit to HN and r/programming. The bare app goes to the
lower-friction subs.

## Phase 2 — The launch sequence (stagger over ~4 days, never same-hour cross-post)

**Day 1 — Hacker News (your main shot)**
- `Show HN: StackBrief – AI news ranked by cross-source corroboration, not clicks`
- Post **Tue–Thu, 8–10am ET**.
- Immediately post your "why I built this" as the first comment.
- Then **stay at your desk for 3–4 hours** and answer every comment fast.
  Engagement velocity is the whole game on HN.
- Do NOT ask anyone to upvote (fastest way to get flagged).

**Day 2 — r/selfhosted** (your best Reddit audience)
- Lead with self-hosting: "Self-hostable AI news aggregator — Docker Compose,
  optional Redis/S3, one-line replica scaling."
- Link the GitHub repo, not just the app. This crowd wants to run it themselves.

**Day 3 — r/SideProject + r/LocalLLaMA**
- r/SideProject: founder story framing, app link fine.
- r/LocalLLaMA: frame as tooling; pre-empt "why not local models?" by addressing
  it in the post body.

**Day 4 — r/programming or r/webdev** (only with the blog post)
- Submit the **blog post URL**, not the app. A bare product link gets removed as
  promo here.

## Phase 3 — Follow-through

- Reply to every comment across all platforms for 48 hrs.
- Capture recurring questions → FAQ section in README.
- If HN takes off, the others ride the wave; if it flops, the staggered schedule
  means you haven't burned all your channels at once.

---

## Where, ranked by expected ROI

1. **Hacker News (Show HN)** — highest ceiling, technical crowd, your philosophy
   hook lands here.
2. **r/selfhosted** — underused angle, you genuinely have the goods.
3. **r/SideProject** — easy yes, decent traffic.
4. **r/LocalLLaMA** — topical but expect API-vs-local pushback.
5. **r/programming / r/webdev** — only via the blog post.

## Subreddit cheat sheet

| Subreddit | Why it fits | Caution |
|---|---|---|
| **r/selfhosted** | Ships Docker Compose + optional Redis/S3 | Lead with the compose file; highest-quality Reddit audience |
| **r/SideProject** | Built for "I built X" posts | Lower-signal traffic |
| **r/LocalLLaMA** | AI-native crowd | Uses Claude/Voyage APIs — expect "why not local?" |
| **r/programming** | Big reach | Removed if it reads as promo; submit the blog post only |
| **r/webdev** | Next.js 16 / Tailwind v4 stack | Frame around the build, not the product |
| **r/artificial**, **r/ArtificialIntelligence** | Topical | General audience, lower technical engagement |

## Hard rules

- Don't post the same link to HN + 5 subreddits in the same hour — cross-post
  spam patterns get auto-flagged. Stagger over days.
- Each sub has strict self-promo rules; read them before posting. No drive-by
  link drops.
- Never ask for upvotes anywhere.

---

## Assets still to write

- [ ] Show HN title + first comment
- [ ] r/selfhosted post
- [ ] r/SideProject post
- [ ] Blog post: "Why I rank AI news by cross-source corroboration, not clicks"
