/**
 * precipDecision.ts
 *
 * Pure precipitation-decision logic shared between the client and the
 * Phase 2 backend notification system (Cloud Function).
 *
 * No DOM dependencies. No side effects. Safe to import in Node.js.
 *
 * Exports:
 *   THUNDER_CODES          — WMO codes for thunder events
 *   RAIN_CODES             — WMO codes for rain/drizzle/shower events
 *   HourlyPrecipSlot       — per-hour precipitation data shape
 *   UmbrellaLevel          — 0–3 umbrella intensity tier
 *   LookAheadAdvice        — result of lookAheadUmbrellaAdvice()
 *   lookAheadUmbrellaAdvice() — full-day future rain window detection
 *   notificationEligible()    — push-notification threshold gate (level ≥ 2)
 *
 * Imported by:
 *   • precipAdvice.ts — re-exports these symbols so existing callers are unchanged
 *   • weatherContext.ts — via precipAdvice.ts (no import path change needed)
 *   • Phase 2 Cloud Function — imports directly from this module (server-side)
 */

// ---------------------------------------------------------------------------
// WMO code sets
// ---------------------------------------------------------------------------

export const THUNDER_CODES = new Set([95, 96, 99]);

export const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Hourly precipitation snapshot (one entry per hour of the day). */
export type HourlyPrecipSlot = { hour: number; prob: number; code: number };

/**
 * Umbrella intensity level derived from the daily precipitation probability
 * and hourly data.
 *
 *   0 = no umbrella needed
 *   1 = consider carrying (20–39% day OR a short but meaningful hourly spike)
 *   2 = umbrella recommended (40–59%)
 *   3 = strongly recommended (60%+)
 *
 * Hourly spike rule: if any 2-hour window has avg precipProb ≥ 60% while
 * the daily max is below 40%, we still return level 1 — the rain is
 * concentrated and brief but real.
 */
export type UmbrellaLevel = 0 | 1 | 2 | 3;

/**
 * Look-ahead result: meaningful future rain detected on the remaining hours
 * of the current day, beyond the near-term 12-slot window.
 *
 * level   — umbrella level warranted by the future window (1–3).
 * timing  — factual human-readable phrase (no commute-time assumptions).
 * window  — [startHour, endHour] of the best future rain window.
 */
export type LookAheadAdvice = {
  level: Exclude<UmbrellaLevel, 0>;
  timing: string;
  window: [number, number];
};

// ---------------------------------------------------------------------------
// lookAheadUmbrellaAdvice
// ---------------------------------------------------------------------------

/**
 * Scan the full-day hourlyPrecip array from w.daily[0] for meaningful rain
 * or thunder windows that start AFTER the current hour. Returns the most
 * intense qualifying future window, or null if nothing meaningful is found.
 *
 * Design principles:
 *   • Only future hours (hour > Math.floor(nowFrac)) are considered.
 *     Hours that have already started or passed are excluded.
 *   • A WMO rain/thunder code on a slot is treated as corroborating evidence
 *     for that slot's probability. A single isolated slot at ≥ 50% OR a
 *     rain-coded slot adjacent to another qualifying slot qualifies.
 *   • Single isolated slots at < 50% with no rain code are filtered as noise.
 *   • Thunder codes (95, 96, 99) always warrant level 3.
 *
 * Level assignment (applied to the best future window's average probability):
 *   avg ≥ 65% OR thunder present → 3 (strongly recommended)
 *   avg ≥ 50%                    → 2 (umbrella recommended)
 *   avg ≥ 35%                    → 1 (consider carrying)
 *
 * Timing wording is factual: "Rain expected between 5 PM and 8 PM."
 * No commute-time assumptions are made.
 *
 * @param hourlyPrecip   Full-day slots from DailyForecast.hourlyPrecip.
 * @param nowFrac        Current fractional hour (e.g. 7.5 = 07:30).
 */
