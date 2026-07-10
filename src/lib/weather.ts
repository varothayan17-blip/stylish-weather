import { weatherProvider } from "./weatherProviders";
import { CANADIAN_LOCALITIES } from "./canadianLocalities";

export type { Weather, DailyForecast } from "./weatherProviders";

/**
 * Public entry point every screen calls. The actual network request is
 * delegated to whichever WeatherProvider is active (see
 * src/lib/weatherProviders/index.ts) — screens never need to know or care
 * which one that is.
 */
export function fetchWeather(lat: number, lon: number, city = "Your location") {
  return weatherProvider.fetchWeather(lat, lon, city);
}

/**
 * Reshapes a single day of forecast data into a Weather-shaped object so it
 * can be run through the exact same `recommend()` and `computeRegretRisk()`
 * used for today — one recommendation engine, no duplicated outfit logic.
 * The two synthetic hourly points (day low, day high) let the existing
 * "temperature swing" risk factor work unchanged for forecast days too.
 */
import type { DailyForecast, Weather } from "./weatherProviders";

export function dailyToWeather(day: DailyForecast, city: string): Weather {
  // Use the real per-hour precipitation data stored on DailyForecast when
  // available. precipAdvice.ts uses w.hourly to derive rain timing — if we
  // use the old 2-slot synthetic approximation, we'd get misleading timing
  // like "Rain between 6 AM and 3 PM" for every forecast day regardless of
  // when the rain actually occurs.
  const hourly =
    day.hourlyPrecip.length > 0
      ? day.hourlyPrecip.map((h) => ({
          time: `${day.date}T${String(h.hour).padStart(2, "0")}:00`,
          tempC: h.hour < 12 ? day.tempMinC : day.tempMaxC,
          precipProb: h.prob,
          code: h.code,
          isDay: h.hour >= 6 && h.hour <= 21,
        }))
      : [
          // Fallback for the dormant weatherApiCom provider which doesn't
          // populate hourlyPrecip — two synthetic slots as before.
          {
            time: `${day.date}T06:00`,
            tempC: day.tempMinC,
            precipProb: day.precipProb,
            code: day.code,
            isDay: true,
          },
          {
            time: `${day.date}T15:00`,
            tempC: day.tempMaxC,
            precipProb: day.precipProb,
            code: day.code,
            isDay: true,
          },
        ];

  return {
    tempC: day.tempMaxC,
    feelsLikeC: day.feelsMaxC,
    windKph: day.windMaxKph,
    precipProb: day.precipProb,
    snowProb: day.snowCm >= 0.05 ? 100 : 0,
    uv: day.uvMax,
    code: day.code,
    isDay: true,
    condition: day.condition,
    city,
    hasSecondaryWeather: Boolean(day.stormWarning),
    // Forward sunrise/sunset if the daily entry has them (populated by
    // openMeteo.ts). Not used by the recommendation engine, only for display.
    sunrise: day.sunrise,
    sunset: day.sunset,
    hourly,
    daily: [],
  };
}

export const CANADIAN_CITIES = [
  { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  { name: "Vancouver", lat: 49.2827, lon: -123.1207 },
  { name: "Montreal", lat: 45.5019, lon: -73.5674 },
  { name: "Calgary", lat: 51.0447, lon: -114.0719 },
  { name: "Ottawa", lat: 45.4215, lon: -75.6972 },
  { name: "Edmonton", lat: 53.5461, lon: -113.4938 },
  { name: "Halifax", lat: 44.6488, lon: -63.5752 },
  { name: "Winnipeg", lat: 49.8951, lon: -97.1384 },
];

export function getBrowserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.message || "Location denied")),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

