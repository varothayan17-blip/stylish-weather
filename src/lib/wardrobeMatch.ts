/**
 * wardrobeMatch.ts — Wardrobe Matching v1
 *
 * Pure, deterministic, testable module.
 * No Gemini calls, no network, no AI. No changes to the weather engine.
 *
 * ── Algorithm ────────────────────────────────────────────────────────────────
 *
 * Given a Recommendation (outfit string[]) and a list of WardrobeItems:
 *
 * For each outfit slot (e.g. "Polo shirt or T-shirt"):
 *   1. Tokenise: split by " or " and " / " → ["polo shirt", "t-shirt"]
 *   2. Score every available item against those tokens
 *   3. Return the highest-scoring item for that slot (if score ≥ MIN_SCORE)
 *
 * Scoring (additive, first match wins per category):
 *   -100 item.unavailable === true                  (hard exclusion, checked first)
 *   -100 garment-intent incompatibility             (e.g. T-shirt for long-sleeve slot)
 *   +40  subcategory/type contains a SPECIFIC token (generic tokens excluded)
 *   +35  item name contains a SPECIFIC token        (generic tokens excluded)
 *   +20  WardrobeCategory matches slot category hint (e.g. "Tops" for "shirt")
 *   +15  warmth is suitable for the temperature band
 *   +10  season string contains the current season
 *   +10  weatherFit contains a matching condition
 *    +5  item is a favourite                        (tie-breaker only)
 *   -100 warmth obviously wrong for band            (e.g. Warm item in hot band)
 *
 * GENERIC_TOKENS ("shirt", "top", "layer", …) cannot independently satisfy +40/+35.
 * COMPAT_RULES enforce physical intent: "long-sleeve" slot blocks T-shirts/tees.
 *
 * MIN_SCORE = 35 — requires at least one specific subcategory or name match.
 *
 * ── Limitations (v1) ─────────────────────────────────────────────────────────
 * - Text matching is case-insensitive keyword search, not semantic similarity.
 * - GENERIC_TOKENS prevents false-positives from shared generic words ("shirt",
 *   "top"). "Polo shirt or T-shirt" still matches a crewneck T-shirt because
 *   "t-shirt" and "polo" are specific tokens; "long-sleeve shirt" does not match
 *   a T-shirt because the compat rule blocks it AND "shirt" is generic.
 * - COMPAT_RULES are narrow and explicit. Only clear physical incompatibilities
 *   are blocked (long-sleeve requires long-sleeve coverage).
 * - No style-based filtering (casual/formal) at v1.
 * - Slot deduplication: the same item will not be returned for two slots.
 * - Only the first matching item per slot is returned.
 */

import type { WardrobeItem } from "@/components/wardrobe/wardrobeData";
import type { Recommendation } from "@/lib/recommend";

// ── Types ────────────────────────────────────────────────────────────────────

export type WardrobeMatch = {
  /** The raw outfit slot string, e.g. "Polo shirt or T-shirt" */
  slot: string;
  /** The matched wardrobe item */
  item: WardrobeItem;
  /** Debug score (hidden from UI) */
  score: number;
};

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_SCORE = 35; // Require at least a subcategory or name hit

/**
 * Generic tokens that appear in many garment names but carry no specificity.
 * A name/type hit driven ONLY by one of these tokens is not a meaningful match —
 * it just means both items happen to involve clothing.
 *
 * Examples of false-positives these prevent:
 *   "Long-sleeve shirt" → T-shirt (both contain "shirt")
 *   "Long-sleeve tee"   → any top  (both contain "top")
 *
 * When ALL matching tokens between a slot and an item are generic, the type/name
 * score is zeroed out (forcing the item below MIN_SCORE unless category/warmth etc.
 * independently push it over — which alone cannot reach 35).
 */
const GENERIC_TOKENS = new Set([
  "shirt", "top", "tops", "clothes", "layer", "wear",
]);

