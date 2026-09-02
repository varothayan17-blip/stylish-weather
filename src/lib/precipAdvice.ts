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
 *   Implemented in precipDecision.ts and re-exported here.
 */

// Re-export shared precipitation-decision symbols from precipDecision.ts.
// All existing callers import from precipAdvice.ts — these re-exports keep
// every import path unchanged while Stage A moves the implementations.
export {
  THUNDER_CODES,
  RAIN_CODES,
  type HourlyPrecipSlot,
  type UmbrellaLevel,
  type LookAheadAdvice,
  lookAheadUmbrellaAdvice,
  notificationEligible,
} from "./precipDecision";

// Import what this file needs for its own implementations.
import { THUNDER_CODES, RAIN_CODES, type HourlyPrecipSlot, type UmbrellaLevel } from "./precipDecision";

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

/** Text labels for each umbrella level (future/general rain). */
export const UMBRELLA_LABEL: Record<UmbrellaLevel, string | null> = {
  0: null,
  1: "Consider carrying a compact umbrella.",
  2: "Umbrella recommended.",
  3: "Strongly recommend carrying an umbrella.",
};

/**
 * When rainTiming indicates rain is happening NOW, use this stronger action label.
 * The secondary text (rainTiming phrase) provides the exact context, e.g.:
 * "Rain happening now." or "Rain expected soon."
 */
export const UMBRELLA_LABEL_NOW = "Bring an umbrella now.";

/**
 * Returns true when rainTiming indicates precipitation is active right now
 * or imminent (within the current hour). Used by the UI to select the
 * stronger "now" label instead of the general future label.
 */
export function isRainNow(rainTiming: string | null): boolean {
  if (!rainTiming) return false;
  return (
    rainTiming.includes("happening now") ||
    rainTiming.includes("expected soon")
  );
}

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
 *     BUT ONLY when precipitationIsActiveNow is true (or not supplied).
 *   - window starts within 60 min                      -> "expected soon"
 *   - otherwise -> existing daypart / time-range wording
 *   Omit for future forecast days.
 *
 * @param precipitationIsActiveNow
 *   Optional. When supplied:
 *     true  — "happening now" wording is allowed (caller confirmed active precipitation).
 *     false — "happening now" is suppressed; probability alone cannot claim rain is active.
 *             "expected soon" is also suppressed when the window started up to 60 min ago.
 *   When omitted (undefined) — original behavior: window timing decides.
 *   This prevents probability (e.g. 57%) from producing "Rain happening now"
 *   when the WMO code and measured precipitation fields indicate no active rain.
 */
export function rainTimingPhrase(
  hourlyPrecip: HourlyPrecipSlot[],
  threshold = 30,
  nowFrac?: number,
  precipitationIsActiveNow?: boolean,
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
      // The probability window is active, but we must ALSO have confirmed
      // active precipitation via the shared rainNowDecision() result.
      // When precipitationIsActiveNow is explicitly false, probability alone
      // cannot produce "happening now" — downgrade to "expected soon" if the
      // rain is truly imminent, otherwise use future wording.
      if (precipitationIsActiveNow !== false) {
        // Rain is occurring right now — current fractional hour is inside the
        // best window AND caller confirms active precipitation evidence.
        return `${condition} happening now.`;
      }
      // precipitationIsActiveNow === false: suppress "happening now".
      // The window started but provider says no active precipitation.
      // This is "Rain possible/expected right now" territory — use "expected soon"
      // only if the window started very recently (within last 15 min).
      if (nowFrac - startHour <= 0.25) {
        return `${condition} expected soon.`;
      }
      // Window well underway but no provider evidence — fall to future wording
      // with the end of the window as the reference.
      // Falls through to regular future wording below.
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
  if (mid < 22) return "this evening";
  return "overnight";
}
