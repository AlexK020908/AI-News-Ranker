import type { NextRequest } from "next/server";

// Shared-secret Bearer auth used by every /api/jobs/* endpoint. The env var
// stays CRON_SECRET (widely referenced in deploy docs / external schedulers;
// renaming would be a breaking change for existing setups).
export function isAuthorizedJob(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
