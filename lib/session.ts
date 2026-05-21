// Anonymous per-browser session ID used to dedup engagement events.
// Client-only — guards every access with a typeof window check so the file
// is import-safe from RSC.

const STORAGE_KEY = "ainf_sid";

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let sid = window.localStorage.getItem(STORAGE_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      window.localStorage.setItem(STORAGE_KEY, sid);
    }
    return sid;
  } catch {
    // localStorage can throw in private-mode or when disabled — treat as no sid.
    return null;
  }
}

export function sendEngagementBeacon(topicId: string, kind: "view" | "click"): void {
  if (typeof window === "undefined") return;
  const sid = getSessionId();
  if (!sid) return;
  const payload = JSON.stringify({ topic_id: topicId, sid, kind });
  try {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon("/api/events", blob)) return;
    // sendBeacon can refuse if the user is leaving the page; fall back to fetch.
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  } catch {
    // Swallow — engagement signal is best-effort.
  }
}
