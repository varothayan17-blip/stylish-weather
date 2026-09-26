/**
 * outingForecast.ts — Targeted Open-Meteo fetch for the Outing Planner.
 *
 * Design decisions:
 *   - Full interval containment: departure must be >= coverageStart AND
 *     return must be <= coverageEnd. Partial coverage is rejected.
 *   - Hourly bucket selection: the bucket whose time <= departure is the
 *     first selected slot (handles 8:30 departure → 8:00 bucket is included).
 *     Every subsequent hourly bucket through the return time is included.
 *   - No fallback values: missing or non-finite data causes a fetch_error.
 *   - 10-second AbortController timeout.
 *   - Raw values are never mixed with personalised values here.
 *   - parseOutingForecastResponse is exported as a pure function so tests
 *     can exercise it with fixture JSON without network calls.
 */

export type HourlyOutingSlot = {
  /** ISO local time matching Open-Meteo format "2026-09-22T14:00" */
  time:          string;
  /** Actual air temperature °C */
  tempC:         number;
  /** Apparent (feels-like) temperature °C — wind-chill + heat-index */
  apparentTempC: number;
  /** Precipitation probability 0–100 */
  precipProb:    number;
  /** WMO weather interpretation code */
  code:          number;
  /** Wind speed km/h at 10 m (not gust) */
  windKph:       number;
  /** True during daylight */
  isDay:         boolean;
};

export type OutingForecastSlice = {
  /** Hourly slots covering [departureIso, returnIso] — never empty */
  slots:            HourlyOutingSlot[];
  /** Raw apparent temperature minimum across the exact interval */
  rawMinApparentC:  number;
  /** Raw apparent temperature maximum across the exact interval */
  rawMaxApparentC:  number;
  /** Peak precipitation probability across all slots */
  peakPrecipProb:   number;
  /** Wind speed (not gust) km/h — labelled accurately */
  maxWindKph:       number;
  /**
   * True when any slot has a rain WMO code OR precipProb >= 40.
   * Threshold 40 used here; umbrella logic re-checks code evidence separately.
   */
  hasRain:          boolean;
  /** True when any slot has a snow WMO code */
  hasSnow:          boolean;
  /** True when maxWindKph >= 30 */
  isWindy:          boolean;
  /** Latitude stored so rechecks use the locked plan location */
  lat:              number;
  /** Longitude stored so rechecks use the locked plan location */
  lon:              number;
  /** First available hourly slot ISO */
  coverageStartIso: string;
  /** Last available hourly slot ISO */
  coverageEndIso:   string;
};

export type OutingForecastResult =
  | { ok: true;  slice: OutingForecastSlice }
  | {
      ok: false;
      reason: "out_of_range";
      /** ISO datetime — full date + time, not only clock time */
      availableStart: string;
      /** ISO datetime */
      availableEnd:   string;
    }
  | { ok: false; reason: "fetch_error"; message: string };

/** Raw JSON shape returned by Open-Meteo */
export type OpenMeteoHourlyJson = {
  hourly: {
    time:                      string[];
    temperature_2m:            number[];
    apparent_temperature:      number[];
    precipitation_probability: number[];
    weather_code:              number[];
    wind_speed_10m:            number[];
    is_day:                    number[];
  };
};

