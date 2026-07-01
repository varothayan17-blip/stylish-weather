/**
 * weatherContext.ts
 *
 * Layer 1 of the two-layer recommendation architecture.
 *
 * analyzeWeather() contains ALL weather intelligence: temperature thresholds,
 * rain/snow/UV/wind detection, headline generation, commute warnings, and
 * mood classification. It produces a WeatherContext that expresses clothing
 * *requirements* (band, needs*) without naming any specific garments.
 *
 * Layer 2 (clothingProfiles.ts) translates those requirements into actual
 * clothing names per profile (men's, women's, gender-neutral, …).
 *
 * This separation means:
 *   • Adding a new profile = one new object in clothingProfiles.ts
 *   • Changing weather thresholds = one change here, all profiles benefit
 *   • No weather logic is duplicated across profiles
 */

import type { Weather } from "./weather";
import type { Prefs } from "./preferences";
import { OUTFIT_BAND_EDGES } from "./recommend"; // thresholds stay canonical here

/**
 * Named temperature bands.
 * Every ClothingProfile maps each band to a list of garments.
 */
export type TemperatureBand =
  | "freezing" // feels ≤ -10°C
  | "winter" // -10 < feels ≤ 0°C
  | "chilly" //   0 < feels ≤ 8°C
  | "cool" //   8 < feels ≤ 15°C
  | "mild" //  15 < feels ≤ 22°C
  | "warm" //  22 < feels ≤ 28°C
  | "hot"; //  feels > 28°C

/**
 * All the weather intelligence produced for a single moment/day.
 * Clothing profiles read from this; nothing here is profile-specific.
 */
export type WeatherContext = {
  feels: number; // feelsLikeC + sensitivity adjustment
  band: TemperatureBand; // which temperature category applies

  // Accessories — universal across all profiles
  umbrella: boolean;
  gloves: boolean;
  sunglasses: boolean;

  // Additive clothing requirements — the profile decides the garment name
  needsWaterproof: boolean; // heavy rain (precipProb >= 60) or rain code
  needsSnowBoots: boolean; // snowProb > 0
  needsWindbreaker: boolean; // windKph >= 25

  // Whether rain risk is active at all (used by profile to swap open footwear)
  rainRisk: boolean; // umbrella = true for any reason

  // Mood drives the UI colour theme — profile-independent
  mood: "sunny" | "cloudy" | "rainy" | "snowy" | "cold" | "hot";

  // Headline — the single sentence shown at the top of the recommendation card.
  // Temperature-derived first, then overridden by dominant condition.
  headline: string;

  // Commute-specific advice, context-aware and consistent with the outfit band.
  commuteWarning?: string;

  // The adjusted felt temperature — exposed so RegretRisk can use it.
  effectiveFeelsC: number;
};

function bandFor(feels: number): TemperatureBand {
  if (feels <= OUTFIT_BAND_EDGES[0]) return "freezing";
  if (feels <= OUTFIT_BAND_EDGES[1]) return "winter";
  if (feels <= OUTFIT_BAND_EDGES[2]) return "chilly";
  if (feels <= OUTFIT_BAND_EDGES[3]) return "cool";
  if (feels <= OUTFIT_BAND_EDGES[4]) return "mild";
  if (feels <= OUTFIT_BAND_EDGES[5]) return "warm";
  return "hot";
}

const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER_CODES = new Set([95, 96, 99]);

