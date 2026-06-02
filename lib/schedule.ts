// Daily-cadence helper. The briefs + the combined email are generated ONCE per
// day in the morning US-Eastern (when most readers check email), not
// continuously — this is the single source of truth for that gate and for the
// ET-day window used as the idempotency key.
//
// Why ET and not UTC: the audience is US-centric and the send hour should be
// the reader's wall-clock hour, surviving DST. Intl with timeZone does the DST
// math for us, so there's no tz dependency to ship.

const TZ = "America/New_York";

// Generation fires at the first tick on/after this ET wall-clock hour.
export const BRIEF_HOUR_ET = 8; // 8am — when most people check their inbox

export interface EtDayWindow {
  etDay: string;             // "YYYY-MM-DD" in ET — human label / log key
  hourET: number;            // 0-23, current ET wall-clock hour
  isAfterBriefHour: boolean; // hourET >= BRIEF_HOUR_ET
  etMidnightUtc: string;     // ISO — 00:00 ET of etDay, as a UTC instant (digest period_start)
  periodEnd: string;         // ISO — next 00:00 ET, as a UTC instant
}

// shortOffset renders as "GMT-4", "GMT-04:00", or "GMT+5:30" depending on the
// runtime — accept all three.
function parseGmtOffsetMinutes(s: string): number {
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? "0"));
}

// ET-day window + morning gate for `now`. The UTC instants are derived from
// that day's ET offset, so they're stable for every call within the same ET day
// (DST flips at 2am, before the 8am gate, so the offset is settled by the time
// generation runs — the period key never shifts under us mid-day).
export function etDayWindow(now: Date = new Date()): EtDayWindow {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const parts = dtf.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hourET = Number(get("hour"));
  const offsetMin = parseGmtOffsetMinutes(get("timeZoneName"));

  // ET-wall 00:00 as a UTC instant: ET = UTC + offsetMin (offsetMin negative in
  // North America), so the UTC instant for ET midnight is the civil-date UTC
  // midnight minus the offset.
  const civilMidnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const etMidnightUtcMs = civilMidnightUtcMs - offsetMin * 60_000;
  const etMidnightUtc = new Date(etMidnightUtcMs).toISOString();
  // +24h is exact except on the two DST-boundary days, where it's off by an
  // hour — harmless, since periodEnd is only an idempotency upper bound and a
  // generous item-window cap.
  const periodEnd = new Date(etMidnightUtcMs + 24 * 3600 * 1000).toISOString();

  const etDay = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return {
    etDay,
    hourET,
    isAfterBriefHour: hourET >= BRIEF_HOUR_ET,
    etMidnightUtc,
    periodEnd,
  };
}
