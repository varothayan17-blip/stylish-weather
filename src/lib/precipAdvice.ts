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
 *   1. Find all hours with precipProb ≥ 30 (or a thunder code).
 *   2. Group consecutive hours into windows.
 *   3. Pick the window with the highest average probability.
 *   4. Choose wording based on window span and severity.
 *
 * All times come from the API — nothing is invented.
 */
export function rainTimingPhrase(hourlyPrecip: HourlyPrecipSlot[], threshold = 30): string | null {
  if (hourlyPrecip.length === 0) return null;

  // Mark which hours meet the rain threshold
  const rainHours = hourlyPrecip.filter((h) => h.prob >= threshold || RAIN_CODES.has(h.code));
  if (rainHours.length === 0) return null;

  // Group consecutive hours (gap ≤ 1 h) into windows
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

  // Choose phrasing based on span and time of day
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
