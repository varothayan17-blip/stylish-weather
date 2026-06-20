import { createServerFn } from "@tanstack/react-start";

function mapWeatherApiCode(code: number): number {
  // Map weatherapi.com condition codes -> open-meteo-style codes (used by WeatherIcon)
  if (code === 1000) return 0;
  if (code === 1003) return 2;
  if (code === 1006 || code === 1009) return 3;
  if (code === 1030 || code === 1135) return 45;
  if (code === 1147) return 48;
  if ([1150, 1153, 1168, 1171, 1180, 1183, 1198, 1201, 1072].includes(code)) return 51;
  if ([1063, 1186, 1189, 1240].includes(code)) return 61;
  if ([1192, 1195, 1243].includes(code)) return 63;
  if ([1246].includes(code)) return 65;
  if ([1066, 1069, 1204, 1207, 1210, 1213, 1216, 1219, 1249, 1252, 1255, 1261].includes(code)) return 71;
  if ([1222, 1258].includes(code)) return 73;
  if ([1225, 1237, 1264].includes(code)) return 75;
  if ([1087, 1273, 1276].includes(code)) return 95;
  if ([1279, 1282].includes(code)) return 99;
  return 3;
}

export const getWeatherFn = createServerFn({ method: "GET" })
  .inputValidator((d: { lat: number; lon: number; city?: string }) => d)
  .handler(async ({ data }) => {
    const key = process.env.weatherapi;
    if (!key) throw new Error("Weather API key not configured");
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${data.lat},${data.lon}&days=1&aqi=no&alerts=no`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Weather request failed (${r.status})`);
    const j: any = await r.json();
    const cur = j.current;
    const day0 = j.forecast?.forecastday?.[0];
    const hours: any[] = day0?.hour ?? [];
    const now = Date.now();
    const upcoming = hours.filter((h) => new Date(h.time).getTime() >= now - 60 * 60 * 1000).slice(0, 12);
    const list = upcoming.length ? upcoming : hours.slice(0, 12);

    const code = mapWeatherApiCode(cur.condition?.code ?? 1000);
    const precipProb = Math.max(day0?.day?.daily_chance_of_rain ?? 0, ...list.map((h) => h.chance_of_rain ?? 0));
    const snowProb = Math.max(day0?.day?.daily_chance_of_snow ?? 0, ...list.map((h) => h.chance_of_snow ?? 0));

    return {
      tempC: cur.temp_c,
      feelsLikeC: cur.feelslike_c,
      windKph: cur.wind_kph,
      precipProb,
      snowProb,
      uv: cur.uv ?? 0,
      code,
      condition: cur.condition?.text ?? "—",
      city: data.city ?? j.location?.name ?? "Your location",
      hourly: list.map((h) => ({
        time: h.time,
        tempC: h.temp_c,
        precipProb: h.chance_of_rain ?? 0,
        code: mapWeatherApiCode(h.condition?.code ?? 1000),
      })),
    };
  });