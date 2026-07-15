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
