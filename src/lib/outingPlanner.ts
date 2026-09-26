/**
 * outingPlanner.ts — Deterministic Outing Planner engine.
 *
 * Pure function: same inputs → same output. No network, no AI.
 *
 * ═══ Two-track thermal model (Issue 1) ═══════════════════════════════════════
 *
 * TRACK A — Destination effective temperature (base outfit)
 *   destinationEffC = rawApparentC + sensitivityAdj + activityAdj + contextBonus
 *   Used to choose the base garments worn at the destination.
 *   Indoor context and activity heat shift this track.
 *   Controls: base top, base bottom, gym wear choice.
 *
 * TRACK B — Exposure effective temperature (safety / commute)
 *   exposureEffC = rawApparentC + sensitivityAdj
 *   Used for all outward-facing protection decisions that must withstand
 *   departure, commute, outdoor transitions and return.
 *   Activity bonuses and indoor context NEVER apply to this track.
 *   Safety overrides style and activity preferences.
 *   Controls: outer coat, removable carry-layer, rain/snow/wind protection,
 *             departure/return timeline guidance thresholds.
 *
 * Example: -2°C, gym, active, mostly indoors
 *   exposureMin = -2 + 0 (normal sens) = -2°C → winter band → Winter coat required
 *   destinationMin = -2 + 4 (active) + 3 (indoors) = 5°C → cool band → gym shorts fine
 *   Result: gym base outfit + Winter coat (commute protection).
 *   Never: gym hoodie only.
 *
 * ═══ Real PersonalStyleProfile integration (Issue 2) ═══════════════════════
 *
 * planOuting now accepts PersonalStyleProfile | null as a required parameter.
 * Used fields:
 *   - layeringPreference ("minimal"|"balanced"|"prefer"):
 *       "minimal": skip optional carry-layers when exposureMin is cool but safe
 *       "prefer":  add an extra carryable layer when exposureMin is cool and no coat
 *   - rainTolerance ("low"|"normal"|"high"):
 *       "low": umbrella threshold drops to precipProb >= 25 (from 40)
 *       "high": umbrella only for active rain codes, not probability alone
 *   - windSensitivity ("low"|"normal"|"high"):
 *       "high": windbreaker added at 20 km/h instead of 30 km/h
 *       "low":  windbreaker only at 40 km/h
 *   - commuteMode:
 *       "walk"/"transit": commute exposure note in timeline
 *
 * Safety overrides always apply regardless of profile:
 *   - Outer coat always required when exposureMin <= 0°C
 *   - Rain/snow protection always included when RAIN_CODES fire
 *   - "minimal" layering preference never removes weather-safety items
 *
 * ═══ Garment-family matching (Issue 3) ══════════════════════════════════════
 *
 * Generic descriptive adjectives ("light", "warm", "smart", "casual",
 * "waterproof", "long-sleeve", "dark", "soft") are explicitly excluded from
 * the semantic-match token set. Only garment-family root words qualify
 * (shirt, hoodie, blouse, tee, sweatshirt, trouser, jean, short, coat,
 * jacket, sneaker, boot, trainer, sandal, cardigan, blazer, etc.).
 * A "Light hoodie" cannot fill a "Light smart shirt" slot because "hoodie"
 * is not a member of the shirt/blouse family.
 */

import type { WardrobeItem } from "@/components/wardrobe/wardrobeData";
import type { Prefs } from "./preferences";
import type { OutingForecastSlice, HourlyOutingSlot } from "./outingForecast";
import type { PersonalStyleProfile } from "./styleProfile";
import { RAIN_CODES } from "./outingForecast";

export type OutingOccasion =
  | "gym" | "college" | "work" | "casual" | "event" | "other";
export type OutingActivity = "low" | "moderate" | "active";
export type OutingContext  = "indoors" | "mixed" | "outdoors";

export type OutingInput = {
  occasion:      OutingOccasion;
  departureTime: string;
  returnTime:    string | null;
  activity:      OutingActivity;
  context:       OutingContext;
  locationLabel: string;
};

export type PlannedItem = {
  name:         string;
  wardrobeId:   string | null;
  fromWardrobe: boolean;
  reason:       string;
};

export type TimelineGuidance = {
  startTime:   string;
  endTime?:    string;
  instruction: string;
  reason:      string;
};

export type WeatherSummary = {
  /** Raw apparent temperature minimum across the interval (meteorological) */
  rawMinApparentTempC:          number;
  /** Raw apparent temperature maximum across the interval (meteorological) */
  rawMaxApparentTempC:          number;
  /**
   * Exposure effective minimum (rawApparent + sensitivityAdj).
   * Used for safety decisions. Never adjusted for activity or indoor context.
   * Must not be labelled "Feels like" in UI.
   */
  effectiveMinC:                 number;
  /** Exposure effective maximum */
  effectiveMaxC:                 number;
  /**
   * Destination effective minimum (rawApparent + all adjustments).
   * Used for base outfit selection at the destination.
   */
  destinationMinC:               number;
  /** Destination effective maximum */
  destinationMaxC:               number;
  peakPrecipitationProbability:  number;
  /** Wind speed km/h at 10m — NOT gusts */
  maxWindSpeedKph:               number;
  hasRain:                       boolean;
  hasSnow:                       boolean;
  isWindy:                       boolean;
  hasActiveRainCode:             boolean;
};

export type OutingPlanRecommendation = {
  coverageStart:              string;
  coverageEnd:                string;
  locationLabel:              string;
  locationLat:                number;
  locationLon:                number;
  occasion:                   string;
  baseItems:                  PlannedItem[];
  /**
   * Layers required at departure — must be worn when leaving.
   * These are chosen for outdoor exposure (cold commute, freezing return).
   * They may be removed or opened indoors.
   */
  departureLayers:            PlannedItem[];
  /**
   * Layers genuinely optional at departure — pack for later.
   * Not needed when leaving; needed later due to temperature swing or return cold.
   */
  carryLayers:                PlannedItem[];
  /**
   * Deprecated alias kept for backward-compat with v2 snapshots and existing
   * tests that read removableLayers directly.
   * = [...departureLayers, ...carryLayers]
   */
  removableLayers:            PlannedItem[];
  /**
   * Optional indoor-adaptation hint shown when a departure layer may be
   * removed/opened once at the warm destination.
   */
  adaptationHint?:            string;
  footwear:                   PlannedItem[];
  accessories:                PlannedItem[];
  timelineGuidance:           TimelineGuidance[];
  weatherSummary:             WeatherSummary;
  assumption?:                string;
  personalizationExplanation: string;
  generatedAt:                string;
  recommendationVersion:      number;
};

/**
 * v3 — 2026-09-26: adds departureLayers / carryLayers / adaptationHint split.
 * Old v2 records lacking these fields must be regenerated.
 * Bumping the version ensures the store rejects v2 records silently on load.
 */
export const OUTING_PLAN_VERSION = 3;

/**
 * The specific reason wind protection was or was not added to the plan.
 * Passed to buildExplanation so output text accurately reflects the decision.
 */
export type WindReason =
  | "windbreaker_added"    // isWindyForUser && no adequate layer && not driving-mild
  | "layer_adequate"       // isWindyForUser && existing removable layer covers it
  | "driving_reduced"      // isWindyForUser && driving commute, wind below drive ceiling
  | "not_windy";           // wind below user's threshold — no wind note needed

