"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Smoothed scrollY via requestAnimationFrame. Used by the briefing-header
// parallax + the back-to-top button visibility threshold + the sticky nav
// border. One subscriber per page is enough; consumers receive the same
// shared state via re-renders.
export function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      setY(window.scrollY || window.pageYOffset || 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    tick();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return y;
}

// Polls /api/version/clusters every `intervalMs` and returns a `pendingCount`
// of how many new updates have accumulated since the last refresh. Auto-applies
// updates when the user is near the top (silent refresh); otherwise the page
// owns the UI for surfacing the pending count to the user.
//
// Returns { pendingCount, acceptUpdates } — call acceptUpdates() when the user
// clicks the "N new ↑" pill to clear the count and trigger router.refresh().
export interface ClusterFreshness {
  pendingCount: number;
  acceptUpdates: () => void;
}

export function useClusterFreshness(intervalMs = 60_000): ClusterFreshness {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  // Baseline version we last reconciled against. Updated on every silent
  // refresh and every explicit acceptUpdates() click so the diff stays
  // relative to what's currently rendered.
  const baselineTs = useRef<number | null>(null);
  // Last server-observed ts — separate from baseline so we can keep polling
  // without re-incrementing on the same payload.
  const lastSeenTs = useRef<number | null>(null);
  const baselineCount = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apply = (ts: number, count: number) => {
      baselineTs.current = ts;
      baselineCount.current = count;
      setPendingCount(0);
    };

    const poll = async () => {
      try {
        const r = await fetch("/api/version/clusters", { cache: "no-store" });
        if (!r.ok) return;
        const { ts, count } = (await r.json()) as { ts: number; count: number };
        if (cancelled) return;
        if (typeof ts !== "number" || typeof count !== "number") return;

        // First poll: anchor baseline silently, no pill.
        if (baselineTs.current === null) {
          baselineTs.current = ts;
          baselineCount.current = count;
          lastSeenTs.current = ts;
          return;
        }
        // Same payload as last poll → nothing to do.
        if (ts === lastSeenTs.current) return;
        lastSeenTs.current = ts;

        // Cluster set hasn't actually moved since our baseline → ignore.
        if (ts <= baselineTs.current) return;

        // If the user is at the top, refresh silently — no pill, no
        // disruption, new clusters just appear. Otherwise surface a count
        // and let the page decide how to display it.
        if (window.scrollY < 200) {
          apply(ts, count);
          router.refresh();
        } else {
          const delta = Math.max(1, count - (baselineCount.current ?? count));
          setPendingCount(delta);
        }
      } catch {
        /* network blip — try again next tick */
      }
    };

    poll();
    const id = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, router]);

  const acceptUpdates = () => {
    // Reset baseline to whatever the next poll observes; the immediate
    // refresh below will re-render with the latest server data, and the
    // next /api/version/clusters poll will anchor baseline to the new ts.
    baselineTs.current = null;
    baselineCount.current = null;
    setPendingCount(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
    router.refresh();
  };

  return { pendingCount, acceptUpdates };
}
