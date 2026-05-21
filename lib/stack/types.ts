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
  thumb: {
    hue: number;
    label: string;
    // Optional real-image URL (S3 if configured, else publisher CDN). When set,
    // <RotatingThumb> renders an <img> over the gradient; when null the
    // gradient + label combo is the thumbnail.
    imageUrl?: string | null;
  };
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
  sources: StackSource[];
}

export interface StackTopic {
  id: string;
  label: string;
}
