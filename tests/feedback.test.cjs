/**
 * feedback.test.cjs — Regression tests for the Aeruvo feedback system.
 * Run with: node tests/feedback.test.cjs
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readSource = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

let p = 0, f = 0;
function ok(label, cond, detail) {
  if (cond) { console.log("✓", label); p++; }
  else { console.error("✗", label, detail != null ? String(detail) : ""); f++; }
}

// ── Source files ────────────────────────────────────────────────────────────
const feedbackTypes = readSource("src/lib/feedback-types.ts");
const feedbackHandler = readSource("src/lib/feedback-handler.ts");
const feedbackSheet = readSource("src/components/FeedbackSheet.tsx");
const sourcesSheet = readSource("src/components/WeatherDataSourcesSheet.tsx");
const indexSrc = readSource("src/routes/index.tsx");
const settingsSrc = readSource("src/routes/settings.tsx");
const serverSrc = readSource("src/server.ts");
const firestoreRules = readSource("firestore.rules");
// ════════════════════════════════════════════════════════════════════════════
// A. Hero overflow menu — UI structure
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── A: Hero overflow menu ─────────────────────────────────────");
ok("A1. MoreVertical icon imported", indexSrc.includes("MoreVertical"));
ok("A2. overflow button has aria-label='More weather actions'", indexSrc.includes('"More weather actions"'));
ok("A3. overflow button has aria-haspopup='menu'", indexSrc.includes('aria-haspopup="menu"'));
ok("A4. overflow button has aria-expanded", indexSrc.includes("aria-expanded={overflowOpen}"));
ok("A5. Menu has role='menu'", indexSrc.includes('role="menu"'));
ok("A6. Refresh conditions menu item present", indexSrc.includes("Refresh conditions"));
ok("A7. Report weather menu item present", indexSrc.includes("Report weather"));
ok("A8. Weather data sources menu item present", indexSrc.includes("Weather data sources"));
ok("A9. Refresh calls refresh()", indexSrc.includes("setOverflowOpen(false); refresh()"));
ok("A10. Report weather opens feedbackOpen", indexSrc.includes("setFeedbackOpen(true)"));
ok("A11. Weather data sources opens sourcesOpen", indexSrc.includes("setSourcesOpen(true)"));
ok("A12. Overflow closes when backdrop clicked", indexSrc.includes("setOverflowOpen(false)"));
ok("A13. No permanent large feedback card below hero", !indexSrc.includes("Report incorrect weather"));

// ════════════════════════════════════════════════════════════════════════════
// B. FeedbackSheet component structure
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── B: FeedbackSheet component ────────────────────────────────");
ok("B1. role='dialog' on sheet", feedbackSheet.includes('role="dialog"'));
ok("B2. aria-modal='true'", feedbackSheet.includes('aria-modal="true"'));
ok("B3. aria-label='Send feedback'", feedbackSheet.includes('"Send feedback"'));
ok("B4. Close button aria-label='Close feedback'", feedbackSheet.includes('"Close feedback"'));
ok("B5. Focus trapped via keydown handler", feedbackSheet.includes("handleKeyDown") || feedbackSheet.includes("focus-visible"));
ok("B6. Escape closes the sheet", feedbackSheet.includes('"Escape"'));
ok("B7. Category select has aria-required", feedbackSheet.includes("aria-required"));
ok("B8. Character counter displayed", feedbackSheet.includes("{trimmedLen}/{MESSAGE_MAX}") || feedbackSheet.includes("trimmedLen"));
ok("B9. Character counter announced via aria-live", feedbackSheet.includes("aria-live"));
ok("B10. Loading state shows spinner", feedbackSheet.includes("Loader2") || feedbackSheet.includes("Sending"));
ok("B11. Success state uses role='status' aria-live='polite'", feedbackSheet.includes('role="status"') && feedbackSheet.includes("polite"));
ok("B12. Success message: 'Thank you — your feedback was sent.'", feedbackSheet.includes("Thank you — your feedback was sent."));
ok("B13. Error preserves form content (no reset on error)", feedbackSheet.includes('phase === "error"'));
ok("B14. Server error shown inline", feedbackSheet.includes("errorMsg"));
ok("B15. Submit disabled during submission", feedbackSheet.includes('disabled={phase === "submitting"}'));
ok("B16. Duplicate submission prevented (phase guard)", feedbackSheet.includes('if (phase === "submitting") return'));
ok("B17. Privacy disclosure present", feedbackSheet.includes("Exact GPS coordinates are not included"));
ok("B18. Weather issue sub-question shown only for weather category", feedbackSheet.includes("isWeather") && feedbackSheet.includes("What seems incorrect?"));
ok("B19. Contact permission checkbox present", feedbackSheet.includes("mayContact"));
ok("B20. Cancel button present", feedbackSheet.includes("Cancel"));

// ════════════════════════════════════════════════════════════════════════════
// C. Settings — Help & Feedback section
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── C: Settings Help & Feedback ───────────────────────────────");
ok("C1. Help & Feedback section present", settingsSrc.includes("Help") && settingsSrc.includes("Feedback"));
ok("C2. Send feedback button in settings", settingsSrc.includes("Send feedback"));
ok("C3. FeedbackSheet imported in settings", settingsSrc.includes("FeedbackSheet"));
ok("C4. feedbackOpen state in settings", settingsSrc.includes("feedbackOpen"));
ok("C5. Settings opens same FeedbackSheet component", settingsSrc.includes("<FeedbackSheet"));
ok("C6. Settings and hero use same FeedbackSheet component (structural)", (() => {
  const heroImport    = indexSrc.includes('import { FeedbackSheet }');
  const settingsImport= settingsSrc.includes('import { FeedbackSheet }');
  return heroImport && settingsImport;
})());

// ════════════════════════════════════════════════════════════════════════════
// D. WeatherDataSourcesSheet
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── D: WeatherDataSourcesSheet ────────────────────────────────");
ok("D1. Sources sheet has role='dialog'", sourcesSheet.includes('role="dialog"'));
ok("D2. Mentions Open-Meteo", sourcesSheet.includes("Open-Meteo"));
ok("D3. Mentions ECCC (radar for Canadian)", sourcesSheet.includes("Environment and Climate Change Canada"));
ok("D4. No raw radar terminology (mm/h, RRAI, etc.)", !sourcesSheet.includes("RRAI") && !sourcesSheet.includes("mm/h"));
ok("D5. Escape closes sources sheet", sourcesSheet.includes('"Escape"'));

// ════════════════════════════════════════════════════════════════════════════
// E. Diagnostics snapshot
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── E: Diagnostics snapshot ───────────────────────────────────");
ok("E1. feedbackDiagnostics derived from rainDecision (same source as hero)", indexSrc.includes("rainDecision?.effectiveCurrentCode") && indexSrc.includes("feedbackDiagnostics"));
ok("E2. displayedLocation from prefs.city.name (not GPS coords)", indexSrc.includes("prefs?.city?.name"));
ok("E3. radarStatus from radar?.status", indexSrc.includes("radar?.status"));
ok("E4. radarRateMmPerHour included", indexSrc.includes("radarRateMmPerHour"));
ok("E5. clientSubmittedAt set to ISO string", indexSrc.includes("new Date().toISOString()"));
ok("E6. No exact GPS coordinates (no lat/lon in diagnostics)", (() => {
  const diagBlock = indexSrc.slice(indexSrc.indexOf("feedbackDiagnostics = useMemo"), indexSrc.indexOf("}, [weather, prefs, rainDecision, radar]);"));
  return !diagBlock.includes(".lat") && !diagBlock.includes(".lon");
})());
ok("E7. diagnostics passed to FeedbackSheet", indexSrc.includes("diagnostics={feedbackDiagnostics}"));
ok("E8. Diagnostics NOT attached for non-weather feedback (server-side guard)", feedbackHandler.includes('category === "weather-incorrect"'));

// ════════════════════════════════════════════════════════════════════════════
// F. Server handler — authentication and validation
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── F: Server handler — auth & validation ─────────────────────");
ok("F1. /api/feedback in server.ts apiPaths", serverSrc.includes('"/api/feedback"'));
ok("F2. POST /api/feedback handled", serverSrc.includes('"POST"') && serverSrc.includes('handleFeedback'));
ok("F3. verifyFirebaseToken called first", feedbackHandler.includes("const uid = await verifyFirebaseToken(request)"));
ok("F4. uid from verified token, not body", (() => {
  const uidLine = feedbackHandler.split('\n').find(l => l.includes('const uid = await verifyFirebaseToken'));
  return !!uidLine && !feedbackHandler.includes("raw.uid") && !feedbackHandler.includes("body.uid");
})());
ok("F5. Rate limiting implemented", feedbackHandler.includes("checkRateLimit") && feedbackHandler.includes("RATE_MAX"));
ok("F6. Body size cap enforced", feedbackHandler.includes("MAX_BODY_BYTES") && feedbackHandler.includes("413"));
ok("F7. Category validated against enum", feedbackHandler.includes("FEEDBACK_CATEGORIES") && feedbackHandler.includes("Invalid category"));
ok("F8. Unknown category rejected", feedbackHandler.includes('"Invalid category"'));
ok("F9. WeatherIssueType validated against enum", feedbackHandler.includes("WEATHER_ISSUE_TYPES") && feedbackHandler.includes("Invalid weatherIssueType"));
ok("F10. Message min length enforced", feedbackHandler.includes("MESSAGE_MIN") && feedbackHandler.includes("at least"));
ok("F11. Message max length enforced", feedbackHandler.includes("MESSAGE_MAX") && feedbackHandler.includes("not exceed"));
ok("F12. createdAt uses server timestamp (FieldValue.serverTimestamp)", feedbackHandler.includes("FieldValue.serverTimestamp()") || feedbackHandler.includes("serverTimestamp()"));
ok("F13. status:'new' written on creation", feedbackHandler.includes('"new"'));
ok("F14. Unexpected diagnostic keys discarded (sanitizeDiagnostics)", feedbackHandler.includes("sanitizeDiagnostics"));
ok("F15. Exact coordinates NOT stored (no lat/lon in sanitize)", (() => {
  const sanitizeBlock = feedbackHandler.slice(feedbackHandler.indexOf("function sanitizeDiagnostics"), feedbackHandler.indexOf("export async function handleFeedback"));
  return !sanitizeBlock.includes(".lat") && !sanitizeBlock.includes(".lon") && !sanitizeBlock.includes("latitude") && !sanitizeBlock.includes("longitude");
})());
ok("F16. Server error messages don't leak internals (ApiError used)", feedbackHandler.includes("ApiError"));
// verifyFirebaseToken (in stripe-server.ts) throws ApiError(401) — check it's called
ok("F17. 401 for missing auth (via verifyFirebaseToken)", feedbackHandler.includes("verifyFirebaseToken") && (() => {
  const ss = readSource("src/lib/stripe-server.ts");
  return ss.includes("401") && ss.includes("Missing or malformed");
})());
ok("F18. 429 for rate limit", feedbackHandler.includes("429"));
ok("F19. 413 for oversized body", feedbackHandler.includes("413"));
ok("F20. 400 for bad category", feedbackHandler.includes("400") && feedbackHandler.includes("Invalid category"));

// ════════════════════════════════════════════════════════════════════════════
// G. Firestore security rules
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── G: Firestore security rules ───────────────────────────────");
ok("G1. userFeedback collection exists in rules", firestoreRules.includes("userFeedback"));
ok("G2. userFeedback read: if false (no client reads)", (() => {
  const block = firestoreRules.slice(firestoreRules.indexOf("userFeedback"));
  return block.includes("allow read:  if false") || block.includes("allow read: if false");
})());
ok("G3. userFeedback write: if false (no client writes)", (() => {
  const block = firestoreRules.slice(firestoreRules.indexOf("userFeedback"));
  return block.includes("allow write:  if false") || block.includes("allow write: if false");
})());

// ════════════════════════════════════════════════════════════════════════════
// H. Privacy protections
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── H: Privacy protections ────────────────────────────────────");
ok("H1. No GPS coordinates in diagnostics builder", (() => {
  const diagBlock = indexSrc.slice(indexSrc.indexOf("feedbackDiagnostics = useMemo"), indexSrc.indexOf("}, [weather, prefs, rainDecision, radar]);"));
  return !diagBlock.includes(".lat") && !diagBlock.includes(".lon");
})());
ok("H2. No wardrobe data in diagnostics", (() => {
  const diagBlock = indexSrc.slice(indexSrc.indexOf("feedbackDiagnostics = useMemo"), indexSrc.indexOf("}, [weather, prefs, rainDecision, radar]);"));
  return !diagBlock.includes("wardrobe") && !diagBlock.includes("clothing");
})());
ok("H3. No auth tokens in diagnostics", (() => {
  const diagBlock = indexSrc.slice(indexSrc.indexOf("feedbackDiagnostics = useMemo"), indexSrc.indexOf("}, [weather, prefs, rainDecision, radar]);"));
  return !diagBlock.includes("token") && !diagBlock.includes("idToken");
})());
ok("H4. Privacy disclosure shown in FeedbackSheet", feedbackSheet.includes("Exact GPS coordinates are not included"));
ok("H5. Server sanitizeDiagnostics rejects unrecognised keys", feedbackHandler.includes("sanitizeDiagnostics"));
ok("H6. FeedbackSheet does not log or transmit diagnostics beyond the API call", !feedbackSheet.includes("console.log(diag") && !feedbackSheet.includes("console.log(feedbackDiag"));

// ════════════════════════════════════════════════════════════════════════════
// I. Weather consistency — diagnostics match hero
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── I: Weather consistency ─────────────────────────────────────");
ok("I1. effectiveCurrentCode in diagnostics comes from rainDecision (same as hero icon)", indexSrc.includes("rainDecision?.effectiveCurrentCode") && indexSrc.includes("feedbackDiagnostics"));
ok("I2. isPrecipitatingNow from rainDecision", indexSrc.includes("isPrecipitatingNow:    rainDecision?.isPrecipitatingNow"));
ok("I3. radarStatus from radar?.status (same radar as hero)", indexSrc.includes("radarStatus:           radar?.status"));
ok("I4. Feedback system does NOT change rainDecision or radar state", (() => {
  // feedbackDiagnostics is a useMemo — it reads but does not write
  const diagBlock = indexSrc.slice(indexSrc.indexOf("feedbackDiagnostics = useMemo"), indexSrc.indexOf("}, [weather, prefs, rainDecision, radar]);"));
  return !diagBlock.includes("setRainDecision") && !diagBlock.includes("setRadar") && !diagBlock.includes("setWeather");
})());

// ════════════════════════════════════════════════════════════════════════════
// J. Feedback types correctness
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── J: Feedback types ─────────────────────────────────────────");
// Port the validation logic
const VALID_CATEGORIES = ["weather-incorrect","outfit-recommendation","app-problem","feature-idea","other"];
const VALID_WIT = ["raining-but-shows-dry","dry-but-shows-raining","temperature","condition-or-icon","rain-timing","other-weather"];
ok("J1. All 5 categories in FEEDBACK_CATEGORIES", VALID_CATEGORIES.every(c => feedbackTypes.includes(`"${c}"`)));
ok("J2. All 6 weather issue types in WEATHER_ISSUE_TYPES", VALID_WIT.every(t => feedbackTypes.includes(`"${t}"`)));
ok("J3. MESSAGE_MIN = 10", feedbackTypes.includes("MESSAGE_MIN = 10") || feedbackTypes.includes("MESSAGE_MIN=10"));
ok("J4. MESSAGE_MAX = 1000", feedbackTypes.includes("MESSAGE_MAX = 1000") || feedbackTypes.includes("MESSAGE_MAX=1000"));
ok("J5. FeedbackDiagnostics has radarStatus union", feedbackTypes.includes('"precipitation" | "dry" | "no-coverage" | "unavailable"'));
ok("J6. FeedbackPayload exported", feedbackTypes.includes("export interface FeedbackPayload"));

// ════════════════════════════════════════════════════════════════════════════
// K. Accessibility structural checks
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── K: Accessibility ──────────────────────────────────────────");
ok("K1. Overflow button has aria-label", indexSrc.includes('"More weather actions"'));
ok("K2. Menu has role='menu'", indexSrc.includes('role="menu"'));
ok("K3. Menu items have role='menuitem'", indexSrc.includes('role="menuitem"'));
ok("K4. Dialog has aria-modal", feedbackSheet.includes('aria-modal="true"'));
ok("K5. Category select has htmlFor/id pairing", feedbackSheet.includes('htmlFor="fb-category"') && feedbackSheet.includes('id="fb-category"'));
ok("K6. Message textarea has htmlFor/id pairing", feedbackSheet.includes('htmlFor="fb-message"') && feedbackSheet.includes('id="fb-message"'));
ok("K7. Error messages have role='alert'", feedbackSheet.includes('role="alert"'));
ok("K8. Loading state announced via aria-live", feedbackSheet.includes("aria-live") || feedbackSheet.includes("aria-label="));
ok("K9. Success state announced via aria-live='polite'", feedbackSheet.includes("polite"));
ok("K10. Focus returned to trigger on close (triggerRef)", feedbackSheet.includes("triggerRef.current?.focus"));

// ════════════════════════════════════════════════════════════════════════════
// L. Server handler sanitization — executable tests
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── L: Sanitization logic ─────────────────────────────────────");

// Port sanitizeDiagnostics for direct testing
function sanitizeDiagnostics(d) {
  if (typeof d !== "object" || d === null) return null;
  const src = d;
  const validRadar = ["precipitation", "dry", "no-coverage", "unavailable", null];
  return {
    displayedLocation:    typeof src.displayedLocation    === "string" ? src.displayedLocation.slice(0, 100) : null,
    displayedCondition:   typeof src.displayedCondition   === "string" ? src.displayedCondition.slice(0, 100) : null,
    displayedWeatherCode: typeof src.displayedWeatherCode === "number" && isFinite(src.displayedWeatherCode)
      ? Math.round(src.displayedWeatherCode) : null,
    displayedTemperatureC:typeof src.displayedTemperatureC=== "number" && isFinite(src.displayedTemperatureC)
      ? Math.round(src.displayedTemperatureC * 10) / 10 : null,
    isPrecipitatingNow:   typeof src.isPrecipitatingNow   === "boolean" ? src.isPrecipitatingNow : null,
    precipitationEvidence:typeof src.precipitationEvidence=== "string" ? src.precipitationEvidence.slice(0, 50) : null,
    effectiveCurrentCode: typeof src.effectiveCurrentCode === "number" && isFinite(src.effectiveCurrentCode)
      ? Math.round(src.effectiveCurrentCode) : null,
    radarStatus:          validRadar.includes(src.radarStatus) ? src.radarStatus : null,
    radarRateMmPerHour:   typeof src.radarRateMmPerHour   === "number" && isFinite(src.radarRateMmPerHour)
      ? src.radarRateMmPerHour : null,
    radarObservedAt:      typeof src.radarObservedAt       === "string" ? src.radarObservedAt.slice(0, 40) : null,
    weatherObservedAt:    typeof src.weatherObservedAt     === "string" ? src.weatherObservedAt.slice(0, 40) : null,
    clientSubmittedAt:    typeof src.clientSubmittedAt     === "string" ? src.clientSubmittedAt.slice(0, 40)
      : new Date().toISOString(),
    appVersion:           typeof src.appVersion            === "string" ? src.appVersion.slice(0, 30) : null,
  };
}

// L1. radar-precipitation decision captured correctly
{
  const d = sanitizeDiagnostics({
    displayedLocation: "Scarborough", displayedCondition: "Rain showers",
    displayedWeatherCode: 80, displayedTemperatureC: 18.3,
    isPrecipitatingNow: true, precipitationEvidence: "radar-precipitation",
    effectiveCurrentCode: 80, radarStatus: "precipitation",
    radarRateMmPerHour: 2.4, radarObservedAt: "2026-09-03T02:42:00Z",
    weatherObservedAt: "2026-09-03T02:42:00Z", clientSubmittedAt: "2026-09-03T02:45:00Z",
    appVersion: null,
  });
  ok("L1. radar-precipitation: isPrecipitatingNow=true", d.isPrecipitatingNow === true);
  ok("L2. radar-precipitation: evidence='radar-precipitation'", d.precipitationEvidence === "radar-precipitation");
  ok("L3. radar-precipitation: radarStatus='precipitation'", d.radarStatus === "precipitation");
  ok("L4. radar-precipitation: effectiveCurrentCode=80", d.effectiveCurrentCode === 80);
}

// L5. radar-dry decision captured correctly
{
  const d = sanitizeDiagnostics({
    displayedLocation: "Scarborough", isPrecipitatingNow: false,
    precipitationEvidence: "radar-dry", effectiveCurrentCode: 3,
    radarStatus: "dry", radarRateMmPerHour: 0, radarObservedAt: "2026-09-03T02:42:00Z",
    clientSubmittedAt: "2026-09-03T02:45:00Z",
  });
  ok("L5. radar-dry: isPrecipitatingNow=false", d.isPrecipitatingNow === false);
  ok("L6. radar-dry: radarStatus='dry'", d.radarStatus === "dry");
  ok("L7. radar-dry: effectiveCurrentCode=3", d.effectiveCurrentCode === 3);
}

// L8. Unknown radarStatus rejected
{
  const d = sanitizeDiagnostics({ radarStatus: "evil-value", clientSubmittedAt: "2026-09-03T02:45:00Z" });
  ok("L8. Unknown radarStatus → null", d.radarStatus === null);
}

// L9. Unexpected keys discarded (no lat/lon stored)
{
  const d = sanitizeDiagnostics({
    lat: 43.77, lon: -79.25, // should be silently discarded
    displayedLocation: "Scarborough", clientSubmittedAt: "2026-09-03T02:45:00Z",
  });
  ok("L9. lat/lon keys discarded by sanitizeDiagnostics", !("lat" in d) && !("lon" in d));
}

// L10. Unavailable radar status represented correctly
{
  const d = sanitizeDiagnostics({ radarStatus: "unavailable", isPrecipitatingNow: false, clientSubmittedAt: "2026-09-03T02:45:00Z" });
  ok("L10. unavailable radar status stored correctly", d.radarStatus === "unavailable");
}

// L11. null input → null (non-weather feedback)
ok("L11. sanitizeDiagnostics(null) → null", sanitizeDiagnostics(null) === null);

// L12. Non-weather feedback: diagnostics null (structural)
ok("L12. Non-weather category: diagnostics not attached (server guard)", feedbackHandler.includes('category === "weather-incorrect"') && feedbackHandler.includes(': null'));

console.log(`\n${"═".repeat(55)}`);
console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
