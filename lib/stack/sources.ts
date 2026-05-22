// Stable visuals for each ingested source.
//
// Known sources get hand-picked brand colors; unknown slugs fall back to a
// deterministic palette index so the avatar color stays stable across renders.
// `hue` is used by the rotating gradient thumbnails — different from color so
// the thumb can riff off the brand identity without literally being the brand
// color (which would clash against the body text inside the gradient).

const BRAND: Record<string, { color: string; initial: string; hue: number; text?: string }> = {
  // News press
  "techcrunch-ai":         { color: "#0a9847", initial: "T", hue: 140 },
  "the-verge-ai":          { color: "#FF3D00", initial: "V", hue: 16 },
  "wired-ai":              { color: "#000000", initial: "W", hue: 220 },
  "ars-technica-ai":       { color: "#ff4e16", initial: "A", hue: 22 },
  "the-register-ai":       { color: "#cc0000", initial: "R", hue: 0 },
  "venturebeat-ai":        { color: "#e21e34", initial: "V", hue: 350 },
  "mit-tech-review-ai":    { color: "#a41010", initial: "M", hue: 5 },
  "zdnet-ai":              { color: "#e60000", initial: "Z", hue: 0 },
  "404-media":             { color: "#000000", initial: "4", hue: 270 },
  "axios-ai":              { color: "#000000", initial: "A", hue: 245 },
  "cnbc-tech":             { color: "#005594", initial: "C", hue: 210 },
  "rest-of-world":         { color: "#222222", initial: "R", hue: 30 },
  "the-decoder":           { color: "#1d4ed8", initial: "D", hue: 220 },

  // Analyst newsletters
  "platformer":            { color: "#1f9aa3", initial: "P", hue: 190 },
  "big-technology":        { color: "#0a0a0a", initial: "B", hue: 30 },
  "stratechery":           { color: "#5C2D91", initial: "S", hue: 280 },
  "one-useful-thing":      { color: "#f97316", initial: "U", hue: 30 },
  "dont-worry-vase":       { color: "#0d9488", initial: "Z", hue: 170 },
  "dwarkesh-podcast":      { color: "#7c3aed", initial: "D", hue: 270 },
  "astral-codex-ten":      { color: "#374151", initial: "A", hue: 200 },
  "the-generalist":        { color: "#111827", initial: "G", hue: 220 },
  "latent-space":          { color: "#2563eb", initial: "L", hue: 230 },
  "interconnects":         { color: "#10b981", initial: "I", hue: 160 },
  "last-week-in-ai":       { color: "#f59e0b", initial: "L", hue: 40 },
  "ai-snake-oil":          { color: "#84cc16", initial: "S", hue: 90 },
  "marcus-on-ai":          { color: "#ef4444", initial: "M", hue: 0 },

  // Frontier labs / first-party
  "openai-blog":           { color: "#10a37f", initial: "O", hue: 160 },
  "anthropic-news":        { color: "#d97757", initial: "A", hue: 25 },
  "anthropic-news-crawled":{ color: "#d97757", initial: "A", hue: 25 },
  "anthropic-research-crawled": { color: "#c2410c", initial: "R", hue: 20 },
  "claude-blog":           { color: "#d97757", initial: "C", hue: 25 },
  "anthropic-engineering": { color: "#9a3412", initial: "E", hue: 15 },
  "deepmind-blog":         { color: "#4285f4", initial: "D", hue: 220 },
  "google-ai-blog":        { color: "#4285f4", initial: "G", hue: 230 },
  "microsoft-research":    { color: "#0078d4", initial: "M", hue: 210 },
  "nvidia-blog":           { color: "#76b900", initial: "N", hue: 90 },
  "nvidia-developer":      { color: "#76b900", initial: "N", hue: 80 },
  "hf-blog":               { color: "#FF9D00", initial: "H", hue: 40 },
  "mistral-news":          { color: "#fa5104", initial: "M", hue: 18 },
  "together-ai":           { color: "#7c3aed", initial: "T", hue: 270 },
  "databricks-ai":         { color: "#ff3621", initial: "D", hue: 10 },
  "snowflake-ai":          { color: "#29b5e8", initial: "S", hue: 200 },
  "replicate-blog":        { color: "#000000", initial: "R", hue: 250 },
  "cerebras-crawled":      { color: "#f97316", initial: "C", hue: 30 },
  "ai21-blog":             { color: "#9333ea", initial: "A", hue: 280 },

  // Vendors
  "weaviate-blog":         { color: "#1f6feb", initial: "W", hue: 220 },
  "aws-ml-blog":           { color: "#ff9900", initial: "A", hue: 35 },
  "cloudflare-ai":         { color: "#f6821f", initial: "C", hue: 30 },

  // Independent
  "simon-willison":        { color: "#5e35b1", initial: "S", hue: 270 },
  "jack-clark":            { color: "#0f766e", initial: "J", hue: 170 },
  "lesswrong-ai":          { color: "#a25c2a", initial: "L", hue: 30 },
  "alignment-forum":       { color: "#4b6cb7", initial: "A", hue: 220 },
  "bair-berkeley":         { color: "#003262", initial: "B", hue: 220 },
  "robohub":               { color: "#0ea5e9", initial: "R", hue: 200 },
  "ieee-spectrum-ai":      { color: "#00629b", initial: "I", hue: 210 },
  "sebastian-raschka":     { color: "#0891b2", initial: "S", hue: 190 },
  "eugene-yan":            { color: "#0f766e", initial: "E", hue: 170 },
  "jay-alammar":           { color: "#1d4ed8", initial: "J", hue: 220 },
  "the-gradient":          { color: "#1e293b", initial: "G", hue: 220 },
  "quanta-magazine":       { color: "#172554", initial: "Q", hue: 240 },
  "80000-hours":           { color: "#f59e0b", initial: "8", hue: 35 },
  "ea-forum-ai":           { color: "#0c4a6e", initial: "E", hue: 200 },
};

