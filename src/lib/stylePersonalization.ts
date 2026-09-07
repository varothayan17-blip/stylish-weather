/**
 * stylePersonalization.ts — Pure, deterministic personalization layer.
 *
 * Sits between the base recommendation (weather-safe, temperature-adjusted)
 * and the final output. Applies Personal Style Profile preferences WITHOUT
 * overriding safety decisions.
 *
 * Priority order enforced here:
 *   1. Safety constraints (weather, temperature) — from base recommendation
 *   2. Existing temperature sensitivity (applied in weatherContext.ts)
 *   3. Personal Style Profile  ← this module
 *   4. Wardrobe availability   ← handled upstream in selectOutfit()
 *
 * Rules:
 *   - NEVER removes rain protection during meaningful precipitation.
 *   - NEVER adds warm layers during dangerous heat (feelsLike >= 28 °C).
 *   - NEVER creates contradictory outfit items (add + exclude same garment).
 *   - Returns an identical result when entitlement is inactive or profile is null.
 *   - No network calls. No mutation of inputs. Same inputs → same output always.
 *
 * OUTFIT_BAND_EDGES reference: [-10, 0, 8, 15, 22, 28] °C
 *   "freezing" < -10
 *   "winter"   -10..0
 *   "chilly"    0..8
 *   "cool"      8..15
 *   "mild"     15..22
 *   "warm"     22..28
 *   "hot"      >28
 */

import type { PersonalStyleProfile } from "./styleProfile";
import type { Recommendation } from "./recommend";
import type { EntitlementResult } from "./entitlement";

// ── Temperature thresholds (named constants, not scattered literals) ────────

/** Above this feelsLikeC it is unsafe to add warm layers. */
const HEAT_SAFETY_THRESHOLD_C = 28;
/** Below this feelsLikeC an extra layer is always weather-appropriate. */
const COOL_LAYER_THRESHOLD_C  = 15;
/** Wind speed (km/h) above which transit/walk exposure guidance is added. */
const WIND_EXPOSURE_THRESHOLD_KPH = 20;

// ── Result type ─────────────────────────────────────────────────────────────

export interface PersonalizationResult {
  /** Personalized headline. Null = use base headline unchanged. */
  headline: string | null;
  /**
   * Items to prepend/append to the outfit (never duplicates base items).
   * Items are ADDED only — we never remove base outfit items here.
   */
  extraItems: string[];
  /**
   * One concise explanation for the user, reflecting actual inputs used.
   * Null when no profile-driven adjustment was made.
   */
  explanation: string | null;
  /**
   * Commute exposure note, separate from headline.
   * Null when no commute-specific guidance applies.
   */
  commuteNote: string | null;
}

const NO_CHANGE: PersonalizationResult = {
  headline:    null,
  extraItems:  [],
  explanation: null,
  commuteNote: null,
};

// ── Main personalization function ───────────────────────────────────────────

export interface PersonalizeInput {
  baseRecommendation: Recommendation;
  /** The effective feelsLike temperature (after coldSensitivity adjustment). */
  effectiveFeelsC: number;
  /** Whether the current weather decision includes active precipitation. */
  isPrecipitatingNow: boolean;
  /** Wind speed in km/h from the weather provider. */
  windKph: number;
  /** Personal Style Profile. Null = return NO_CHANGE. */
  personalStyleProfile: PersonalStyleProfile | null;
  /** Trusted entitlement result from useEntitlement(). */
  entitlement: EntitlementResult;
}

/**
 * Apply Personal Style Profile personalization.
 *
 * Returns NO_CHANGE when:
 *   - entitlement is loading or inactive (free users see existing behaviour)
 *   - profile is null (new users, missing document)
 *
 * Never mutates inputs. Always returns a new object.
 */
