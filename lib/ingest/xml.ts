export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SerializeItemOpts {
  guid: string;
  link: string;
  title: string;
  pubDate: string | null;
  description: string;
  thumbnail: string | null;
  attrs?: Record<string, string>;
}

export function serializeItemXml(opts: SerializeItemOpts): string {
  const fields: string[] = [
    `<guid>${xmlEscape(opts.guid)}</guid>`,
    `<link>${xmlEscape(opts.link)}</link>`,
    `<title>${xmlEscape(opts.title)}</title>`,
  ];
  if (opts.pubDate) fields.push(`<pubDate>${xmlEscape(opts.pubDate)}</pubDate>`);
  if (opts.description) fields.push(`<description>${xmlEscape(opts.description)}</description>`);
  if (opts.thumbnail) fields.push(`<thumbnail>${xmlEscape(opts.thumbnail)}</thumbnail>`);
  const attrStr = opts.attrs
    ? " " + Object.entries(opts.attrs).map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(" ")
    : "";
  return `<item${attrStr}>${fields.join("")}</item>`;
}
