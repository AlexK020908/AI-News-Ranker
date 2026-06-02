"use client";

import { useState } from "react";
import Link from "next/link";
import { sendGAEvent } from "@next/third-parties/google";
import { Logo } from "./Logo";

type Status = "idle" | "submitting" | "ok" | "error";

// Standalone signup landing — the page to drop in an Instagram / X bio. Dead
// simple: paste an email, get the daily brief. It posts to the same
// /api/email/subscribe endpoint as the modal (double opt-in, confirmation
// email), defaulting to the daily digest so subscribers land on the 8am brief.
export function SignupPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    const value = email.trim();
    if (!value) {
      setError("Enter your email.");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, is_digest: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(json.error || `Something went wrong (${res.status}). Try again.`);
        return;
      }
      // GA4 funnel: form submitted (the true conversion fires on the confirm
      // link). No-ops when GA isn't configured.
      sendGAEvent("event", "subscribe", { channel: "email", mode: "digest", source: "signup_page" });
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message);
    }
  };

  return (
    <main className="signup">
      <div className="signup__card">
        <Link href="/" className="signup__brand" aria-label="stackbrief.tech">
          <Logo className="signup__logo" />
        </Link>

        {status === "ok" ? (
          <>
            <div className="onb__eyebrow">Almost there</div>
            <h1 className="onb__title">Check your inbox.</h1>
            <p className="onb__sub">
              We sent a confirmation link to <b>{email.trim()}</b>. Click it to confirm — your
              first brief lands the next morning. Don&apos;t see it? Peek in spam.
            </p>
            <Link href="/" className="signup__feedlink">Browse the feed →</Link>
          </>
        ) : (
          <>
            <div className="onb__eyebrow">The daily AI brief</div>
            <h1 className="onb__title">Keep up with AI in two minutes a day.</h1>
            <p className="onb__sub">
              One email each morning: the day&apos;s biggest releases, funding, and research, plus
              what AI X is talking about — clustered across hundreds of sources so you read each
              story once.
            </p>

            <form className="signup__form" onSubmit={submit}>
              <input
                className="sub-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                spellCheck={false}
                aria-label="Your email"
                autoFocus
              />
              <button className="btn-primary" type="submit" disabled={status === "submitting"}>
                {status === "submitting" ? "Subscribing…" : "Get the brief"}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>

            {error && <div className="sub-error">{error}</div>}

            <p className="signup__fine">Free · one email each morning · unsubscribe anytime</p>
            <Link href="/" className="signup__feedlink">Or browse the feed →</Link>
          </>
        )}
      </div>
    </main>
  );
}
