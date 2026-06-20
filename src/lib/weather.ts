export type Weather = {
  tempC: number;
  feelsLikeC: number;
  windKph: number;
  precipProb: number;
  snowProb: number;
  uv: number;
  code: number;
  condition: string;
  hourly: { time: string; tempC: number; precipProb: number; code: number }[];
  city: string;
};

const codeMap: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ hail",
};

export async function fetchWeather(lat: number, lon: number, city = "Your location"): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability,uv_index&hourly=temperature_2m,precipitation_probability,weather_code,snowfall&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const j = await res.json();
  const c = j.current;
  const h = j.hourly;
  const snowMax = Math.max(0, ...(h.snowfall ?? []).slice(0, 12));
  const precipMax = Math.max(0, ...(h.precipitation_probability ?? []).slice(0, 12));
  return {
    tempC: c.temperature_2m,
    feelsLikeC: c.apparent_temperature,
    windKph: c.wind_speed_10m,
    precipProb: c.precipitation_probability ?? precipMax,
    snowProb: snowMax > 0 ? Math.min(100, snowMax * 100) : 0,
    uv: c.uv_index ?? 0,
    code: c.weather_code,
    condition: codeMap[c.weather_code] ?? "—",
    city,
    hourly: (h.time as string[]).slice(0, 12).map((t, i) => ({
      time: t,
      tempC: h.temperature_2m[i],
      precipProb: h.precipitation_probability?.[i] ?? 0,
      code: h.weather_code[i],
    })),
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

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

export async function searchCity(q: string): Promise<{ name: string; lat: number; lon: number; country?: string; admin1?: string }[]> {
  if (!q.trim()) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results ?? []).map((x: any) => ({
    name: x.name, lat: x.latitude, lon: x.longitude, country: x.country_code, admin1: x.admin1,
  }));
}