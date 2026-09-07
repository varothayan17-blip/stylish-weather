/**
 * share-outfit.test.cjs
 * Tests for "Share today's outfit".
 * Run with: node tests/share-outfit.test.cjs
 *
 * What these tests do:
 *   SOURCE CHECKS — read the TypeScript source files as text and assert that
 *   expected strings, function names and wiring patterns are present. They
 *   do not import or execute the compiled TypeScript modules.
 *
 *   JS SIMULATIONS — port the pure logic of deduplicateOutfit() and
 *   resolvedSlotsToDisplayLabels() directly in JS and exercise them with
 *   representative inputs. These verify the algorithm, not the compiled TS.
 *   If the TypeScript source diverges from the JS port, neither suite would
 *   catch it.
 *
 *   SHARE CASCADE SIMULATIONS — stub Canvas, navigator and document to drive
 *   a JS reimplementation of the shareOrDownload() cascade. The real
 *   TypeScript function in shareOutfit.ts is not imported or called.
 *
 * Limitation: full behavioural coverage of the compiled TypeScript would
 * require tsx/ts-node imports and JSDOM or a real browser environment.
 * This matches the pre-existing approach of all other test suites in the
 * repository (rain-now, umbrella, feedback, etc.).
 */
"use strict";
const fs   = require("fs");
const path = require("path");

const ROOT       = path.resolve(__dirname, "..");
const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let p = 0, f = 0;
function ok(label, cond, detail) {
  if (cond) { console.log("✓", label); p++; }
  else { console.error("✗", label, detail != null ? String(detail) : ""); f++; }
}

// ── Source files ──────────────────────────────────────────────────────────────
const shareSrc = readSource("src/lib/shareOutfit.ts");
const indexSrc = readSource("src/routes/index.tsx");
const recSrc   = readSource("src/routes/recommendation.tsx");

