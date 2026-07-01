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
  };
}