// Geocoding stays on Open-Meteo's free geocoding API regardless of which
// weather provider is active above — it's a separate, unrelated service.
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en&format=json`;
    const r = await fetch(url);
    if (!r.ok) return "Your location";
    const j = await r.json();
    const res = j?.results?.[0];
    return res?.name ?? "Your location";
  } catch {
    return "Your location";
  }
}

// ── Search result ranking ─────────────────────────────────────────────────
//
// Open-Meteo geocoding returns results in its own text-match order, which
// often surfaces foreign or low-population places before the obvious local
// result (e.g. Scarborough, Rhode Island before Scarborough, Ontario).
//
// rankSearchResults() applies an additive scoring model that considers:
//   - Exact country code match from the user's saved city (no inference)
//   - GeoNames feature code (capital / admin centre vs neighbourhood)
//   - Population size
//   - Prefix / exact name match on the query string
//   - Haversine distance from the user's known location
//
// Country preference comes only from p.city.countryCode — an explicit value
// written when the user previously selected a search result. No bounding
// boxes, no coordinate inference, no hardcoded country lists.
//
// The algorithm is fully generic: the same code improves results for any
// city in any country without any location-specific logic.

type GeoResult = {
  name: string;
  lat: number;
  lon: number;
  country?: string;      // ISO 3166-1 alpha-2, e.g. "CA"
  admin1?: string;       // province / state name
  _featureCode?: string; // GeoNames feature code, e.g. "PPL", "PPLA", "PPLC"
  _population?: number;  // city population from GeoNames
  _isLocality?: boolean; // true = injected from CANADIAN_LOCALITIES fallback
};

/**
 * Haversine great-circle distance in km between two lat/lon points.
 */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Score and sort geocoding results so the most relevant place appears first.
 *
 * @param results              Raw GeoResult array (already mapped from API)
 * @param query                The original search string
 * @param preferredCountryCode ISO 3166-1 alpha-2 from the user's saved city
 *                             (e.g. "CA"). No country boost is applied when
 *                             undefined — no inference, no guessing.
 * @param userLat              Saved city latitude for proximity boost
 * @param userLon              Saved city longitude for proximity boost
 */
function rankSearchResults(
  results: GeoResult[],
  query: string,
  preferredCountryCode?: string,
  userLat?: number,
  userLon?: number,
): GeoResult[] {
  const q = query.trim().toLowerCase();

  // GeoNames feature codes for administrative centres.
  // https://www.geonames.org/export/codes.html
  const MAJOR_FEATURE_CODES = new Set([
    "PPLC",  // capital of a country
    "PPLA",  // seat of a first-order administrative division
    "PPLA2", // seat of a second-order administrative division
    "PPLA3", // seat of a third-order administrative division
  ]);

  const scored = results.map((r) => {
    let score = 0;

    // ── Country match ─────────────────────────────────────────────────
    // Applied only when an explicit country code is available from the
    // user's saved city. No coordinate-based inference is performed.
    if (preferredCountryCode && r.country === preferredCountryCode) {
      score += 500;
    }

    // ── Curated locality fallback boost ───────────────────────────────
    // Results injected from CANADIAN_LOCALITIES matched the query by alias,
    // meaning they are a direct answer to what the user typed. Give them
    // a boost so they rank above unrelated foreign results that happened
    // to contain the search term. This is intentionally lower than the
    // country-match signal so a closer same-country API result still wins.
    if (r._isLocality) {
      score += 350;
    }

    // ── Feature code (administrative importance) ───────────────────────
    if (r._featureCode && MAJOR_FEATURE_CODES.has(r._featureCode)) {
      score += 200;
    }
    // Neighbourhood or section of populated place — slight penalty so
    // named districts rank below the city they belong to.
    if (r._featureCode === "PPLX" || r._featureCode === "PPLL") {
      score -= 50;
    }

    // ── Population ────────────────────────────────────────────────────
    const pop = r._population ?? 0;
    if (pop >= 500_000) score += 200;
    else if (pop >= 100_000) score += 150;
    else if (pop >= 50_000) score += 100;
    else if (pop >= 10_000) score += 75;
    else if (pop >= 1_000) score += 25;

    // ── Prefix / exact name match ─────────────────────────────────────
    const nameLower = r.name.toLowerCase();
    if (nameLower === q) score += 300;
    else if (nameLower.startsWith(q)) score += 100;

    // ── Proximity boost ───────────────────────────────────────────────
    // Uses the saved city lat/lon as the user's known location.
    // Kept as a separate signal from country — nearby places in a
    // border region should surface even when the country differs.
    if (userLat !== undefined && userLon !== undefined) {
      const km = haversineKm(userLat, userLon, r.lat, r.lon);
      if (km < 50) score += 400;
      else if (km < 200) score += 300;
      else if (km < 500) score += 150;
      else if (km < 2_000) score += 50;
    }

    return { r, score };
  });

  // Sort descending by score; stable sort preserves API order as tiebreaker.
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ r }) => r);
}

export async function searchCity(
  q: string,
  preferredCountryCode?: string,
  userLat?: number,
  userLon?: number,
): Promise<{ name: string; lat: number; lon: number; country?: string; admin1?: string }[]> {
  if (!q.trim()) return [];
  // Request count=10 so the ranker has more candidates to reorder.
  // The UI receives at most 8 results after ranking.
  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(q)}&count=10&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  const raw: GeoResult[] = (j.results ?? []).map(
    (x: {
      name: string;
      latitude: number;
      longitude: number;
      country_code?: string;
      admin1?: string;
      feature_code?: string;
      population?: number;
    }) => ({
      name: x.name,
      lat: x.latitude,
      lon: x.longitude,
      country: x.country_code,
      admin1: x.admin1,
      _featureCode: x.feature_code,
      _population: x.population,
    }),
  );
  // ── Local locality fallback ─────────────────────────────────────────
  // Some well-known Canadian localities (former Toronto boroughs etc.) are
  // absent from GeoNames and therefore never returned by Open-Meteo. We
  // maintain a curated list and merge matching entries into the result pool
  // before ranking, then deduplicate by proximity to avoid double entries.
  const qNorm = q.trim().toLowerCase();
  const localityMatches: GeoResult[] = CANADIAN_LOCALITIES
    .filter((loc) =>
      loc.aliases.some(
        (alias) => alias === qNorm || alias.startsWith(qNorm) || qNorm.startsWith(alias),
      ),
    )
    .map((loc) => ({
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      country: loc.country,
      admin1: loc.admin1,
      _featureCode: loc.featureCode,
      _population: loc.population,
      _isLocality: true,
    }));

  // Deduplicate: skip a locality entry if the API already returned a
  // result within 5 km of the same spot (same place, different name form).
  const DEDUP_KM = 5;
  const newLocalities = localityMatches.filter(
    (loc) =>
      !raw.some(
        (api) => haversineKm(loc.lat, loc.lon, api.lat, api.lon) < DEDUP_KM,
      ),
  );

  const merged = [...raw, ...newLocalities];
  const ranked = rankSearchResults(merged, q, preferredCountryCode, userLat, userLon);
  // Strip internal ranking fields before returning to callers.
  return ranked.slice(0, 8).map(({ name, lat, lon, country, admin1 }) => ({
    name,
    lat,
    lon,
    country,
    admin1,
  }));
}
