import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { generateManageToken } from "@/lib/webhooks";
import { sendEmail, isValidEmail, buildConfirmationEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { CATEGORIES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubscribeBody = z.object({
  email: z.string().email().max(254),
  min_importance: z.number().int().min(0).max(100).default(70),
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).default([]),
  is_digest: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    const json = await req.json();
    parsed = SubscribeBody.parse(json);
  } catch (e) {
    return Response.json(
      { error: "invalid body", detail: (e as Error).message.slice(0, 200) },
      { status: 400 },
    );
  }

  const email = parsed.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  // Re-subscribe semantics: if the email already exists, regenerate the
  // manage token and reset confirmed_at to null so the user has to confirm
  // again. Prevents stale unsubscribe links from being re-used and gives
  // a way to recover from a misconfigured filter set.
  const manage_token = generateManageToken();

  const { data, error } = await supabase
    .from("webhooks")
    .upsert(
      {
        kind: "email",
        email,
        url: null,
        min_importance: parsed.min_importance,
        categories: parsed.categories,
        is_digest: parsed.is_digest,
        enabled: true,
        confirmed_at: null,
        manage_token,
      },
      { onConflict: "email" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const confirmUrl = buildConfirmUrl(req, data.id, manage_token);
  const tmpl = buildConfirmationEmail(confirmUrl);
  const send = await sendEmail({
    to: email,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    listUnsubscribeUrl: `${SITE_URL}/api/webhooks/unsubscribe?id=${data.id}&token=${manage_token}`,
  });

  if (!send.ok) {
    // The row is in the DB but the confirmation never went out — surface
    // the error so the user knows to retry instead of waiting for an email
    // that won't arrive. The row stays so a follow-up POST can resend
    // without violating the unique(email) constraint.
    return Response.json(
      {
        ok: false,
        error: "failed to send confirmation email",
        detail: send.error?.slice(0, 200),
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    id: data.id,
    message: "Check your inbox for a confirmation link.",
  });
}

function buildConfirmUrl(_req: NextRequest, id: string, token: string): string {
  // SITE_URL uses `||` with a production fallback, so an empty
  // NEXT_PUBLIC_SITE_URL can't slip through as "" and yield a relative
  // /api/email/confirm link the subscriber can't click (the `??` getOrigin
  // this replaced had exactly that bug).
  return `${SITE_URL}/api/email/confirm?id=${id}&token=${token}`;
}