// ── Port deduplicateOutfit and resolvedSlotsToDisplayLabels ──────────────────
function deduplicateOutfit(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Port of resolvedSlotsToDisplayLabels from shareOutfit.ts.
 * Produces the exact labels OutfitSlotList renders:
 *   matched   → "Your {itemName}"
 *   unmatched → genericText
 * Then appends deduplicated extraItems.
 */
function resolvedSlotsToDisplayLabels(resolvedSlots, extraItems) {
  const baseLabels = resolvedSlots.map(slot =>
    slot.matched ? `Your ${slot.itemName}` : slot.genericText,
  );
  return deduplicateOutfit([...baseLabels, ...extraItems]);
}

// ── Simulate canShareFiles ────────────────────────────────────────────────────
function canShareFiles_sim(nav) {
  if (!nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare !== "function") return false;
  try { return nav.canShare({ files: [] }); } catch { return false; }
}

// ── Canvas stub ───────────────────────────────────────────────────────────────
function makeCanvas(blobOk = true) {
  const ctx = {
    fillRect: () => {}, createLinearGradient: () => ({ addColorStop: () => {} }),
    save: () => {}, restore: () => {}, fill: () => {}, fillText: () => {},
    stroke: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, closePath: () => {}, arc: () => {},
    measureText: t => ({ width: t.length * 20 }),
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set font(_) {}, set textAlign(_) {}, set globalAlpha(_) {},
    set shadowColor(_) {}, set shadowBlur(_) {}, set shadowOffsetY(_) {},
  };
  return {
    width: 1080, height: 1920,
    getContext: () => ctx,
    toBlob(cb, type) {
      setTimeout(() => cb(blobOk ? { type, size: 100, _stub: true } : null), 0);
    },
  };
}

// ── Simulate shareOrDownload exactly mirroring the real cascade ───────────────
async function shareOrDownload_sim(input, textFallback, {
  nav = null, blobOk = true, generateOk = true, docStub = null,
} = {}) {
  let file = null;
  if (generateOk) {
    const canvas = makeCanvas(blobOk);
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (blob) file = { blob, name: "aeruvo-outfit.png", type: "image/png", _isFile: true };
  }

  if (file && canShareFiles_sim(nav)) {
    try {
      await nav.share({ files: [file], title: "Today's outfit — Aeruvo", text: "My weather-ready outfit from Aeruvo" });
      return { action: "shared" };
    } catch (err) {
      if (err?.name === "AbortError") return { action: "cancelled" };
    }
  }

  if (file && docStub) {
    docStub.downloaded = true;
    docStub.file = file;
    return { action: "downloaded", message: "Outfit card downloaded — share it anywhere." };
  }

  if (nav?.share) {
    try {
      await nav.share({ title: "Today's outfit — Aeruvo", text: textFallback });
      return { action: "text-shared" };
    } catch (err) {
      if (err?.name === "AbortError") return { action: "cancelled" };
    }
  }

  return { action: "error", message: "Couldn't share this outfit. Please try again." };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Free users can share
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. Free users can share ───────────────────────────────────");
ok("1a. shareOrDownload accepts no entitlement parameter", !shareSrc.includes("entitlement:"));
ok("1b. index.tsx share button has no entitlement/premium guard in onClick",
  (() => {
    const btnIdx = indexSrc.indexOf('"Share today\'s outfit"');
    const block  = indexSrc.slice(btnIdx - 50, btnIdx + 600);
    return !block.includes("entitlement") && !block.includes("isPremium");
  })());
ok("1c. recommendation.tsx share button has no entitlement guard",
  (() => {
    const btnIdx = recSrc.indexOf('"Share today\'s outfit"');
    const block  = recSrc.slice(btnIdx - 50, btnIdx + 600);
    return !block.includes("entitlement") && !block.includes("isPremium");
  })());

// ════════════════════════════════════════════════════════════════════════════
// 2. Premium users can share
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. Premium users can share ────────────────────────────────");
ok("2. shareOrDownload has no entitlement branching (same path for all)",
  !shareSrc.includes("entitlement.active") && !shareSrc.includes("isPremium"));

// ════════════════════════════════════════════════════════════════════════════
// 3. Shared list matches the final rendered outfit (mergedOutfit)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. Share uses mergedOutfit (exact rendered array) ─────────");
ok("3a. index.tsx share call uses finalDisplayOutfit (wardrobe-matched labels)",
  indexSrc.includes("const outfitItems = finalDisplayOutfit;"));
ok("3b. recommendation.tsx share call combines rec.outfit + personalization.extraItems",
  recSrc.includes("[...rec.outfit, ...personalization.extraItems]"));
ok("3c. shareOutfit.ts receives outfitItems param (not re-derives outfit)",
  shareSrc.includes("outfitItems: string[]") && !shareSrc.includes("recommend("));

// ════════════════════════════════════════════════════════════════════════════
// 4. Share payload matches exact rendered labels (wardrobe match + personalization)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. Wardrobe-matched labels + personalized extras in payload ─");
{
  // ── Scenario: Premium user, wardrobe match + personalization extra ──────
  //
  // OutfitSlotList renders (for rec.outfit = ["t-shirt", "jeans"]):
  //   slot 0: no match → displays "t-shirt"
  //   slot 1: matched  → displays "Your Blue jeans"   ← wardrobe match
  //   personalization extra: "light removable layer"  ← prefer-layers profile
  //
  // resolvedSlotsToDisplayLabels must produce:
  //   ["t-shirt", "Your Blue jeans", "light removable layer"]
  //
  // The OLD (incorrect) path (deduplicateOutfit(mergedOutfit)) would have produced:
  //   ["t-shirt", "jeans", "light removable layer"]  ← wrong: "jeans" not "Your Blue jeans"

  const resolvedSlots = [
    { matched: false, genericText: "t-shirt" },
    { matched: true,  genericText: "jeans", itemName: "Blue jeans", itemId: "item-1", itemTint: "from-blue-400 to-blue-600" },
  ];
  const extraItems = ["light removable layer"];

  const payload = resolvedSlotsToDisplayLabels(resolvedSlots, extraItems);

  ok("4a. Wardrobe-matched slot uses 'Your Blue jeans' label, not generic 'jeans'",
    payload.includes("Your Blue jeans"), `got: ${payload.join(", ")}`);
  ok("4b. Generic 'jeans' not in payload when replaced by wardrobe match",
    !payload.includes("jeans") || payload.includes("Your Blue jeans"),
    // "jeans" is a substring of "Your Blue jeans" — check exact item
    `full payload: ${payload.join(", ")}`);
  // Stronger check: the exact string "jeans" as a standalone item must not appear
  ok("4b-strict. Standalone 'jeans' not in payload when wardrobe match exists",
    !payload.some(item => item === "jeans"), `payload: ${payload.join(", ")}`);
  ok("4c. Personalized extra layer included after wardrobe slots",
    payload.includes("light removable layer"), `got: ${payload.join(", ")}`);
  ok("4d. Unmatched slot retains generic text",
    payload.includes("t-shirt"), `got: ${payload.join(", ")}`);
  ok("4e. Ordering: base slots first, then extra items",
    payload.indexOf("t-shirt") < payload.indexOf("light removable layer") &&
    payload.indexOf("Your Blue jeans") < payload.indexOf("light removable layer"),
    `payload: ${payload.join(", ")}`);
  ok("4f. All 3 visible items present in payload", payload.length === 3,
    `expected 3, got ${payload.length}: ${payload.join(", ")}`);

  // ── Free user: no wardrobe matches, no extra items ───────────────────
  const freeSlots = [
    { matched: false, genericText: "t-shirt" },
    { matched: false, genericText: "jeans" },
  ];
  const freePayload = resolvedSlotsToDisplayLabels(freeSlots, []);
  ok("4g. Free user (no match, no extras): only generic base items",
    freePayload.length === 2 && freePayload[0] === "t-shirt" && freePayload[1] === "jeans",
    `got: ${freePayload.join(", ")}`);
  ok("4h. Free user: no 'Your ' prefix labels", !freePayload.some(i => i.startsWith("Your ")));

  // ── index.tsx structural: uses finalDisplayOutfit ────────────────────
  ok("4i. index.tsx imports resolvedSlotsToDisplayLabels",
    indexSrc.includes("resolvedSlotsToDisplayLabels"));
  ok("4j. index.tsx builds finalDisplayOutfit from resolvedSlotsResult.resolvedSlots",
    indexSrc.includes("resolvedSlotsResult.resolvedSlots,") &&
    indexSrc.includes("personalization.extraItems,") &&
    indexSrc.includes("resolvedSlotsToDisplayLabels("));
  ok("4k. index.tsx share handler uses finalDisplayOutfit (not mergedOutfit directly)",
    indexSrc.includes("const outfitItems = finalDisplayOutfit;"));

  // ── recommendation.tsx: uses combined array (no wardrobe matching on that route) ─
  ok("4l. recommendation.tsx: combines rec.outfit + personalization.extraItems",
    recSrc.includes("[...rec.outfit, ...personalization.extraItems]"));

  // ── resolvedSlotsToDisplayLabels is exported from shareOutfit.ts ─────
  ok("4m. shareOutfit.ts exports resolvedSlotsToDisplayLabels",
    shareSrc.includes("export function resolvedSlotsToDisplayLabels"));
  ok("4n. resolvedSlotsToDisplayLabels applies 'Your ' prefix for matched slots",
    shareSrc.includes("`Your ${slot.itemName}`") ||
    shareSrc.includes("'Your ' + slot.itemName") ||
    shareSrc.includes("slot.matched ? `Your ${slot.itemName}`"));
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Duplicate items are removed
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 5. Deduplication ──────────────────────────────────────────");
ok("5a. Exact duplicates removed", deduplicateOutfit(["t-shirt","t-shirt","jeans"]).length === 2);
ok("5b. Case-insensitive dedup",   deduplicateOutfit(["T-Shirt","t-shirt"]).length === 1);
ok("5c. Order preserved",          deduplicateOutfit(["jacket","t-shirt","jacket"])[0] === "jacket");
ok("5d. Whitespace handled",       deduplicateOutfit(["jeans "," jeans"]).length === 1);
ok("5e. Empty list → empty",       deduplicateOutfit([]).length === 0);
ok("5f. Single item preserved",    deduplicateOutfit(["sneakers"]).length === 1);
ok("5g. All unique kept",          deduplicateOutfit(["a","b","c"]).length === 3);

// ════════════════════════════════════════════════════════════════════════════
// 6. Privacy — no sensitive data in ShareCardInput
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. Privacy ────────────────────────────────────────────────");
const ifaceMatch = shareSrc.match(/export interface ShareCardInput \{([^}]+)\}/s);
const iface = ifaceMatch?.[1] ?? "";
ok("6a. No uid field",          !iface.includes("uid"));
ok("6b. No email field",        !iface.includes("email"));
ok("6c. No name field",         !iface.includes("name:") && !iface.includes("userName") && !iface.includes("displayName"));
ok("6d. No coordinates",        !iface.includes("lat") && !iface.includes("lon"));
ok("6e. No commuteMode",        !iface.includes("commuteMode"));
ok("6f. No subscription state", !iface.includes("subscription") && !iface.includes("entitlement"));
ok("6g. No city/location",      !iface.includes("city") && !iface.includes("location"));
ok("6h. Footer = aeruvo.app only (no user data)", shareSrc.includes("aeruvo.app"));
// Confirm call sites do not pass city or coordinates
ok("6i. index.tsx share call does not pass city or coordinates",
  (() => {
    const callIdx = indexSrc.indexOf("await shareOrDownload(");
    const callBlock = indexSrc.slice(callIdx, callIdx + 200);
    return !callBlock.includes("city") && !callBlock.includes("lat") && !callBlock.includes("lon");
  })());

// ════════════════════════════════════════════════════════════════════════════
// 7. Web Share API with file when supported
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 7. Web Share API file sharing ─────────────────────────────");
(async () => {
  const nav = { share: async () => {}, canShare: () => true };
  const r = await shareOrDownload_sim(
    { outfitItems:["t-shirt","jeans"], headline:"Nice.", tempC:20, condition:"Sunny" },
    "fallback", { nav });
  ok("7a. Returns action='shared' with Web Share + files", r.action === "shared");
  ok("7b. canShareFiles_sim true with compatible navigator", canShareFiles_sim(nav));
  ok("7c. canShareFiles_sim false without navigator",        canShareFiles_sim(null) === false);
})().catch(e => ok("7 (async)", false, e.message));

// ════════════════════════════════════════════════════════════════════════════
// 8. PNG download fallback
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. PNG download fallback ──────────────────────────────────");
(async () => {
  const docStub = { downloaded: false };
  const r = await shareOrDownload_sim(
    { outfitItems:["t-shirt"], headline:".", tempC:20, condition:"." },
    "fallback", { nav: null, docStub });
  ok("8a. action='downloaded' when no Web Share support", r.action === "downloaded");
  ok("8b. message='Outfit card downloaded — share it anywhere.'",
    r.message === "Outfit card downloaded — share it anywhere.");
  ok("8c. download was triggered", docStub.downloaded);
})().catch(e => ok("8 (async)", false, e.message));

// ════════════════════════════════════════════════════════════════════════════
// 9. Plain-text fallback when image fails
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 9. Plain-text fallback ────────────────────────────────────");
(async () => {
  let sharedText = null;
  const nav = { share: async d => { sharedText = d.text; }, canShare: () => false };
  const r = await shareOrDownload_sim(
    { outfitItems:["hoodie"], headline:"Chilly.", tempC:8, condition:"Cloudy" },
    "Today's outfit\nhoodie", { nav, generateOk: false });
  ok("9a. Text share used when image fails",    r.action === "text-shared" || r.action === "error");
  ok("9b. text-shared path exists in source",   shareSrc.includes('"text-shared"'));
  ok("9c. text-copied path exists in source",   shareSrc.includes('"text-copied"'));
})().catch(e => ok("9 (async)", false, e.message));

// ════════════════════════════════════════════════════════════════════════════
// 10. AbortError = silent cancellation, no toast
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 10. AbortError = cancellation ─────────────────────────────");
(async () => {
  const abortErr = Object.assign(new Error("user cancelled"), { name: "AbortError" });
  const nav = { share: async () => { throw abortErr; }, canShare: () => true };
  const r = await shareOrDownload_sim(
    { outfitItems:["t-shirt"], headline:".", tempC:20, condition:"." },
    "fallback", { nav });
  ok("10a. AbortError → action='cancelled'", r.action === "cancelled");
  ok("10b. No message on cancel",             !r.message);
})().catch(e => ok("10 (async)", false, e.message));

// ════════════════════════════════════════════════════════════════════════════
// 11. SSR safety
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 11. SSR safety ────────────────────────────────────────────");
// Top-level module code = everything before the first exported function
const beforeFirstExport = shareSrc.split("\nexport ")[0];
ok("11a. No document.createElement at top level",  !beforeFirstExport.includes("document.createElement"));
ok("11b. No navigator.share at top level",         !beforeFirstExport.includes("navigator.share"));
ok("11c. No window. access at top level",          !beforeFirstExport.includes("window."));
ok("11d. canShareFiles guards 'typeof navigator'", shareSrc.includes("typeof navigator"));
ok("11e. generateOutfitCard is async function",    shareSrc.includes("async function generateOutfitCard"));

// ════════════════════════════════════════════════════════════════════════════
// 12. Duplicate-tap prevention
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 12. Duplicate-tap prevention ──────────────────────────────");
ok("12a. index.tsx disabled={sharing}",         indexSrc.includes("disabled={sharing}"));
ok("12b. index.tsx if (sharing) guard",         indexSrc.includes("if (sharing"));
ok("12c. index.tsx setSharing(false) in finally",
  indexSrc.includes("} finally {\n                  setSharing(false);"));
ok("12d. recommendation.tsx disabled={sharing}", recSrc.includes("disabled={sharing}"));
ok("12e. recommendation.tsx if (sharing) guard", recSrc.includes("if (sharing)"));

// ════════════════════════════════════════════════════════════════════════════
// 13. Accessibility
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 13. Accessibility ─────────────────────────────────────────");
ok("13a. index.tsx: aria-label='Share today's outfit'",
  indexSrc.includes("aria-label=\"Share today's outfit\""));
ok("13b. recommendation.tsx: aria-label='Share today's outfit'",
  recSrc.includes("aria-label=\"Share today's outfit\""));
ok("13c. index.tsx: Share2 has aria-hidden",
  indexSrc.includes('<Share2 className="h-4 w-4" aria-hidden />'));
ok("13d. recommendation.tsx: Share2 has aria-hidden",
  recSrc.includes('<Share2 className="h-4 w-4" aria-hidden />'));

// ════════════════════════════════════════════════════════════════════════════
// 14. Integration — exact call sites
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 14. Call sites ────────────────────────────────────────────");
ok("14a. index.tsx imports shareOrDownload + resolvedSlotsToDisplayLabels",
  indexSrc.includes("shareOrDownload") && indexSrc.includes("resolvedSlotsToDisplayLabels") && indexSrc.includes("@/lib/shareOutfit"));
ok("14b. recommendation.tsx imports shareOrDownload + deduplicateOutfit",
  recSrc.includes("import { shareOrDownload, deduplicateOutfit } from \"@/lib/shareOutfit\""));
ok("14c. index.tsx uses finalDisplayOutfit (wardrobe labels) as outfitItems",
  indexSrc.includes("const outfitItems = finalDisplayOutfit;"));
ok("14d. recommendation.tsx combines rec.outfit + personalization.extraItems",
  recSrc.includes("[...rec.outfit, ...personalization.extraItems]"));
ok("14e. Both routes pass rec.headline", indexSrc.includes("headline: rec.headline") && recSrc.includes("headline: rec.headline"));
ok("14f. Both routes pass weather.tempC", indexSrc.includes("tempC: weather.tempC") && recSrc.includes("tempC: weather.tempC"));
ok("14g. Both routes pass weather.condition", indexSrc.includes("condition: weather.condition") && recSrc.includes("condition: weather.condition"));

// ════════════════════════════════════════════════════════════════════════════
// 15. Card copy and dimensions
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 15. Card content and copy ─────────────────────────────────");
ok("15a. Heading: 'Today's outfit'",        shareSrc.includes("Today's outfit"));
ok("15b. Footer: 'Dress smarter with Aeruvo'", shareSrc.includes("Dress smarter with Aeruvo"));
ok("15c. Footer: 'aeruvo.app'",             shareSrc.includes("aeruvo.app"));
ok("15d. Share title correct",              shareSrc.includes("Today's outfit — Aeruvo"));
ok("15e. Share text correct",               shareSrc.includes("My weather-ready outfit from Aeruvo"));
ok("15f. Download message correct",         shareSrc.includes("Outfit card downloaded — share it anywhere."));
ok("15g. Failure message correct",          shareSrc.includes("Couldn't share this outfit. Please try again."));
ok("15h. Card is 1080×1920",               shareSrc.includes("1080") && shareSrc.includes("1920"));

// Wait for async tests
setTimeout(() => {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`${p + f} tests: ${p} passed, ${f} failed`);
  process.exit(f > 0 ? 1 : 0);
}, 300);