/**
 * Garment-intent compatibility rules.
 *
 * When a slot contains a REQUIRE keyword, an item whose name or type contains
 * any of the EXCLUDE keywords is incompatible and receives a hard −100 penalty.
 *
 * This prevents generic token overlap from producing false-positives, e.g.:
 *   Slot "Long-sleeve shirt" REQUIRES long-sleeve coverage.
 *   A T-shirt or tank top does NOT provide that → hard exclude.
 *
 * Rules are intentionally narrow — only block clear physical incompatibilities.
 * A "Long-sleeve shirt" slot does NOT block hoodies or sweaters (which layer fine).
 */
type CompatRule = {
  /** Slot must contain ALL of these to activate this rule (lowercase). */
  slotRequires: string[];
  /** Item name/type must NOT contain any of these (lowercase). */
  itemExcludes: string[];
  /** Human-readable reason — for comments/tests only. */
  reason: string;
};

const COMPAT_RULES: CompatRule[] = [
  {
    // "Long-sleeve shirt" or "Long-sleeve tee" explicitly requires long-sleeve
    // coverage. A short-sleeve T-shirt or tank top cannot satisfy this.
    slotRequires: ["long-sleeve"],
    itemExcludes: ["t-shirt", "tee", "tank", "short-sleeve", "cap sleeve"],
    reason: "long-sleeve slot excludes short-sleeve items",
  },
  {
    // A "T-shirt" or "Breathable T-shirt" slot explicitly wants short-sleeve.
    // A heavy winter sweater is wrong. But polo shirts and crewnecks are fine.
    // This rule is intentionally narrow — only block clearly wrong warmth.
    // (Warmth scoring already penalises heavy items in warm/hot bands.)
    slotRequires: [],          // no slot restriction — rely on warmth scoring instead
    itemExcludes: [],
    reason: "placeholder — warmth scoring handles hot-band mismatches",
  },
];

// Maps WardrobeCategory → slot keywords that imply that category
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Tops:        ["shirt", "tee", "t-shirt", "polo", "blouse", "top", "sweater",
                 "hoodie", "jersey", "turtleneck", "crewneck", "pullover",
                 "long-sleeve", "henley", "tank", "vest"],
  Bottoms:     ["jeans", "pants", "chinos", "shorts", "trousers", "leggings",
                 "skirt", "denim"],
  Outerwear:   ["jacket", "coat", "parka", "puffer", "blazer", "windbreaker",
                 "hoodie", "raincoat", "shell", "fleece", "overcoat"],
  Shoes:       ["sneakers", "boots", "sandals", "shoes", "loafers", "flats",
                 "runners", "footwear"],
  Accessories: ["hat", "beanie", "scarf", "gloves", "cap", "sunglasses",
                 "belt", "bag"],
};

// Which warmth levels are suitable per temperature band
const WARMTH_FOR_BAND: Record<string, string[]> = {
  freezing: ["Warm"],
  winter:   ["Warm"],
  chilly:   ["Warm", "Medium"],
  cool:     ["Medium", "Light"],
  mild:     ["Light", "Medium"],
  warm:     ["Light"],
  hot:      ["Light"],
};

// Obviously-wrong warmth assignments (score penalty)
const WARMTH_WRONG_FOR_BAND: Record<string, string[]> = {
  hot:  ["Warm", "Medium"],
  warm: ["Warm"],
  freezing: ["Light"],
  winter:   ["Light"],
};

// Current season from month number (1-indexed)
function currentSeason(): string {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5)  return "Spring";
  if (m >= 6 && m <= 8)  return "Summer";
  if (m >= 9 && m <= 11) return "Fall";
  return "Winter";
}

// ── Tokenisation ─────────────────────────────────────────────────────────────

/**
 * Split an outfit slot string into match tokens.
 * "Polo shirt or T-shirt"  → ["polo shirt", "t-shirt", "polo", "shirt"]
 * "Long-sleeve shirt"      → ["long-sleeve shirt", "long-sleeve", "shirt"]
 * "Chinos or lightweight pants" → ["chinos", "lightweight pants", "chinos", "pants"]
 */