// ── Track A: destination comfort (base outfit selection) ────────────────────
//
// For context="outdoors": destination = rawApparent + sensAdj + actAdj
//   (activity heat reduces how cold outdoor apparent temp feels)
//
// For context="indoors": destination uses a FIXED INDOOR COMFORT BASELINE
//   rather than outdoor apparent temperature.
//   Rationale: a heated building is ~20–22°C regardless of -10°C outside.
//   The base outfit is chosen for the indoor environment, not the weather.
//   Formula: destinationEffC = INDOOR_COMFORT_C + actAdj + sensAdj
//   where INDOOR_COMFORT_C = 21°C (standard heated-room temperature)
//
// For context="mixed": weighted blend of indoor baseline and outdoor apparent.
//   The outdoor apparent temperature influences the base outfit because
//   significant time is spent outside (commute, breaks, travel legs).
//
// Track B remains the EXPOSURE track for commute/safety decisions and is
// NEVER influenced by indoor context or activity.

const INDOOR_COMFORT_C = 21; // °C — standard heated indoor environment baseline

function activityAdj(a: OutingActivity): number {
  if (a === "active")   return +4;
  if (a === "moderate") return +2;
  return 0;
}

function sensitivityAdj(cs: Prefs["coldSensitivity"]): number {
  if (cs === "cold") return -4;
  if (cs === "hot")  return +4;
  return 0;
}

/**
 * Track A: destination comfort temperature for base outfit selection.
 * - outdoors:  rawApparent + sensAdj + actAdj  (fully weather-driven)
 * - indoors:   INDOOR_COMFORT_C + sensAdj + actAdj  (building temperature)
 * - mixed:     blend of both (60% indoor, 40% outdoor apparent)
 * NOT a meteorological value. Must not be labelled "Feels like" in UI.
 */
function destinationEffC(
  rawApparent: number,
  sensAdj:     number,
  actAdj:      number,
  ctx:         OutingContext,
): number {
  if (ctx === "indoors") {
    // Indoor room temperature base — outdoor weather is irrelevant for the base outfit
    return INDOOR_COMFORT_C + sensAdj + actAdj;
  }
  if (ctx === "mixed") {
    // Blend: significant time in both environments
    const indoorPart  = INDOOR_COMFORT_C + sensAdj + actAdj;
    const outdoorPart = rawApparent + sensAdj + actAdj;
    return indoorPart * 0.6 + outdoorPart * 0.4;
  }
  // outdoors: fully weather-driven
  return rawApparent + sensAdj + actAdj;
}

// Track B: outdoor exposure (commute, departure, return).
// Only sensitivity applies — activity and context MUST NOT suppress protection.
function exposureEffC(rawApparent: number, sensAdj: number): number {
  return rawApparent + sensAdj;
}

// ── Temperature band ─────────────────────────────────────────────────────────

export type TempBand =
  | "freezing" | "winter" | "chilly" | "cool" | "mild" | "warm" | "hot";

export function bandFor(c: number): TempBand {
  if (c <= -10) return "freezing";
  if (c <=   0) return "winter";
  if (c <=   8) return "chilly";
  if (c <=  15) return "cool";
  if (c <=  22) return "mild";
  if (c <=  28) return "warm";
  return "hot";
}

