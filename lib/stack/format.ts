export function hoursAgoLabel(h: number): string {
  if (h < 1) return "just now";
  if (h === 1) return "1h ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1d ago" : `${d}d ago`;
}

export function plural(n: number, s: string, p?: string): string {
  return n === 1 ? s : p || s + "s";
}
