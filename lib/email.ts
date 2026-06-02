import type { Category } from "@/lib/types";
import type { NewsBriefSections } from "@/lib/anthropic/news-brief-prompt";

// Resend REST API. No SDK dep — the call surface is one POST.
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "StackBrief <brief@stackbrief.tech>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  // When set, adds RFC 8058 one-click List-Unsubscribe headers. Improves
  // inbox placement (Gmail/Outlook favour — and bulk-sender rules effectively
  // require — a one-click unsubscribe). Must be an absolute HTTPS URL whose
  // endpoint unsubscribes on POST; /api/webhooks/unsubscribe does exactly that.
  listUnsubscribeUrl?: string;
}

export interface SendEmailResult {
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
}

export async function sendEmail(
  input: SendEmailInput,
  opts: { timeoutMs?: number } = {},
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, error: "RESEND_API_KEY not set" };
  }
  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.listUnsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${input.listUnsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 300) };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, status: res.status, id: json.id };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

export function isValidEmail(s: string): boolean {
  // Pragmatic, not RFC-perfect: rejects the obvious garbage without
  // requiring punycode handling. The Resend API and bounce flow are the
  // real validators.
  if (s.length < 3 || s.length > 254) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  if (at === s.length - 1) return false;
  if (s.includes(" ")) return false;
  return s.slice(at + 1).includes(".");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function shell(title: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0c;color:#ececef;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.55;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0c;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#101013;border:1px solid rgba(255,255,255,0.14);border-radius:14px;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px 32px;">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#f5a73c;">StackBrief</div>
      </td></tr>
      <tr><td style="padding:8px 32px 24px 32px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgba(236,236,239,0.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        ${footerHtml}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// Inline markdown → HTML for the digest. The digest prompt promises
// plain prose with `## headings`, `**bold**`, and double-newline paragraph
// breaks — no lists, no links in prose, no code. Anything richer than that
// is out of scope and would need a real renderer.
export function renderDigestHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const para = buf.join(" ").trim();
    if (para) out.push(`<p style="margin:0 0 14px 0;font-size:15px;color:#ececef;">${inlineFmt(para)}</p>`);
    buf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "") { flush(); continue; }
    if (line.startsWith("# ")) {
      flush();
      out.push(`<h1 style="margin:0 0 6px 0;font-size:22px;letter-spacing:-0.01em;color:#ececef;">${inlineFmt(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      out.push(`<h2 style="margin:24px 0 10px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#f5a73c;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${inlineFmt(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
      flush();
      out.push(`<div style="margin:0 0 18px 0;font-size:12px;color:rgba(236,236,239,0.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(line.slice(1, -1))}</div>`);
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.join("\n");
}

function inlineFmt(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600;">$1</strong>');
}

// ---------------------------------------------------------------------------

export function buildConfirmationEmail(confirmUrl: string): { subject: string; html: string; text: string } {
  const subject = "Confirm your StackBrief subscription";
  const html = shell(
    subject,
    `<h1 style="margin:0 0 14px 0;font-size:24px;letter-spacing:-0.01em;color:#ececef;">One click to confirm.</h1>
     <p style="margin:0 0 22px 0;color:rgba(236,236,239,0.72);font-size:15px;">You're almost subscribed to StackBrief — the fastest way to keep up with AI. Hit the button below to confirm and we'll start sending.</p>
     <p style="margin:0 0 24px 0;"><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#f5a73c;color:#0a0a0c;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;padding:12px 22px;border-radius:10px;text-decoration:none;letter-spacing:0.02em;">Confirm subscription</a></p>
     <p style="margin:0;font-size:12px;color:rgba(236,236,239,0.5);">If the button doesn't work, paste this into your browser:<br><span style="color:rgba(236,236,239,0.72);word-break:break-all;">${escapeHtml(confirmUrl)}</span></p>`,
    `Didn't sign up? Just ignore this email — we won't send anything else.`,
  );
  const text = `Confirm your StackBrief subscription:\n\n${confirmUrl}\n\nDidn't sign up? Ignore this email and you'll hear nothing more.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------

export interface EmailItem {
  title: string;
  url: string;
  summary: string | null;
  importance: number | null;
  category: Category | null;
  duplicate_count: number;
  source_name: string;
  published_at: string | null;
}

export function buildItemAlertEmail(
  items: EmailItem[],
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  // Multiple items bundled into one email: even per-item subscribers don't
  // want N separate emails when several items land in the same notify tick.
  // The Discord channel still splits because Discord chat scrolling is the
  // unit of consumption there; an email inbox is not.
  const lead = items[0];
  const subject =
    items.length === 1
      ? `[${lead.importance ?? 0}] ${lead.title}`.slice(0, 120)
      : `${items.length} new on StackBrief — ${lead.title}`.slice(0, 120);

  const itemsHtml = items
    .map(
      (it) => `
      <div style="margin:0 0 22px 0;padding:0 0 22px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:rgba(236,236,239,0.5);letter-spacing:0.04em;margin-bottom:6px;">
          ${escapeHtml(it.source_name)}${it.duplicate_count >= 2 ? ` · ${1 + it.duplicate_count} sources` : ""}
          ${it.category ? ` · ${escapeHtml(it.category)}` : ""}
          ${it.importance != null ? ` · importance ${it.importance}` : ""}
        </div>
        <h2 style="margin:0 0 10px 0;font-size:18px;letter-spacing:-0.01em;line-height:1.3;">
          <a href="${escapeHtml(it.url)}" style="color:#ececef;text-decoration:none;">${escapeHtml(it.title)}</a>
        </h2>
        ${it.summary ? `<p style="margin:0;color:rgba(236,236,239,0.72);font-size:14px;line-height:1.55;">${escapeHtml(it.summary.slice(0, 400))}</p>` : ""}
      </div>`,
    )
    .join("\n");

  const html = shell(
    subject,
    itemsHtml,
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:rgba(236,236,239,0.5);text-decoration:underline;">Unsubscribe</a> · You're getting this because you subscribed at stackbrief.tech.`,
  );

  const textParts = items.map((it) => {
    const parts = [`# ${it.title}`, it.url];
    if (it.summary) parts.push("", it.summary.slice(0, 400));
    parts.push(
      "",
      `Source: ${it.source_name}${it.duplicate_count >= 2 ? ` (${1 + it.duplicate_count} sources)` : ""} · importance ${it.importance ?? 0}${it.category ? ` · ${it.category}` : ""}`,
    );
    return parts.join("\n");
  });
  const text = `${textParts.join("\n\n---\n\n")}\n\nUnsubscribe: ${unsubscribeUrl}`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------

export function buildDigestEmail(
  markdown: string,
  periodLabel: string,
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  const subject = `StackBrief — ${periodLabel}`;
  const html = shell(
    subject,
    renderDigestHtml(markdown),
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:rgba(236,236,239,0.5);text-decoration:underline;">Unsubscribe</a> · Daily AI briefing from stackbrief.tech`,
  );
  const text = `${markdown}\n\n—\nUnsubscribe: ${unsubscribeUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Daily 5pm-ET brief email. Two sections: a ranked "What's going on in AI
// Space" list (from the news brief's structured topics) and "What's being
// talked about in X" (the X prose brief, with its [n] markers turned into
// links). Tight by design — the reader just wants what happened.

interface BriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}
type CiteMap = Record<string, BriefCitation> | null | undefined;

const SECTION_HEAD =
  "margin:26px 0 12px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#f5a73c;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

export function buildDailyBriefEmail(input: {
  newsSections: NewsBriefSections | null;
  newsCitations: CiteMap;
  xMarkdown: string | null;
  xCitations: CiteMap;
  periodLabel: string;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const { newsSections, newsCitations, xMarkdown, xCitations, periodLabel, unsubscribeUrl } = input;
  const subject = `StackBrief — what happened in AI today · ${periodLabel}`;

  const bodyParts: string[] = [
    `<h1 style="margin:0 0 4px 0;font-size:20px;letter-spacing:-0.01em;color:#ececef;">What happened in AI today</h1>
     <div style="margin:0 0 8px 0;font-size:12px;color:rgba(236,236,239,0.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(periodLabel)}</div>`,
  ];

  if (newsSections && newsSections.topics.length > 0) {
    bodyParts.push(`<h2 style="${SECTION_HEAD}">What's going on in AI Space</h2>`);
    bodyParts.push(renderNewsTopicsHtml(newsSections, newsCitations));
  }
  if (xMarkdown && xMarkdown.trim()) {
    bodyParts.push(`<h2 style="${SECTION_HEAD}">What's being talked about in X</h2>`);
    bodyParts.push(renderXBriefHtml(xMarkdown, xCitations));
  }

  const html = shell(
    subject,
    bodyParts.join("\n"),
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:rgba(236,236,239,0.5);text-decoration:underline;">Unsubscribe</a> · Daily AI brief from stackbrief.tech`,
  );

  const text = buildDailyBriefText({ newsSections, xMarkdown, periodLabel, unsubscribeUrl });
  return { subject, html, text };
}

function renderNewsTopicsHtml(sections: NewsBriefSections, citations: CiteMap): string {
  const items = sections.topics.map((t) => {
    const url = citations?.[String(t.cite)]?.posts?.[0]?.url;
    const titleHtml = url
      ? `<a href="${escapeHtml(url)}" style="color:#fff;font-weight:600;text-decoration:none;font-size:15px;">${escapeHtml(t.title)}</a>`
      : `<span style="color:#fff;font-weight:600;font-size:15px;">${escapeHtml(t.title)}</span>`;
    const bullets = t.bullets.length
      ? `<ul style="margin:6px 0 0 0;padding-left:18px;color:rgba(236,236,239,0.72);font-size:14px;line-height:1.5;">${t.bullets
          .map((b) => `<li style="margin:0 0 3px 0;">${escapeHtml(b)}</li>`)
          .join("")}</ul>`
      : "";
    return `<li style="margin:0 0 14px 0;">${titleHtml}${bullets}</li>`;
  });
  return `<ol style="margin:0;padding-left:20px;">${items.join("")}</ol>`;
}

// The X prose brief markdown → compact HTML. Drops the brief's own H1 and the
// "*N posts reviewed*" meta (the email section header covers it), keeps the
// "## " subheads, and turns [n] markers into links via the citation map.
function renderXBriefHtml(markdown: string, citations: CiteMap): string {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const para = buf.join(" ").trim();
    if (para) {
      out.push(
        `<p style="margin:0 0 12px 0;font-size:14px;color:rgba(236,236,239,0.78);line-height:1.55;">${inlineWithCites(para, citations)}</p>`,
      );
    }
    buf = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") { flush(); continue; }
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      flush();
      out.push(
        `<div style="margin:16px 0 6px 0;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:rgba(236,236,239,0.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(line.slice(3))}</div>`,
      );
      continue;
    }
    if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) continue;
    buf.push(line);
  }
  flush();
  return out.join("\n");
}

