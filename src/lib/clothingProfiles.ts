/**
 * clothingProfiles.ts
 *
 * Layer 2 of the two-layer recommendation architecture.
 *
 * A ClothingProfile translates a WeatherContext (clothing *requirements*)
 * into actual garment names. The weather intelligence that produced those
 * requirements lives entirely in weatherContext.ts — nothing here changes
 * when weather logic changes, and nothing in weatherContext.ts changes when
 * a new profile is added.
 *
 * HOW TO ADD A NEW PROFILE:
 *   1. Add a new key to ClothingProfileId.
 *   2. Add a new ClothingProfile object to PROFILES.
 *   3. That's it. The recommendation engine, UI, and sync all pick it up automatically.
 *
 * Profile structure:
 *   bands     — garments for each temperature band (base outfit)
 *   waterproof — what to add when it's raining hard (precipProb ≥ 60%)
 *   snowBoots  — what to add when snow is expected
 *   windLayer  — what to add when wind ≥ 25 km/h
 *   rainFootwear — what to replace open footwear with when rain risk is active
 *
 * Profiles must cover all 7 bands: freezing, winter, chilly, cool, mild, warm, hot.
 */

import type { WeatherContext, TemperatureBand } from "./weatherContext";

export type ClothingProfileId = "neutral" | "mens" | "womens";
// Future profiles: "business" | "gym" | "hiking" | "kids" | "travel" | "luxury"

export type BandOutfit = {
  /** Base garments for this temperature band (in display order). */
  items: string[];
  /**
   * If rainRisk is true, any item in this list is replaced by its
   * counterpart in `rainFootwear`. This avoids sandals during rain
   * without hard-coding garment names in the weather engine.
   */
  openFootwear?: string; // e.g. "Sandals" — swapped for rainFootwear when wet
};

export type ClothingProfile = {
  id: ClothingProfileId;
  label: string;
  emoji: string;
  description: string;
  bands: Record<TemperatureBand, BandOutfit>;
  /** Added to outfit when precipProb ≥ 60% or active rain code. */
  waterproof: string;
  /** Added when snowProb > 0. */
  snowBoots: string;
  /** Added when windKph ≥ 25. */
  windLayer: string;
  /** Replaces openFootwear when rainRisk is true. */
  rainFootwear: string;
};

// ── GENDER-NEUTRAL (default for all existing users) ───────────────────────
const neutral: ClothingProfile = {
  id: "neutral",
  label: "Gender-neutral",
  emoji: "👤",
  description: "Works for everyone.",
  waterproof: "Waterproof shell",
  snowBoots: "Snow boots",
  windLayer: "Windbreaker layer",
  rainFootwear: "Sneakers",
  bands: {
    freezing: {
      items: [
        "Heavy parka",
        "Thermal base layer",
        "Insulated boots",
        "Wool socks",
        "Beanie & scarf",
      ],
    },
    winter: { items: ["Warm coat", "Sweater", "Long pants", "Boots", "Beanie"] },
    chilly: { items: ["Insulated jacket", "Long sleeve", "Jeans", "Sneakers"] },
    cool: { items: ["Light hoodie or jacket", "T-shirt", "Jeans", "Sneakers"] },
    mild: { items: ["Long-sleeve tee", "Light pants", "Sneakers"] },
    warm: { items: ["T-shirt", "Shorts or chinos", "Breathable sneakers"] },
    hot: { items: ["Linen shirt", "Shorts", "Sandals", "Cap"], openFootwear: "Sandals" },
  },
};

// ── MEN'S ────────────────────────────────────────────────────────────────
const mens: ClothingProfile = {
  id: "mens",
  label: "Men's",
  emoji: "👨",
  description: "Men's clothing recommendations.",
  waterproof: "Waterproof jacket",
  snowBoots: "Winter boots",
  windLayer: "Windbreaker",
  rainFootwear: "Sneakers",
  bands: {
    freezing: {
      items: [
        "Heavy parka",
        "Thermal base layer",
        "Insulated boots",
        "Wool socks",
        "Beanie & scarf",
      ],
    },
    winter: {
      items: ["Winter coat", "Fleece sweater", "Thermal pants", "Waterproof boots", "Beanie"],
    },
    chilly: { items: ["Insulated jacket", "Long-sleeve shirt", "Jeans", "Sneakers or boots"] },
    cool: { items: ["Hoodie", "T-shirt", "Jeans or chinos", "Sneakers"] },
    mild: { items: ["Long-sleeve polo or tee", "Chinos or jeans", "Casual sneakers"] },
    warm: { items: ["T-shirt", "Shorts or chinos", "Sneakers"] },
    hot: { items: ["Linen shirt", "Shorts", "Sandals", "Cap"], openFootwear: "Sandals" },
  },
};

