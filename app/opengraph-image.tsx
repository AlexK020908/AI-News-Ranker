import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

// Social share card shown when a StackBrief link is posted to X, LinkedIn,
// Slack, Discord, iMessage, etc. Generated at build time by Satori (next/og)
// and cached. Reuses the site's dark canvas + amber accent so a shared link
// reads unmistakably as StackBrief.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0a0c";
const ACCENT = "#f5a73c";
const TEXT = "#ececef";
const MUTED = "rgba(236,236,239,0.62)";

// Display host without the protocol, e.g. "stackbrief.tech".
const HOST = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: BG,
          // Soft amber glow in the upper-left, echoing the app's accent.
          backgroundImage:
            "radial-gradient(900px 500px at 12% 0%, rgba(245,167,60,0.18), rgba(245,167,60,0) 60%)",
          color: TEXT,
        }}
      >
        {/* Brand lockup */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 18,
              background: "#fff",
              color: "#0a0a0c",
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: -1,
            }}
          >
            SB
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              marginLeft: 24,
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {SITE_NAME}
            <span style={{ color: ACCENT }}>.</span>
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 6,
              color: ACCENT,
              marginBottom: 22,
            }}
          >
            AI BRIEFING
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 980,
            }}
          >
            The fastest way to keep up with AI.
          </div>
        </div>

        {/* Footer: domain + coverage */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 28,
          }}
        >
          <div style={{ display: "flex", color: TEXT, fontWeight: 600 }}>
            {HOST}
          </div>
          <div style={{ display: "flex", color: MUTED }}>
            Papers · Models · Repos · News
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