export function personalizeRecommendation(input: PersonalizeInput): PersonalizationResult {
  const { baseRecommendation, effectiveFeelsC, isPrecipitatingNow, windKph,
          personalStyleProfile: profile, entitlement } = input;

  // ── Gate: Premium only ──────────────────────────────────────────────────
  if (entitlement.loading || !entitlement.active || !profile) {
    return NO_CHANGE;
  }

  const extraItems: string[]   = [];
  let explanation: string | null = null;
  let commuteNote: string | null = null;

  // ── Layering preference ─────────────────────────────────────────────────
  const isHot   = effectiveFeelsC >= HEAT_SAFETY_THRESHOLD_C;
  const isCool  = effectiveFeelsC <= COOL_LAYER_THRESHOLD_C;
  const baseHasLayer = baseRecommendation.outfit.some(item =>
    /jacket|coat|hoodie|sweater|cardigan|layer|vest/i.test(item),
  );

  if (profile.layeringPreference === "minimal" && !baseHasLayer) {
    // Already no extra layer in the base — nothing to adjust.
    if (!isPrecipitatingNow && effectiveFeelsC >= 15) {
      explanation = "You prefer minimal layers, so Aeruvo kept the outfit light.";
    }
  }

  if (profile.layeringPreference === "prefer" && !isHot && !baseHasLayer) {
    // Add a removable layer only when weather conditions make it reasonable:
    // cool temperature, wind chill, or afternoon exposure likely.
    const windChill = effectiveFeelsC < 22 && windKph >= WIND_EXPOSURE_THRESHOLD_KPH;
    if (isCool || windChill) {
      extraItems.push("light removable layer");
      if (isCool && windChill) {
        explanation = "A light removable layer suits your preference and the cool, windy conditions.";
      } else if (isCool) {
        explanation = `A light removable layer suits your preference and the ${effectiveFeelsC < 8 ? "chilly" : "cool"} temperature.`;
      } else {
        explanation = "A light removable layer suits your preference given the wind.";
      }
    }
  }

  // ── Wind sensitivity ────────────────────────────────────────────────────
  // High wind sensitivity + meaningful wind → suggest windproof where not already covered.
  if (profile.windSensitivity === "high" && windKph >= WIND_EXPOSURE_THRESHOLD_KPH) {
    const hasWindproof = baseRecommendation.outfit.some(item =>
      /wind|shell|waterproof|rain jacket/i.test(item),
    );
    if (!hasWindproof && !isHot) {
      // Only add note, not a garment — wardrobe matching handles specifics.
      explanation = explanation ?? "Aeruvo noted wind sensitivity — look for a windproof outer layer.";
    }
  }

  // ── Rain tolerance ──────────────────────────────────────────────────────
  // High rain tolerance: keep existing rain protection (safety rule preserved).
  // Low rain tolerance: explanation only — the base recommendation already handles rain gear.
  // We never remove rain protection regardless of tolerance setting.

  // ── Commute mode exposure guidance ─────────────────────────────────────
  if (profile.commuteMode === "walk" || profile.commuteMode === "transit") {
    // Walking and transit increase outdoor exposure to wind and temperature changes.
    if (windKph >= WIND_EXPOSURE_THRESHOLD_KPH && !isHot) {
      commuteNote = profile.commuteMode === "transit"
        ? "Transit commutes increase outdoor exposure — the wind layer is a good call."
        : "Walking in this wind will feel cooler — consider a windproof layer.";
    } else if (isCool && profile.commuteMode === "walk") {
      commuteNote = "Walking in the cool air — an extra layer in your bag is worth it.";
    }
  } else if (profile.commuteMode === "drive") {
    // Driving reduces outdoor exposure — only mention when wind/cold is extreme.
    if (effectiveFeelsC < 0) {
      commuteNote = "Even driving, you'll feel the cold getting in and out — dress warm.";
    }
  }

  // Deduplicate: never add an item already in the base outfit (case-insensitive)
  const baseSet = new Set(baseRecommendation.outfit.map(i => i.toLowerCase()));
  const uniqueExtra = extraItems.filter(i => !baseSet.has(i.toLowerCase()));

  if (uniqueExtra.length === 0 && !explanation && !commuteNote) {
    return NO_CHANGE;
  }

  return {
    headline:    null, // Phase 1: we don't rewrite the headline
    extraItems:  uniqueExtra,
    explanation,
    commuteNote,
  };
}