export function lookAheadUmbrellaAdvice(
  hourlyPrecip: HourlyPrecipSlot[],
  nowFrac: number,
): LookAheadAdvice | null {
  const currentHour = Math.floor(nowFrac);

  // Only consider hours that have not yet started.
  const futureSlots = hourlyPrecip.filter((h) => h.hour > currentHour);
  if (futureSlots.length === 0) return null;

  // Mark each future slot as qualifying (meaningful precipitation signal).
  // A slot qualifies when its probability meets the minimum threshold OR it
  // carries an authoritative rain/thunder WMO code.
  // The minimum probability to enter a window is 35% — below this, a slot
  // must have a rain/thunder code to avoid reacting to forecast noise.
  const MIN_PROB = 35;
  const qualifies = (h: HourlyPrecipSlot) =>
    h.prob >= MIN_PROB || RAIN_CODES.has(h.code) || THUNDER_CODES.has(h.code);

  const qualified = futureSlots.filter(qualifies);
  if (qualified.length === 0) return null;

  // Group consecutive qualifying hours into windows (gap ≤ 1 h).
  const windows: HourlyPrecipSlot[][] = [];
  let cur: HourlyPrecipSlot[] = [qualified[0]];
  for (let i = 1; i < qualified.length; i++) {
    if (qualified[i].hour - qualified[i - 1].hour <= 1) {
      cur.push(qualified[i]);
    } else {
      windows.push(cur);
      cur = [qualified[i]];
    }
  }
  windows.push(cur);

  // Noise filter: a single isolated slot qualifies only if its prob ≥ 50% OR
  // it has a rain/thunder code. Lone weak-probability slots (e.g. 38% at
  // 22:00 with no supporting code or neighbors) are treated as noise.
  const SINGLE_SLOT_MIN_PROB = 50;
  const meaningfulWindows = windows.filter(
    (w) =>
      w.length >= 2 ||
      w[0].prob >= SINGLE_SLOT_MIN_PROB ||
      THUNDER_CODES.has(w[0].code) ||
      RAIN_CODES.has(w[0].code),
  );
  if (meaningfulWindows.length === 0) return null;

  // Pick the most intense window: highest average probability, with thunder
  // windows always scoring above non-thunder at the same probability.
  const best = meaningfulWindows.reduce((a, b) => {
    const scoreA =
      a.reduce((s, h) => s + h.prob, 0) / a.length +
      (a.some((h) => THUNDER_CODES.has(h.code)) ? 200 : 0);
    const scoreB =
      b.reduce((s, h) => s + h.prob, 0) / b.length +
      (b.some((h) => THUNDER_CODES.has(h.code)) ? 200 : 0);
    return scoreB > scoreA ? b : a;
  });

  const startHour = best[0].hour;
  const endHour = best[best.length - 1].hour;
  const avgProb = best.reduce((s, h) => s + h.prob, 0) / best.length;
  const hasThunder = best.some((h) => THUNDER_CODES.has(h.code));
  const condition = hasThunder ? "Thunderstorms" : "Rain";

  // Assign level based on the best window.
  // Thunder always triggers level 3 regardless of probability.
  let level: Exclude<UmbrellaLevel, 0>;
  if (hasThunder || avgProb >= 65) {
    level = 3;
  } else if (avgProb >= 50) {
    level = 2;
  } else {
    level = 1;
  }

  // Factual timing — no commute-time assumptions.
  // Short window: "between X and Y" (≤ 4 hours or single slot).
  // Long window: named period (this morning / this afternoon / this evening).
  let timing: string;
  const span = endHour - startHour + 1;
  if (span <= 4) {
    timing = `${condition} expected between ${formatHour(startHour)} and ${formatHour(endHour + 1)}.`;
  } else {
    const period = timePeriod(startHour, endHour);
    timing = `${condition} expected ${period}.`;
  }

  return { level, timing, window: [startHour, endHour] };
}

// ---------------------------------------------------------------------------
// notificationEligible
// ---------------------------------------------------------------------------

/**
 * Returns true when a LookAheadAdvice result warrants a push notification.
 *
 * Push notifications are MORE conservative than in-app advice:
 *   level 0 → no push  (no meaningful window found)
 *   level 1 → no push  (35–49% sustained — "consider carrying" in-app only)
 *   level 2 → eligible (≥ 50% sustained rain)
 *   level 3 → eligible (≥ 65% rain or any thunder)
 *
 * This gate is the single source of truth for the push threshold.
 * The Cloud Function and any future notification path must call this
 * function rather than re-implementing the threshold.
 */
export function notificationEligible(advice: LookAheadAdvice): boolean {
  return advice.level >= 2;
}

// ---------------------------------------------------------------------------
// Private helpers (used only within this module)
// ---------------------------------------------------------------------------

/** Format an integer hour as "3 PM" / "10 AM". */
function formatHour(h: number): string {
  const clamped = ((h % 24) + 24) % 24;
  const suffix = clamped < 12 ? "AM" : "PM";
  const display = clamped === 0 ? 12 : clamped > 12 ? clamped - 12 : clamped;
  return `${display} ${suffix}`;
}

/**
 * Convert a start+end hour range to a named time period.
 * The midpoint of the window determines the period label.
 */
function timePeriod(startH: number, endH: number): string {
  const mid = (startH + endH) / 2;
  if (mid < 9) return "this morning";
  if (mid < 12) return "in the late morning";
  if (mid < 14) return "around midday";
  if (mid < 17) return "in the afternoon";
  if (mid < 20) return "this evening";
  return "overnight";
}