// ── WOMEN'S ──────────────────────────────────────────────────────────────
const womens: ClothingProfile = {
  id: "womens",
  label: "Women's",
  emoji: "👩",
  description: "Women's clothing recommendations.",
  waterproof: "Waterproof jacket",
  snowBoots: "Warm boots",
  windLayer: "Windbreaker or scarf",
  rainFootwear: "Ankle boots or sneakers",
  bands: {
    freezing: {
      items: [
        "Heavy parka",
        "Thermal base layer",
        "Insulated boots",
        "Wool socks",
        "Beanie & scarf",
      ],
    },
    winter: {
      items: [
        "Winter coat",
        "Turtleneck or sweater",
        "Warm leggings or pants",
        "Knee-high boots",
        "Beanie",
      ],
    },
    chilly: {
      items: ["Insulated jacket or peacoat", "Long-sleeve top", "Jeans or leggings", "Ankle boots"],
    },
    cool: {
      items: [
        "Cardigan or light jacket",
        "T-shirt or blouse",
        "Jeans or light trousers",
        "Sneakers or flats",
      ],
    },
    mild: {
      items: [
        "Light blouse or long-sleeve tee",
        "Jeans, trousers, or midi skirt",
        "Sneakers or flats",
      ],
    },
    warm: {
      items: ["Blouse or tank top", "Shorts, skirt, or light trousers", "Sandals or sneakers"],
      openFootwear: "Sandals or sneakers",
    },
    hot: {
      items: ["Tank top or summer dress", "Shorts or lightweight skirt", "Sandals", "Sun hat"],
      openFootwear: "Sandals",
    },
  },
};

// ── PROFILE REGISTRY ────────────────────────────────────────────────────
export const PROFILES: Record<ClothingProfileId, ClothingProfile> = {
  neutral,
  mens,
  womens,
};

export const DEFAULT_PROFILE: ClothingProfileId = "neutral";

/**
 * Resolve the ClothingProfile for a given profile ID.
 * Returns the gender-neutral profile if the ID is unknown or undefined.
 */
export function getProfile(id: ClothingProfileId | undefined): ClothingProfile {
  return PROFILES[id ?? DEFAULT_PROFILE] ?? PROFILES[DEFAULT_PROFILE];
}

/**
 * Select the outfit items for a given WeatherContext using the given profile.
 * This is the only function that reads from both layers — it produces a
 * garment list that is both weather-appropriate and profile-specific.
 */
export function selectOutfit(ctx: WeatherContext, profile: ClothingProfile): string[] {
  const bandOutfit = profile.bands[ctx.band];
  const outfit = [...bandOutfit.items];

  // Rain footwear swap — replaces open footwear (sandals etc.) when rain risk
  // is active. The profile declares which item is "open" via openFootwear.
  if (ctx.rainRisk && bandOutfit.openFootwear) {
    const idx = outfit.indexOf(bandOutfit.openFootwear);
    if (idx !== -1) outfit[idx] = profile.rainFootwear;
    // Also replace if a partial match (e.g. "Sandals or sneakers")
    const partialIdx = outfit.findIndex(
      (item) => bandOutfit.openFootwear && item.toLowerCase().includes("sandal"),
    );
    if (partialIdx !== -1 && partialIdx !== idx) outfit[partialIdx] = profile.rainFootwear;
  }

  // Additive items from the profile — appended in severity order
  if (ctx.needsWaterproof) outfit.push(profile.waterproof);
  if (ctx.needsSnowBoots) outfit.push(profile.snowBoots);
  if (ctx.needsWindbreaker) outfit.push(profile.windLayer);

  return outfit;
}