export function formatHour(iso: string): string {
  const h = parseInt(iso.slice(11, 13), 10);
  const m = parseInt(iso.slice(14, 16), 10);
  const suffix  = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

// ── Garment tables: profile-specific single items ─────────────────────────

type ProfileId = "mens" | "womens" | "neutral" | undefined;
type GarmentSpec = { top: string; bottom: string };
type ProfileRow = { m: GarmentSpec; w: GarmentSpec; n: GarmentSpec };

const GARMENTS: Record<OutingOccasion, Record<TempBand, ProfileRow>> = {
  gym: {
    freezing: { m:{top:"Thermal base layer",        bottom:"Thermal leggings"  }, w:{top:"Thermal base layer",       bottom:"Thermal leggings"  }, n:{top:"Thermal base layer",       bottom:"Thermal leggings"  } },
    winter:   { m:{top:"Fleece sweatshirt",          bottom:"Joggers"           }, w:{top:"Fleece sweatshirt",        bottom:"Joggers"           }, n:{top:"Fleece sweatshirt",        bottom:"Joggers"           } },
    chilly:   { m:{top:"Long-sleeve gym shirt",      bottom:"Joggers"           }, w:{top:"Long-sleeve gym top",      bottom:"Joggers"           }, n:{top:"Long-sleeve gym top",      bottom:"Joggers"           } },
    cool:     { m:{top:"Long-sleeve gym shirt",      bottom:"Training pants"    }, w:{top:"Long-sleeve gym top",      bottom:"Training leggings" }, n:{top:"Long-sleeve gym top",      bottom:"Training pants"    } },
    mild:     { m:{top:"T-shirt",                    bottom:"Training shorts"   }, w:{top:"Fitted gym top",           bottom:"Training shorts"   }, n:{top:"T-shirt",                  bottom:"Training shorts"   } },
    warm:     { m:{top:"Lightweight gym shirt",      bottom:"Training shorts"   }, w:{top:"Lightweight gym top",      bottom:"Training shorts"   }, n:{top:"Lightweight gym top",      bottom:"Training shorts"   } },
    hot:      { m:{top:"Light gym singlet",          bottom:"Training shorts"   }, w:{top:"Light gym top",            bottom:"Training shorts"   }, n:{top:"Light gym singlet",        bottom:"Training shorts"   } },
  },
  college: {
    freezing: { m:{top:"Warm sweater",               bottom:"Jeans"             }, w:{top:"Warm sweater",             bottom:"Jeans"             }, n:{top:"Warm sweater",             bottom:"Jeans"             } },
    winter:   { m:{top:"Sweater",                    bottom:"Jeans"             }, w:{top:"Sweater",                  bottom:"Jeans"             }, n:{top:"Sweater",                  bottom:"Jeans"             } },
    chilly:   { m:{top:"Hoodie",                     bottom:"Jeans"             }, w:{top:"Hoodie",                   bottom:"Jeans"             }, n:{top:"Hoodie",                   bottom:"Jeans"             } },
    cool:     { m:{top:"Long-sleeve shirt",          bottom:"Jeans"             }, w:{top:"Long-sleeve top",          bottom:"Jeans"             }, n:{top:"Long-sleeve top",          bottom:"Jeans"             } },
    mild:     { m:{top:"T-shirt",                    bottom:"Chinos"            }, w:{top:"T-shirt",                  bottom:"Jeans"             }, n:{top:"T-shirt",                  bottom:"Jeans"             } },
    warm:     { m:{top:"T-shirt",                    bottom:"Shorts"            }, w:{top:"T-shirt",                  bottom:"Shorts"            }, n:{top:"T-shirt",                  bottom:"Shorts"            } },
    hot:      { m:{top:"Light T-shirt",              bottom:"Shorts"            }, w:{top:"Light T-shirt",            bottom:"Shorts"            }, n:{top:"Light T-shirt",            bottom:"Shorts"            } },
  },
  work: {
    freezing: { m:{top:"Warm sweater",               bottom:"Trousers"          }, w:{top:"Warm sweater",             bottom:"Trousers"          }, n:{top:"Warm sweater",             bottom:"Trousers"          } },
    winter:   { m:{top:"Smart jumper",               bottom:"Trousers"          }, w:{top:"Smart jumper",             bottom:"Trousers"          }, n:{top:"Smart jumper",             bottom:"Trousers"          } },
    chilly:   { m:{top:"Smart shirt",                bottom:"Trousers"          }, w:{top:"Smart blouse",             bottom:"Trousers"          }, n:{top:"Smart shirt",              bottom:"Trousers"          } },
    cool:     { m:{top:"Smart shirt",                bottom:"Chinos"            }, w:{top:"Smart blouse",             bottom:"Trousers"          }, n:{top:"Smart shirt",              bottom:"Trousers"          } },
    mild:     { m:{top:"Shirt",                      bottom:"Chinos"            }, w:{top:"Blouse",                   bottom:"Trousers"          }, n:{top:"Smart shirt",              bottom:"Trousers"          } },
    warm:     { m:{top:"Light shirt",                bottom:"Chinos"            }, w:{top:"Light blouse",             bottom:"Trousers"          }, n:{top:"Light shirt",              bottom:"Trousers"          } },
    hot:      { m:{top:"Light breathable shirt",     bottom:"Light trousers"    }, w:{top:"Light breathable blouse",  bottom:"Light trousers"    }, n:{top:"Light breathable shirt",   bottom:"Light trousers"    } },
  },
  casual: {
    freezing: { m:{top:"Warm sweater",               bottom:"Jeans"             }, w:{top:"Warm sweater",             bottom:"Jeans"             }, n:{top:"Warm sweater",             bottom:"Jeans"             } },
    winter:   { m:{top:"Hoodie",                     bottom:"Jeans"             }, w:{top:"Hoodie",                   bottom:"Jeans"             }, n:{top:"Hoodie",                   bottom:"Jeans"             } },
    chilly:   { m:{top:"Sweatshirt",                 bottom:"Jeans"             }, w:{top:"Sweatshirt",               bottom:"Jeans"             }, n:{top:"Sweatshirt",               bottom:"Jeans"             } },
    cool:     { m:{top:"Long-sleeve shirt",          bottom:"Jeans"             }, w:{top:"Long-sleeve top",          bottom:"Jeans"             }, n:{top:"Long-sleeve top",          bottom:"Jeans"             } },
    mild:     { m:{top:"T-shirt",                    bottom:"Jeans"             }, w:{top:"T-shirt",                  bottom:"Jeans"             }, n:{top:"T-shirt",                  bottom:"Jeans"             } },
    warm:     { m:{top:"T-shirt",                    bottom:"Shorts"            }, w:{top:"T-shirt",                  bottom:"Shorts"            }, n:{top:"T-shirt",                  bottom:"Shorts"            } },
    hot:      { m:{top:"Light T-shirt",              bottom:"Shorts"            }, w:{top:"Light T-shirt",            bottom:"Shorts"            }, n:{top:"Light T-shirt",            bottom:"Shorts"            } },
  },
  event: {
    freezing: { m:{top:"Smart warm jumper",          bottom:"Smart trousers"    }, w:{top:"Smart warm top",           bottom:"Smart trousers"    }, n:{top:"Smart warm jumper",        bottom:"Smart trousers"    } },
    winter:   { m:{top:"Smart jumper",               bottom:"Smart trousers"    }, w:{top:"Smart top",                bottom:"Smart trousers"    }, n:{top:"Smart jumper",             bottom:"Smart trousers"    } },
    chilly:   { m:{top:"Smart shirt",                bottom:"Smart trousers"    }, w:{top:"Smart blouse",             bottom:"Smart trousers"    }, n:{top:"Smart shirt",              bottom:"Smart trousers"    } },
    cool:     { m:{top:"Smart shirt",                bottom:"Smart trousers"    }, w:{top:"Smart blouse",             bottom:"Smart trousers"    }, n:{top:"Smart shirt",              bottom:"Smart trousers"    } },
    mild:     { m:{top:"Smart shirt",                bottom:"Smart trousers"    }, w:{top:"Smart blouse",             bottom:"Smart skirt"       }, n:{top:"Smart shirt",              bottom:"Smart trousers"    } },
    warm:     { m:{top:"Light smart shirt",          bottom:"Smart trousers"    }, w:{top:"Light smart top",          bottom:"Smart skirt"       }, n:{top:"Light smart shirt",        bottom:"Smart trousers"    } },
    hot:      { m:{top:"Light smart shirt",          bottom:"Light smart trousers"}, w:{top:"Light smart blouse",     bottom:"Light smart skirt" }, n:{top:"Light smart shirt",        bottom:"Light smart trousers"} },
  },
  other: {
    freezing: { m:{top:"Warm sweater",               bottom:"Trousers"          }, w:{top:"Warm sweater",             bottom:"Trousers"          }, n:{top:"Warm sweater",             bottom:"Trousers"          } },
    winter:   { m:{top:"Warm top",                   bottom:"Jeans"             }, w:{top:"Warm top",                 bottom:"Jeans"             }, n:{top:"Warm top",                 bottom:"Jeans"             } },
    chilly:   { m:{top:"Long-sleeve top",            bottom:"Jeans"             }, w:{top:"Long-sleeve top",          bottom:"Jeans"             }, n:{top:"Long-sleeve top",          bottom:"Jeans"             } },
    cool:     { m:{top:"Long-sleeve shirt",          bottom:"Jeans"             }, w:{top:"Long-sleeve top",          bottom:"Jeans"             }, n:{top:"Long-sleeve top",          bottom:"Jeans"             } },
    mild:     { m:{top:"T-shirt",                    bottom:"Jeans"             }, w:{top:"T-shirt",                  bottom:"Jeans"             }, n:{top:"T-shirt",                  bottom:"Jeans"             } },
    warm:     { m:{top:"T-shirt",                    bottom:"Shorts"            }, w:{top:"T-shirt",                  bottom:"Shorts"            }, n:{top:"T-shirt",                  bottom:"Shorts"            } },
    hot:      { m:{top:"Light T-shirt",              bottom:"Shorts"            }, w:{top:"Light T-shirt",            bottom:"Shorts"            }, n:{top:"Light T-shirt",            bottom:"Shorts"            } },
  },
};

function garmentSpec(
  occasion: OutingOccasion,
  band:     TempBand,
  profile:  ProfileId,
): GarmentSpec {
  const row = GARMENTS[occasion][band];
  if (profile === "mens")   return row.m;
  if (profile === "womens") return row.w;
  return row.n;
}

function layerForBand(
  band:     TempBand,
  occasion: OutingOccasion,
  profile:  ProfileId,
): string | null {
  if (band === "freezing" || band === "winter") return null; // outer coat handles this
  if (occasion === "gym") {
    return (band === "chilly" || band === "cool") ? "Gym hoodie" : null;
  }
  if (occasion === "work" || occasion === "event") {
    if (band === "chilly") return profile === "womens" ? "Cardigan" : "Smart blazer";
    if (band === "cool")   return profile === "womens" ? "Light cardigan" : "Light blazer";
    return null;
  }
  if (band === "chilly") return "Hoodie";
  if (band === "cool")   return "Light jacket";
  return null;
}

function outerCoatForBand(band: TempBand): string | null {
  if (band === "freezing") return "Heavy winter coat";
  if (band === "winter")   return "Winter coat";
  return null;
}

function footwearFor(
  band:     TempBand,
  occasion: OutingOccasion,
  profile:  ProfileId,
  hasRain:  boolean,
  hasSnow:  boolean,
): string {
  if (hasSnow) return "Waterproof winter boots";
  if (hasRain) {
    if (occasion === "gym")   return "Waterproof trainers";
    if (occasion === "work" || occasion === "event") return "Waterproof smart shoes";
    return "Waterproof shoes";
  }
  if (occasion === "gym") return "Trainers";
  if (band === "hot" || band === "warm") {
    return profile === "womens" ? "Light sandals" : "Lightweight sneakers";
  }
  if (band === "freezing" || band === "winter") return "Insulated waterproof boots";
  if (occasion === "work" || occasion === "event") return "Smart shoes";
  return "Sneakers";
}

// ── Garment-family matching (Issue 3) ─────────────────────────────────────
// Generic adjectives are stripped from the semantic match; only garment-family
// root words qualify as a "hit". This prevents "Light hoodie" filling
// "Light smart shirt" via the shared adjective "light".

type WarmthLevel = "Light" | "Medium" | "Warm";

const WARMTH_FOR_BAND: Record<TempBand, WarmthLevel[]> = {
  freezing: ["Warm"],
  winter:   ["Warm"],
  chilly:   ["Warm", "Medium"],
  cool:     ["Medium", "Warm"],
  mild:     ["Light", "Medium"],
  warm:     ["Light"],
  hot:      ["Light"],
};

const CATEGORY_HINT: Record<string, string> = {
  "t-shirt": "Tops", tshirt: "Tops",
  top: "Tops", shirt: "Tops", tee: "Tops", hoodie: "Tops", sweater: "Tops",
  sweatshirt: "Tops", singlet: "Tops", tank: "Tops", blouse: "Tops",
  jumper: "Tops", blazer: "Outerwear", cardigan: "Tops",
  jeans: "Bottoms", trousers: "Bottoms", pants: "Bottoms", shorts: "Bottoms",
  chinos: "Bottoms", leggings: "Bottoms", joggers: "Bottoms", skirt: "Bottoms",
  jacket: "Outerwear", coat: "Outerwear", fleece: "Outerwear",
  windbreaker: "Outerwear",
  shoes: "Shoes", boots: "Shoes", trainers: "Shoes",
  sneakers: "Shoes", sandals: "Shoes", loafers: "Shoes",
};

/**
 * Generic descriptive words that must NEVER count as a garment-family match.
 * These adjectives appear in many slot names but do not identify a garment family.
 * "Light hoodie" must not fill "Light smart shirt" via the shared token "light".
 */
const GENERIC_ADJECTIVES = new Set([
  // Colour / fit descriptors
  "light", "warm", "smart", "casual", "waterproof", "long", "sleeve",
  "dark", "soft", "fitted", "loose", "heavy", "breathable", "thermal",
  "gym", "sport", "athletic", "formal", "classic", "base",
  // Compound descriptor tokens produced by GARMENT_PHRASE_CANONICAL —
  // must be excluded so they do not become spurious garment-family hits:
  "longsleeve",  // produced from "long-sleeve" / "long sleeve"
  "baselayer",   // produced from "base layer"
  // Bare category-path prefix that appears in item type strings:
  // "Top / Hoodie" → tokens: {"top", "hoodie"} — only "top" is ambiguous.
  // Real garment names (shoes, boots, trainers …) are in GARMENT_FAMILY_MAP
  // and must NOT be added here, or legitimate family hits would be lost.
  "top",         // category prefix — too broad; use specific names (shirt, tshirt, hoodie …)
]);

/**
 * Canonical garment-phrase substitutions (Issue 2 — phrase-aware tokenisation).
 *
 * Applied BEFORE splitting into words. Replaces multi-word compound garment
 * phrases with a single canonical family token so that "t-shirt" / "t shirt"
 * do NOT become ["t", "shirt"] → "shirt" (incorrectly joining the shirt family).
 *
 * Priority: longer phrases are replaced first (sort by descending length).
 * After substitution the string is split on whitespace; each token is
 * then filtered against GENERIC_ADJECTIVES.
 */
const GARMENT_PHRASE_CANONICAL: Array<[RegExp, string]> = [
  // T-shirt variants → canonical token "tshirt" (NOT in the shirt family)
  [/\bt[-\s]shirt\b/gi, "tshirt"],
  // "long-sleeve" and "long sleeve" → stripped (generic descriptor)
  [/long[-\s]sleeve\b/gi, "longsleeve"],
  // "base layer" → "baselayer"
  [/\bbase[-\s]layer\b/gi, "baselayer"],
];

/**
 * Canonical garment-family aliases.
 *
 * ┌──────────────┬──────────────────────────────────┐
 * │ Family key   │ Members                          │
 * ├──────────────┼──────────────────────────────────┤
 * │ shirt        │ shirt, blouse                    │
 * │ tshirt       │ tshirt, tee                      │  ← t-shirt EXCLUDED from shirt family
 * │ hoodie       │ hoodie, sweatshirt, zip           │
 * │ trousers     │ trousers, pants, chinos           │
 * │ trainers     │ trainers, sneakers                │
 * │ coat         │ coat, parka, anorak               │
 * │ jacket       │ jacket, windbreaker, gilet        │
 * │ jeans        │ jeans, denim                      │
 * └──────────────┴──────────────────────────────────┘
 *
 * Each group is a Set. When any slot token appears in a group, every member
 * of that group is a valid item match. Generic adjectives are not members.
 */
/**
 * Positive garment-family vocabulary.
 *
 * Maps every canonical token → the Set of tokens that constitute its family.
 * IMPORTANT: Only tokens that appear in this map can produce a family hit.
 * Unknown tokens (e.g. "training", "lightweight", "winter" as descriptors,
 * "gym") are ignored — resolveAliases() returns null for them.
 *
 * This prevents false positives such as "Training shorts" matching
 * "Training sneakers" via the shared descriptor "training", because
 * "training" is not a key in this map and produces no alias set.
 *
 * Families are symmetric: every member maps to the full group Set.
 *
 * Families covered (matching GARMENTS, layerForBand, outerCoatForBand,
 * footwearFor, and all slot names the planner can produce):
 *   Tops:      shirt/blouse, tshirt/tee, hoodie/sweatshirt/zip,
 *              sweater/jumper, singlet/tank, cardigan
 *   Bottoms:   trousers/pants/chinos, jeans/denim, shorts, leggings,
 *              joggers, skirt
 *   Outerwear: coat/parka/anorak, jacket/windbreaker/gilet, blazer, fleece
 *   Footwear:  trainers/sneakers, boots, shoes, loafers, sandals
 */
const GARMENT_FAMILY_MAP = new Map<string, Set<string>>((() => {
  const families: string[][] = [
    ["shirt", "blouse"],
    ["tshirt", "tee"],
    ["hoodie", "sweatshirt", "zip"],
    ["sweater", "jumper"],
    ["singlet", "tank"],
    ["cardigan"],
    ["trousers", "pants", "chinos"],
    ["jeans", "denim"],
    ["shorts"],
    ["leggings"],
    ["joggers"],
    ["skirt"],
    ["coat", "parka", "anorak"],
    ["jacket", "windbreaker", "gilet"],
    ["blazer"],
    ["fleece"],
    ["trainers", "sneakers"],
    ["boots"],
    ["shoes", "loafers"],
    ["sandals"],
  ];
  const map = new Map<string, Set<string>>();
  for (const family of families) {
    const group = new Set(family);
    for (const member of family) map.set(member, group);
  }
  return map;
})());

/**
 * Return the alias set for a recognised garment-family token, or null for
 * unrecognised tokens (descriptors, modifiers, category words).
 *
 * Returning null for unrecognised tokens prevents descriptor-collision false
 * positives: "training", "lightweight", "winter", "gym", "fitted", "thermal"
 * are NOT garment families and must never count as a family hit.
 *
 * Contrast with the old behaviour of returning a singleton Set — that caused
 * "Training shorts" to match "Training sneakers" because both contained the
 * shared (but non-family) token "training".
 */
function resolveAliases(token: string): Set<string> | null {
  return GARMENT_FAMILY_MAP.get(token) ?? null;
}

/**
 * Apply GARMENT_PHRASE_CANONICAL substitutions then tokenise the result into
 * a Set<string> of garment-family tokens.
 *
 * "White T-shirt" → canonicalise → "white tshirt"
 *                 → split        → ["white", "tshirt"]
 *                 → Set          → {"white", "tshirt"}
 *
 * The Set is used for EXACT membership tests (itemTokens.has(alias)),
 * which prevents substring false-positives such as:
 *   "tshirt".includes("shirt") → true  (substring — WRONG)
 *   {"tshirt"}.has("shirt")    → false (token set — CORRECT)
 */
function canonicalItemTokens(text: string): Set<string> {
  let s = text.toLowerCase();
  for (const [re, canon] of GARMENT_PHRASE_CANONICAL) {
    s = s.replace(re, canon);
  }
  // Split on non-word chars (spaces, slashes, hyphens, punctuation)
  return new Set(s.split(/[^a-z]+/).filter(w => w.length >= 2));
}

function guessCategory(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [kw, cat] of Object.entries(CATEGORY_HINT)) {
    if (lower.includes(kw)) return cat;
  }
  return null;
}

