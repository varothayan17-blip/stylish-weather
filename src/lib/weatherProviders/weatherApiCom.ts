import type { DailyForecast, Weather, WeatherProvider } from "./types";

/**
 * WeatherAPI.com adapter — scaffolded for when you're ready to switch off
 * Open-Meteo (e.g. for higher rate limits or different forecast accuracy).
 * Not wired in by default; selected only if VITE_WEATHER_PROVIDER=weatherapi
 * and VITE_WEATHER_API_KEY are both set (see src/lib/weatherProviders/index.ts).
 *
 * NOTE: this has not been exercised against a live key in this environment
 * (no network egress to api.weatherapi.com here) — the field mapping below
 * follows WeatherAPI's documented forecast.json response shape, but give it
 * a real smoke test against your own key once deployed before relying on it.
 */
async function fetchWeather(lat: number, lon: number, city = "Your location"): Promise<Weather> {
  const apiKey = import.meta.env.VITE_WEATHER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WeatherAPI provider selected but VITE_WEATHER_API_KEY is missing. Add it to your .env file.",
    );
  }

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&days=7&aqi=no&alerts=no`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const j = await res.json();

  const current = j.current;
  const forecastDays = j.forecast.forecastday as Array<{
    date: string;
    day: {
      maxtemp_c: number;
      mintemp_c: number;
      avgtemp_c: number;
      daily_chance_of_rain: number;
      totalsnow_cm: number;
      maxwind_kph: number;
      uv: number;
      condition: { code: number; text: string };
    };
    hour: Array<{
      time: string;
      temp_c: number;
      chance_of_rain: number;
      is_day: number;
      condition: { code: number };
    }>;
  }>;

  const today = forecastDays[0];

  // WeatherAPI conveniently returns the forecast location's own current
  // local time directly (location.localtime, e.g. "2026-06-21 18:30") —
  // using that instead of the server's own clock avoids the same bug
  // openMeteo.ts had to work around manually (a server running in UTC
  // would otherwise grab the wrong hours for, say, a Toronto forecast).
  // Hours are also combined across today + tomorrow so the 12-hour
  // window doesn't get truncated when "now" is late in the day.
  const localTime: string | undefined = j.location?.localtime;
  const currentHourKey = localTime
    ? `${localTime.slice(0, 10)} ${localTime.slice(11, 13)}:00`
    : `${today.date} 00:00`;
  const combinedHours = [...today.hour, ...(forecastDays[1]?.hour ?? [])];
  let startIdx = combinedHours.findIndex((hr) => hr.time >= currentHourKey);
  if (startIdx === -1) startIdx = 0;
  const upcomingHours = combinedHours.slice(startIdx, startIdx + 12);

  const daily: DailyForecast[] = forecastDays.map((d) => ({
    date: d.date,
    tempMaxC: d.day.maxtemp_c,
    tempMinC: d.day.mintemp_c,
    feelsMaxC: d.day.maxtemp_c, // WeatherAPI doesn't expose a daily feels-like max directly
    feelsMinC: d.day.mintemp_c,
    precipProb: d.day.daily_chance_of_rain,
    snowCm: d.day.totalsnow_cm,
    windMaxKph: d.day.maxwind_kph,
    uvMax: d.day.uv,
    code: d.day.condition.code,
    condition: d.day.condition.text,
  }));

  return {
    tempC: current.temp_c,
    feelsLikeC: current.feelslike_c,
    windKph: current.wind_kph,
    precipProb: current.precip_mm > 0 ? 100 : today.day.daily_chance_of_rain,
    snowProb: today.day.totalsnow_cm > 0 ? Math.min(100, today.day.totalsnow_cm * 40) : 0,
    uv: current.uv ?? 0,
    code: current.condition.code,
    // WeatherAPI returns is_day (1=day, 0=night) in the current block
    isDay: (current.is_day ?? 1) === 1,
    condition: current.condition.text,
    city,
    hourly: upcomingHours.map((h) => ({
      time: h.time,
      tempC: h.temp_c,
      precipProb: h.chance_of_rain,
      code: h.condition.code,
      // WeatherAPI hourly entries include is_day per-hour
      isDay: (h.is_day ?? 1) === 1,
    })),
    daily,
  };
}

export const weatherApiComProvider: WeatherProvider = {
  id: "weatherapi",
  fetchWeather,
};
