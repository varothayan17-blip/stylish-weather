import type { Weather } from "./weather";

export type AlertKind = "wind-chill" | "rain" | "snow";
export type AlertSeverity = "info" | "warning";

export type WeatherAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
};

export function getWeatherAlerts(w: Weather): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  const chillGap = w.tempC - w.feelsLikeC;
  if (chillGap >= 4) {
    alerts.push({
      kind: "wind-chill",
      severity: chillGap >= 8 ? "warning" : "info",
      title: chillGap >= 8 ? "Significant wind chill" : "Wind chill",
      message: `Feels like ${Math.round(w.feelsLikeC)}° — about ${Math.round(chillGap)}° colder than the actual ${Math.round(w.tempC)}° because of ${Math.round(w.windKph)} km/h wind.`,
    });
  }

  if (w.precipProb >= 40) {
    alerts.push({
      kind: "rain",
      severity: w.precipProb >= 70 ? "warning" : "info",
      title: w.precipProb >= 70 ? "Rain expected" : "Rain possible",
      message: `${Math.round(w.precipProb)}% chance of precipitation today — bring an umbrella.`,
    });
  }

  if (w.snowProb > 0) {
    alerts.push({
      kind: "snow",
      severity: "warning",
      title: "Snow expected",
      message: "Snowfall expected — wear waterproof boots and leave extra time for your commute.",
    });
  }

  return alerts;
}
