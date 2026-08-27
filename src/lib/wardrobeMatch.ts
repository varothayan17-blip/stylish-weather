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
 * MIN_SCORE = 40 — requires at least one specific text match (type or name).
 *   category+warmth (35) alone is insufficient to avoid category-only false
 *   positives like a hoodie matching a "Long-sleeve shirt" slot.
 *
 * ── Limitations (v1) ─────────────────────────────────────────────────────────
 * - Text matching is case-insensitive keyword search, not semantic similarity.
 * - GENERIC_TOKENS prevents false-positives from shared generic words ("shirt",
 *   "top"). "Polo shirt or T-shirt" still matches a crewneck T-shirt because
 *   "t-shirt" and "polo" are specific tokens; "long-sleeve shirt" does not match
 *   a T-shirt because the compat rule blocks it AND "shirt" is generic.
 * - COMPAT_RULES are narrow and explicit. Only clear physical incompatibilities
 *   are blocked (long-sleeve requires long-sleeve coverage).
 * - Cross-category guard (name-bleed + type-ambiguity): when the slot's guessed
 *   category differs from item.category AND the slot has no keyword for item.category,
 *   both name-token and type-token matches are rejected. Compound slots (e.g.
 *   "Fleece hoodie", "Light jacket or hoodie") pass because they contain keywords
 *   for both categories. Uses item.category (server-controlled) only.
 * - "sweater" COMPAT_RULE: belt-and-suspenders for sweater slots — ensures even
 *   direct Outerwear items cannot satisfy sweater-specific slots.
 * - No style-based filtering (casual/formal) at v1.
 * - Slot deduplication: the same item will not be returned for two slots.
 * - Only the first matching item per slot is returned.
 */

import type { WardrobeItem } from "@/components/wardrobe/wardrobeData";
import type { Recommendation } from "@/lib/recommend";

// ── Shared navigation constant ───────────────────────────────────────────────

/**
 * sessionStorage key used by OutfitSlotList to tell wardrobe.tsx which item
 * to open in the ItemDetailSheet after navigating to /wardrobe.
 * Kept here (the shared matching module) so no UI component file needs to be
 * imported solely for a string constant.
 */
export const WARDROBE_OPEN_ITEM_KEY = "aeruvo:wardrobe:open-item";

// ── Types ────────────────────────────────────────────────────────────────────

export type WardrobeMatch = {
  /** The raw outfit slot string, e.g. "Polo shirt or T-shirt" */
  slot: string;
  /** Index into rec.outfit[] that this match corresponds to */
  slotIndex: number;
  /** The matched wardrobe item */
  item: WardrobeItem;
  /** Debug score (hidden from UI) */
  score: number;
};

/**
 * Slot-indexed map from outfit slot index → WardrobeMatch.
 * Used by the slot-replacement UI to substitute specific item names
 * directly into each outfit bullet while preserving slot order.
 */
export type SlotMatchMap = Map<number, WardrobeMatch>;

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_SCORE = 40; // Require at least one specific text match.
// Items with no specific text token match return 0 (early exit before this point).
// Genuine matches have type/name hits: type(40)+cat(20)+warmth(15)+season(10)=85 minimum.

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
  /** If set: item.category must equal this value or the item is rejected (−100). */
  itemMustBeCategory?: string;
  /** If set: rule only activates when guessCategory(slot) === this value. */
  slotCategory?: string;
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
    // Footwear slots must only match Shoes category items.
    // Prevents a Tops/Bottoms item from satisfying a "Sneakers" slot even if
    // its name happened to contain the word "sneakers" or "shoes".
    slotRequires: [],
    itemExcludes: [],
    slotCategory: "Shoes",
    itemMustBeCategory: "Shoes",
    reason: "footwear slot must match Shoes category items only",
  },
  {
    // "Sweater" slots (Fleece sweater, Heavy sweater, Turtleneck or sweater)
    // are Tops slots. An Outerwear fleece jacket is not a sweater substitute.
    // The token "fleece" appears in both CATEGORY_KEYWORDS.Tops and .Outerwear,
    // which otherwise produces a false type-hit for Outerwear on sweater slots.
    slotRequires: ["sweater"],
    itemExcludes: [],
    slotCategory: "Tops",
    itemMustBeCategory: "Tops",
    reason: "sweater slot requires Tops category items",
  },
];

