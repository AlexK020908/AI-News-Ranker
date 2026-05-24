# StackBrief — SEO & Brand-Entity Launch Checklist

A step-by-step runbook for getting StackBrief to rank #1 for the branded query
"stackbrief" and to be recognized by Google/Bing as the official brand entity
(the foundation for a knowledge panel and, later, the verified checkmark).

Work top-to-bottom. Each phase is ordered by impact ÷ effort.

---

## Phase 0 — What's already done (in code)

These shipped with the SEO changes; no action needed, listed so you know what's live:

- `lib/site.ts` — single source of truth for brand identity + `SITE_URL`.
- `app/layout.tsx` — `metadataBase`, canonical URL, OpenGraph + Twitter tags,
  and **Organization + WebSite JSON-LD** structured data.
- `app/robots.ts` — serves `/robots.txt` (allows crawling, blocks `/api/` and
  `/search`, points to the sitemap).
- `app/sitemap.ts` — serves `/sitemap.xml` (lists `/` and `/repos`).

---

## Phase 1 — Deploy (this week, free, highest impact)

- [ ] **1.1 — Decide the production URL value.**
  See [Appendix A](#appendix-a--how-next_public_site_url-actually-works) first.
  TL;DR: you do **not** have to set anything — the code falls back to
  `https://stackbrief.tech`. Only set the secret below if your production
  domain differs from that.

- [ ] **1.2 (optional) — Set the `NEXT_PUBLIC_SITE_URL` GitHub Actions secret.**
  GitHub repo → **Settings → Secrets and variables → Actions → New repository
  secret**:
  - Name: `NEXT_PUBLIC_SITE_URL`
  - Value: `https://stackbrief.tech` (no trailing slash)

  Skip this if you're happy with the `stackbrief.tech` fallback. It's already
  referenced by the CI workflow (`.github/workflows/ci.yml`, build step + the
  runtime `.env`), so there's **nothing to edit in the workflow file**.

- [ ] **1.3 — Merge & push to `main`.** CI builds and deploys automatically
  (self-hosted runner → `/opt/ai-news-feed` → `systemctl restart`).

- [ ] **1.4 — Smoke-test the live routes** once deployed:
  ```bash
  curl -s https://stackbrief.tech/robots.txt
  curl -s https://stackbrief.tech/sitemap.xml
  curl -s https://stackbrief.tech/ | grep -o 'application/ld+json'
  ```
  Confirm the URLs inside show `https://stackbrief.tech` (not `localhost`).
  If they show `localhost`, the build had a bad `NEXT_PUBLIC_SITE_URL` value —
  fix the secret (1.2) and redeploy. See [Appendix A](#appendix-a--how-next_public_site_url-actually-works).

---

## Phase 2 — Get indexed (this week, free, this is the step that wins #1)

> For a coined name like "StackBrief" there's almost no competition, so
> indexing alone typically earns the #1 spot within days.

- [ ] **2.1 — Google Search Console** — https://search.google.com/search-console
  - Add property → **Domain** property `stackbrief.tech` (verify via the DNS
    TXT record they give you), or URL-prefix `https://stackbrief.tech`.
  - **Sitemaps** → submit `https://stackbrief.tech/sitemap.xml`.
  - **URL Inspection** → enter the homepage → **Request indexing**.

- [ ] **2.2 — Bing Webmaster Tools** — https://www.bing.com/webmasters
  - Add the site (you can import directly from Google Search Console).
  - Submit the same sitemap. (Bing also feeds Copilot / ChatGPT search.)

- [ ] **2.3 — Validate structured data** on the live URL:
  - https://search.google.com/test/rich-results → enter `https://stackbrief.tech`
  - https://validator.schema.org → paste the URL
  - Confirm both **Organization** and **WebSite** parse with no errors.

---

## Phase 3 — Establish the brand entity (1–2 weeks, cheap)

> This is what graduates you from "a result" to "the official StackBrief," and
> is the groundwork for a knowledge panel.

- [ ] **3.1 — Create official profiles** (use the exact name "StackBrief",
  link back to `https://stackbrief.tech` in each bio):
  - [ ] X / Twitter
  - [ ] LinkedIn company page
  - [ ] GitHub org
  - [ ] (optional) Product Hunt launch

- [ ] **3.2 — Add those URLs to `SITE_SAME_AS` in `lib/site.ts`.**
  This populates schema.org `sameAs`, the single strongest signal tying the
  domain to the brand entity. Uncomment and fill in:
  ```ts
  const SAME_AS_CANDIDATES: string[] = [
    "https://x.com/your_real_handle",
    "https://www.linkedin.com/company/your_real_company",
    "https://github.com/your_real_org",
  ];
  ```
  Then commit + push (redeploys automatically).

- [ ] **3.3 — Re-run the Rich Results Test** (2.3) to confirm `sameAs` appears.

---

## Phase 4 — Protect the brand (when convenient)

- [ ] **4.1 — Check `stackbrief.com` ownership.**
  - Free / cheap → buy it and 301-redirect to `stackbrief.tech`. Kills the
    "I'll just type .com" subscriber leak.
  - Parked / for sale → decide whether the asking price is worth it.
- [ ] **4.2 — Grab matching social handles** even if unused, to prevent
  impersonation.

---

## Phase 5 — The inbox checkmark (longer game, costs money)

> The blue verified mark next to the sender in Gmail (BIMI). Lifts open rates
> — directly valuable for a newsletter. Gated on a registered trademark.

- [ ] **5.1 — Register a trademark for "StackBrief"** (money + a few months).
  This is the hard prerequisite for the Verified Mark Certificate.
- [ ] **5.2 — Enforce DMARC** (`p=quarantine` or `p=reject`) with aligned
  SPF + DKIM on `stackbrief.tech`.
- [ ] **5.3 — Add a BIMI DNS record** pointing to an SVG Tiny PS logo.
- [ ] **5.4 — Buy a VMC** (Verified Mark Certificate, ~$1,000+/yr from
  DigiCert/Entrust) using the registered trademark.

> Ping the dev side once 5.1 is in motion — the DNS/DMARC/BIMI wiring (5.2–5.3)
> can be prepped in parallel.

---

## Appendix A — How `NEXT_PUBLIC_SITE_URL` actually works

This trips people up, so read it once:

- **`NEXT_PUBLIC_*` variables are inlined at _build time_**, not read at
  runtime. When `next build` runs in CI, every `process.env.NEXT_PUBLIC_SITE_URL`
  in the code is replaced with whatever literal value was in the build
  environment at that moment.
- Therefore the URL baked into `robots.txt`, `sitemap.xml`, the canonical tag,
  and the JSON-LD is decided by the **CI build step's** env
  (`.github/workflows/ci.yml`, the `Next.js build` step), **not** by the
  runtime `.env` on the server.
- **If the `NEXT_PUBLIC_SITE_URL` secret is unset**, the build inlines
  `undefined`, and `lib/site.ts` falls back to the hardcoded
  `https://stackbrief.tech`. That's the intended safe default — production is
  correct with zero configuration.
- **Set the secret only if** your production domain ever differs from
  `https://stackbrief.tech` (e.g. you move to `stackbrief.com`). Then update
  both the secret and the fallback in `lib/site.ts`, and redeploy.

**Net:** no new GitHub secret is _required_. The fallback covers the
unspecified case. Setting the secret is just an override.

---

## Quick reference — the 3 things that matter most

1. **Deploy** (Phase 1).
2. **Submit the sitemap in Google Search Console** (Phase 2.1) — this wins #1.
3. **Fill in `SITE_SAME_AS`** with real social URLs (Phase 3.2) — this builds
   the brand entity.

Everything else is polish or a longer game.
