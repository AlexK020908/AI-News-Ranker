"use client";

import { useState } from "react";
import { Bell, ChevronDown, Copy, Check } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; unsubscribeUrl: string };

export function WebhookSignup() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [minImp, setMinImp] = useState(80);
  const [cats, setCats] = useState<Category[]>([]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/webhooks/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, min_importance: minImp, categories: cats }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", unsubscribeUrl: data.unsubscribe_url });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  function toggleCat(c: Category) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function copyUnsub() {
    if (state.kind !== "success") return;
    await navigator.clipboard.writeText(state.unsubscribeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="my-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">Get alerts in Discord</div>
          <div className="text-xs text-muted-fg">
            Push high-importance items to a Discord channel via webhook. No account needed.
          </div>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-fg transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {state.kind === "success" ? (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
                Subscribed. A confirmation ping was sent to your Discord channel.
              </div>
              <div>
                <label className="label-caps text-muted-fg">
                  Unsubscribe link (save this — it&rsquo;s the only way to remove later)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    readOnly
                    value={state.unsubscribeUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-md border border-border bg-bg/40 px-2 py-1.5 font-mono text-xs text-fg"
                  />
                  <button
                    type="button"
                    onClick={copyUnsub}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-bg/40 px-2 py-1.5 text-xs text-muted-fg hover:text-fg"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUrl("");
                  setState({ kind: "idle" });
                }}
                className="text-xs text-muted-fg hover:text-fg"
              >
                Register another
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label htmlFor="webhook-url" className="label-caps text-muted-fg">
                  Discord webhook URL
                </label>
                <input
                  id="webhook-url"
                  type="url"
                  required
                  placeholder="https://discord.com/api/webhooks/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-bg/40 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted-fg/60 focus:border-primary/60 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-muted-fg">
                  Create one in Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy URL.
                </p>
              </div>

              <div>
                <label htmlFor="min-imp" className="label-caps text-muted-fg">
                  Minimum importance · <span className="font-mono text-fg">{minImp}</span>
                </label>
                <input
                  id="min-imp"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minImp}
                  onChange={(e) => setMinImp(Number(e.target.value))}
                  className="mt-1.5 w-full accent-primary"
                />
                <div className="flex justify-between font-mono text-[10px] text-muted-fg">
                  <span>0 · everything</span>
                  <span>80 · notable</span>
                  <span>95 · major</span>
                </div>
              </div>

              <div>
                <label className="label-caps text-muted-fg">
                  Categories <span className="normal-case text-muted-fg/70">(optional, empty = all)</span>
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const active = cats.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCat(c)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors",
                          active
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border bg-bg/40 text-muted-fg hover:text-fg",
                        )}
                      >
                        {CATEGORY_LABELS[c]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {state.kind === "error" && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
                  {state.message}
                </div>
              )}

              <button
                type="submit"
                disabled={state.kind === "submitting" || !url}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {state.kind === "submitting" ? "Subscribing…" : "Subscribe"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
