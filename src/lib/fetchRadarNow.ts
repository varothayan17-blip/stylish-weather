/**
 * fetchRadarNow.ts — Client-side helper to call /api/radar-now.
 *
 * Calls the server route, which proxies the ECCC GeoMet WMS request
 * server-side. The browser never contacts geo.weather.gc.ca directly.
 *
 * Returns a RadarPrecipObservation. On any error, returns status="unavailable"
 * so the caller (rainNowDecision) silently falls back to Open-Meteo evidence.
 *
 * Only called for Canadian locations (lat 41.5–83.5, lon -141 to -52).
 * For non-Canadian locations, returns "no-coverage" without a network request.
 */

import type { RadarPrecipObservation } from "./radar-types";

const CANADA_LAT_MIN = 41.5;
const CANADA_LAT_MAX = 83.5;
const CANADA_LON_MIN = -141.0;
const CANADA_LON_MAX = -52.0;

export function isCanadianLocation(lat: number, lon: number): boolean {
  return (
    lat >= CANADA_LAT_MIN && lat <= CANADA_LAT_MAX &&
    lon >= CANADA_LON_MIN && lon <= CANADA_LON_MAX
  );
}

export async function fetchRadarNow(
  lat: number,
  lon: number,
): Promise<RadarPrecipObservation> {
  if (!isCanadianLocation(lat, lon)) {
    return { status: "no-coverage", source: "eccc-radar" };
  }

  try {
    const url = `/api/radar-now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!resp.ok) return { status: "unavailable", source: "eccc-radar" };
    const data = await resp.json() as RadarPrecipObservation;
    // Basic validation: ensure the response has a valid status
    if (!["precipitation", "dry", "no-coverage", "unavailable"].includes(data.status)) {
      return { status: "unavailable", source: "eccc-radar" };
    }
    return data;
  } catch {
    return { status: "unavailable", source: "eccc-radar" };
  }
}
