/**
 * precipAdvice.ts
 *
 * Pure functions for precipitation advice: umbrella intensity level and
 * rain timing language. All outputs are derived directly from the hourly
 * precipitation data stored on DailyForecast — no values are invented.
 *
 * Imported by:
 *   • weatherContext.ts — to add umbrellaLevel + rainTiming to WeatherContext
 *   • forecast.tsx — to render the advice in expanded forecast cards
 *
 * lookAheadUmbrellaAdvice() — scans the full daily hourlyPrecip for future
 *   rain windows beyond the near-term 12-slot hourly window.
 */

const THUNDER_CODES = new Set([95, 96, 99]);
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

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

export function umbrellaLevel(
  dailyPrecipProb: number,
  hourlyPrecip: HourlyPrecipSlot[],
): UmbrellaLevel {
  if (dailyPrecipProb >= 60) return 3;
  if (dailyPrecipProb >= 40) return 2;
  if (dailyPrecipProb >= 20) return 1;

  // Below 20% daily — check for a concentrated hourly spike.
  // A 2-hour window with avg ≥ 60% is a real, brief rain event.
  for (let idx = 0; idx < hourlyPrecip.length - 1; idx++) {
    const avgTwo = (hourlyPrecip[idx].prob + hourlyPrecip[idx + 1].prob) / 2;
    if (avgTwo >= 60) return 1;
  }

  return 0;
}

/** Text labels for each umbrella level. */
export const UMBRELLA_LABEL: Record<UmbrellaLevel, string | null> = {
  0: null,
  1: "Consider carrying a compact umbrella.",
  2: "Umbrella recommended.",
  3: "Strongly recommend carrying an umbrella.",
};

/** Umbrella icon glyph — ☂ for levels 1–2, ☔ for level 3. */
export const UMBRELLA_ICON: Record<UmbrellaLevel, string> = {
  0: "",
  1: "☂",
  2: "☂",
  3: "☔",
};

/**
 * Determine the rain timing phrase for a forecast day based on hourly data.
 * Returns a natural-language string or null if no meaningful rain is expected.
 *
 * Algorithm:
 *   1. Find all hours with precipProb >= 30 (or a thunder code).
 *   2. Group consecutive hours into windows.
 *   3. Pick the window with the highest average probability.
 *   4. Choose wording based on whether rain is active now, starting soon,
 *      or genuinely in the future.
 *
 * @param nowFrac  Optional fractional hour (0-23.983) = getHours()+getMinutes()/60.
 *   When supplied, wording is time-aware:
 *   - current fractional hour is inside the best window -> "happening now"
 *   - window starts within 60 min                      -> "expected soon"
 *   - otherwise -> existing daypart / time-range wording
 *   Omit for future forecast days.
 */
export function rainTimingPhrase(
  hourlyPrecip: HourlyPrecipSlot[],
  threshold = 30,
  nowFrac?: number,
): string | null {
  if (hourlyPrecip.length === 0) return null;

  // Mark which hours meet the rain threshold
  const rainHours = hourlyPrecip.filter((h) => h.prob >= threshold || RAIN_CODES.has(h.code));
  if (rainHours.length === 0) return null;

  // Group consecutive hours (gap <= 1 h) into windows
  const windows: HourlyPrecipSlot[][] = [];
  let current: HourlyPrecipSlot[] = [rainHours[0]];
  for (let i = 1; i < rainHours.length; i++) {
    if (rainHours[i].hour - rainHours[i - 1].hour <= 1) {
      current.push(rainHours[i]);
    } else {
      windows.push(current);
      current = [rainHours[i]];
    }
  }
  windows.push(current);

  // Pick the most intense window (highest average prob)
  const best = windows.reduce((a, b) => {
    const avgA = a.reduce((s, h) => s + h.prob, 0) / a.length;
    const avgB = b.reduce((s, h) => s + h.prob, 0) / b.length;
    return avgB > avgA ? b : a;
  });

  const startHour = best[0].hour;
  const endHour = best[best.length - 1].hour;
  const hasThunder = best.some((h) => THUNDER_CODES.has(h.code));
  const condition = hasThunder ? "Thunderstorms" : "Rain";

  // ── Time-aware wording when nowFrac is supplied ──────────────────────────
  // nowFrac is the fractional current hour (e.g. 00:03 = 0.05).
  // An integer hour H represents the interval [H, H+1), so the best window
  // covers [startHour, endHour+1). The window is active when nowFrac is
  // inside that interval.
  if (nowFrac !== undefined) {
    const windowIsActive = nowFrac >= startHour && nowFrac < endHour + 1;
    // minutesToStart is negative when the window has already started.
    const minutesToStart = (startHour - nowFrac) * 60;

    if (windowIsActive) {
      // Rain is occurring right now — current fractional hour is inside the
      // best window. Prioritise this over any daypart label.
      return `${condition} happening now.`;
    }
    if (minutesToStart > 0 && minutesToStart <= 60) {
      // Rain window starts within the next 60 minutes.
      return `${condition} expected soon.`;
    }
    // Falls through to regular future wording below.
  }

  // ── Regular wording (future window or no nowFrac supplied) ───────────────
  if (best.length === 1) {
    // Single hour — specific time
    return `${condition} possible around ${formatHour(startHour)}.`;
  }

  const spanHours = endHour - startHour + 1;

  if (spanHours <= 4) {
    // Short window — "between X and Y"
    return `${condition} expected between ${formatHour(startHour)} and ${formatHour(endHour + 1)}.`;
  }

  // Longer window — use named period
  const period = timePeriod(startHour, endHour);
  return `${condition} likely ${period}.`;
}


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
