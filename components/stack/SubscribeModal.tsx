"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

interface Props {
  onClose: () => void;
}

type Channel = "email" | "discord";
type Mode = "digest" | "alerts";
type Status = "idle" | "submitting" | "ok-email" | "ok-discord" | "error";

const DEFAULT_IMPORTANCE_DIGEST = 70;
const DEFAULT_IMPORTANCE_ALERTS = 85;

interface DiscordSuccess {
  unsubscribe_url: string;
}

export function SubscribeModal({ onClose }: Props) {
  const [channel, setChannel] = useState<Channel>("email");
  const [mode, setMode] = useState<Mode>("digest");
  const [target, setTarget] = useState("");
  const [importance, setImportance] = useState(DEFAULT_IMPORTANCE_DIGEST);
  const [picked, setPicked] = useState<Set<Category>>(() => new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [discordSuccess, setDiscordSuccess] = useState<DiscordSuccess | null>(null);

  // Re-default the importance threshold when switching modes. Done inline
  // in the toggle handlers (not in a useEffect on `mode`) because the
  // react-hooks/set-state-in-effect rule rejects derived setState — and
  // it's the right call here: the threshold only needs to retarget when
  // the user clicks the toggle, not on every render where mode changes.
  const setModeAndDefault = (next: Mode) => {
    setMode(next);
    setImportance(next === "digest" ? DEFAULT_IMPORTANCE_DIGEST : DEFAULT_IMPORTANCE_ALERTS);
  };

  // Esc closes the modal — matches the existing Onboarding overlay behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleCat = (c: Category) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  };

  const submit = async () => {
    setError("");
    if (!target.trim()) {
      setError(channel === "email" ? "Enter your email." : "Paste a Discord webhook URL.");
      return;
    }

    setStatus("submitting");
    try {
      if (channel === "email") {
        const res = await fetch("/api/email/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: target.trim(),
            min_importance: importance,
            categories: Array.from(picked),
            is_digest: mode === "digest",
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setError(json.error || `request failed (${res.status})`);
          return;
        }
        setStatus("ok-email");
      } else {
        const res = await fetch("/api/webhooks/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: target.trim(),
            min_importance: importance,
            categories: Array.from(picked),
            // Discord uses is_digest on the webhook row, but the legacy
            // register endpoint doesn't accept it yet — fall back to
            // per-item alerts there. Email path supports both modes.
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setError(json.error || `request failed (${res.status})`);
          return;
        }
        setDiscordSuccess({ unsubscribe_url: json.unsubscribe_url });
        setStatus("ok-discord");
      }
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };

  // ----- Success states ---------------------------------------------------

  if (status === "ok-email") {
    return (
      <div className="onb-mask" onClick={onClose}>
        <div className="onb sub-modal" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="onb__eyebrow">Almost there</div>
            <h2 className="onb__title">Check your inbox.</h2>
          </div>
          <p className="onb__sub">
            We sent a confirmation link to <b>{target}</b>. Click it and you&apos;re subscribed.
            If you don&apos;t see it in a minute, peek in spam.
          </p>
          <div className="onb__footer">
            <span className="onb__count">no email arrives → check spam folder</span>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "ok-discord" && discordSuccess) {
    return (
      <div className="onb-mask" onClick={onClose}>
        <div className="onb sub-modal" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="onb__eyebrow">Subscribed</div>
            <h2 className="onb__title">Your Discord channel is wired up.</h2>
          </div>
          <p className="onb__sub">
            We sent a test ping. New items above importance {importance} will start arriving as
            they&apos;re enriched.
          </p>
          <div className="sub-row">
            <label className="sub-label">Unsubscribe link (save this)</label>
            <input
              className="sub-input"
              readOnly
              value={discordSuccess.unsubscribe_url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="onb__footer">
            <span />
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  // ----- Form -------------------------------------------------------------

  return (
    <div className="onb-mask" onClick={onClose}>
      <div className="onb sub-modal" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="onb__eyebrow">Subscribe</div>
          <h2 className="onb__title">Don&apos;t miss what matters in AI.</h2>
        </div>
        <p className="onb__sub">
          A daily briefing or per-item alerts — your inbox or your Discord. You set the importance
          floor; we cluster across sources so you read each story once.
        </p>

        <div className="sub-row">
          <label className="sub-label">Channel</label>
          <div className="seg">
            <button
              type="button"
              className="seg__btn"
              aria-pressed={channel === "email"}
              onClick={() => setChannel("email")}
            >
              Email
            </button>
            <button
              type="button"
              className="seg__btn"
              aria-pressed={channel === "discord"}
              onClick={() => { setChannel("discord"); setModeAndDefault("alerts"); }}
            >
              Discord
            </button>
          </div>
        </div>

        <div className="sub-row">
          <label className="sub-label">
            {channel === "email" ? "Your email" : "Discord webhook URL"}
          </label>
          <input
            className="sub-input"
            type={channel === "email" ? "email" : "url"}
            placeholder={
              channel === "email"
                ? "you@example.com"
                : "https://discord.com/api/webhooks/…"
            }
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            autoComplete={channel === "email" ? "email" : "off"}
            spellCheck={false}
          />
          {channel === "discord" && (
            <div className="sub-hint">
              Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
            </div>
          )}
        </div>

        {channel === "email" && (
          <div className="sub-row">
            <label className="sub-label">Cadence</label>
            <div className="seg">
              <button
                type="button"
                className="seg__btn"
                aria-pressed={mode === "digest"}
                onClick={() => setModeAndDefault("digest")}
              >
                Daily digest
              </button>
              <button
                type="button"
                className="seg__btn"
                aria-pressed={mode === "alerts"}
                onClick={() => setModeAndDefault("alerts")}
              >
                Per-item alerts
              </button>
            </div>
            <div className="sub-hint">
              {mode === "digest"
                ? "One email per day with the AI-written briefing across the top items."
                : "An email whenever a new item clears your importance threshold."}
            </div>
          </div>
        )}

        <div className="sub-row">
          <label className="sub-label">
            Importance threshold <span className="sub-label__val">{importance}</span>
          </label>
          <input
            className="sub-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
          />
          <div className="sub-hint">
            Items below this score won&apos;t reach you. 70+ = signal, 85+ = only the big stuff.
          </div>
        </div>

        <div className="sub-row">
          <label className="sub-label">
            Categories <span className="sub-label__val">{picked.size === 0 ? "all" : `${picked.size} picked`}</span>
          </label>
          <div className="onb__topics">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="topic-chip"
                aria-pressed={picked.has(c)}
                onClick={() => toggleCat(c)}
              >
                <span className="topic-chip__check">✓</span>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="sub-error">{error}</div>}

        <div className="onb__footer">
          <button className="btn-link" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={status === "submitting"}
            onClick={submit}
          >
            {status === "submitting"
              ? "Subscribing…"
              : channel === "email"
                ? "Subscribe"
                : "Connect Discord"}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