/**
 * Extract garment-family tokens from a slot name.
 *
 * Steps:
 *   1. Apply GARMENT_PHRASE_CANONICAL substitutions (phrase-aware, prevents
 *      "t-shirt" → ["t","shirt"] collision with the shirt family).
 *   2. Split on whitespace (hyphens already consumed by canonical step).
 *   3. Filter: length >= 3 AND not in GENERIC_ADJECTIVES.
 *
 * Examples:
 *   "Light smart shirt"   → ["shirt"]
 *   "T-shirt"             → ["tshirt"]  (canonical substitution applied first)
 *   "Tee"                 → ["tee"]
 *   "Gym hoodie"          → ["hoodie"]
 *   "Waterproof trainers" → ["trainers"]
 *   "Smart blouse"        → ["blouse"]
 */
function garmentFamilyTokens(slotName: string): string[] {
  let s = slotName.toLowerCase();
  for (const [re, canon] of GARMENT_PHRASE_CANONICAL) {
    s = s.replace(re, canon);
  }
  // Split on whitespace only (hyphens removed by canonical substitutions above)
  const words = s.split(/\s+/);
  return words.filter(w => w.length >= 3 && !GENERIC_ADJECTIVES.has(w));
}

export function matchWardrobeItem(
  slotName:        string,
  items:           WardrobeItem[],
  usedIds:         Set<string>,
  band:            TempBand,
  stylePreferences?: readonly string[],
): WardrobeItem | null {
  // Extract garment-family tokens (adjectives removed)
  const familyTokens = garmentFamilyTokens(slotName);
  // Expand recognised tokens to alias sets; drop unrecognised descriptors (null).
  // This prevents "training", "lightweight", "winter" etc. from becoming fake families.
  const resolvedTokenSets = familyTokens.map(resolveAliases).filter((s): s is Set<string> => s !== null);

  const wantedCat = guessCategory(slotName);
  const wantedW   = WARMTH_FOR_BAND[band];

  const scored: { item: WardrobeItem; score: number; familyHit: boolean }[] = [];

  for (const item of items) {
    if (usedIds.has(item.id) || item.unavailable) continue;
    let score     = 0;
    let familyHit = false;

    // Build exact token sets from the canonicalised item name and type.
    // "White T-shirt" → {"white","tshirt"}, "Top / T-shirt" → {"top","tshirt"}
    // Using Set.has() instead of string.includes() prevents the substring
    // false-positive: "tshirt".includes("shirt") === true but
    // {"tshirt"}.has("shirt") === false.
    const nameTokens = canonicalItemTokens(item.name);
    const typeTokens = canonicalItemTokens(item.type);

    if (wantedCat && item.category === wantedCat) score += 20;
    if (wantedW.includes(item.warmth as WarmthLevel)) score += 15;

    for (const aliasSet of resolvedTokenSets) {
      // A hit occurs when the item's name or type token set EXACTLY contains
      // an alias token. Substring matching is NOT used.
      //   "tshirt" slot → aliasSet={tshirt,tee}:
      //     {"white","tshirt"}.has("tshirt") → true  ✓
      //     {"white","tshirt"}.has("shirt")  → false ✗ (shirt is a different alias set)
      //   "shirt" slot → aliasSet={shirt,blouse}:
      //     {"white","tshirt"}.has("shirt")  → false ✓ (T-shirt ≠ shirt family)
      //     {"white","tshirt"}.has("blouse") → false ✓
      for (const alias of aliasSet) {
        if (nameTokens.has(alias)) { score += 30; familyHit = true; break; }
        if (typeTokens.has(alias)) { score += 25; familyHit = true; break; }
      }
    }

    // Style-preference bonus: uses item.style and item.labels defensively.
    // Uses item.name (raw lowercase) for style keyword matching — not token set —
    // because style words like "casual" may appear inside compound names.
    // Array.isArray guards against corrupted wardrobe data.
    // +5 is small enough not to override family/warmth compatibility.
    if (stylePreferences && familyHit) {
      const itemRec    = item as unknown as Record<string, unknown>;
      const styleField = typeof itemRec.style === "string" ? itemRec.style.toLowerCase() : "";
      const labelsArr  = Array.isArray(itemRec.labels) ? (itemRec.labels as string[]) : [];
      const ll         = labelsArr.join(" ").toLowerCase();
      const nlRaw      = item.name.toLowerCase();
      for (const pref of stylePreferences) {
        const p = pref.toLowerCase();
        if (nlRaw.includes(p) || ll.includes(p) || styleField.includes(p)) {
          score += 5;
          break;
        }
      }
    }

    // Require at least one garment-family (or alias) hit AND minimum score.
    // Category + warmth alone (35 pts) is rejected without a family hit.
    if (score >= 35 && familyHit) scored.push({ item, score, familyHit });
  }
  if (scored.length === 0) return null;
  // Deterministic: score DESC, then id ASC (style bonus breaks ties within equal score)
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return scored[0].item;
}

