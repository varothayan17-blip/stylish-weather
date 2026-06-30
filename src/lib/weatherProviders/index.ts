import type { WeatherProvider } from "./types";
import { openMeteoProvider } from "./openMeteo";
import { weatherApiComProvider } from "./weatherApiCom";

export type { Weather, DailyForecast, WeatherProvider } from "./types";

const registry: Record<string, WeatherProvider> = {
  "open-meteo": openMeteoProvider,
  weatherapi: weatherApiComProvider,
};

/**
 * Active provider, chosen via VITE_WEATHER_PROVIDER. Defaults to Open-Meteo,
 * which needs no API key and is what the app ships with today. Switching
 * providers later is a one-line .env change — nothing else in the app
 * needs to know which provider is active.
 */
const providerId = import.meta.env.VITE_WEATHER_PROVIDER ?? "open-meteo";
export const weatherProvider: WeatherProvider = registry[providerId] ?? openMeteoProvider;
