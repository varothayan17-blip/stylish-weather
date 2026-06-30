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