// Fallback palette — deterministic by slug hash so the same source always
// renders the same color across pages, even without a brand entry.
const FALLBACK_COLORS = [
  "#7e22ce", "#0891b2", "#dc2626", "#65a30d", "#ea580c",
  "#0284c7", "#9333ea", "#16a34a", "#db2777", "#facc15",
  "#475569", "#15803d", "#a16207", "#4f46e5", "#0f766e",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarFor(slug: string, name: string): { color: string; initial: string; text?: string } {
  const brand = BRAND[slug];
  if (brand) return { color: brand.color, initial: brand.initial, text: brand.text };
  const color = FALLBACK_COLORS[hash(slug) % FALLBACK_COLORS.length];
  const initial = (name || slug || "?").replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase() || "?";
  return { color, initial };
}

export function hueFor(slug: string): number {
  const brand = BRAND[slug];
  if (brand) return brand.hue;
  return hash(slug) % 360;
}

// Per-source default thumbnail. Used as the final fallback in resolveImageUrl
// when neither s3_storage_id nor thumb_url is available — e.g. arxiv abstract
// pages serve only a logo as og:image, so every paper would otherwise render
// as a gradient panel with no imagery. Files live in /public/source-thumbs/.
//
// Add new entries here; SVGs in public/source-thumbs/ are intentionally
// simple wordmarks and can be replaced with real brand assets without
// touching code.
const DEFAULT_THUMBS: Array<{ match: (slug: string) => boolean; url: string }> = [
  { match: (s) => s.startsWith("arxiv-"), url: "/source-thumbs/arxiv.svg" },
  { match: (s) => s === "hf-models-trending" || s === "hf-datasets-trending", url: "/source-thumbs/huggingface.svg" },
  { match: (s) => s === "simon-willison", url: "/source-thumbs/simon-willison.svg" },
  { match: (s) => s === "stratechery", url: "/source-thumbs/stratechery.svg" },
];

export function defaultThumbFor(slug: string): string | null {
  for (const entry of DEFAULT_THUMBS) {
    if (entry.match(slug)) return entry.url;
  }
  return null;
}
