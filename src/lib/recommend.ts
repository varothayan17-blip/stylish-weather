import type { Weather } from "./weather";
import type { Prefs } from "./preferences";

export type Recommendation = {
  headline: string;
  outfit: string[];
  umbrella: boolean;
  gloves: boolean;
  sunglasses: boolean;
  commuteWarning?: string;
  mood: "sunny" | "cloudy" | "rainy" | "snowy" | "cold" | "hot";
};

export function recommend(w: Weather, p: Prefs): Recommendation {
  const adj = p.coldSensitivity === "cold" ? -4 : p.coldSensitivity === "hot" ? 4 : 0;
  const feels = w.feelsLikeC + adj;
  const outfit: string[] = [];
  let headline = "";
  let mood: Recommendation["mood"] = "cloudy";

  if (feels <= -10) {
    headline = "Bundle up — it's freezing out there.";
    outfit.push("Heavy parka", "Thermal base layer", "Insulated boots", "Wool socks", "Beanie & scarf");
    mood = "snowy";
  } else if (feels <= 0) {
    headline = "Winter mode — layer up properly.";
    outfit.push("Warm coat", "Sweater", "Long pants", "Boots", "Beanie");
    mood = "snowy";
  } else if (feels <= 8) {
    headline = "Chilly — a warm jacket will do the trick.";
    outfit.push("Insulated jacket", "Long sleeve", "Jeans", "Sneakers");
    mood = "cold";
  } else if (feels <= 15) {
    headline = "Crisp & cool — a light hoodie is perfect.";
    outfit.push("Light hoodie or jacket", "T-shirt", "Jeans", "Sneakers");
    mood = "cloudy";
  } else if (feels <= 22) {
    headline = "Beautiful day — easy layers.";
    outfit.push("Long-sleeve tee", "Light pants", "Sneakers");
    mood = "sunny";
  } else if (feels <= 28) {
    headline = "Warm & lovely — keep it breezy.";
    outfit.push("T-shirt", "Shorts or chinos", "Breathable sneakers");
    mood = "sunny";
  } else {
    headline = "Hot — dress light and hydrate.";
    outfit.push("Linen shirt", "Shorts", "Sandals", "Cap");
    mood = "hot";
  }

  const umbrella = w.precipProb >= 40;
  const gloves = feels <= -2;
  const sunglasses = w.uv >= 5;

  if (w.precipProb >= 60) { outfit.push("Waterproof shell"); mood = "rainy"; }
  if (w.snowProb > 0) { outfit.push("Snow boots"); mood = "snowy"; }
  if (w.windKph >= 25) outfit.push("Windbreaker layer");

  let commuteWarning: string | undefined;
  if (p.commute === "walk") {
    if (w.precipProb >= 50) commuteWarning = "Wet sidewalks — grab the umbrella before you leave.";
    else if (feels <= -5) commuteWarning = "Cold wind on the walk — cover ears & hands.";
  } else if (p.commute === "ttc") {
    if (w.tempC >= 24) commuteWarning = "Subway cars run warm — wear a thin top under your jacket.";
    else if (w.precipProb >= 50) commuteWarning = "Streetcar stops are exposed — bring an umbrella.";
  } else if (p.commute === "cycle") {
    if (w.windKph >= 25) commuteWarning = "Strong headwinds — give yourself extra time.";
    else if (w.precipProb >= 40) commuteWarning = "Slick roads expected — ride cautiously.";
    else if (feels <= 2) commuteWarning = "Cold ride — windproof gloves recommended.";
  } else if (p.commute === "drive") {
    if (w.snowProb > 0) commuteWarning = "Snow on the roads — leave early and check tires.";
    else if (w.precipProb >= 60) commuteWarning = "Heavy rain expected — reduced visibility on the drive.";
  }

  return { headline, outfit, umbrella, gloves, sunglasses, commuteWarning, mood };
}