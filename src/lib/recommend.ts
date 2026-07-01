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
import { analyzeWeather } from "./weatherContext";
import { getProfile, selectOutfit } from "./clothingProfiles";

export type Recommendation = {
  headline: string;
  outfit: string[];
  umbrella: boolean;
  gloves: boolean;
  sunglasses: boolean;
  commuteWarning?: string;
  mood: "sunny" | "cloudy" | "rainy" | "snowy" | "cold" | "hot";
  /** Adjusted felt temperature — the value the recommendation was based on. */
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
    gloves: ctx.gloves,
    sunglasses: ctx.sunglasses,
    commuteWarning: ctx.commuteWarning,
    mood: ctx.mood,
    effectiveFeelsC: ctx.effectiveFeelsC,
  };
}
