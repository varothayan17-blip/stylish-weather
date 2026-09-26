/**
 * Wardrobe AI — MOCK DATA ONLY.
 *
 * This module is purely presentational demo data for the Wardrobe UI.
 * It does NOT touch Firestore, Firebase Storage, Stripe, entitlements,
 * notifications, or the weather/recommendation engines.
 */

export type WardrobeCategory = "Tops" | "Bottoms" | "Outerwear" | "Shoes" | "Accessories";

export const CATEGORIES: WardrobeCategory[] = [
  "Tops",
  "Bottoms",
  "Outerwear",
  "Shoes",
  "Accessories",
];

export type Warmth = "Light" | "Medium" | "Warm";

export type WardrobeItem = {
  id: string;
  name: string;
  category: WardrobeCategory;
  /** Sub-type shown on the detail screen, e.g. "Top / Hoodie". */
  type: string;
  color: string;
  warmth: Warmth;
  /** Short human weather fit, e.g. "Cool / cold". */
  weatherFit: string;
  waterResistance: "Low" | "Medium" | "High";
  style: string;
  season: string;
  /** Two short chips shown on the grid card. */
  labels: string[];
  /** Tailwind gradient classes used for the mock "photo" tile. */
  tint: string;
  favourite?: boolean;
  unavailable?: boolean;
  /** Full AI analysis attached when item was scanned via AI. */
  aiAnalysis?: import("@/lib/wardrobe-types").ClothingAnalysis;
};

export const SEED_ITEMS: WardrobeItem[] = [
  {
    id: "hoodie-black",
    name: "Black hoodie",
    category: "Tops",
    type: "Top / Hoodie",
    color: "Black",
    warmth: "Medium",
    weatherFit: "Cool / cold",
    waterResistance: "Low",
    style: "Casual",
    season: "Fall / Winter",
    labels: ["Medium warmth", "Casual"],
    tint: "from-slate-700/70 to-slate-900/80",
  },
  {
    id: "tee-white",
    name: "White T-shirt",
    category: "Tops",
    type: "Top / T-shirt",
    color: "White",
    warmth: "Light",
    weatherFit: "Mild / warm",
    waterResistance: "Low",
    style: "Casual",
    season: "Spring / Summer",
    labels: ["Lightweight", "Casual"],
    tint: "from-white/80 to-slate-200/70",
  },
  {
    id: "jeans-blue",
    name: "Blue jeans",
    category: "Bottoms",
    type: "Bottom / Denim",
    color: "Blue",
    warmth: "Medium",
    weatherFit: "Cool / mild",
    waterResistance: "Low",
    style: "Casual",
    season: "All season",
    labels: ["Medium warmth", "Casual"],
    tint: "from-sky-600/60 to-indigo-800/70",
  },
  {
    id: "jacket-waterproof",
    name: "Black waterproof jacket",
    category: "Outerwear",
    type: "Outerwear / Shell",
    color: "Black",
    warmth: "Warm",
    weatherFit: "Cold / rain",
    waterResistance: "High",
    style: "Practical",
    season: "Fall / Winter",
    labels: ["Water resistant", "Warm"],
    tint: "from-zinc-700/70 to-zinc-950/80",
  },
  {
    id: "sneakers-white",
    name: "White sneakers",
    category: "Shoes",
    type: "Shoes / Sneakers",
    color: "White",
    warmth: "Light",
    weatherFit: "Dry days",
    waterResistance: "Low",
    style: "Casual",
    season: "Spring / Summer",
    labels: ["Light", "Casual"],
    tint: "from-white/80 to-zinc-300/70",
  },
  {
    id: "boots-black",
    name: "Black boots",
    category: "Shoes",
    type: "Shoes / Boots",
    color: "Black",
    warmth: "Warm",
    weatherFit: "Cold / wet",
    waterResistance: "High",
    style: "Practical",
    season: "Fall / Winter",
    labels: ["Warm", "Rain friendly"],
    tint: "from-neutral-700/70 to-neutral-950/80",
  },
];

/**
 * DEV-ONLY mock scan result.
 * The real Add clothing flow now uses /api/wardrobe/scan (Anthropic Claude AI).
 * This is ONLY used as a skeleton shape reference in the confirm form.
 * It is never returned by production AI analysis.
 */
export const MOCK_SCAN_RESULT: Omit<WardrobeItem, "id"> = {
  name: "Black hoodie",
  category: "Tops",
  type: "Top / Hoodie",
  color: "Black",
  warmth: "Medium",
  weatherFit: "Cool / cold",
  waterResistance: "Low",
  style: "Casual",
  season: "Fall / Winter",
  labels: ["Medium warmth", "Casual"],
  tint: "from-slate-700/70 to-slate-900/80",
};

/**
 * VISUAL DEMO ONLY — a hand-picked "outfit" for the Today's picks strip.
 * Deliberately not wired to the real weather recommendation engine.
 */
export const TODAY_PICK_IDS = [
  "jacket-waterproof",
  "tee-white",
  "jeans-blue",
  "sneakers-white",
];