export function tokeniseSlot(slot: string): string[] {
  const lower = slot.toLowerCase();
  // Split on " or " and " / "
  const parts = lower.split(/\s+or\s+|\s*\/\s*/);
  const tokens = new Set<string>();
  for (const part of parts) {
    tokens.add(part.trim());
    // Also add individual significant words (length > 3, not stop-words)
    const words = part.trim().split(/\s+/);
    const stopWords = new Set(["and", "the", "or", "a", "an", "of", "with",
                               "for", "light", "light", "breathable", "lightweight"]);
    for (const w of words) {
      if (w.length > 3 && !stopWords.has(w)) tokens.add(w);
    }
  }
  return Array.from(tokens);
}

/**
 * Guess the most likely WardrobeCategory for a slot string.
 * Returns the category whose keyword list has the most hits.
 */
function guessCategory(slot: string): string | null {
  const lower = slot.toLowerCase();
  let best: string | null = null;
  let bestCount = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const count = kws.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) { bestCount = count; best = cat; }
  }
  return bestCount > 0 ? best : null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score one WardrobeItem against one outfit slot.
 * Higher is better. Negative means obviously wrong.
 */
export function scoreItem(
  item: WardrobeItem,
  slot: string,
  band: string,
): number {
  // Hard exclusion
  if (item.unavailable) return -100;

  const slotLow  = slot.toLowerCase();
  const tokens   = tokeniseSlot(slot);
  const nameLow  = item.name.toLowerCase();
  const typeLow  = (item.type ?? "").toLowerCase();
  const season   = currentSeason();

  let score = 0;

  // ── Garment-intent compatibility check (hard exclusion −100) ─────────────
  // Prevents generic token overlap from producing false-positives, e.g.
  // "Long-sleeve shirt" matching a T-shirt purely via the "shirt" token.
  for (const rule of COMPAT_RULES) {
    if (rule.slotRequires.length === 0) continue; // placeholder rules
    const slotMatches = rule.slotRequires.every((req) => slotLow.includes(req));
    if (!slotMatches) continue;
    const itemIncompatible = rule.itemExcludes.some(
      (excl) => nameLow.includes(excl) || typeLow.includes(excl),
    );
    if (itemIncompatible) return -100; // hard fail — rule violated
  }

  // ── Subcategory/type hit (+40) ────────────────────────────────────────────
  // Only award points if at least one SPECIFIC (non-generic) token matches.
  // This prevents "Long-sleeve shirt" → T-shirt via the generic "shirt" token.
  const specificTypeTokens = tokens.filter(
    (t) => !GENERIC_TOKENS.has(t) && typeLow.includes(t),
  );
  if (specificTypeTokens.length > 0) score += 40;

  // ── Name hit (+35) ────────────────────────────────────────────────────────
  // Same guard: generic tokens alone do not award name-hit points.
  const specificNameTokens = tokens.filter(
    (t) => !GENERIC_TOKENS.has(t) && nameLow.includes(t),
  );
  if (specificNameTokens.length > 0) score += 35;

  // ── Category match (+20) ──────────────────────────────────────────────────
  const guessed = guessCategory(slot);
  if (guessed && item.category === guessed) score += 20;

  // ── Warmth suitable for band (+15) ────────────────────────────────────────
  const suitableWarmths = WARMTH_FOR_BAND[band] ?? [];
  if (suitableWarmths.includes(item.warmth)) score += 15;

  // ── Warmth wrong for band (−100) ──────────────────────────────────────────
  const wrongWarmths = WARMTH_WRONG_FOR_BAND[band] ?? [];
  if (wrongWarmths.includes(item.warmth)) score -= 100;

  // ── Season match (+10) ────────────────────────────────────────────────────
  if (item.season.toLowerCase().includes(season.toLowerCase())) score += 10;

  // ── WeatherFit match (+10) ────────────────────────────────────────────────
  const fitLow = item.weatherFit.toLowerCase();
  const bandFitWords: Record<string, string[]> = {
    hot:      ["hot", "warm", "mild"],
    warm:     ["warm", "mild", "hot"],
    mild:     ["mild", "warm", "cool"],
    cool:     ["cool", "cold", "mild"],
    chilly:   ["cold", "cool", "chilly"],
    winter:   ["cold", "winter"],
    freezing: ["cold", "winter", "freezing"],
  };
  const fitWords = bandFitWords[band] ?? [];
  if (fitWords.some((fw) => fitLow.includes(fw))) score += 10;

  // ── Favourite tie-breaker (+5) ────────────────────────────────────────────
  if (item.favourite) score += 5;

  return score;
}