// ── Timeline guidance ─────────────────────────────────────────────────────
// Uses exposure effective temperature for wear/carry threshold decisions.

function buildTimeline(
  departureIso:    string,
  returnIso:       string,
  summary:         WeatherSummary,
  slots:           HourlyOutingSlot[],
  departureLayers: PlannedItem[],
  carryLayers:     PlannedItem[],
  sensAdj:         number,
  effectiveMinC:   number,
  styleProfile:    PersonalStyleProfile | null,
  needsUmbrella:   boolean,   // Issue 1: single authoritative decision from planOuting
): TimelineGuidance[] {
  const guidance: TimelineGuidance[] = [];

  // Departure slot on the EXPOSURE track (not destination track)
  const deptSlot = [...slots].reverse().find(s => s.time <= departureIso) ?? slots[0];
  const deptExposure = deptSlot ? exposureEffC(deptSlot.apparentTempC, sensAdj) : summary.effectiveMinC;

  // Find warmest/coldest using EXPOSURE track
  let maxExp = -Infinity, minExp = Infinity;
  let warmestIso: string | null = null, coldestIso: string | null = null;
  for (const s of slots) {
    const eff = exposureEffC(s.apparentTempC, sensAdj);
    if (eff > maxExp) { maxExp = eff; warmestIso = s.time; }
    if (eff < minExp) { minExp = eff; coldestIso = s.time; }
  }
  const tempSwing = maxExp - minExp;

  // Layer guidance uses exposure departure temperature (not destination)
  const coldAtDeparture = deptExposure <= 14;
  const hasLayer = departureLayers.length > 0 || carryLayers.length > 0;

  // Departure layers: must be worn when leaving (cold at departure)
  if (departureLayers.length > 0) {
    guidance.push({
      startTime:   departureIso,
      instruction: `Wear your ${departureLayers.map(l => l.name.toLowerCase()).join(" and ")} — it's cool when you leave.`,
      reason:      `Outdoor exposure is ${deptExposure.toFixed(0)} °C at departure`,
    });
  }

  // Carry layers: not needed at departure, pack for later
  if (carryLayers.length > 0) {
    if (coldestIso && coldestIso > departureIso) {
      guidance.push({
        startTime:   departureIso,
        instruction: `Pack your ${carryLayers.map(l => l.name.toLowerCase()).join(" and ")} — you won't need it yet but will later.`,
        reason:      `Outdoor temperature drops to ~${minExp.toFixed(0)} °C later`,
      });
    } else {
      guidance.push({
        startTime:   departureIso,
        instruction: `Your ${carryLayers.map(l => l.name.toLowerCase()).join(" and ")} is available if you need it.`,
        reason:      "Conditions may vary during your outing",
      });
    }
  }

  // (hasLayer and coldAtDeparture are now handled via departureLayers/carryLayers above)

  // Commute note from StyleProfile
  if (styleProfile) {
    if (styleProfile.commuteMode === "walk" && deptExposure < 10) {
      guidance.push({
        startTime:   departureIso,
        instruction: "You're walking — dress for the outdoor temperature, not just the destination.",
        reason:      "Commute mode: walking",
      });
    } else if (styleProfile.commuteMode === "transit" && needsUmbrella) {
      // Issue 1: transit note only when umbrella is actually recommended
      guidance.push({
        startTime:   departureIso,
        instruction: "Transit commute: keep your umbrella accessible for platform wait times.",
        reason:      "Commute mode: transit + rain protection included",
      });
    }
  }

  // Issue 1: umbrella at departure — driven by needsUmbrella (single authoritative decision)
  if (needsUmbrella) {
    guidance.push({
      startTime:   departureIso,
      instruction: "Bring an umbrella — rain is expected during your outing.",
      reason:      "Precipitation forecast for the interval",
    });
  }

  // Layer removal at warmest point — only for departure layers worn at leaving
  if (departureLayers.length > 0 && tempSwing >= 5 && warmestIso && warmestIso > departureIso) {
    guidance.push({
      startTime:   warmestIso,
      instruction: "Consider removing or opening your layer indoors when you feel comfortable.",
      reason:      `Outdoor temperature peaks around ${formatHour(warmestIso)}`,
    });
  }

  // Layer back on for cold return — for carry layers being donned later
  if (carryLayers.length > 0 && coldestIso && coldestIso > departureIso) {
    guidance.push({
      startTime:   coldestIso,
      instruction: `Put on your ${carryLayers.map(l => l.name.toLowerCase()).join(" and ")} now — it's getting cooler outside.`,
      reason:      `Outdoor temperature drops around ${formatHour(coldestIso)}`,
    });
  } else if (hasLayer && departureLayers.length === 0 && coldestIso && coldestIso > departureIso) {
    // carry-only layer for later cold
    guidance.push({
      startTime:   coldestIso,
      instruction: "Put your layer on now — it's getting cooler outside.",
      reason:      `Outdoor temperature drops around ${formatHour(coldestIso)}`,
    });
  }

  // Issue 1: "rain arriving later" only when umbrella is actually recommended
  // (needsUmbrella already includes both active-code and probability checks)
  if (needsUmbrella && !summary.hasActiveRainCode) {
    // Umbrella is recommended but no active rain code at departure — rain likely later
    const rainSlot = slots.find(
      s => (s.precipProb >= 40 || RAIN_CODES.has(s.code)) && s.time > departureIso,
    );
    if (rainSlot) {
      guidance.push({
        startTime:   rainSlot.time,
        instruction: "Rain is likely — keep your umbrella accessible.",
        reason:      `Precipitation expected from ${formatHour(rainSlot.time)}`,
      });
    }
  }

  // Return
  guidance.push({
    startTime:   returnIso,
    instruction: `Return by ${formatHour(returnIso)}. ` + (
      effectiveMinC <= 10
        ? "Ensure your layer is on for the trip home."
        : "You should be comfortable for the journey back."
    ),
    reason: "End of outing",
  });

  return guidance;
}

