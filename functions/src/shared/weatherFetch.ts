/**
 * weatherFetch.ts — Minimal Open-Meteo fetch for Cloud Functions.
 *
 * Fetches only the fields needed to build hourlyPrecip for lookAheadUmbrellaAdvice.
 * Does NOT replicate the full client-side openMeteo.ts — only what Stage E needs.
 *
 * OPEN-METEO LICENSING
 * ─────────────────────
 * The free open-access endpoint (api.open-meteo.com) is for NON-COMMERCIAL use.
 * Current free-tier limits (verify at open-meteo.com/en/pricing):
 *   10,000 API calls/day · 5,000 calls/hour · 600 calls/minute
 *
 * Aeruvo is a student/personal project and not currently monetized, so the
 * free endpoint is acceptable at this stage.
 *
 * ⚠️  BEFORE MONETIZING AERUVO (ads, subscriptions, paid plans, or any
 * commercial use), review Open-Meteo licensing at open-meteo.com/en/pricing
 * and migrate to an appropriate commercial API plan or alternative provider.
 *
 * No API key is required for the free endpoint.
 */

import type { HourlyPrecipSlot } from "./precipDecision";

/** One day's worth of hourly precipitation data. */
export type DayPrecipData = {
  date: string;           // "YYYY-MM-DD"
  hourlyPrecip: HourlyPrecipSlot[];
};

/**
 * Fetch today's hourly precipitation for a given location.
 * Returns slots for the current calendar day in the given timezone,
 * from hour 0 through 23.
 *
 * @param lat       Latitude
 * @param lon       Longitude
 * @param timezone  IANA timezone, e.g. "America/Toronto"
 */
export async function fetchTodayPrecip(
  lat: number,
  lon: number,
  timezone: string,
  timeoutMs = 10_000,
): Promise<DayPrecipData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&timezone=${encodeURIComponent(timezone)}` +
    `&forecast_days=1` +
    `&hourly=precipitation_probability,weather_code` +
    `&timeformat=iso8601`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) {
    throw new Error(`Open-Meteo error: HTTP ${resp.status}`);
  }

  const data = await resp.json() as {
    hourly: {
      time: string[];
      precipitation_probability: number[];
      weather_code: number[];
    };
  };

  const h = data.hourly;
  if (!h?.time?.length) {
    throw new Error("Open-Meteo returned empty hourly data");
  }

  // Date string for today in the requested timezone is the prefix of h.time[0]
  // (Open-Meteo returns times in the requested timezone when timezone is set).
  const date = h.time[0].slice(0, 10);

  const hourlyPrecip: HourlyPrecipSlot[] = h.time
    .map((t, i) => ({
      hour: parseInt(t.slice(11, 13), 10),
      prob: h.precipitation_probability[i] ?? 0,
      code: h.weather_code[i] ?? 0,
    }))
    .filter((slot) => slot.hour >= 0 && slot.hour <= 23);

  return { date, hourlyPrecip };
}