/** All WMO codes indicating actively falling rain or rain showers — exported for sharing */
export const RAIN_CODES = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);
/** WMO codes indicating snow */
export const SNOW_CODES = new Set([71,73,75,77,85,86]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/**
 * Parse a validated Open-Meteo JSON response into an OutingForecastResult.
 * Exported as a pure function so tests can call it with fixture data.
 *
 * Full-containment rule:
 *   departure >= coverageStart  AND  return <= coverageEnd
 * Partial coverage is rejected — we never generate a plan from incomplete data.
 *
 * Hourly bucket rule:
 *   Find the LAST hourly bucket whose time <= departure (or the first bucket
 *   if departure is before all buckets). This ensures an 8:30 departure uses
 *   the 8:00 bucket, not the 9:00 bucket.
 *   Then include every subsequent bucket through (and including) return time.
 */
export function parseOutingForecastResponse(
  json:         OpenMeteoHourlyJson,
  lat:          number,
  lon:          number,
  departureIso: string,
  returnIso:    string,
): OutingForecastResult {
  const h = json?.hourly;
  if (
    !h ||
    !Array.isArray(h.time) ||
    !Array.isArray(h.temperature_2m) ||
    !Array.isArray(h.apparent_temperature) ||
    !Array.isArray(h.precipitation_probability) ||
    !Array.isArray(h.weather_code) ||
    !Array.isArray(h.wind_speed_10m) ||
    !Array.isArray(h.is_day)
  ) {
    return { ok: false, reason: "fetch_error", message: "Malformed hourly data from API" };
  }

  const times = h.time;
  const n     = times.length;
  if (n === 0) {
    return { ok: false, reason: "fetch_error", message: "No hourly data returned" };
  }

  const coverageStartIso = times[0];
  const coverageEndIso   = times[n - 1];

  // Full-containment validation (issue 3)
  // departure must be >= first available slot
  // return must be <= last available slot
  if (departureIso < coverageStartIso) {
    return {
      ok: false,
      reason: "out_of_range",
      availableStart: coverageStartIso,
      availableEnd:   coverageEndIso,
    };
  }
  if (returnIso > coverageEndIso) {
    return {
      ok: false,
      reason: "out_of_range",
      availableStart: coverageStartIso,
      availableEnd:   coverageEndIso,
    };
  }

  // Find start index: last bucket whose time <= departureIso (issue 4)
  // This handles 8:30 departure → 8:00 bucket is selected, not 9:00
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    if (times[i] <= departureIso) {
      startIdx = i;
    } else {
      break;
    }
  }

  // Collect all slots from startIdx through return time
  const slots: HourlyOutingSlot[] = [];
  for (let i = startIdx; i < n; i++) {
    if (times[i] > returnIso) break;

    // Validate each data point — no fallback values (issue 19)
    const tempC         = h.temperature_2m[i];
    const apparentTempC = h.apparent_temperature[i];
    const precipProb    = h.precipitation_probability[i];
    const code          = h.weather_code[i];
    const windKph       = h.wind_speed_10m[i];
    const isDayRaw      = h.is_day[i];

    if (
      !isFiniteNumber(tempC) ||
      !isFiniteNumber(apparentTempC) ||
      !isFiniteNumber(precipProb) ||
      !isFiniteNumber(code) ||
      !isFiniteNumber(windKph) ||
      typeof isDayRaw !== "number"
    ) {
      return {
        ok:      false,
        reason:  "fetch_error",
        message: `Non-finite or missing data at slot index ${i} (time: ${times[i]})`,
      };
    }

    slots.push({
      time:          times[i],
      tempC,
      apparentTempC,
      precipProb:    Math.round(precipProb),
      code:          Math.round(code),
      windKph,
      isDay:         isDayRaw === 1,
    });
  }

  if (slots.length === 0) {
    return { ok: false, reason: "fetch_error", message: "No slots within the requested interval" };
  }

  let rawMinApparentC = Infinity;
  let rawMaxApparentC = -Infinity;
  let peakPrecipProb  = 0;
  let maxWindKph      = 0;
  let hasRain         = false;
  let hasSnow         = false;

  for (const s of slots) {
    if (s.apparentTempC < rawMinApparentC) rawMinApparentC = s.apparentTempC;
    if (s.apparentTempC > rawMaxApparentC) rawMaxApparentC = s.apparentTempC;
    if (s.precipProb    > peakPrecipProb)  peakPrecipProb  = s.precipProb;
    if (s.windKph       > maxWindKph)      maxWindKph       = s.windKph;
    // Rain if WMO code indicates active rain OR probability is material (issue 15)
    if (RAIN_CODES.has(s.code) || s.precipProb >= 40) hasRain = true;
    if (SNOW_CODES.has(s.code)) hasSnow = true;
  }

  return {
    ok: true,
    slice: {
      slots,
      rawMinApparentC: Math.round(rawMinApparentC * 10) / 10,
      rawMaxApparentC: Math.round(rawMaxApparentC * 10) / 10,
      peakPrecipProb:  Math.round(peakPrecipProb),
      maxWindKph:      Math.round(maxWindKph),
      hasRain,
      hasSnow,
      isWindy:          maxWindKph >= 30,
      lat,
      lon,
      coverageStartIso,
      coverageEndIso,
    },
  };
}

/**
 * Fetch hourly forecast data from Open-Meteo and parse it for the outing interval.
 * 10-second timeout. No fallback values.
 */
export async function fetchOutingForecast(
  lat:          number,
  lon:          number,
  departureIso: string,
  returnIso:    string,
): Promise<OutingForecastResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,is_day` +
    `&timezone=auto&forecast_days=7`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let json: OpenMeteoHourlyJson;
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json() as OpenMeteoHourlyJson;
  } catch (e) {
    clearTimeout(timer);
    return {
      ok:      false,
      reason:  "fetch_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  return parseOutingForecastResponse(json, lat, lon, departureIso, returnIso);
}
