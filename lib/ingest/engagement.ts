// Normalize per-source raw engagement metrics into a 0–100 score.
// Each source kind has its own typical range, so we log-scale separately.
//
// Calibration target: ~70 means "notably engaged, a top-of-HN kind of post";
// 100 is saturated (viral). Not a strict percentile — a rough vibe check that
// makes the signal comparable across source types.

function logNormalize(raw: number, pivot: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // score 70 when raw == pivot; saturates around raw == pivot^2.
  const score = (Math.log10(1 + raw) / Math.log10(1 + pivot)) * 70;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function hnEngagement(points: number, comments: number): number {
  // ~300 pts is typical for a top story.
  const pointScore = logNormalize(points, 300);
  // A lot of comments signals contention/discussion on top of votes.
  const commentBoost = Math.min(15, Math.log10(1 + comments) * 6);
  return Math.min(100, Math.round(pointScore + commentBoost));
}

export function githubStarsEngagement(stars: number): number {
  // Trending AI repos on a daily window typically sit in 100-2000 stars.
  return logNormalize(stars, 500);
}

export function huggingfaceEngagement(likes: number, downloads: number): number {
  // Likes are the stronger signal (less gameable); downloads scale differently.
  const likeScore = logNormalize(likes, 100);
  const dlScore = logNormalize(downloads, 100_000);
  // Weighted average favoring likes; both matter though.
  return Math.min(100, Math.round(likeScore * 0.6 + dlScore * 0.4));
}
