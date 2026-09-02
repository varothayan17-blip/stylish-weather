export type DailyForecast = {
  date: string; // ISO date, e.g. "2026-06-21"
  tempMaxC: number;
  tempMinC: number;
  feelsMaxC: number;
  feelsMinC: number;
  precipProb: number;
  snowCm: number;
  windMaxKph: number;
  uvMax: number;
  code: number;
  condition: string;
  /** Optional secondary alert shown below the primary condition. */
  stormWarning?: string;
  /**
   * Per-hour precipitation snapshot for the day (08:00–23:00 local).
   * Populated by openMeteo.ts from the hourly.precipitation_probability and
   * hourly.weather_code arrays so forecast cards can derive rain timing
   * without hard-coding any times. Empty array if hourly data is unavailable.
   */
  hourlyPrecip: { hour: number; prob: number; code: number }[];
  /**
   * ISO 8601 local-time strings for sunrise and sunset on this day,
   * e.g. "2026-07-07T05:42". Populated from the Open-Meteo daily endpoint.
   * Optional so existing code that constructs DailyForecast manually
   * (e.g. tests or the dormant weatherApiCom provider) does not break.
   */
  sunrise?: string;
  sunset?: string;
};

export type Weather = {
  tempC: number;
  feelsLikeC: number;
  windKph: number;
  precipProb: number;
  snowProb: number;
  uv: number;
  code: number;
  isDay: boolean;
  condition: string;
  hourly: { time: string; tempC: number; precipProb: number; code: number; isDay: boolean }[];
  daily: DailyForecast[];
  city: string;
  /**
   * True when a stormWarning is active for this day — meaning secondary
   * precipitation or storm risk exists even though the primary condition is
   * clear or cloudy. recommend() uses this to force umbrella=true and swap
   * sandals for sneakers even when precipProb and the primary WMO code alone
   * would not trigger those guards.
   *
   * Always false for the live current reading; set by dailyToWeather() when
   * day.stormWarning is non-empty.
   */
  hasSecondaryWeather: boolean;
  /**
   * ISO 8601 local-time string for sunrise and sunset today,
   * e.g. "2026-07-07T05:42". Sourced from the Open-Meteo daily endpoint.
   * Optional so callers that do not need sun times (e.g. dailyToWeather)
   * do not need to supply them.
   */
  sunrise?: string;
  sunset?: string;
  /**
   * Atmospheric air-quality advisory for display below the hero card.
   * Set when haze or smoke is detected via the Air Quality API.
   * Null/undefined when air quality is normal.
   */
  atmosphericAlert?: string;

  // ── Live current-block precipitation fields ──────────────────────────────
  // These are the raw amounts from Open-Meteo's current block (c.precipitation,
  // c.rain, c.showers). Surfaced so rainNowDecision.ts can use them without
  // re-reading the provider response. Values are mm per 15-min accumulation.
  // Set to 0 when missing or not reported.

  /** c.precipitation — total current-block precipitation in mm (15-min window). */
  currentPrecipMm?: number;
  /** c.rain — stratiform liquid precipitation in mm (15-min window). */
  currentRainMm?: number;
  /** c.showers — convective precipitation in mm (15-min window). */
  currentShowersMm?: number;

  /**
   * ISO local-time string of the Open-Meteo current-block timestamp (c.time).
   * Represents the most-recent 15-minute model boundary, e.g. "2026-08-31T15:15".
   * Used for the truthful freshness label: "Conditions for 3:15 PM · checked just now".
   */
  currentTimeIso?: string;

  /**
   * Age of the Open-Meteo current-block data in milliseconds at the time of fetch.
   * = (client fetch time) - (provider c.time).
   * Always >= 0. Positive means the provider data is older than the fetch moment.
   * Used to distinguish stale provider data from a fresh client fetch.
   */
  providerDataAgeMs?: number;

  // ── Nearest minutely_15 slot ─────────────────────────────────────────────
  // The current 15-min slot from the minutely_15 block, if available and within
  // the strict timestamp tolerance used by rainNowDecision. Undefined when the
  // m15 block is absent for the location/model or no in-tolerance slot exists.

  /** Precipitation amount (mm) for the current m15 slot. */
  m15CurrentPrecipMm?: number;
  /** Rain amount (mm) for the current m15 slot. */
  m15CurrentRainMm?: number;
  /** True when the current m15 slot's WMO code is a rain/thunder code. */
  m15CurrentIsRain?: boolean;
  /** ISO local-time string of the selected m15 slot, e.g. "2026-08-31T15:15". */
  m15CurrentTimeIso?: string;

  /**
   * The "local epoch" milliseconds at the moment of the fetch:
   *   Date.now() + utc_offset_seconds * 1000
   *
   * This is NOT a real UTC epoch. It is a pseudo-epoch where the hour/minute
   * components of a getUTCHours()/getUTCMinutes() call return the location's
   * local time — matching the hour/minute embedded in Open-Meteo's ISO strings
   * (which carry no UTC offset suffix and use the location's local timezone).
   *
   * rainNowDecision uses this value (not Date.now()) as `nowMs` so that
   * parseIsoLocal(m15TimeIso) and nowLocalMs are in the same frame of
   * reference regardless of the browser's or server's local timezone.
   *
   * See "Timezone-safe provider timestamps" in rainNowDecision.ts.
   */
  nowLocalMs?: number;
};

/**
 * Anything that can answer "what's the weather at this lat/lon" implements
 * this. Swapping providers (Open-Meteo → WeatherAPI → OpenWeather) means
 * writing one new file that satisfies this interface — no screen, no
 * recommendation logic, and no other file in the app needs to change.
 */
export interface WeatherProvider {
  id: string;
  fetchWeather(lat: number, lon: number, city?: string): Promise<Weather>;
}