export function analyzeWeather(w: Weather, p: Prefs): WeatherContext {
  const adj = p.coldSensitivity === "cold" ? -4 : p.coldSensitivity === "hot" ? 4 : 0;
  const feels = w.feelsLikeC + adj;
  const band = bandFor(feels);

  // ── Accessory decisions ──────────────────────────────────────────────────
  // Three independent umbrella triggers (30% = industry standard):
  //   1. Meaningful daily rain probability
  //   2. Current WMO code is a precipitation type
  //   3. Secondary storm warning is active (stormWarning forwarded via hasSecondaryWeather)
  const umbrella = w.precipProb >= 30 || RAIN_CODES.has(w.code) || (w.hasSecondaryWeather ?? false);

  const gloves = feels <= -2;

  // Sunglasses: only when UV is elevated, it's not actively raining, and
  // rain risk isn't high enough to carry an umbrella.
  const sunglasses = w.uv >= 5 && !RAIN_CODES.has(w.code) && w.precipProb < 30;

  // ── Additive clothing requirements ───────────────────────────────────────
  const needsWaterproof = w.precipProb >= 60 || RAIN_CODES.has(w.code);
  const needsSnowBoots = w.snowProb > 0;
  const needsWindbreaker = w.windKph >= 25;
  const rainRisk = umbrella; // same condition, named semantically for profiles

  // ── Mood ────────────────────────────────────────────────────────────────
  let mood: WeatherContext["mood"] = "cloudy";
  if (band === "freezing" || band === "winter") mood = "snowy";
  else if (band === "hot") mood = "hot";
  else if (band === "warm" || band === "mild") mood = "sunny";
  else mood = "cold";

  if (RAIN_CODES.has(w.code) || w.precipProb >= 60) mood = "rainy";
  if (SNOW_CODES.has(w.code) || w.snowProb > 0) mood = "snowy";

  // ── Temperature-band headline ────────────────────────────────────────────
  const BAND_HEADLINES: Record<TemperatureBand, string> = {
    freezing: "Bundle up — it's freezing out there.",
    winter: "Winter mode — layer up properly.",
    chilly: "Chilly — a warm jacket will do the trick.",
    cool: "Crisp & cool — a light hoodie is perfect.",
    mild: "Beautiful day — easy layers.",
    warm: "Warm & lovely — keep it breezy.",
    hot: "Hot — dress light and hydrate.",
  };
  let headline = BAND_HEADLINES[band];

  // ── Condition-aware headline overrides ───────────────────────────────────
  // The band headline is temperature-only. Override it when the dominant WMO
  // condition would otherwise contradict what the icon shows.
  const tempBase = w.tempC;
  if (THUNDER_CODES.has(w.code)) {
    if (tempBase > 28) headline = "Hot with thunderstorms — stay aware of storm risk.";
    else if (tempBase > 22) headline = "Warm with thunderstorms — keep an eye on the sky.";
    else if (tempBase > 15) headline = "Thunderstorms expected — bring an umbrella.";
    else headline = "Thunderstorms possible — layer up and stay covered.";
    mood = "rainy";
  } else if (SNOW_CODES.has(w.code)) {
    headline =
      tempBase <= 0
        ? "Snow expected — winter jacket, boots, and patience."
        : "Snow possible — waterproof boots recommended.";
    mood = "snowy";
  } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(w.code)) {
    const positivePrefix = ["Beautiful day", "Warm & lovely", "Hot"].find((px) =>
      headline.startsWith(px),
    );
    if (positivePrefix) {
      if (w.code === 51 || w.code === 53) headline = `${positivePrefix} — light drizzle expected.`;
      else if (w.code === 55) headline = `${positivePrefix} — drizzle throughout the day.`;
      else if (w.code === 61) headline = `${positivePrefix} — light rain possible.`;
      else if (w.code === 63) headline = `${positivePrefix} — rain expected.`;
      else if (w.code === 65) headline = `${positivePrefix} — heavy rain expected.`;
      else if (w.code === 80 || w.code === 81) headline = `${positivePrefix} — showers likely.`;
      else if (w.code === 82) headline = `${positivePrefix} — heavy showers expected.`;
      mood = "rainy";
    }
  } else if (w.code === 45 || w.code === 48) {
    const fogPositive = ["Beautiful day", "Warm & lovely"].find((px) => headline.startsWith(px));
    if (fogPositive) headline = `${fogPositive} — foggy start to the day.`;
  }

  // ── Commute warnings ─────────────────────────────────────────────────────
  // Derived from the band flags — never references specific garment names,
  // only band-level concepts (jacket, coat, hoodie) that match the outfit band.
  const hasParka = band === "freezing";
  const hasCoat = band === "winter";
  const hasJacket = band === "chilly";
  const hasHoodie = band === "cool";
  const isWarm = band === "warm";
  const isHot = band === "hot";
  const isWinter = hasParka || hasCoat;

  let commuteWarning: string | undefined;

  if (p.commute === "walk") {
    if (w.precipProb >= 50) commuteWarning = "Wet sidewalks — grab the umbrella before you leave.";
    else if (isHot)
      commuteWarning = "It's hot out — shade the route where you can and carry water.";
    else if (isWinter)
      commuteWarning = "Icy sidewalks possible — watch your step and allow extra time.";
    else if (hasJacket) commuteWarning = "Cold wind on the walk — cover ears and hands.";
  } else if (p.commute === "ttc") {
    if (w.precipProb >= 50)
      commuteWarning = "Streetcar stops are exposed — bring an umbrella for the wait.";
    else if (isHot)
      commuteWarning =
        "Subway platforms can be hot in summer — stay hydrated and dress breathably.";
    else if (isWarm)
      commuteWarning = "Subway cars run warm — a single breathable layer works well underground.";
    else if (hasHoodie)
      commuteWarning =
        "Subway cars run warm — your hoodie may be plenty inside; keep it handy for outside.";
    else if (hasJacket)
      commuteWarning =
        "Subway cars run warm — wear a lighter layer under your jacket for comfort on the train.";
    else if (isWinter)
      commuteWarning =
        "Subway cars run warm — wear a lighter layer under your coat; you'll want it outside.";
  } else if (p.commute === "cycle") {
    if (isWinter)
      commuteWarning = "Icy roads — consider transit instead, or ride with extra caution.";
    else if (isHot) commuteWarning = "Ride early or late to avoid the peak heat. Bring water.";
    else if (w.windKph >= 25)
      commuteWarning = "Strong headwinds expected — give yourself extra time.";
    else if (w.precipProb >= 40)
      commuteWarning = "Slick roads expected — ride cautiously and leave extra stopping distance.";
    else if (hasJacket)
      commuteWarning = "Cold headwind on the bike — windproof gloves recommended.";
  } else if (p.commute === "drive") {
    if (w.snowProb > 0) commuteWarning = "Snow on the roads — leave early and check your tires.";
    else if (w.precipProb >= 60)
      commuteWarning = "Heavy rain expected — reduced visibility on the drive.";
    else if (isWinter && w.precipProb >= 30)
      commuteWarning = "Roads may be slippery — drive with extra caution today.";
  }

  return {
    feels,
    band,
    umbrella,
    gloves,
    sunglasses,
    needsWaterproof,
    needsSnowBoots,
    needsWindbreaker,
    rainRisk,
    mood,
    headline,
    commuteWarning,
    effectiveFeelsC: feels,
  };
}