// ── Explanation ───────────────────────────────────────────────────────────

function buildExplanation(
  prefs:         Prefs,
  activity:      OutingActivity,
  context:       OutingContext,
  summary:       WeatherSummary,
  styleProfile:  PersonalStyleProfile | null,
  needsUmbrella: boolean,    // Issue 1: authoritative umbrella decision
  windReason:    WindReason, // Bug 3: explicit wind decision — not inferred
): string {
  const parts: string[] = [];
  if (prefs.coldSensitivity === "cold")
    parts.push("You run cold, so slightly warmer clothing is recommended.");
  else if (prefs.coldSensitivity === "hot")
    parts.push("You run warm, so lighter options are preferred.");
  if (activity === "active")
    parts.push("Active movement generates body heat — the base outfit is lighter.");
  else if (activity === "low")
    parts.push("Low activity level — a slightly warmer base is used.");
  if (context === "outdoors")
    parts.push("Mostly outdoors — full weather exposure assumed.");
  else if (context === "indoors")
    parts.push("Mostly indoors — commute layers required for outdoor legs.");
  // Bug 3: wind explanation derived from explicit windReason, not inferred from summary.
  // Each branch corresponds exactly to how the decision was made in planOuting.
  if (windReason === "windbreaker_added")
    parts.push("Wind speed is elevated — a wind-protective layer is included for travel.");
  else if (windReason === "layer_adequate")
    parts.push("Wind speed is elevated; your existing layer provides adequate coverage.");
  else if (windReason === "driving_reduced")
    parts.push("Wind speed is elevated; driving limits outdoor wind exposure so no extra layer was added.");
  // windReason === "not_windy": no wind note
  // Issue 1: only mention umbrella in explanation when it is actually included
  if (needsUmbrella)
    parts.push("Rain protection included — bring an umbrella for travel legs.");
  else if (summary.hasRain)
    parts.push("Some rain in the forecast; waterproof footwear recommended.");
  if (styleProfile) {
    if (styleProfile.layeringPreference === "minimal")
      parts.push("You prefer minimal layers — optional carry-layers are skipped when safe.");
    else if (styleProfile.layeringPreference === "prefer")
      parts.push("You prefer layers — an extra carryable layer is included where conditions allow.");
    if (styleProfile.windSensitivity === "high" && windReason === "windbreaker_added")
      parts.push("Your high wind sensitivity is noted — wind protection is included.");
    if (styleProfile.rainTolerance === "low" && needsUmbrella)
      parts.push("Your low rain tolerance means rain protection is emphasised.");
  }
  if (parts.length === 0)
    return `Balanced plan for ${summary.rawMinApparentTempC}–${summary.rawMaxApparentTempC} °C apparent temperature.`;
  return parts.join(" ");
}

// ── Main engine ──────────────────────────────────────────────────────────────