// Maps WardrobeCategory → slot keywords that imply that category
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Tops:        ["shirt", "tee", "t-shirt", "polo", "blouse", "top", "sweater",
                 "hoodie", "jersey", "turtleneck", "crewneck", "pullover",
                 "long-sleeve", "henley", "tank", "vest", "cardigan"],
  Bottoms:     ["jeans", "pants", "chinos", "shorts", "trousers", "leggings",
                 "skirt", "denim"],
  Outerwear:   ["jacket", "coat", "parka", "puffer", "blazer", "windbreaker",
                 "hoodie", "raincoat", "shell", "fleece", "overcoat"],
  Shoes:       ["sneakers", "trainers", "runners", "boots", "sandals", "shoes",
                 "loafers", "flats", "footwear"],
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

// ── Category-keyword helper ───────────────────────────────────────────────────

/**
 * Return true if the slot string contains at least one keyword from
 * CATEGORY_KEYWORDS[category].
 *
 * Used by the cross-category name-bleed guard: if a slot has no keyword
 * for the item's stored category, a pure name-token match is rejected.
 * This uses item.category (server-controlled) — never the user-supplied name.
 *
 * Examples:
 *   slotContainsCategoryKeyword("Waterproof jacket", "Shoes")     → false
 *   slotContainsCategoryKeyword("Boots or sneakers",  "Shoes")    → true
 *   slotContainsCategoryKeyword("Light jacket or hoodie", "Tops") → true  (hoodie)
 *   slotContainsCategoryKeyword("Waterproof jacket", "Tops")      → false
 */