// **bold** + [n] citation links. Escapes first, then injects our own controlled
// markup (the URL is escaped), so user text can't break out.
function inlineWithCites(s: string, citations: CiteMap): string {
  let html = escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600;">$1</strong>');
  html = html.replace(/\[(\d+)\]/g, (_full, num: string) => {
    const url = citations?.[num]?.posts?.[0]?.url;
    if (!url) return `<sup style="color:rgba(236,236,239,0.4);">[${num}]</sup>`;
    return `<sup><a href="${escapeHtml(url)}" style="color:#f5a73c;text-decoration:none;">[${num}]</a></sup>`;
  });
  return html;
}

function buildDailyBriefText(input: {
  newsSections: NewsBriefSections | null;
  xMarkdown: string | null;
  periodLabel: string;
  unsubscribeUrl: string;
}): string {
  const { newsSections, xMarkdown, periodLabel, unsubscribeUrl } = input;
  const parts: string[] = [`What happened in AI today — ${periodLabel}`];
  if (newsSections && newsSections.topics.length > 0) {
    parts.push("", "What's going on in AI Space", "");
    newsSections.topics.forEach((t, i) => {
      parts.push(`${i + 1}. ${t.title}`);
      for (const b of t.bullets) parts.push(`   - ${b}`);
    });
  }
  if (xMarkdown && xMarkdown.trim()) {
    // Strip the brief's own H1 / meta line; keep the prose (with bare [n]).
    const body = xMarkdown
      .split("\n")
      .filter((l) => !l.startsWith("# ") && !(l.startsWith("*") && l.endsWith("*") && !l.startsWith("**")))
      .join("\n")
      .trim();
    parts.push("", "What's being talked about in X", "", body);
  }
  parts.push("", "—", `Unsubscribe: ${unsubscribeUrl}`);
  return parts.join("\n");
}