export function planOuting(
  input:           OutingInput,
  slice:           OutingForecastSlice,
  wardrobeItems:   WardrobeItem[],
  prefs:           Prefs,
  effectiveReturn: string,
  styleProfile:    PersonalStyleProfile | null = null,
): OutingPlanRecommendation {
  const profile = prefs.clothingProfile;

  const sensAdj  = sensitivityAdj(prefs.coldSensitivity);
  const actAdj   = activityAdj(input.activity);
  // ── Track A: destination comfort (base outfit selection) ─────────────────
  const destTemps = slice.slots.map(s => destinationEffC(s.apparentTempC, sensAdj, actAdj, input.context));
  const destMinC  = Math.min(...destTemps);
  const destMaxC  = Math.max(...destTemps);

  // ── Track B: exposure / commute / safety (protection selection) ──────────
  const expTemps = slice.slots.map(s => exposureEffC(s.apparentTempC, sensAdj));
  const expMinC  = Math.min(...expTemps);
  const expMaxC  = Math.max(...expTemps);

  // Raw apparent minimum — used for minimum-protection floor decisions.
  // sensAdj must NOT be allowed to eliminate minimum cold-weather coverage.
  const rawMinApparentC = slice.rawMinApparentC;
  const rawMaxApparentC = slice.rawMaxApparentC;

  // Exposure track drives protection bands.
  // Protection-layer triggering uses the raw-apparent band so that "runs warm"
  // (+4 sensAdj) cannot suppress a layer when raw outdoor temperature is genuinely cold.
  const rawColdBand      = bandFor(rawMinApparentC);   // raw-apparent — for protection floor
  const exposureColdBand = bandFor(expMinC);           // sensAdj-adjusted — for comfort/outfit
  const exposureWarmBand = bandFor(expMaxC);
  // Destination track drives base outfit band
  const destWarmBand     = bandFor(destMaxC);

  const hasActiveRainCode = slice.slots.some(s => RAIN_CODES.has(s.code));

  // Umbrella thresholds by StyleProfile.rainTolerance:
  //   low:    25% — sensitive users want protection early
  //   normal: 40% — standard threshold
  //   high:   65% — rain-tolerant users still need protection at high probability
  // Safety floor: 80%+ always triggers umbrella regardless of tolerance.
  // Active RAIN_CODES always trigger umbrella regardless of tolerance or probability.
  const umbrellaThreshold =
    styleProfile?.rainTolerance === "low"  ? 25 :
    styleProfile?.rainTolerance === "high" ? 65 : 40;
  const needsUmbrella = hasActiveRainCode ||
    slice.peakPrecipProb >= umbrellaThreshold ||
    slice.peakPrecipProb >= 80;  // safety floor: very high probability always requires umbrella

  // Wind threshold adjusted by StyleProfile.windSensitivity
  const windThreshold =
    styleProfile?.windSensitivity === "high" ? 20 :
    styleProfile?.windSensitivity === "low"  ? 40 : 30;
  const isWindyForUser = slice.maxWindKph >= windThreshold;

  const summary: WeatherSummary = {
    rawMinApparentTempC:          Math.round(slice.rawMinApparentC * 10) / 10,
    rawMaxApparentTempC:          Math.round(slice.rawMaxApparentC * 10) / 10,
    effectiveMinC:                Math.round(expMinC * 10) / 10,
    effectiveMaxC:                Math.round(expMaxC * 10) / 10,
    destinationMinC:              Math.round(destMinC * 10) / 10,
    destinationMaxC:              Math.round(destMaxC * 10) / 10,
    peakPrecipitationProbability: slice.peakPrecipProb,
    maxWindSpeedKph:              slice.maxWindKph,
    hasRain:                      slice.hasRain,
    hasSnow:                      slice.hasSnow,
    isWindy:                      slice.isWindy,
    hasActiveRainCode,
  };

  // ── Base outfit: driven by DESTINATION track ─────────────────────────────
  // Minimum-protection floor: when raw outdoor apparent temperature is ≤ 15°C,
  // the occasion band used for bottoms is capped at "cool" (jeans/chinos/trousers).
  // This prevents sensAdj or indoor-comfort boost from producing shorts at 12–15°C raw.
  // Gym occasion is exempt — gym shorts are destination clothing, not outdoor bottoms.
  const BOTTOMS_FLOOR_RAW_C = 15;

  const spec    = garmentSpec(input.occasion, destWarmBand, profile);
  // Override the bottom from spec when the floor applies
  const specBottom = input.occasion !== "gym" && rawMinApparentC <= BOTTOMS_FLOOR_RAW_C && /short/i.test(spec.bottom)
    ? garmentSpec(input.occasion, "cool", profile).bottom
    : spec.bottom;

  const usedIds = new Set<string>();

  // Wardrobe candidates: matchWardrobeItem handles style preference via its bonus score.
  const sortedWardrobe = wardrobeItems;

  // bottomsBand: cap at "cool" when raw outdoor temp is ≤ floor (no shorts at cool-raw temps)
  const bottomsBand: TempBand =
    input.occasion !== "gym" && rawMinApparentC <= BOTTOMS_FLOOR_RAW_C && destWarmBand === "warm"
      ? "cool"
      : destWarmBand;

  const matchTop    = matchWardrobeItem(spec.top,   sortedWardrobe, usedIds, destWarmBand, styleProfile?.stylePreferences);
  if (matchTop)    usedIds.add(matchTop.id);
  const matchBottom = matchWardrobeItem(specBottom, sortedWardrobe, usedIds, bottomsBand,  styleProfile?.stylePreferences);
  if (matchBottom) usedIds.add(matchBottom.id);

  const baseItems: PlannedItem[] = [
    {
      name:         matchTop    ? matchTop.name    : spec.top,
      wardrobeId:   matchTop    ? matchTop.id      : null,
      fromWardrobe: !!matchTop,
      reason:       `Appropriate for the destination (~${destMaxC.toFixed(0)} °C effective indoors)`,
    },
    {
      name:         matchBottom ? matchBottom.name : specBottom,
      wardrobeId:   matchBottom ? matchBottom.id   : null,
      fromWardrobe: !!matchBottom,
      reason:       rawMinApparentC <= BOTTOMS_FLOOR_RAW_C && /jean|trouser|chino|pant/i.test(specBottom)
        ? `Full-length bottoms required — outdoor apparent temperature is ~${rawMinApparentC.toFixed(0)} °C`
        : "Suitable for your occasion and conditions",
    },
  ];

  // ── Protection layers: driven by EXPOSURE track ──────────────────────────
  // departureLayers: must be WORN at departure (cold at departure)
  // carryLayers: OPTIONAL at departure but needed later (warm departure, colder later)
  const departureLayers: PlannedItem[] = [];
  const carryLayers:     PlannedItem[] = [];

  // Departure exposure: last slot at or before departure time.
  // coldAtDeparture uses raw apparent temperature (no sensAdj) so that "runs warm"
  // cannot suppress a departure layer at genuinely cold outdoor conditions.
  const expSlots = slice.slots;
  const deptSlotForLayer = [...expSlots].reverse().find(s => s.time <= input.departureTime) ?? expSlots[0];
  const deptRawApparentC = deptSlotForLayer ? deptSlotForLayer.apparentTempC : rawMinApparentC;
  const coldAtDeparture  = deptRawApparentC <= 15; // raw apparent floor — consistent with PROTECTION_FLOOR_RAW_C

  const expSwing = expMaxC - expMinC;

  // Use rawColdBand (raw-apparent, no sensAdj) to determine outer coat requirement.
  // A user who "runs warm" must still carry an outer coat in genuinely freezing/winter conditions.
  const outerCoat = outerCoatForBand(rawColdBand);
  if (outerCoat) {
    // Outer coat always required when raw-apparent band is winter/freezing
    // regardless of StyleProfile layeringPreference (safety override)
    const m = matchWardrobeItem(outerCoat, wardrobeItems, usedIds, rawColdBand);
    if (m) usedIds.add(m.id);
    const item: PlannedItem = {
      name:         m ? m.name : outerCoat,
      wardrobeId:   m ? m.id   : null,
      fromWardrobe: !!m,
      reason:       `Outdoor temperature is ~${rawMinApparentC.toFixed(0)} °C — required for commute and return`,
    };
    // Outer coat is always worn at departure (cold exposure requires it immediately)
    departureLayers.push(item);
  } else {
    // Check if a carry-layer is warranted by EXPOSURE track.
    // Use raw-apparent band for triggering so that "runs warm" (+sensAdj) cannot
    // suppress a layer when raw outdoor temperature is genuinely chilly/cool.
    const rawSwing        = rawMaxApparentC - rawMinApparentC;
    const rawWarmBand     = bandFor(rawMaxApparentC);
    const coldBandNeedsLayer = rawColdBand === "chilly" || rawColdBand === "cool";
    const needsLayer = rawSwing >= 4 || rawColdBand !== rawWarmBand || coldBandNeedsLayer;
    const layerName    = needsLayer ? layerForBand(rawColdBand, input.occasion, profile) : null;
    const wantsLayer   = layerName !== null;

    // StyleProfile layeringPreference can suppress OPTIONAL layers only when
    // raw outdoor apparent temperature is genuinely safe (> 15°C raw).
    // This prevents "runs warm" or "minimal" preference from removing minimum
    // cold-weather protection at genuinely cool/chilly raw temperatures.
    const PROTECTION_FLOOR_RAW_C = 15; // raw apparent above this → optional layer may be skipped
    const skipOptional = styleProfile?.layeringPreference === "minimal" && rawMinApparentC > PROTECTION_FLOOR_RAW_C;
    // StyleProfile "prefer" adds a layer if not already there and raw exposure is cool
    const addExtra     = styleProfile?.layeringPreference === "prefer" &&
      !wantsLayer && rawMinApparentC <= 15 && outerCoat === null;
    const finalLayer   = skipOptional ? null : (layerName ?? (addExtra ? "Light jacket" : null));

    if (finalLayer) {
      const m = matchWardrobeItem(finalLayer, wardrobeItems, usedIds, rawColdBand);
      if (m) usedIds.add(m.id);
      const item: PlannedItem = {
        name:         m ? m.name : finalLayer,
        wardrobeId:   m ? m.id   : null,
        fromWardrobe: !!m,
        reason:       rawSwing >= 4
          ? `~${rawSwing.toFixed(0)} °C outdoor swing — carry this for the cooler period`
          : `Outdoor apparent temperature may reach ~${rawMinApparentC.toFixed(0)} °C`,
      };
      // Classify: if cold at departure → departureLayers; if warm now but cold later → carryLayers
      if (coldAtDeparture) {
        departureLayers.push(item);
      } else {
        carryLayers.push(item);
      }
    }
  }

  // Derived alias for backward-compat (existing tests, store validation, ActivePlanCard)
  const removableLayers: PlannedItem[] = [...departureLayers, ...carryLayers];

  // Adaptation hint: when departure layer is worn, note it can be removed/opened indoors
  const adaptationHint: string | undefined =
    departureLayers.length > 0 && (input.context === "indoors" || input.context === "mixed")
      ? `Your ${departureLayers.map(l => l.name).join(" and ")} can be removed or opened once you're indoors.`
      : undefined;

  // ── Footwear: driven by EXPOSURE track (outdoor conditions) ─────────────
  const footwearName = footwearFor(exposureColdBand, input.occasion, profile, slice.hasRain, slice.hasSnow);
  const matchFoot    = matchWardrobeItem(footwearName, wardrobeItems, usedIds, exposureColdBand);
  if (matchFoot) usedIds.add(matchFoot.id);
  const footwear: PlannedItem[] = [{
    name:         matchFoot ? matchFoot.name : footwearName,
    wardrobeId:   matchFoot ? matchFoot.id   : null,
    fromWardrobe: !!matchFoot,
    reason:       slice.hasSnow ? "Snow expected"
                : slice.hasRain  ? "Rain likely — waterproof footwear recommended"
                : "Comfortable for your occasion",
  }];

  // ── Accessories ───────────────────────────────────────────────────────────
  const accessories: PlannedItem[] = [];

  if (needsUmbrella) {
    accessories.push({
      name: "Umbrella", wardrobeId: null, fromWardrobe: false,
      reason: hasActiveRainCode
        ? "Rain is actively forecast — carry one for all legs of travel"
        : `${slice.peakPrecipProb}% rain probability — bring one for travel legs`,
    });
  }

  // Gloves required whenever outdoor exposure is sub-zero,
  // regardless of destination context — the commute still happens.
  if (exposureColdBand === "freezing" || exposureColdBand === "winter") {
    accessories.push({
      name: "Gloves", wardrobeId: null, fromWardrobe: false,
      reason: "Sub-zero outdoor temperatures — gloves required for commute and travel legs",
    });
  }

  // Issue 6 / Bug 3: Wind protection for commute legs, even for indoor destinations.
  // An indoor destination does not mean the user teleports there —
  // walking or transit commutes still expose them to outdoor wind.
  // commuteMode="drive" reduces (but does not eliminate) exposure.
  // Only skip wind protection when: existing layer already present, OR
  // driving commute with mild wind below an elevated threshold.
  //
  // needsWindProtection is the single authoritative decision — used for both
  // the accessories list AND buildExplanation wind text.
  const hasAdequateLayer     = removableLayers.length > 0;
  const drivingNoExtraNeeded =
    styleProfile?.commuteMode === "drive" && slice.maxWindKph < windThreshold + 10;
  const needsWindProtection  = isWindyForUser && !hasAdequateLayer && !drivingNoExtraNeeded;

  // Compute the explicit wind reason for accurate explanation text (Bug 3).
  const windReason: WindReason =
    !isWindyForUser            ? "not_windy"        :
    needsWindProtection        ? "windbreaker_added" :
    hasAdequateLayer           ? "layer_adequate"   :
    /* drivingNoExtraNeeded */   "driving_reduced";

  if (needsWindProtection) {
    accessories.push({
      name: "Windbreaker", wardrobeId: null, fromWardrobe: false,
      reason: `Wind speed up to ${slice.maxWindKph} km/h — a wind layer helps for travel legs`,
    });
  }

  const timeline = buildTimeline(
    input.departureTime, effectiveReturn, summary,
    slice.slots, departureLayers, carryLayers, sensAdj, expMinC, styleProfile, needsUmbrella,
  );
  const explanation = buildExplanation(prefs, input.activity, input.context, summary, styleProfile, needsUmbrella, windReason);

  return {
    coverageStart:              input.departureTime,
    coverageEnd:                effectiveReturn,
    locationLabel:              input.locationLabel,
    locationLat:                slice.lat,
    locationLon:                slice.lon,
    occasion:                   input.occasion,
    baseItems,
    departureLayers,
    carryLayers,
    removableLayers,
    adaptationHint,
    footwear,
    accessories,
    timelineGuidance:           timeline,
    weatherSummary:             summary,
    personalizationExplanation: explanation,
    generatedAt:                new Date().toISOString(),
    recommendationVersion:      OUTING_PLAN_VERSION,
  };
}