function slotContainsCategoryKeyword(slot: string, category: string): boolean {
  const kws = CATEGORY_KEYWORDS[category];
  if (!kws) return true; // unknown category → do not block
  const lower = slot.toLowerCase();
  return kws.some((kw) => lower.includes(kw));
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
    // Text requirement: all slotRequires words must appear in the slot
    const textOk =
      rule.slotRequires.length === 0 ||
      rule.slotRequires.every((req) => slotLow.includes(req));
    // Category requirement: slot must classify as slotCategory (if set)
    const catOk =
      !rule.slotCategory ||
      guessCategory(slot) === rule.slotCategory;
    if (!textOk || !catOk) continue;

    // Check name/type exclusions
    if (rule.itemExcludes.some((excl) => nameLow.includes(excl) || typeLow.includes(excl))) {
      return -100;
    }
    // Check category requirement
    if (rule.itemMustBeCategory && item.category !== rule.itemMustBeCategory) {
      return -100;
    }
  }

  // ── Specific-token gate ───────────────────────────────────────────────────
  // At least one specific (non-generic) token must match the item's type or
  // name before any positive score is awarded. Without this gate, an item
  // could score category(20) + warmth(15) + season(10) = 45 and pass
  // MIN_SCORE=40 solely via auxiliary signals with NO textual evidence of
  // compatibility — e.g. a T-shirt for a "Hoodie" slot in Summer.
  const specificTypeTokens = tokens.filter(
    (t) => !GENERIC_TOKENS.has(t) && typeLow.includes(t),
  );
  const specificNameTokens = tokens.filter(
    (t) => !GENERIC_TOKENS.has(t) && nameLow.includes(t),
  );
  if (specificTypeTokens.length === 0 && specificNameTokens.length === 0) {
    // No textual evidence of compatibility → skip this item entirely
    return 0;
  }

  // ── Cross-category guard (name-bleed and type-token ambiguity) ──────────
  //
  // NAME-BLEED: a user can name their item with words from a different-category
  // slot (e.g. Shoes item named "My waterproof boots" → "waterproof" matches
  // "Waterproof jacket" slot, scoring +35 name + +15 warmth = 50).
  // Fix: if the ONLY evidence is a name token and the slot has no keyword for
  // item.category, reject the match.
  //
  // TYPE-AMBIGUITY: some type tokens appear in CATEGORY_KEYWORDS for multiple
  // categories (e.g. "fleece" is an Outerwear keyword). A Tops/Fleece item
  // (type="Fleece") gets a type-token hit on "Fleece jacket" slots even though
  // a Tops fleece pullover is not a jacket substitute.
  // Fix: if ALL type-token hits come from tokens that carry no keyword for
  // item.category in this slot, AND the slot's guessed category is known and
  // different from item.category, reject. Compound slots pass because they
  // contain keywords for both categories (e.g. "Fleece hoodie" has "hoodie"
  // which IS a Tops keyword).
  //
  // Both checks use item.category (server-controlled), never item.name.
  if (specificTypeTokens.length === 0 && specificNameTokens.length > 0) {
    // Pure name-driven match
    if (!slotContainsCategoryKeyword(slot, item.category)) {
      return 0;
    }
  }

  if (specificTypeTokens.length > 0) {
    // Type-token hit: check whether the slot is actually for this item's category.
    const slotGuessedCat = guessCategory(slot);
    if (slotGuessedCat && slotGuessedCat !== item.category) {
      // The slot guesses a different category. Only allow if the slot ALSO contains
      // a keyword for the item's category (legitimate compound slot).
      if (!slotContainsCategoryKeyword(slot, item.category)) {
        return 0;
      }
    }
  }

  // ── Subcategory/type hit (+40) ────────────────────────────────────────────
  if (specificTypeTokens.length > 0) score += 40;

  // ── Name hit (+35) ────────────────────────────────────────────────────────
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

  // Slot filter:
  //   skipKeywords — pure-accessory slots with no wardrobe-match support.
  //   keepKeywords — words that confirm a slot should be scored.
  // Footwear (sneakers, boots, shoes…) is now in keepKeywords so footwear
  // slots pass through to the scorer. The compat rule + specific-token gate
  // ensure only Shoes category items with matching names/types can score them.
  const skipKeywords = ["beanie", "scarf", "gloves", "hat", "socks",
                        "umbrella", "sunscreen", "sunglasses"];
  const keepKeywords = ["shirt", "tee", "pants", "jeans", "chinos", "hoodie",
                        "jacket", "coat", "sweater", "shorts", "blouse", "top",
                        "long-sleeve", "polo", "layer", "parka", "fleece",
                        "windbreaker", "pullover", "crewneck",
                        "sneakers", "trainers", "runners", "boots", "shoes",
                        "sandals", "loafers", "flats"];
  // Carry original index so the UI can do in-place slot replacement.
  const clothingSlots = rec.outfit
    .map((slot, i) => ({ slot, originalIndex: i }))
    .filter(({ slot }) => {
      const sl = slot.toLowerCase();
      const hasKeep = keepKeywords.some((k) => sl.includes(k));
      const onlySkip = !hasKeep && skipKeywords.some((k) => sl.includes(k));
      return !onlySkip;
    });

  for (const { slot, originalIndex } of clothingSlots.slice(0, 5)) { // max 5 (clothing + footwear)
    let best: WardrobeMatch | null = null;

    for (const item of available) {
      if (usedIds.has(item.id)) continue;
      const s = scoreItem(item, slot, band);
      if (s >= MIN_SCORE && (!best || s > best.score)) {
        best = { slot, slotIndex: originalIndex, item, score: s };
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
 * Returns a Map from outfit slot index → WardrobeMatch for slot-replacement UI.
 *
 * Premium UI uses this to substitute specific saved item names directly into
 * each outfit bullet (e.g. slot 0 "Long-sleeve shirt" → "Your Navy hoodie")
 * while preserving slot order and leaving unmatched slots as generic text.
 *
 * Same deduplication rules as matchWardrobeToOutfit: one item per slot.
 */
export function slotMatchMap(
  rec: Pick<Recommendation, "outfit" | "effectiveFeelsC">,
  items: WardrobeItem[],
  band: string,
): SlotMatchMap {
  const matches = matchWardrobeToOutfit(rec, items, band);
  const map: SlotMatchMap = new Map();
  for (const m of matches) {
    map.set(m.slotIndex, m);
  }
  return map;
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
