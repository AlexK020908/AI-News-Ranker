import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", bytes).then((buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  );
}

export function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await worker(items[idx], idx);
      }
    }),
  );
}

export const SEARCH_MAX_LEN = 80;

// Strips anything that would break PostgREST `.or()` parsing (commas, parens,
// braces used by array literals, quotes) or act as an ilike wildcard (%, _, \).
export function sanitizeIlike(s: string, maxLen = SEARCH_MAX_LEN): string {
  return s.replace(/[,()%_\\{}"]/g, "").trim().slice(0, maxLen);
}

export function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
