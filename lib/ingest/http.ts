import type { IngestContext } from "./types";
import { USER_AGENT } from "./types";

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function readStringConfig(
  ctx: IngestContext,
  key: string,
  fallback = "",
): string {
  const v = ctx.config[key];
  return typeof v === "string" ? v : fallback;
}

export function readNumberConfig(
  ctx: IngestContext,
  key: string,
  fallback: number,
): number {
  const v = ctx.config[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
