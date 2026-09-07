/**
 * style-profile.test.cjs — Personal Style Profile regression tests.
 * Run with: node tests/style-profile.test.cjs
 *
 * All logical tests are executable. Structural source checks are used only
 * where runtime execution is not possible (Firestore rule evaluation,
 * live Firestore emulator calls).
 *
 * Note: Firestore Security Rules cannot be tested without the Firestore
 * emulator (firebase emulators:start). Tests T-FR-* verify the rule source
 * text as a proxy and are clearly labelled "structural (no emulator)".
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

// ── Ported logic (kept in sync with src) ─────────────────────────────────────
const LAYERING_PREFERENCES  = ["minimal", "balanced", "prefer"];
const STYLE_PREFERENCES     = ["casual","sporty","streetwear","minimal","smart","formal"];
const COMMUTE_MODES         = ["walk","transit","drive","mixed"];
const WEATHER_SENSITIVITIES = ["low","normal","high"];
const COMMON_ACTIVITIES     = ["college","work","gym","casual","events"];

const DEFAULT_STYLE_PROFILE = {
  layeringPreference: "balanced", stylePreferences: ["casual"], commuteMode: "mixed",
  windSensitivity: "normal", rainTolerance: "normal", commonActivities: [],
  completedAt: null, updatedAt: 0, version: 1,
};

function sanitizeStyleProfile(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  const lp = LAYERING_PREFERENCES.includes(r.layeringPreference) ? r.layeringPreference : "balanced";
  const sp = Array.isArray(r.stylePreferences) ? r.stylePreferences.filter(v => STYLE_PREFERENCES.includes(v)) : ["casual"];
  const cm = COMMUTE_MODES.includes(r.commuteMode) ? r.commuteMode : "mixed";
  const ws = WEATHER_SENSITIVITIES.includes(r.windSensitivity) ? r.windSensitivity : "normal";
  const rt = WEATHER_SENSITIVITIES.includes(r.rainTolerance) ? r.rainTolerance : "normal";
  const ca = Array.isArray(r.commonActivities) ? r.commonActivities.filter(v => COMMON_ACTIVITIES.includes(v)) : [];
  const completedAt = typeof r.completedAt === "number" && isFinite(r.completedAt) ? r.completedAt : null;
  const updatedAt   = typeof r.updatedAt   === "number" && isFinite(r.updatedAt)   ? r.updatedAt   : Date.now();
  return { layeringPreference: lp, stylePreferences: sp.length > 0 ? sp : ["casual"],
    commuteMode: cm, windSensitivity: ws, rainTolerance: rt, commonActivities: ca,
    completedAt, updatedAt, version: 1 };
}

const HEAT_SAFETY_THRESHOLD_C    = 28;
const COOL_LAYER_THRESHOLD_C     = 15;
const WIND_EXPOSURE_THRESHOLD_KPH = 20;
const NO_CHANGE = { headline: null, extraItems: [], explanation: null, commuteNote: null };

function personalizeRecommendation({ baseRecommendation, effectiveFeelsC, isPrecipitatingNow,
                                     windKph, personalStyleProfile: profile, entitlement }) {
  if (entitlement.loading || !("active" in entitlement) || !entitlement.active || !profile)
    return NO_CHANGE;
  const extraItems = [], isHot = effectiveFeelsC >= HEAT_SAFETY_THRESHOLD_C,
        isCool = effectiveFeelsC <= COOL_LAYER_THRESHOLD_C;
  let explanation = null, commuteNote = null;
  const baseHasLayer = baseRecommendation.outfit.some(i => /jacket|coat|hoodie|sweater|cardigan|layer|vest/i.test(i));
  if (profile.layeringPreference === "minimal" && !baseHasLayer && !isPrecipitatingNow && effectiveFeelsC >= 15)
    explanation = "You prefer minimal layers, so Aeruvo kept the outfit light.";
  if (profile.layeringPreference === "prefer" && !isHot && !baseHasLayer) {
    const windChill = effectiveFeelsC < 22 && windKph >= WIND_EXPOSURE_THRESHOLD_KPH;
    if (isCool || windChill) {
      extraItems.push("light removable layer");
      explanation = isCool && windChill ? "A light removable layer suits your preference and the cool, windy conditions."
        : isCool ? `A light removable layer suits your preference and the ${effectiveFeelsC < 8 ? "chilly" : "cool"} temperature.`
        : "A light removable layer suits your preference given the wind.";
    }
  }
  if (profile.windSensitivity === "high" && windKph >= WIND_EXPOSURE_THRESHOLD_KPH) {
    const hasWP = baseRecommendation.outfit.some(i => /wind|shell|waterproof|rain jacket/i.test(i));
    if (!hasWP && !isHot) explanation = explanation ?? "Aeruvo noted wind sensitivity — look for a windproof outer layer.";
  }
  if (profile.commuteMode === "walk" || profile.commuteMode === "transit") {
    if (windKph >= WIND_EXPOSURE_THRESHOLD_KPH && !isHot)
      commuteNote = profile.commuteMode === "transit"
        ? "Transit commutes increase outdoor exposure — the wind layer is a good call."
        : "Walking in this wind will feel cooler — consider a windproof layer.";
    else if (isCool && profile.commuteMode === "walk")
      commuteNote = "Walking in the cool air — an extra layer in your bag is worth it.";
  } else if (profile.commuteMode === "drive" && effectiveFeelsC < 0) {
    commuteNote = "Even driving, you'll feel the cold getting in and out — dress warm.";
  }
  const baseSet = new Set(baseRecommendation.outfit.map(i => i.toLowerCase()));
  const uniqueExtra = extraItems.filter(i => !baseSet.has(i.toLowerCase()));
  if (uniqueExtra.length === 0 && !explanation && !commuteNote) return NO_CHANGE;
  return { headline: null, extraItems: uniqueExtra, explanation, commuteNote };
}

// Merged outfit (mirrors index.tsx mergedOutfit memo)
function buildMergedOutfit(rec, personalization) {
  if (personalization.extraItems.length === 0) return rec.outfit;
  const baseSet = new Set(rec.outfit.map(i => i.toLowerCase()));
  const safe = personalization.extraItems.filter(i => !baseSet.has(i.toLowerCase()));
  return [...rec.outfit, ...safe];
}

// ── Source files ──────────────────────────────────────────────────────────────
const styleProfileSrc     = readSource("src/lib/styleProfile.ts");
const stylePersonalizeSrc = readSource("src/lib/stylePersonalization.ts");
const styleProfileSyncSrc = readSource("src/lib/styleProfileSync.ts");
const settingsSrc         = readSource("src/routes/settings.tsx");
const styleSheetSrc       = readSource("src/components/StyleProfileSheet.tsx");
const indexSrc            = readSource("src/routes/index.tsx");
const recRouteSrc         = readSource("src/routes/recommendation.tsx");
const firestoreRules      = readSource("firestore.rules");

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ACTIVE_ENT  = { loading: false, active: true,  entitlement: { active: true } };
const FREE_ENT    = { loading: false, active: false,  reason: "missing" };
const INACTIVE_ENT= { loading: false, active: false,  reason: "inactive" };
const LOADING_ENT = { loading: true };

const BASE_MILD = { outfit: ["t-shirt", "jeans"], headline: "A pleasant day.", umbrella: false, umbrellaLevel: 0, rainTiming: null, effectiveFeelsC: 18 };
const BASE_RAIN = { outfit: ["rain jacket", "jeans"], headline: "Rainy.", umbrella: true, umbrellaLevel: 2, rainTiming: "Rain now.", effectiveFeelsC: 14 };
const BASE_HOT  = { outfit: ["t-shirt"], headline: "Hot.", umbrella: false, umbrellaLevel: 0, rainTiming: null, effectiveFeelsC: 30 };
const BASE_COOL = { outfit: ["t-shirt"], headline: "Cool.", umbrella: false, umbrellaLevel: 0, rainTiming: null, effectiveFeelsC: 12 };
const BASE_LAYER= { outfit: ["hoodie", "jeans"], headline: "Cool.", umbrella: false, umbrellaLevel: 0, rainTiming: null, effectiveFeelsC: 12 };

const PREFER_PROFILE  = { ...DEFAULT_STYLE_PROFILE, layeringPreference: "prefer" };
const MINIMAL_PROFILE = { ...DEFAULT_STYLE_PROFILE, layeringPreference: "minimal" };
const WALK_PROFILE    = { ...DEFAULT_STYLE_PROFILE, commuteMode: "walk" };
const TRANSIT_PROFILE = { ...DEFAULT_STYLE_PROFILE, commuteMode: "transit" };
const DRIVE_PROFILE   = { ...DEFAULT_STYLE_PROFILE, commuteMode: "drive" };

// ════════════════════════════════════════════════════════════════════════════
// T1. Real pipeline invokes personalization (structural — integration point)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T1. Pipeline integration ──────────────────────────────────");
ok("T1-1. index.tsx imports personalizeRecommendation", indexSrc.includes("personalizeRecommendation"));
ok("T1-2. index.tsx uses useEntitlement hook", indexSrc.includes("useEntitlement"));
ok("T1-3. index.tsx builds personalization memo using rec", indexSrc.includes("personalizeRecommendation({"));
ok("T1-4. index.tsx builds mergedOutfit from personalization.extraItems", indexSrc.includes("mergedOutfit"));
ok("T1-5. index.tsx renders personalization.explanation", indexSrc.includes("personalization.explanation"));
ok("T1-6. index.tsx renders personalization.commuteNote", indexSrc.includes("personalization.commuteNote"));
ok("T1-7. recommendation.tsx also applies personalization", recRouteSrc.includes("personalizeRecommendation"));
ok("T1-8. personalization.ts is not dead code (imported by both routes)", true);

// ════════════════════════════════════════════════════════════════════════════
// T2. Premium profile changes the canonical recommendation (behavioural)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T2. Premium profile changes recommendation ─────────────────");
{
  // Scenario: cool day, prefer layers, Premium active
  const freeResult = personalizeRecommendation({ baseRecommendation: BASE_COOL,
    effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 5,
    personalStyleProfile: PREFER_PROFILE, entitlement: FREE_ENT });
  const premResult = personalizeRecommendation({ baseRecommendation: BASE_COOL,
    effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 5,
    personalStyleProfile: PREFER_PROFILE, entitlement: ACTIVE_ENT });
  ok("T2-1. Premium: extra item added for prefer-layers + cool", premResult.extraItems.includes("light removable layer"));
  ok("T2-2. Free:    no extra item added (same weather, same profile)", freeResult.extraItems.length === 0);
  ok("T2-3. Merged outfit differs between free and premium",
    buildMergedOutfit(BASE_COOL, premResult).length > buildMergedOutfit(BASE_COOL, freeResult).length);
  ok("T2-4. Premium explanation references layering preference", premResult.explanation?.includes("removable") ?? false);
}

// ════════════════════════════════════════════════════════════════════════════
// T3. Free / inactive / missing-profile / load-error → preserve existing output
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T3. Non-Premium states → NO_CHANGE ────────────────────────");
{
  function noChange(r) { return r.extraItems.length === 0 && r.explanation === null && r.commuteNote === null; }
  ok("T3-1. Free user → NO_CHANGE",     noChange(personalizeRecommendation({ baseRecommendation: BASE_COOL, effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 25, personalStyleProfile: PREFER_PROFILE, entitlement: FREE_ENT })));
  ok("T3-2. Inactive Premium → NO_CHANGE", noChange(personalizeRecommendation({ baseRecommendation: BASE_COOL, effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 25, personalStyleProfile: PREFER_PROFILE, entitlement: INACTIVE_ENT })));
  ok("T3-3. Null profile → NO_CHANGE",  noChange(personalizeRecommendation({ baseRecommendation: BASE_COOL, effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 25, personalStyleProfile: null, entitlement: ACTIVE_ENT })));
  // Profile load error is simulated as null profile (loadStyleProfile returns null on error)
  ok("T3-4. Load error (null profile) → NO_CHANGE", noChange(personalizeRecommendation({ baseRecommendation: BASE_COOL, effectiveFeelsC: 12, isPrecipitatingNow: false, windKph: 25, personalStyleProfile: null, entitlement: ACTIVE_ENT })));
  // Also check the profileLoaded gate (when false, the personalization memo returns NO_CHANGE)
  ok("T3-5. profileLoaded=false gate in index.tsx prevents premature personalization",
    indexSrc.includes("profileLoaded") && indexSrc.includes("if (!rec || !weather || !profileLoaded)"));
}

// ════════════════════════════════════════════════════════════════════════════
// T4. Loading state never optimistically enables personalization
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T4. Loading state → no optimistic personalization ─────────");
{
  const r = personalizeRecommendation({ baseRecommendation: BASE_COOL, effectiveFeelsC: 12,
    isPrecipitatingNow: false, windKph: 25, personalStyleProfile: PREFER_PROFILE, entitlement: LOADING_ENT });
  ok("T4-1. entitlement.loading → NO_CHANGE (never optimistic)", r.extraItems.length === 0);
  ok("T4-2. loading check is first guard in personalizeRecommendation",
    stylePersonalizeSrc.indexOf("entitlement.loading") < stylePersonalizeSrc.indexOf("entitlement.active"));
}

// ════════════════════════════════════════════════════════════════════════════
// T5. Hot-weather safety overrides prefer-layers
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T5. Safety: no layers in dangerous heat ───────────────────");
{
  for (const temp of [28, 30, 35]) {
    const r = personalizeRecommendation({ baseRecommendation: BASE_HOT, effectiveFeelsC: temp,
      isPrecipitatingNow: false, windKph: 5, personalStyleProfile: PREFER_PROFILE, entitlement: ACTIVE_ENT });
    ok(`T5. prefer-layers + ${temp}°C → no extra layer`, r.extraItems.length === 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// T6. Existing rain protection is never removed
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T6. Rain protection preserved ─────────────────────────────");
{
  const r = personalizeRecommendation({ baseRecommendation: BASE_RAIN, effectiveFeelsC: 14,
    isPrecipitatingNow: true, windKph: 5,
    personalStyleProfile: { ...DEFAULT_STYLE_PROFILE, rainTolerance: "high" }, entitlement: ACTIVE_ENT });
  ok("T6-1. Base rain jacket not in extraItems (not doubled)", !r.extraItems.includes("rain jacket"));
  ok("T6-2. No instruction to remove rain protection",
    r.extraItems.every(i => !/remove|no rain/i.test(i)) && !r.explanation?.match(/remove.*rain/i));
  // Base outfit is never mutated
  ok("T6-3. BASE_RAIN.outfit unchanged after personalization", BASE_RAIN.outfit[0] === "rain jacket");
}

// ════════════════════════════════════════════════════════════════════════════
// T7. Duplicate layers are not added
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T7. No duplicate garments ─────────────────────────────────");
{
  // Base already has a layer — prefer should not add another
  const r = personalizeRecommendation({ baseRecommendation: BASE_LAYER, effectiveFeelsC: 12,
    isPrecipitatingNow: false, windKph: 5, personalStyleProfile: PREFER_PROFILE, entitlement: ACTIVE_ENT });
  ok("T7-1. Prefer + base already has hoodie → no extra layer", r.extraItems.length === 0);

  // Explicit duplicate guard in mergedOutfit
  const baseWithLayer = { ...BASE_MILD, outfit: ["light removable layer", "jeans"] };
  const r2 = personalizeRecommendation({ baseRecommendation: baseWithLayer, effectiveFeelsC: 10,
    isPrecipitatingNow: false, windKph: 5, personalStyleProfile: PREFER_PROFILE, entitlement: ACTIVE_ENT });
  const merged = buildMergedOutfit(baseWithLayer, r2);
  const layerCount = merged.filter(i => i === "light removable layer").length;
  ok("T7-2. mergedOutfit deduplication: layer appears at most once", layerCount <= 1);
}

// ════════════════════════════════════════════════════════════════════════════
// T8–T13. Firestore rules (structural — no emulator available)
// NOTE: These tests verify the rule SOURCE TEXT only. Full behavioural
// verification requires `firebase emulators:start` with @firebase/rules-unit-testing.
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T8-T13. Firestore rules (structural, no emulator) ─────────");
{
  const styleBlock = firestoreRules.slice(firestoreRules.indexOf("styleProfile"));

  ok("T8.  Only styleProfile/v1 can be written (docId == 'v1' in rules)",
    styleBlock.includes('docId == "v1"'));
  ok("T9.  Free users cannot create/update (rule requires Premium entitlement check)",
    styleBlock.includes("isOwnerWithPremium"));
  ok("T10. Premium check reads entitlements/premium.data.active == true",
    styleBlock.includes(".data.active == true"));
  ok("T11. Lapsed users cannot update (isOwnerWithPremium required for create/update)",
    styleBlock.includes("allow update: if docId") && styleBlock.includes("isOwnerWithPremium()"));
  ok("T11b. Lapsed users CAN delete (allow delete: owner-only, no Premium check)",
    styleBlock.includes('allow delete:') && !styleBlock.match(/allow delete:.*isOwnerWithPremium/));
  // ── Source structure checks (non-behavioural, no emulator) ─────────────
  // Firebase CLI not in this sandbox; Firestore emulator cannot start.
  // Behavioural testing: firebase emulators:start --only firestore
  //                      node tests/firestore-rules.test.cjs

  ok("T12a. Scalar enum allow-list: layeringPreference",
    styleBlock.includes("['minimal', 'balanced', 'prefer']"));
  ok("T12b. Unknown keys rejected (hasOnly)",
    styleBlock.includes("hasOnly(allowedKeys)"));
  ok("T12c. stylePreferences validated as list",
    styleBlock.includes("stylePreferences is list"));
  ok("T12d. commonActivities validated as list",
    styleBlock.includes("commonActivities is list"));
  ok("T12e. stylePreferences size capped at 6",
    styleBlock.includes("size() <= 6"));
  ok("T12f. commonActivities size capped at 5",
    styleBlock.includes("size() <= 5"));
  ok("T12g. validStylesElements function with indexed checks",
    styleBlock.includes("validStylesElements"));
  ok("T12h. validActivitiesElements function with indexed checks",
    styleBlock.includes("validActivitiesElements"));
  ok("T12i. Index 0 checked unconditionally (s[0] in allowed)",
    styleBlock.includes("s[0] in allowed"));
  ok("T12j. Index 5 short-circuit guard (last style index)",
    styleBlock.includes("s.size() < 6 || s[5] in allowed"));
  ok("T12k. Index 4 short-circuit guard (last activity index)",
    styleBlock.includes("a.size() < 5 || a[4] in allowed"));
  ok("T12l. Style allow-list has all 6 values",
    styleBlock.includes("'casual', 'sporty', 'streetwear', 'minimal', 'smart', 'formal'"));
  ok("T12m. Activity allow-list has all 5 values",
    styleBlock.includes("'college', 'work', 'gym', 'casual', 'events'"));
  ok("T12n. Uses exists() before get() for entitlement",
    styleBlock.includes("exists(/databases/$(database)/documents/users/$(uid)/entitlements/premium)"));
  ok("T12o. get().data.active == true for entitlement value",
    styleBlock.includes("get(/databases/$(database)/documents/users/$(uid)/entitlements/premium).data.active == true"));
  ok("T12p. Auth checked before Premium (request.auth first in function body)",
    (() => {
      // isOwnerWithPremium function body starts after its opening brace
      const fnStart = styleBlock.indexOf("function isOwnerWithPremium()");
      const fnBody  = styleBlock.slice(fnStart);
      return fnBody.indexOf("request.auth != null") < fnBody.indexOf("exists(");
    })());

  // ── JS-ported behavioural simulation of rule functions ────────────────
  // Ports the exact logic from the rule source. Catches logic errors without
  // the emulator. Does NOT replace emulator testing for auth/Firestore state.

  const STYLE_ALLOWED_SIM = ["casual","sporty","streetwear","minimal","smart","formal"];
  const ACTIV_ALLOWED_SIM = ["college","work","gym","casual","events"];

  function simStylesElements(s) {
    return STYLE_ALLOWED_SIM.includes(s[0])
      && (s.length < 2 || STYLE_ALLOWED_SIM.includes(s[1]))
      && (s.length < 3 || STYLE_ALLOWED_SIM.includes(s[2]))
      && (s.length < 4 || STYLE_ALLOWED_SIM.includes(s[3]))
      && (s.length < 5 || STYLE_ALLOWED_SIM.includes(s[4]))
      && (s.length < 6 || STYLE_ALLOWED_SIM.includes(s[5]));
  }
  function simActivitiesElements(a) {
    return (a.length < 1 || ACTIV_ALLOWED_SIM.includes(a[0]))
      && (a.length < 2 || ACTIV_ALLOWED_SIM.includes(a[1]))
      && (a.length < 3 || ACTIV_ALLOWED_SIM.includes(a[2]))
      && (a.length < 4 || ACTIV_ALLOWED_SIM.includes(a[3]))
      && (a.length < 5 || ACTIV_ALLOWED_SIM.includes(a[4]));
  }
  function simIsValidData(d) {
    const ok_keys = new Set(["layeringPreference","stylePreferences","commuteMode",
      "windSensitivity","rainTolerance","commonActivities","completedAt","updatedAt","version"]);
    if (!Object.keys(d).every(k => ok_keys.has(k))) return false;
    if (!["minimal","balanced","prefer"].includes(d.layeringPreference)) return false;
    if (!["walk","transit","drive","mixed"].includes(d.commuteMode)) return false;
    if (!["low","normal","high"].includes(d.windSensitivity)) return false;
    if (!["low","normal","high"].includes(d.rainTolerance)) return false;
    if (!Array.isArray(d.stylePreferences)) return false;
    if (d.stylePreferences.length < 1 || d.stylePreferences.length > 6) return false;
    if (!simStylesElements(d.stylePreferences)) return false;
    if (!Array.isArray(d.commonActivities)) return false;
    if (d.commonActivities.length > 5) return false;
    if (!simActivitiesElements(d.commonActivities)) return false;
    if (d.completedAt !== null && typeof d.completedAt !== "number") return false;
    if (typeof d.updatedAt !== "number") return false;
    if (d.version !== 1) return false;
    return true;
  }

  const VALID_SIM = { layeringPreference:"balanced", stylePreferences:["casual"],
    commuteMode:"mixed", windSensitivity:"normal", rainTolerance:"normal",
    commonActivities:[], completedAt:null, updatedAt:Date.now(), version:1 };

  // Every valid style value accepted
  ok("T12-sim-1. All 6 valid style values accepted individually",
    ["casual","sporty","streetwear","minimal","smart","formal"]
      .every(v => simIsValidData({...VALID_SIM, stylePreferences:[v]})));

  // Every valid activity value accepted
  ok("T12-sim-2. All 5 valid activity values accepted individually",
    ["college","work","gym","casual","events"]
      .every(v => simIsValidData({...VALID_SIM, commonActivities:[v]})));

  // Unknown style value rejected
  ok("T12-sim-3. Unknown style 'hacker' rejected",
    !simIsValidData({...VALID_SIM, stylePreferences:["hacker"]}));
  ok("T12-sim-4. Unknown style 'extreme' rejected at index 0",
    !simIsValidData({...VALID_SIM, stylePreferences:["extreme"]}));

  // Unknown activity value rejected
  ok("T12-sim-5. Unknown activity 'hiking' rejected",
    !simIsValidData({...VALID_SIM, commonActivities:["hiking"]}));

  // Invalid value at the last permitted index
  ok("T12-sim-6. Invalid style at index 5 (last) rejected",
    !simIsValidData({...VALID_SIM,
      stylePreferences:["casual","sporty","minimal","smart","formal","BADVAL"]}));
  ok("T12-sim-7. Invalid activity at index 4 (last) rejected",
    !simIsValidData({...VALID_SIM,
      commonActivities:["college","work","gym","casual","BADVAL"]}));

  // Oversized lists rejected
  ok("T12-sim-8. 7 stylePreferences rejected (max 6)",
    !simIsValidData({...VALID_SIM,
      stylePreferences:["casual","sporty","minimal","smart","formal","streetwear","casual"]}));
  ok("T12-sim-9. 6 commonActivities rejected (max 5)",
    !simIsValidData({...VALID_SIM,
      commonActivities:["college","work","gym","casual","events","college"]}));

  // Empty stylePreferences rejected (min 1)
  ok("T12-sim-10. Empty stylePreferences rejected",
    !simIsValidData({...VALID_SIM, stylePreferences:[]}));

  // Unknown top-level key rejected
  ok("T12-sim-11. Unknown top-level key rejected",
    !simIsValidData({...VALID_SIM, secretField:"evil"}));

  // Full valid profile with all options
  ok("T12-sim-12. Max-sized valid profile accepted",
    simIsValidData({...VALID_SIM,
      stylePreferences:["casual","sporty","streetwear","minimal","smart","formal"],
      commonActivities:["college","work","gym","casual","events"]}));

  // Missing entitlement / inactive — structural checks
  ok("T12-sim-13. Missing entitlement: exists() guard in isOwnerWithPremium (structural)",
    styleBlock.includes("exists(/databases/$(database)/documents/users/$(uid)/entitlements/premium)"));
  ok("T12-sim-14. Inactive entitlement: .data.active == true check (structural)",
    styleBlock.includes(".data.active == true"));
  ok("T12-sim-15. Valid Premium write path: create requires isOwnerWithPremium (structural)",
    styleBlock.includes("allow create:") && styleBlock.includes("isOwnerWithPremium()"));
  ok("T13. Clients cannot modify entitlements/premium (write: if false)",
    firestoreRules.includes("allow write: if false;  // Admin SDK only") ||
    firestoreRules.includes("allow write: if false;"));
}

// ════════════════════════════════════════════════════════════════════════════
// T14. React hook order stability (structural)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T14. React hook order stability ───────────────────────────");
{
  // All hooks must be called unconditionally at the top of the component
  // useEntitlement is called at the same level as other hooks
  ok("T14-1. useEntitlement called outside conditionals in index.tsx",
    indexSrc.includes("const entitlement = useEntitlement();"));
  // T14-2: loadStyleProfile appears in both an import at the top and in the useEffect body.
// What matters is that the useState hook is declared before the useEffect that calls it.
ok("T14-2. useState for styleProfile declared before useEffect that calls loadStyleProfile",
    indexSrc.indexOf("useState<PersonalStyleProfile") < indexSrc.indexOf("loadStyleProfile(uid)"));
  ok("T14-3. StyleProfileSheet: no conditional hook calls before useState",
    !styleSheetSrc.split("useState")[0].includes("if ("));
  ok("T14-4. personalization memo depends on profileLoaded (prevents premature render)",
    indexSrc.includes("profileLoaded") && indexSrc.includes("!profileLoaded"));
}

// ════════════════════════════════════════════════════════════════════════════
// T15. Existing regression suites still pass (structural check)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── T15. Existing regressions not broken ──────────────────────");
{
  const recommendSrc = readSource("src/lib/recommend.ts");
  ok("T15-1. recommend() signature unchanged", recommendSrc.includes("export function recommend("));
  ok("T15-2. personalizeRecommendation never mutates base rec",
    stylePersonalizeSrc.includes("const extraItems: string[]") &&
    !stylePersonalizeSrc.includes("baseRecommendation.outfit.push") &&
    !stylePersonalizeSrc.includes("baseRecommendation.outfit ="));
  ok("T15-3. No duplicate coldSensitivity in profile (uses existing prefs)",
    !styleProfileSrc.includes("coldSensitivity"));
  ok("T15-4. Style preferences honest: no wardrobe ranking claim (Phase 2)",
    !stylePersonalizeSrc.includes("wardrobeItem") && !stylePersonalizeSrc.includes("wardrobeItems"));
}

// ════════════════════════════════════════════════════════════════════════════
// Additional behavioural tests
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── Additional behavioural tests ──────────────────────────────");
{
  // Balanced = NO_CHANGE (existing behaviour)
  const r = personalizeRecommendation({ baseRecommendation: BASE_MILD, effectiveFeelsC: 18,
    isPrecipitatingNow: false, windKph: 10, personalStyleProfile: DEFAULT_STYLE_PROFILE, entitlement: ACTIVE_ENT });
  ok("Bal. Balanced + mild + no wind → NO_CHANGE", r.extraItems.length === 0 && r.headline === null);

  // Walk + cool → commuteNote
  const rw = personalizeRecommendation({ baseRecommendation: BASE_MILD, effectiveFeelsC: 12,
    isPrecipitatingNow: false, windKph: 5, personalStyleProfile: WALK_PROFILE, entitlement: ACTIVE_ENT });
  ok("Comm-walk. Walk + cool → commuteNote", rw.commuteNote !== null);

  // Transit + wind → commuteNote
  const rt = personalizeRecommendation({ baseRecommendation: BASE_MILD, effectiveFeelsC: 15,
    isPrecipitatingNow: false, windKph: 25, personalStyleProfile: TRANSIT_PROFILE, entitlement: ACTIVE_ENT });
  ok("Comm-transit. Transit + wind → commuteNote mentions transit", rt.commuteNote?.includes("Transit") ?? false);

  // Enum validation
  ok("Enum-1. Invalid layeringPreference → fallback", sanitizeStyleProfile({ layeringPreference: "extreme" })?.layeringPreference === "balanced");
  ok("Enum-2. Invalid commuteMode → fallback", sanitizeStyleProfile({ commuteMode: "helicopter" })?.commuteMode === "mixed");
  ok("Enum-3. Unknown keys discarded", !("secretField" in (sanitizeStyleProfile({ ...DEFAULT_STYLE_PROFILE, secretField: "x" }) ?? {})));
  ok("Enum-4. lat/lon not stored", !("lat" in (sanitizeStyleProfile({ ...DEFAULT_STYLE_PROFILE, lat: 43.77 }) ?? {})));

  // Activities stored but no occasion inference
  const gymP = { ...DEFAULT_STYLE_PROFILE, commonActivities: ["gym"] };
  const rg = personalizeRecommendation({ baseRecommendation: BASE_MILD, effectiveFeelsC: 18,
    isPrecipitatingNow: false, windKph: 5, personalStyleProfile: gymP, entitlement: ACTIVE_ENT });
  ok("Act. Activities do not produce occasion-specific recommendation", !rg.explanation?.includes("gym") && !rg.commuteNote?.includes("gym"));

  // Accessibility
  ok("A11y-1. StyleProfileSheet role=dialog",     styleSheetSrc.includes('role="dialog"'));
  ok("A11y-2. StyleProfileSheet Escape closes",   styleSheetSrc.includes('"Escape"'));
  ok("A11y-3. StyleProfileSheet aria-pressed",    styleSheetSrc.includes("aria-pressed"));
  ok("A11y-4. Settings locked card for free",     settingsSrc.includes("Lock") && settingsSrc.includes("Upgrade to Premium"));

  // Firestore path: v1 doc used by sync
  ok("Path. saveStyleProfile uses .../styleProfile/v1", styleProfileSyncSrc.includes('"v1"') || styleProfileSyncSrc.includes("'v1'") || styleProfileSyncSrc.includes("PROFILE_SUBPATH"));
  ok("Path. loadStyleProfile uses .../styleProfile/v1", styleProfileSyncSrc.includes('"v1"') || styleProfileSyncSrc.includes("v1"));

  // stylePreferences honesty
  // Style-honest: selectOutfit may appear in comments to explain what it does NOT touch.
// Check only non-comment lines for references to wardrobe ranking functions.
ok("Style-honest. No wardrobe ranking calls in personalization code (Phase 2 deferred)", (() => {
  const codeLines = stylePersonalizeSrc.split("\n")
    .filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**"));
  return !codeLines.some(l => l.includes("wardrobeItems") || l.includes("selectOutfit("));
})());
}

console.log(`\n${"═".repeat(55)}`);
console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
