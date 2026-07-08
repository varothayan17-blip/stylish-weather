/**
 * recommend.ts
 *
 * Public API — unchanged. All callers (Home, Forecast, Recommendation screens)
 * continue to call recommend(weather, prefs) and receive a Recommendation.
 *
 * Internally the function now delegates to two layers:
 *   Layer 1: analyzeWeather() in weatherContext.ts
 *            → pure weather intelligence, profile-agnostic
 *   Layer 2: getProfile() + selectOutfit() in clothingProfiles.ts
 *            → profile-specific garment selection
 *
 * OUTFIT_BAND_EDGES is re-exported here because regretRisk.ts imports it
 * from this module. The actual thresholds live in weatherContext.ts.
 */

import type { Weather } from "./weather";
import type { Prefs } from "./preferences";
import type { UmbrellaLevel } from "./precipAdvice";
import { analyzeWeather } from "./weatherContext";
import { getProfile, selectOutfit } from "./clothingProfiles";

export type Recommendation = {
  headline: string;
  outfit: string[];
  umbrella: boolean;
  /** Four-tier umbrella intensity: 0=none 1=consider 2=recommended 3=strongly */
  umbrellaLevel: UmbrellaLevel;
  /** Natural-language rain timing, e.g. "Rain expected between 3 PM and 6 PM." */
  rainTiming: string | null;
  gloves: boolean;
  sunglasses: boolean;
  commuteWarning?: string;
  mood: "sunny" | "cloudy" | "rainy" | "snowy" | "cold" | "hot";
  effectiveFeelsC: number;
  /**
   * Sunscreen advice derived from the UV index. Null when UV < 3.
   * UV 3-5: optional if spending extended time outdoors
   * UV 6-7: SPF 30+ recommended
   * UV 8-10: strongly recommended
   * UV 11+: very high UV, strong warning
   */
  sunscreenAdvice: string | null;
};

/**
 * Temperature band edges — exported for regretRisk.ts which needs to know
 * "how close is the effective temperature to a clothing boundary."
 * Thresholds: [-10, 0, 8, 15, 22, 28] °C (felt temperature after adjustment).
 */
export const OUTFIT_BAND_EDGES = [-10, 0, 8, 15, 22, 28] as const;

export function recommend(w: Weather, p: Prefs): Recommendation {
  // Layer 1 — weather intelligence (profile-agnostic)
  const ctx = analyzeWeather(w, p);

  // Layer 2 — outfit selection (profile-specific)
  const profile = getProfile(p.clothingProfile);
  const outfit = selectOutfit(ctx, profile);

  // Sunscreen advice — derived from UV index, independent of clothing profile.
  // UV comes from w.uv (current reading) which is already on the Weather type.
  // Thresholds follow the WHO UV index scale.
  const uv = w.uv;
  let sunscreenAdvice: string | null = null;
  if (uv >= 11) {
    sunscreenAdvice = "Very high UV — apply SPF 50+ and reapply every 2 hours.";
  } else if (uv >= 8) {
    sunscreenAdvice = "High UV — sunscreen strongly recommended before going out.";
  } else if (uv >= 6) {
    sunscreenAdvice = "Moderate-high UV — SPF 30+ recommended.";
  } else if (uv >= 3) {
    sunscreenAdvice = "Sunscreen optional if spending extended time outdoors.";
  }

  return {
    headline: ctx.headline,
    outfit,
    umbrella: ctx.umbrella,
    umbrellaLevel: ctx.umbrellaLevel,
    rainTiming: ctx.rainTiming,
    gloves: ctx.gloves,
    sunglasses: ctx.sunglasses,
    commuteWarning: ctx.commuteWarning,
    mood: ctx.mood,
    effectiveFeelsC: ctx.effectiveFeelsC,
    sunscreenAdvice,
  };
}
