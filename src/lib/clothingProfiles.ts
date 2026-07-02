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
 * VARIETY via sub-bands:
 *   The 7 temperature bands (freezing → hot) are intentionally wide to give the
 *   recommendation engine stable outfit categories to reason about. But within
 *   each band, temperatures can vary significantly — 29°C and 36°C are both "hot"
 *   but call for different clothing. Sub-bands allow profiles to serve different
 *   garment lists within the same top-level band without changing any thresholds.
 *
 *   Each BandOutfit may have a `subBands` array. selectOutfit() checks
 *   subBands first (highest minFeels wins) before falling through to items[].
 *   Sub-band openFootwear is inherited from the parent if not set.
 */

import type { WeatherContext, TemperatureBand } from "./weatherContext";

export type ClothingProfileId = "neutral" | "mens" | "womens";
// Future profiles: "business" | "gym" | "hiking" | "kids" | "travel" | "luxury"

export type SubBand = {
  /** Minimum effective feels-like temperature (°C) for this sub-band. */
  minFeels: number;
  items: string[];
  openFootwear?: string;
};

export type BandOutfit = {
  /** Base garments — used when no sub-band matches. */
  items: string[];
  /**
   * Optional sub-bands sorted by descending minFeels.
   * selectOutfit() uses the first sub-band whose minFeels ≤ ctx.feels.
   */
  subBands?: SubBand[];
  /**
   * Default open footwear for this band — swapped for rainFootwear when wet.
   * Sub-bands may override this per range.
   */
  openFootwear?: string;
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
  /** Added when windKph ≥ 30 (warm/hot) or ≥ 25 (cold bands). */
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
    winter: {
      items: ["Warm coat", "Sweater", "Thermal pants", "Boots", "Beanie"],
    },
    chilly: {
      items: ["Insulated jacket", "Long-sleeve shirt", "Jeans", "Boots or sneakers"],
    },
    cool: {
      items: ["Light jacket or hoodie", "Long-sleeve shirt", "Jeans", "Sneakers"],
    },
    mild: {
      // 15–22°C: split at 19°C (upper mild vs lower mild)
      items: ["Light layer or hoodie", "Jeans", "Sneakers"],
      subBands: [
        {
          minFeels: 19,
          items: ["Long-sleeve tee", "Light pants or jeans", "Sneakers"],
        },
        {
          minFeels: 15,
          items: ["Light hoodie or sweater", "Jeans", "Sneakers"],
        },
      ],
    },
    warm: {
      // 22–28°C: split at 25°C
      items: ["T-shirt", "Shorts or chinos", "Breathable sneakers"],
      subBands: [
        {
          minFeels: 25,
          items: ["T-shirt", "Shorts", "Breathable sneakers"],
        },
        {
          minFeels: 22,
          items: ["T-shirt or light long-sleeve", "Chinos or jeans", "Sneakers"],
        },
      ],
    },
    hot: {
      // >28°C: split at 34°C (intense heat vs warm)
      items: ["Linen shirt", "Shorts", "Sandals", "Cap"],
      openFootwear: "Sandals",
      subBands: [
        {
          minFeels: 34,
          items: ["Linen shirt", "Shorts", "Sandals", "Cap"],
          openFootwear: "Sandals",
        },
        {
          minFeels: 28,
          items: ["Breathable T-shirt", "Shorts", "Sandals"],
          openFootwear: "Sandals",
        },
      ],
    },
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
    chilly: {
      // 0–8°C: split at 4°C
      items: ["Insulated jacket", "Long-sleeve shirt", "Jeans", "Sneakers or boots"],
      subBands: [
        {
          minFeels: 4,
          items: ["Insulated jacket", "Long-sleeve shirt", "Jeans", "Sneakers"],
        },
        {
          minFeels: 0,
          items: ["Winter jacket", "Heavy sweater", "Jeans", "Boots"],
        },
      ],
    },
    cool: {
      // 8–15°C: split at 11°C
      items: ["Hoodie", "T-shirt", "Jeans", "Sneakers"],
      subBands: [
        {
          minFeels: 11,
          items: ["Light hoodie", "T-shirt", "Jeans or chinos", "Sneakers"],
        },
        {
          minFeels: 8,
          items: ["Fleece hoodie", "Long-sleeve shirt", "Jeans", "Sneakers"],
        },
      ],
    },
    mild: {
      // 15–22°C — two distinct sub-ranges from the spec
      items: ["Long-sleeve shirt", "Jeans", "Sneakers"],
      subBands: [
        {
          // 19–22°C: warmer mild — polo or T-shirt, chinos
          minFeels: 19,
          items: ["Polo shirt or T-shirt", "Jeans or chinos", "Sneakers"],
        },
        {
          // 15–18°C: cooler mild — long sleeve, jeans
          minFeels: 15,
          items: ["Long-sleeve shirt", "Jeans", "Sneakers"],
        },
      ],
    },
    warm: {
      // 22–28°C — two sub-ranges
      items: ["T-shirt", "Shorts or chinos", "Sneakers"],
      subBands: [
        {
          // 25–28°C: warmer end — T-shirt and shorts
          minFeels: 25,
          items: ["Lightweight cotton T-shirt", "Shorts", "Breathable sneakers"],
        },
        {
          // 22–24°C: cooler warm — T-shirt with chinos
          minFeels: 22,
          items: ["T-shirt", "Chinos or lightweight pants", "Sneakers"],
        },
      ],
    },
    hot: {
      // >28°C — two sub-ranges from the spec
      items: ["Linen shirt", "Shorts", "Sandals", "Cap"],
      openFootwear: "Sandals",
      subBands: [
        {
          // 34°C+: intense heat — linen, full sun protection
          minFeels: 34,
          items: ["Linen shirt", "Shorts", "Sandals", "Cap"],
          openFootwear: "Sandals",
        },
        {
          // 28–33°C: hot but manageable — lightweight cotton
          minFeels: 28,
          items: ["Lightweight cotton T-shirt", "Shorts", "Breathable sneakers"],
          openFootwear: "Breathable sneakers",
        },
      ],
    },
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
      // 0–8°C
      items: ["Insulated jacket or peacoat", "Long-sleeve top", "Jeans or leggings", "Ankle boots"],
      subBands: [
        {
          minFeels: 4,
          items: [
            "Insulated jacket or peacoat",
            "Long-sleeve top",
            "Jeans or leggings",
            "Ankle boots",
          ],
        },
        {
          minFeels: 0,
          items: ["Heavy jacket or puffer coat", "Sweater", "Warm pants or leggings", "Boots"],
        },
      ],
    },
    cool: {
      // 8–15°C
      items: ["Cardigan or light jacket", "T-shirt or blouse", "Jeans", "Sneakers or flats"],
      subBands: [
        {
          minFeels: 11,
          items: ["Cardigan or hoodie", "T-shirt or blouse", "Jeans or trousers", "Sneakers"],
        },
        {
          minFeels: 8,
          items: [
            "Light jacket",
            "Long-sleeve top",
            "Jeans or leggings",
            "Sneakers or ankle boots",
          ],
        },
      ],
    },
    mild: {
      // 15–22°C — two sub-ranges
      items: [
        "Light blouse or long-sleeve tee",
        "Jeans, trousers, or midi skirt",
        "Sneakers or flats",
      ],
      subBands: [
        {
          // 19–22°C: warmer mild
          minFeels: 19,
          items: ["Blouse or T-shirt", "Jeans or midi skirt", "Sneakers or flats"],
        },
        {
          // 15–18°C: cooler mild
          minFeels: 15,
          items: ["Light sweater or long-sleeve blouse", "Jeans or trousers", "Sneakers"],
        },
      ],
    },
    warm: {
      // 22–28°C
      items: ["Blouse or tank top", "Shorts, skirt, or light trousers", "Sandals or sneakers"],
      openFootwear: "Sandals or sneakers",
      subBands: [
        {
          minFeels: 25,
          items: ["Blouse or tank top", "Shorts or lightweight skirt", "Sandals or sneakers"],
          openFootwear: "Sandals or sneakers",
        },
        {
          minFeels: 22,
          items: ["T-shirt or light blouse", "Jeans or lightweight trousers", "Sneakers"],
        },
      ],
    },
    hot: {
      // >28°C
      items: ["Tank top or summer dress", "Shorts or lightweight skirt", "Sandals", "Sun hat"],
      openFootwear: "Sandals",
      subBands: [
        {
          // 34°C+: dress for the heat
          minFeels: 34,
          items: [
            "Linen dress or breathable blouse",
            "Shorts or lightweight skirt",
            "Sandals",
            "Sun hat",
          ],
          openFootwear: "Sandals",
        },
        {
          // 28–33°C: warm but comfortable
          minFeels: 28,
          items: ["Cotton T-shirt or tank top", "Shorts or skirt", "Sandals or sneakers"],
          openFootwear: "Sandals or sneakers",
        },
      ],
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
 *
 * Sub-band selection: within each top-level band, a profile may define
 * sub-bands for more granular differentiation (e.g. 34°C vs 29°C within "hot").
 * Sub-bands are checked in descending minFeels order; the first whose minFeels
 * is ≤ ctx.feels provides the items. If no sub-band matches, the parent
 * band's items are used as a fallback. openFootwear is inherited from the
 * sub-band when set, otherwise from the parent band.
 */
export function selectOutfit(ctx: WeatherContext, profile: ClothingProfile): string[] {
  const bandOutfit = profile.bands[ctx.band];

  // Determine items from sub-band if available, else fall through to base items.
  let activeItems = bandOutfit.items;
  let activeOpenFootwear = bandOutfit.openFootwear;

  if (bandOutfit.subBands && bandOutfit.subBands.length > 0) {
    // Sub-bands are stored descending by minFeels — pick the first that applies.
    const sorted = [...bandOutfit.subBands].sort((a, b) => b.minFeels - a.minFeels);
    const match = sorted.find((sb) => ctx.feels >= sb.minFeels);
    if (match) {
      activeItems = match.items;
      // Sub-band may override openFootwear; if not set, inherit from parent.
      activeOpenFootwear = match.openFootwear ?? bandOutfit.openFootwear;
    }
  }

  const outfit = [...activeItems];

  // Rain footwear swap — replaces open footwear when rain risk is active.
  if (ctx.rainRisk && activeOpenFootwear) {
    const idx = outfit.indexOf(activeOpenFootwear);
    if (idx !== -1) outfit[idx] = profile.rainFootwear;
    // Also replace partial matches (e.g. "Sandals or sneakers")
    const partialIdx = outfit.findIndex(
      (item) => activeOpenFootwear && item.toLowerCase().includes("sandal"),
    );
    if (partialIdx !== -1 && partialIdx !== idx) outfit[partialIdx] = profile.rainFootwear;
  }

  // Additive items — appended in severity order
  if (ctx.needsWaterproof) outfit.push(profile.waterproof);
  if (ctx.needsSnowBoots) outfit.push(profile.snowBoots);
  if (ctx.needsWindbreaker) outfit.push(profile.windLayer);

  return outfit;
}