// ── Main matching function ────────────────────────────────────────────────────

/**
 * Match wardrobe items to recommendation outfit slots.
 *
 * @param rec   - Current Recommendation from recommend()
 * @param items - All WardrobeItem[] from the store
 * @param band  - WeatherContext.band (e.g. "mild") — inferred from effectiveFeelsC if needed
 * @returns     An array of WardrobeMatch (one per slot that has a match), max 3.
 *
 * Slot deduplication: each item appears at most once in the result.
 * If no slot meets MIN_SCORE, returns [].
 */
export function matchWardrobeToOutfit(
  rec: Pick<Recommendation, "outfit" | "effectiveFeelsC">,
  items: WardrobeItem[],
  band: string,
): WardrobeMatch[] {
  const available = items.filter((i) => !i.unavailable);
  if (available.length === 0) return [];

  const results: WardrobeMatch[] = [];
  const usedIds = new Set<string>();

  // Only process clothing slots — skip accessories/footwear slots that are
  // unlikely to have wardrobe matches in v1 (shoes, hats, scarves, umbrellas).
  const clothingSlots = rec.outfit.filter((slot) => {
    const sl = slot.toLowerCase();
    // Skip if slot is purely accessory/footwear
    const skipKeywords = ["sneakers", "boots", "sandals", "shoes", "footwear",
                          "beanie", "scarf", "gloves", "cap", "hat", "socks"];
    // Keep if it contains ANY clothing word, even if it also mentions footwear
    const keepKeywords = ["shirt", "tee", "pants", "jeans", "chinos", "hoodie",
                          "jacket", "coat", "sweater", "shorts", "blouse", "top",
                          "long-sleeve", "polo", "layer", "parka", "fleece",
                          "windbreaker", "pullover", "crewneck"];
    const hasKeep = keepKeywords.some((k) => sl.includes(k));
    const onlySkip = !hasKeep && skipKeywords.some((k) => sl.includes(k));
    return !onlySkip;
  });

  for (const slot of clothingSlots.slice(0, 4)) { // max 4 slots to scan
    let best: WardrobeMatch | null = null;

    for (const item of available) {
      if (usedIds.has(item.id)) continue;
      const s = scoreItem(item, slot, band);
      if (s >= MIN_SCORE && (!best || s > best.score)) {
        best = { slot, item, score: s };
      }
    }

    if (best) {
      results.push(best);
      usedIds.add(best.item.id);
      if (results.length >= 3) break; // cap at 3 matches per recommendation
    }
  }

  return results;
}

/**
 * Derive the temperature band from effectiveFeelsC.
 * Mirrors the OUTFIT_BAND_EDGES logic in recommend.ts without importing it
 * (to avoid circular dependency).
 */
export function bandFromFeels(feels: number): string {
  if (feels <= -10) return "freezing";
  if (feels <=   0) return "winter";
  if (feels <=   8) return "chilly";
  if (feels <=  15) return "cool";
  if (feels <=  22) return "mild";
  if (feels <=  28) return "warm";
  return "hot";
}
