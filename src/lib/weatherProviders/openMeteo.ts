import type { DailyForecast, Weather, WeatherProvider } from "./types";

const codeMap: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Thunderstorm w/ hail",
};

async function fetchWeather(lat: number, lon: number, city = "Your location"): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,uv_index,is_day` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,snowfall,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,weather_code,snowfall_sum,wind_speed_10m_max,uv_index_max` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const j = await res.json();
  const c = j.current;
  const h = j.hourly;
  const d = j.daily;

  // Open-Meteo's hourly array starts at midnight of the current day, not
  // from the current hour — slicing [0, 12) would silently show hours
  // already in the past once it's afternoon. utc_offset_seconds (always
  // present when timezone=auto) lets us find "now" in the forecast
  // location's own local time, independent of what timezone this code
  // happens to be running in (e.g. a Cloudflare Worker running in UTC
  // rendering weather for a Toronto user).
  const utcOffsetSec: number = j.utc_offset_seconds ?? 0;
  const nowAtLocation = new Date(Date.now() + utcOffsetSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowKey =
    `${nowAtLocation.getUTCFullYear()}-${pad(nowAtLocation.getUTCMonth() + 1)}-` +
    `${pad(nowAtLocation.getUTCDate())}T${pad(nowAtLocation.getUTCHours())}:00`;
  const hourlyTimes = h.time as string[];
  // Both strings are zero-padded "YYYY-MM-DDTHH:mm", so a plain string
  // comparison is a safe, timezone-ambiguity-free way to find the first
  // hour at or after "now" — no Date parsing involved.
  let startIdx = hourlyTimes.findIndex((t) => t >= nowKey);
  if (startIdx === -1) startIdx = 0;

  const snowMax = Math.max(0, ...(h.snowfall ?? []).slice(startIdx, startIdx + 12));

  // precipitation_probability is NOT available in Open-Meteo's current block —
  // it is hourly-only. Use a 4-hour window (commute-relevant horizon) for the
  // forward-looking probability, and override to 100% when c.precipitation
  // (actual mm/h measured right now) confirms precipitation is occurring.
  const hourlyProb = h.precipitation_probability as number[];
  const next4hMax = Math.max(
    0,
    hourlyProb[startIdx] ?? 0,
    hourlyProb[startIdx + 1] ?? 0,
    hourlyProb[startIdx + 2] ?? 0,
    hourlyProb[startIdx + 3] ?? 0,
  );
  // Threshold lowered from 0.1 to 0.01 mm/h: light drizzle typically measures
  // 0.02–0.08 mm/h, which was previously below the threshold and caused the
  // umbrella recommendation to NOT fire even when it was measurably drizzling.
  // Any value > 0 from Open-Meteo means precipitation is actively occurring.
  const currentPrecipMm: number = c.precipitation ?? 0;
  const precipProb = currentPrecipMm > 0.01 ? 100 : next4hMax;

  // snowProb: Open-Meteo hourly snowfall is in cm (not a fraction).
  // The previous formula (snowMax * 100) was dimensionally wrong:
  //   0.05cm snow → 5 (low, might miss the Snow Boots recommendation)
  //   0.001cm trace → 0.1 → rounds to 0 (trace snow completely missed)
  // Correct interpretation: if any snowfall ≥ 0.05cm is forecast in the
  // next 12 hours, snow is expected. Use 100 (certain) vs 0 (none).
  const snowExpected = snowMax >= 0.05;

  const daily: DailyForecast[] = (d.time as string[]).map((date, i) => ({
    date,
    tempMaxC: d.temperature_2m_max[i],
    tempMinC: d.temperature_2m_min[i],
    feelsMaxC: d.apparent_temperature_max[i],
    feelsMinC: d.apparent_temperature_min[i],
    precipProb: d.precipitation_probability_max?.[i] ?? 0,
    snowCm: d.snowfall_sum?.[i] ?? 0,
    windMaxKph: d.wind_speed_10m_max[i],
    uvMax: d.uv_index_max?.[i] ?? 0,
    code: d.weather_code[i],
    condition: codeMap[d.weather_code[i]] ?? "—",
  }));

  return {
    tempC: c.temperature_2m,
    feelsLikeC: c.apparent_temperature,
    windKph: c.wind_speed_10m,
    precipProb,
    snowProb: snowExpected ? 100 : 0,
    uv: c.uv_index ?? 0,
    code: c.weather_code,
    isDay: c.is_day === 1,
    condition: codeMap[c.weather_code] ?? "—",
    city,
    hourly: hourlyTimes.slice(startIdx, startIdx + 12).map((t, i) => ({
      time: t,
      tempC: h.temperature_2m[startIdx + i],
      precipProb: h.precipitation_probability?.[startIdx + i] ?? 0,
      code: h.weather_code[startIdx + i],
      isDay: (h.is_day?.[startIdx + i] ?? 1) === 1,
    })),
    daily,
  };
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  fetchWeather,
};
