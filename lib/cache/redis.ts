// Region-keyed Redis cache for the homepage hot path.
// No-op fallback when REDIS_URL is unset — every call passes through to the loader.

import type { Redis as RedisClient } from "ioredis";

type CacheJson = unknown;

interface Cache {
  get<T = CacheJson>(key: string): Promise<T | null>;
  set(key: string, value: CacheJson, ttlSec?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  // Wraps a loader behind the cache. On miss, calls loader, stores result.
  remember<T extends CacheJson>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
  ): Promise<T>;
  // SET-NX dedup: returns true the first time we see this key within ttlSec,
  // false on every subsequent call. When Redis is disabled, fails open
  // (returns true) so the caller still counts the event — fewer events lost
  // is preferable to inflating Redis as a hard dependency.
  tryClaim(key: string, ttlSec: number): Promise<boolean>;
  // For tests / explicit clear paths.
  flushPrefix(prefix: string): Promise<number>;
  enabled: boolean;
}

const NOOP: Cache = {
  enabled: false,
  async get() {
    return null;
  },
  async set() {
    /* no-op */
  },
  async del() {
    /* no-op */
  },
  async remember(_key, _ttl, loader) {
    return loader();
  },
  async tryClaim() {
    // Fail open — without Redis we can't dedup, but losing the counter signal
    // entirely is worse than possible double-counting.
    return true;
  },
  async flushPrefix() {
    return 0;
  },
};

let cached: Cache | null = null;

export function getCache(): Cache {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) {
    cached = NOOP;
    return cached;
  }

  // Lazy-require ioredis so the no-op path doesn't pull in the dep.
  // (When REDIS_URL is unset we still want the app to boot.)
  let IORedis: typeof import("ioredis").Redis;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    IORedis = require("ioredis").Redis;
  } catch {
    console.warn("[cache] REDIS_URL set but ioredis not installed — falling back to no-op");
    cached = NOOP;
    return cached;
  }

  const client: RedisClient = new IORedis(url, {
    // Keep the connection lightweight. The cache is best-effort; if Redis is
    // slow/down, we'd rather miss the cache than block the request thread.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", (err) => {
    // Don't crash the process on a transient Redis blip.
    console.warn("[cache] redis error:", err.message);
  });

  cached = makeRedisCache(client);
  return cached;
}

function makeRedisCache(client: RedisClient): Cache {
  return {
    enabled: true,
    async get<T>(key: string): Promise<T | null> {
      try {
        const v = await client.get(key);
        if (v == null) return null;
        return JSON.parse(v) as T;
      } catch (e) {
        console.warn("[cache] get failed:", (e as Error).message);
        return null;
      }
    },
    async set(key, value, ttlSec) {
      try {
        const payload = JSON.stringify(value);
        if (ttlSec && ttlSec > 0) {
          await client.set(key, payload, "EX", ttlSec);
        } else {
          await client.set(key, payload);
        }
      } catch (e) {
        console.warn("[cache] set failed:", (e as Error).message);
      }
    },
    async del(...keys) {
      if (keys.length === 0) return;
      try {
        await client.del(...keys);
      } catch (e) {
        console.warn("[cache] del failed:", (e as Error).message);
      }
    },
    async remember<T extends CacheJson>(
      key: string,
      ttlSec: number,
      loader: () => Promise<T>,
    ): Promise<T> {
      const hit = await this.get<T>(key);
      if (hit !== null) return hit;
      const fresh = await loader();
      // Best-effort store; if it fails, the next request will just reload.
      void this.set(key, fresh, ttlSec);
      return fresh;
    },
    async tryClaim(key, ttlSec) {
      try {
        const res = await client.set(key, "1", "EX", ttlSec, "NX");
        return res === "OK";
      } catch (e) {
        console.warn("[cache] tryClaim failed:", (e as Error).message);
        return true; // fail open
      }
    },
    async flushPrefix(prefix) {
      let cursor = "0";
      let removed = 0;
      do {
        const [next, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length > 0) {
          await client.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== "0");
      return removed;
    },
  };
}

// Key builders — keep them centralized so a future schema bump can invalidate
// everything by changing the version prefix.
const KEY_VERSION = "v1";

export const cacheKeys = {
  feed(region: string, sort: string, cat: string | null, min: number, src: string | null) {
    return `${KEY_VERSION}:feed:${region}:${sort}:${cat ?? "*"}:${min}:${src ?? "*"}`;
  },
  stories(region: string, max: number) {
    return `${KEY_VERSION}:stories:${region}:${max}`;
  },
  topTopics(region: string, max: number) {
    return `${KEY_VERSION}:toptopics:${region}:${max}`;
  },
  sources() {
    return `${KEY_VERSION}:sources`;
  },
  feedPrefix(region?: string) {
    return region ? `${KEY_VERSION}:feed:${region}:` : `${KEY_VERSION}:feed:`;
  },
};

// Common TTLs (seconds). Short enough that staleness is bounded, long enough
// to absorb crawler bursts.
export const ttl = {
  feed: 30,
  stories: 60,
  topTopics: 60,
  sources: 300,
};
