import { weatherProvider } from "./weatherProviders";

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

export async function searchCity(
  q: string,
): Promise<{ name: string; lat: number; lon: number; country?: string; admin1?: string }[]> {
  if (!q.trim()) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results ?? []).map(
    (x: {
      name: string;
      latitude: number;
      longitude: number;
      country_code?: string;
      admin1?: string;
    }) => ({
      name: x.name,
      lat: x.latitude,
      lon: x.longitude,
      country: x.country_code,
      admin1: x.admin1,
    }),
  );
}
