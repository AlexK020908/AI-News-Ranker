// The Stack design works in terms of `clusters` of `sources`. These are the
// runtime shapes the components consume — we transform our DB-side StoryBucket
// into this in lib/stack/transform.ts.

export interface StackSource {
  id: string;              // member.id
  url: string;             // outbound link to the original article
  initial: string;         // single character/glyph badge
  name: string;            // outlet name
  color: string;           // brand color (background of the avatar pill)
  text?: string;           // optional avatar text color override (for very light bg)
  headline: string;        // this outlet's headline
  hoursAgo: number;        // computed from published_at
  // True when this member came from a Twitter/X account source. Tweets almost
  // never carry an og-image, so the thumbnail would otherwise be a bare
  // gradient — RotatingThumb renders an X logo watermark instead.
  isX?: boolean;
  thumb: {
    hue: number;
    label: string;
    // Optional real-image URL (S3 if configured, else publisher CDN). When set,
    // <RotatingThumb> renders an <img> over the gradient; when null the
    // gradient + label combo is the thumbnail.
    imageUrl?: string | null;
  };
  // Plain-English paper explanation. Only populated for paper-category items.
  cavemanSummary?: string | null;
}

export interface StackCluster {
  id: string;
  slug: string;
  topic: string;           // category id ('news', 'paper', etc.) or 'all' is reserved for filtering
  headline: string;
  summary: string;
  hoursAgo: number;
  readMin: number;
  breaking: boolean;
  // True when at least one member is currently in the rising_items result —
  // i.e. its score (HN points, GH stars, etc.) is climbing fast in the
  // recent observation window. Surfaced as a flame badge.
  rising: boolean;
  sources: StackSource[];
  // Caveman explanation for paper clusters. Picked from the highest-
  // importance member's caveman_summary so the card has a single, stable
  // plain-English blurb regardless of which paper rotates into the
  // thumbnail slot. Null when the cluster isn't paper-majority.
  cavemanSummary?: string | null;
}

export interface StackTopic {
  id: string;
  label: string;
}
