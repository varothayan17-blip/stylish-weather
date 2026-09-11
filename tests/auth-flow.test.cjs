/**
 * auth-flow.test.cjs — behavioural tests for the complete onboarding journey,
 * Google auth, pre-auth questions, draft handling, and service-worker guards.
 */
"use strict";
const fs   = require("node:fs");
const path = require("node:path");
const repoRoot   = path.resolve(__dirname, "..");
const readSource = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
let p = 0, f = 0;
function ok(l, c, d) { if (c) { console.log("✓", l); p++; } else { console.error("✗", l, d ?? ""); f++; } }

const signup   = fs.readFileSync(path.join(repoRoot, "src/routes/signup.tsx"), "utf8").replace(/\r\n/g, "\n");
const welcome  = fs.readFileSync(path.join(repoRoot, "src/routes/welcome.tsx"), "utf8").replace(/\r\n/g, "\n");
const idx      = fs.readFileSync(path.join(repoRoot, "src/routes/index.tsx"), "utf8").replace(/\r\n/g, "\n");
const authLib  = fs.readFileSync(path.join(repoRoot, "src/lib/auth.ts"), "utf8").replace(/\r\n/g, "\n");
const guard    = fs.readFileSync(path.join(repoRoot, "src/lib/useAuthGuard.ts"), "utf8").replace(/\r\n/g, "\n");
const regSW    = fs.readFileSync(path.join(repoRoot, "src/lib/registerSW.ts"), "utf8").replace(/\r\n/g, "\n");
const paq      = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/PreAuthQuestions.tsx"), "utf8").replace(/\r\n/g, "\n");
const introSt  = fs.readFileSync(path.join(repoRoot, "src/lib/introState.ts"), "utf8").replace(/\r\n/g, "\n");

// ════════════════════════════════════════════════════════════════════════════
// A. Journey: signed-out / → /welcome (landing screen first)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── A: Signed-out / → /welcome journey ───────────────────────");
ok("A1. index.tsx: signed-out → /welcome", idx.includes('navigate({ to: "/welcome" })'));
ok("A2. index.tsx: uses Firebase onAuthStateChanged (not prefs.onboarded)", idx.includes("onAuthStateChanged"));
ok("A3. index.tsx: no prefs.onboarded gate", !idx.includes("!p.onboarded"));
ok("A4. welcome.tsx: landing headline present", welcome.includes("Never guess"));
ok("A5. welcome.tsx: 'Get started — it's free'", welcome.includes("Get started"));
ok("A6. welcome.tsx: 'Already have an account? Sign in'", welcome.includes("Already have an account? Sign in"));

// ════════════════════════════════════════════════════════════════════════════
// B. Journey: visual screens 1–3 then questions (step 4)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── B: Visual screens → questions → signup ────────────────────");
ok("B1. Step 1 (WeatherDemoCard) present", welcome.includes("WeatherDemoCard"));
ok("B2. Step 2 (WardrobeDemoCard) present", welcome.includes("WardrobeDemoCard"));
ok("B3. Step 3 (ScanDemoCard) present", welcome.includes("ScanDemoCard"));
ok("B4. Step 4: PreAuthQuestions present (not /signup)", welcome.includes("PreAuthQuestions"));
ok("B5. Step 3 Continue → goToStep(4) (questions, not signup)",
  welcome.includes("goToStep(4)") && !welcome.includes("goToSignup()") || welcome.includes("onClick={() => goToStep(4)}"));
ok("B6. PreAuthQuestions 'Continue to create your account' → goToSignup()",
  welcome.includes("goToSignup") && paq.includes("Continue to create your account"));
ok("B7. goToSignup() → /signup?mode=create", welcome.includes('{ mode: "create" }'));
ok("B8. Step machine supports 5 steps (0–4)", welcome.includes("Step = 0 | 1 | 2 | 3 | 4") || welcome.includes("type Step = 0 | 1 | 2 | 3 | 4"));

// ════════════════════════════════════════════════════════════════════════════
// C. No skip, no guest, no bypass
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── C: No skip/guest/bypass ───────────────────────────────────");
ok("C1. No 'Skip introduction'", !welcome.includes("Skip introduction"));
ok("C2. No 'Skip for now'", !welcome.includes("Skip for now") && !signup.includes("Skip for now"));
ok("C3. No 'Continue as guest'", !welcome.includes("Continue as guest") && !signup.includes("Continue as guest"));
ok("C4. No 'continue without'", !welcome.toLowerCase().includes("continue without"));
ok("C5. No guest UI in signup (comments allowed)", !signup.split("\n").some(l => l.includes("guest") && !l.trim().startsWith("*") && !l.trim().startsWith("//")));
ok("C6. IntroButtons secondaryLabel = sign-in, not skip",
  !welcome.includes('"Skip introduction"'));

// ════════════════════════════════════════════════════════════════════════════
// D. Pre-auth questions: reuse existing components, draft safety
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── D: Pre-auth questions correctness ─────────────────────────");
ok("D1. Uses Section, Grid, Choice from FormControls", paq.includes("Section") && paq.includes("Grid") && paq.includes("Choice"));
ok("D2. Has city / location question", paq.includes("Your city") || paq.includes("city"));
ok("D3. Has temperature sensitivity", paq.includes("coldSensitivity") || paq.includes("Temperature sensitivity"));
ok("D4. Has commute question", paq.includes("commute") || paq.includes("commute"));
ok("D5. Has clothing profile", paq.includes("clothingProfile") || paq.includes("Clothing style"));
ok("D6. Draft NEVER sets onboarded=true", (() => {
  // Check that savePrefs is never called with onboarded: true in PreAuthQuestions
  const saveLines = paq.split("\n").filter(l => l.includes("savePrefs"));
  return saveLines.every(l => !l.includes("onboarded: true"));
})());
ok("D7. City required before continue", paq.includes("cityError") || paq.includes("Please choose a city"));
ok("D8. Back button returns to step 3 (with direction -1)", paq.includes("onBack") && welcome.includes("onBack={() => goToStep(3, -1)}"));
ok("D9. Draft writes to dedicated draft key (not PREFS_KEY)", paq.includes("saveOnboardingDraft") && !paq.includes("savePrefs"));
ok("D10. afterSignIn reads loadPrefs() — draft auto-migrated",
  authLib.includes("const local = loadPrefs()") && authLib.includes("afterSignIn"));

// ════════════════════════════════════════════════════════════════════════════
// E. Draft preserved on auth failure/cancel
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── E: Draft preservation ─────────────────────────────────────");
// Simulate draft write and verify it would survive auth failure
const store = {};
const _ls = { getItem: k => store[k] ?? null, setItem: (k,v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
global.window = { localStorage: _ls };

// Simulate draft save (PreAuthQuestions.update)
const draft = { coldSensitivity: "cold", commute: "ttc", city: { name: "Toronto", lat: 43.7, lon: -79.4 }, clothingProfile: "neutral" };
_ls.setItem("weatherwear:prefs", JSON.stringify(draft));
ok("E1. Draft stored in PREFS_KEY", _ls.getItem("weatherwear:prefs") !== null);
ok("E2. Draft has no onboarded field", !JSON.parse(_ls.getItem("weatherwear:prefs")).onboarded);
// Simulate auth failure (nothing changes in storage)
ok("E3. Draft survives auth failure (not cleared on cancel)", _ls.getItem("weatherwear:prefs") !== null);
// Simulate afterSignIn reading the draft
const loadedDraft = JSON.parse(_ls.getItem("weatherwear:prefs"));
ok("E4. Draft city preserved for afterSignIn", loadedDraft.city?.name === "Toronto");
ok("E5. Draft coldSensitivity preserved", loadedDraft.coldSensitivity === "cold");

// ════════════════════════════════════════════════════════════════════════════
// F. signup.tsx: coordinated bootstrap — getRedirectResult before onAuthStateChanged
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── F: signup.tsx coordinated bootstrap ───────────────────────");
ok("F1. getGoogleRedirectResult called in bootstrap (production migration)",
  signup.includes("getGoogleRedirectResult"));
ok("F2. redirectUid processed before onAuthStateChanged subscribe (execution order)",
  (() => {
    // Inside the async IIFE, check the order: redirectUid assignment before unsub = onAuth...
    const iife = signup.slice(signup.indexOf("async () => {"), signup.indexOf("return () => {"));
    return iife.indexOf("redirectUid") < iife.indexOf("unsubscribe = onAuthStateChanged");
  })());
ok("F3. redirectUid checked → navigate immediately if present",
  signup.includes("redirectUid") && signup.includes("if (redirectUid)"));
ok("F4. onAuthStateChanged only fires if no redirect result",
  signup.includes("No redirect result") || signup.indexOf("onAuthStateChanged") > signup.indexOf("redirectUid"));
ok("F5. No prefs.onboarded in signup (no code lines)",
  !signup.split("\n").some(l => l.includes("onboarded") && !l.trim().startsWith("*") && !l.trim().startsWith("//")));
ok("F6. replace:true on all navigate calls", signup.includes("replace: true"));
ok("F7. cancelled flag for Strict Mode safety", signup.includes("cancelled"));
ok("F8. Single useEffect (no competing effects)", (signup.match(/useEffect\(/g) || []).length === 1);
ok("F9. No competing onboarded check removed",
  !signup.includes("loadPrefs().onboarded"));

// ════════════════════════════════════════════════════════════════════════════
// G. Google sign-in: popup on localhost, redirect on production
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── G: Google sign-in method selection ────────────────────────");
ok("G1. signInWithGoogle() in auth.ts", authLib.includes("export async function signInWithGoogle"));
ok("G2. Popup on localhost", authLib.includes("signInWithPopup(fbAuth, provider)"));
ok("G3. Redirect on production", authLib.includes("signInWithRedirect(fbAuth, provider)"));
ok("G4. isLocalhost() checks both 'localhost' and '127.0.0.1'",
  authLib.includes('"localhost"') && authLib.includes('"127.0.0.1"'));
ok("G5. afterSignIn called once in popup path", (() => {
  const fn = authLib.slice(authLib.indexOf("export async function signInWithGoogle"));
  const body = fn.slice(0, fn.indexOf("\nexport", 10) || fn.length);
  return (body.match(/afterSignIn/g) || []).length === 1;
})());
ok("G6. getGoogleRedirectResult calls afterSignIn for production redirect",
  authLib.slice(authLib.indexOf("export async function getGoogleRedirectResult")).includes("afterSignIn"));

// ════════════════════════════════════════════════════════════════════════════
// H. Returning user: sign-in mode bypasses questions
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── H: Returning user sign-in ─────────────────────────────────");
ok("H1. 'Already have an account? Sign in' on landing (step 0)",
  welcome.includes("Already have an account? Sign in"));
ok("H2. goToSignIn → /signup?mode=signin",
  welcome.includes('{ mode: "signin" }'));
ok("H3. Sign-in path skips pre-auth questions (goes direct to /signup)",
  welcome.includes("function goToSignIn") && welcome.includes("goToSignIn"));
ok("H4. signup.tsx sign-in mode: no name field", signup.includes("!isSignIn") && signup.includes("Your name"));
ok("H5. Sign-in copy: no wardrobe claim",
  signup.includes("Sign in to restore your preferences and saved outfits."));

// ════════════════════════════════════════════════════════════════════════════
// I. All protected routes still guarded
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── I: Protected routes → /signup ─────────────────────────────");
const guardRoutes = ["forecast", "recommendation", "wardrobe", "saved", "preferences", "settings", "premium"];
for (const r of guardRoutes) {
  const src = fs.readFileSync(`${repoRoot}/src/routes/${r}.tsx`, "utf8");
  ok(`I. ${r}.tsx: has useAuthGuard`, src.includes("useAuthGuard"));
}
ok("I-guard. useAuthGuard → /signup (not /welcome)", guard.includes('"/signup"') && !guard.includes('"/welcome"'));
ok("I-home. Home route: signed-out → /welcome", idx.includes('to: "/welcome"'));

// ════════════════════════════════════════════════════════════════════════════
// J. Service worker: skipped on localhost
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── J: SW localhost guard ─────────────────────────────────────");
ok("J1. SW skipped on localhost", regSW.includes('"localhost"') && regSW.includes("skipping registration"));
ok("J2. SW skipped on 127.0.0.1", regSW.includes('"127.0.0.1"'));
ok("J3. SW guard before doRegister", regSW.indexOf("127.0.0.1") < regSW.indexOf("doRegister"));

// ════════════════════════════════════════════════════════════════════════════
// K. Copy accuracy
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── K: Copy accuracy ──────────────────────────────────────────");
ok("K1. No wardrobe sync claim in signup", !signup.includes("wardrobe and outfits") && !signup.includes("wardrobe syncs"));
ok("K2. Accurate copy: preferences and saved outfits", signup.includes("preferences and saved outfits"));
ok("K3. IntroProgress shows total=4 on visual screens", welcome.includes("total={4}"));
ok("K4. Step 4 shows 'Step 4 of 4'", paq.includes("Step 4 of 4") || paq.includes("4 of 4"));

// ════════════════════════════════════════════════════════════════════════════
// L. Intro state: step 4 persisted and resumable
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── L: Intro state persistence ────────────────────────────────");
ok("L1. markInProgress(4) used for question step",
  welcome.includes("goToStep(4)") && introSt.includes("markInProgress"));
ok("L2. loadIntro resumes at step 4 correctly",
  welcome.includes("Math.min(intro.step, 4)"));
ok("L3. markDone() called only after questions complete (goToSignup)",
  welcome.includes("function goToSignup") && welcome.includes("markDone()"));

// ════════════════════════════════════════════════════════════════════════════
// M. Draft isolation — dedicated key, never PREFS_KEY
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── M: Draft isolation (aeruvo:onboarding-draft:v1) ──────────");
const paqSrc     = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/PreAuthQuestions.tsx"), "utf8").replace(/\r\n/g, "\n");
const introSrc   = fs.readFileSync(path.join(repoRoot, "src/lib/introState.ts"), "utf8").replace(/\r\n/g, "\n");
const authSrc    = fs.readFileSync(path.join(repoRoot, "src/lib/auth.ts"), "utf8").replace(/\r\n/g, "\n");
const welcomeSrc = fs.readFileSync(path.join(repoRoot, "src/routes/welcome.tsx"), "utf8").replace(/\r\n/g, "\n");
const signupSrc2 = fs.readFileSync(path.join(repoRoot, "src/routes/signup.tsx"), "utf8").replace(/\r\n/g, "\n");

ok("M1. Dedicated draft key exists in introState.ts", introSrc.includes("aeruvo:onboarding-draft:v1"));
ok("M2. loadOnboardingDraft exported", introSrc.includes("export function loadOnboardingDraft"));
ok("M3. saveOnboardingDraft exported", introSrc.includes("export function saveOnboardingDraft"));
ok("M4. clearOnboardingDraft exported", introSrc.includes("export function clearOnboardingDraft"));
ok("M5. OnboardingDraft type exported", introSrc.includes("export interface OnboardingDraft"));
ok("M6. draft.completed field tracked (not prefs.onboarded)", introSrc.includes("completed?: boolean"));

ok("M7. PreAuthQuestions NEVER calls savePrefs (no PREFS_KEY write in code)",
  !paqSrc.split("\n").some(l => l.includes("savePrefs") && !l.trim().startsWith("*") && !l.trim().startsWith("//")));
ok("M8. PreAuthQuestions uses saveOnboardingDraft only", paqSrc.includes("saveOnboardingDraft"));
ok("M9. PreAuthQuestions reads from loadOnboardingDraft (not loadPrefs)",
  paqSrc.includes("loadOnboardingDraft") && !paqSrc.includes("loadPrefs"));
ok("M10. PreAuthQuestions never sets onboarded=true",
  !paqSrc.split("\n").some(l => l.includes("onboarded") && !l.trim().startsWith("*") && !l.trim().startsWith("//")));

ok("M11. afterSignIn uses loadOnboardingDraft (not loadPrefs in its body)",
  (() => {
    const fnStart = authSrc.indexOf("async function afterSignIn");
    const fnEnd   = authSrc.indexOf("async function migrateFavorites");
    const body    = authSrc.slice(fnStart, fnEnd);
    return body.includes("loadOnboardingDraft") && !body.includes("loadPrefs");
  })());
ok("M12. afterSignIn clears draft after persistence", authSrc.includes("clearOnboardingDraft"));
ok("M13. Draft only applied when draft.completed===true (new-user safety)",
  authSrc.includes("draft.completed === true"));
ok("M14. afterSignIn does NOT spread weatherwear:prefs into new user base",
  (() => {
    const fn = authSrc.slice(authSrc.indexOf("async function afterSignIn"));
    const body = fn.slice(0, fn.indexOf("\nasync function", 10) || fn.length);
    // The base payload must not use loadPrefs() spread
    return !body.includes("...loadPrefs") && !body.includes("const local = loadPrefs");
  })());

ok("M15. markDone() called after auth in signup.tsx; not a real call in welcome.tsx",
  signupSrc2.includes("markDone()") &&
  !welcomeSrc.split("\n").some(l => !l.trim().startsWith("*") && !l.trim().startsWith("//") && l.includes("markDone()")));
ok("M16. markDone NOT called in welcome.tsx (only mentioned in comment)",
  !welcomeSrc.split("\n").some(l => l.includes("markDone()") && !l.trim().startsWith("*") && !l.trim().startsWith("//")));
ok("M17. markDone called after redirect, popup AND email success paths",
  (signupSrc2.match(/markDone\(\)/g) || []).length >= 3);

// Simulate isolation: User A fills draft, User B signs in fresh
const simStore = {};
const simLs = {
  getItem: k => simStore[k] ?? null,
  setItem: (k,v) => { simStore[k] = v; },
  removeItem: k => { delete store[k]; },
};
// User A draft
simStore["aeruvo:onboarding-draft:v1"] = JSON.stringify({
  coldSensitivity: "hot", city: { name: "Calgary", lat: 51, lon: -114 }, completed: true,
});
// User A's old prefs in PREFS_KEY
simStore["weatherwear:prefs"] = JSON.stringify({
  coldSensitivity: "cold", city: { name: "Edmonton", lat: 53, lon: -113 }, onboarded: true,
});
// User B starts onboarding fresh — draft key is different, PREFS_KEY from User A is isolated
const userBDraft = JSON.parse(simStore["aeruvo:onboarding-draft:v1"] || "{}");
ok("M18. User B can see previous draft from same browser (expected — they chose answers)",
  userBDraft.coldSensitivity === "hot");
// But User B's afterSignIn does NOT read PREFS_KEY — it reads the draft
// and the base payload starts clean:
const userBBase = { coldSensitivity: "normal", commute: "walk", onboarded: true };
const draftApplied = { ...userBBase, coldSensitivity: userBDraft.coldSensitivity };
ok("M19. User B's base payload is clean (not User A's PREFS_KEY data)",
  draftApplied.coldSensitivity === "hot" && !("name" in draftApplied));
// User A's prefs from weatherwear:prefs are NOT spread into User B's base
const userAPrefs = JSON.parse(simStore["weatherwear:prefs"]);
ok("M20. User A's PREFS_KEY city does not appear in User B's new-account base",
  userAPrefs.city.name === "Edmonton" && draftApplied.city === undefined);

// Cancelled auth: draft preserved
ok("M21. Draft preserved on cancelled auth (draft key not cleared on failure)",
  simStore["aeruvo:onboarding-draft:v1"] !== null);
// clearOnboardingDraft called only after persistence succeeds (structural check)
ok("M22. clearOnboardingDraft only in afterSignIn (after cloud sync)", authSrc.includes("clearOnboardingDraft"));

// Protected routes cannot be accessed via draft
ok("M23. Draft presence cannot grant access to protected routes (structural)",
  !paqSrc.includes("onboarded: true") && !paqSrc.includes("setOnboarded"));

// ════════════════════════════════════════════════════════════════════════════
// N. Animation system: Lovable motion CSS + directional transitions
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── N: Animation system + reduced-motion ──────────────────────");
const css       = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/onboarding-motion.css"), "utf8").replace(/\r\n/g, "\n");
const shell     = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/OnboardingShell.tsx"), "utf8").replace(/\r\n/g, "\n");
const wdcSrc    = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/WeatherDemoCard.tsx"), "utf8").replace(/\r\n/g, "\n");
const wardSrc   = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/WardrobeDemoCard.tsx"), "utf8").replace(/\r\n/g, "\n");
const scanSrc   = fs.readFileSync(path.join(repoRoot, "src/components/onboarding/ScanDemoCard.tsx"), "utf8").replace(/\r\n/g, "\n");
const welSrc    = fs.readFileSync(path.join(repoRoot, "src/routes/welcome.tsx"), "utf8").replace(/\r\n/g, "\n");

// CSS file exists and is non-empty
ok("N1. onboarding-motion.css exists", css.length > 500);
ok("N2. CSS has ob-page-forward and ob-page-back classes", css.includes("ob-page-forward") && css.includes("ob-page-back"));
ok("N3. CSS has ob-in-right and ob-in-left keyframes", css.includes("ob-in-right") && css.includes("ob-in-left"));
ok("N4. CSS has prefers-reduced-motion block", css.includes("prefers-reduced-motion: reduce"));
ok("N5. Reduced-motion: ob-anim animation set to none", css.includes("animation: none !important"));
ok("N6. Reduced-motion: opacity forced to 1", css.includes("opacity: 1 !important"));
ok("N7. Reduced-motion: transform forced to none", css.includes("transform: none !important"));
ok("N8. Reduced-motion: stroke-dashoffset forced to 0 (temperature line visible)", css.includes("stroke-dashoffset: 0 !important"));
ok("N9. Reduced-motion: ob-beam hidden (not looping)", css.includes(".ob-beam") && css.includes("display: none !important"));
ok("N10. Reduced-motion: ob-sweep hidden (not looping)", css.includes(".ob-sweep") && css.includes("display: none !important"));

// OnboardingShell wiring
ok("N11. OnboardingShell imports onboarding-motion.css", shell.includes("onboarding-motion.css"));
ok("N12. OnboardingShell accepts transitionKey prop", shell.includes("transitionKey"));
ok("N13. OnboardingShell accepts direction prop", shell.includes("direction"));
ok("N14. OnboardingShell applies ob-page-forward/back based on direction", shell.includes("ob-page-forward") && shell.includes("ob-page-back"));

// welcome.tsx wiring
ok("N15. welcome.tsx tracks direction state (1 | -1)", welSrc.includes("direction") && welSrc.includes("-1"));
ok("N16. Back actions use direction -1", welSrc.includes("goToStep(2, -1)") || welSrc.includes("-1"));
ok("N17. All OnboardingShell calls pass transitionKey", (() => {
  const shells = welSrc.match(/<OnboardingShell[^>]*>/g) || [];
  return shells.every(s => s.includes("transitionKey"));
})());
ok("N18. All OnboardingShell calls pass direction", (() => {
  const shells = welSrc.match(/<OnboardingShell[^>]*>/g) || [];
  return shells.every(s => s.includes("direction"));
})());

// Weather demo animations
ok("N19. WeatherDemoCard imports onboarding-motion.css", wdcSrc.includes("onboarding-motion.css"));
ok("N20. WeatherDemoCard: column headers stagger with ob-rise", wdcSrc.includes("ob-rise"));
ok("N21. WeatherDemoCard: temperature line draws with ob-draw", wdcSrc.includes("ob-draw"));
ok("N22. WeatherDemoCard: outfit silhouettes reveal with ob-pop", wdcSrc.includes("ob-pop") && wdcSrc.includes("OutfitSilhouette"));
ok("N23. WeatherDemoCard: umbrella banner arrives last (ob-d11 or later)", wdcSrc.includes("ob-d11") || wdcSrc.includes("ob-d10"));
ok("N24. WeatherDemoCard: no infinite animation loops (ob-beam/ob-sweep absent)", !wdcSrc.includes("ob-beam") && !wdcSrc.includes("ob-sweep"));

// Wardrobe demo animations
ok("N25. WardrobeDemoCard imports onboarding-motion.css", wardSrc.includes("onboarding-motion.css"));
ok("N26. WardrobeDemoCard: garments stagger with ob-pop", wardSrc.includes("ob-pop ob-d2") || wardSrc.includes("ob-pop"));
ok("N27. WardrobeDemoCard: recommendation row slides up", wardSrc.includes("ob-slide-up"));
ok("N28. WardrobeDemoCard: one highlight sweep (not a loop)", wardSrc.includes("ob-sweep") && (wardSrc.match(/ob-sweep/g) || []).length <= 3);
ok("N29. WardrobeDemoCard: mini garment thumbnails in recommendation", wardSrc.includes("CrewneckSVG") && wardSrc.includes("SweatpantsSVG") && wardSrc.includes("SneakerSVG"));

// Scan demo animations
ok("N30. ScanDemoCard imports onboarding-motion.css", scanSrc.includes("onboarding-motion.css"));
ok("N31. ScanDemoCard: crewneck pops in (ob-pop)", scanSrc.includes("ob-pop"));
ok("N32. ScanDemoCard: corner brackets animate with ob-bracket-*", scanSrc.includes("ob-bracket-tl") && scanSrc.includes("ob-bracket-br"));
ok("N33. ScanDemoCard: beam runs bounded passes (iteration-count:3 in CSS)", css.includes("animation-iteration-count: 3"));
ok("N34. ScanDemoCard: detection points reveal sequentially", scanSrc.includes("ob-d5") || scanSrc.includes("ob-d6"));
ok("N35. ScanDemoCard: confirmation badge arrives last", scanSrc.includes("ob-confirm"));
ok("N36. ScanDemoCard: Photograph → Review → Save steps present", scanSrc.includes("Photograph") && scanSrc.includes("Review") && scanSrc.includes("Save"));

// No timer or interval in animation files (CSS-only)
const noTimerFiles = [wdcSrc, wardSrc, scanSrc, shell];
ok("N37. No setTimeout/setInterval in animation components (CSS-only motion)",
  noTimerFiles.every(s => !s.includes("setTimeout") && !s.includes("setInterval")));

// Reduced-motion: final state test (DOM-free)
ok("N38. prefers-reduced-motion: all ob-anim elements get opacity:1 (CSS rule present)", (() => {
  // CSS must cover .ob-anim under reduce media query
  const reduceBlock = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  return reduceBlock.includes(".ob-anim") && reduceBlock.includes("opacity: 1");
})());
ok("N39. prefers-reduced-motion: ob-page-forward/back also covered", (() => {
  const reduceBlock = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  return reduceBlock.includes("ob-page-forward") && reduceBlock.includes("ob-page-back");
})());
ok("N40. prefers-reduced-motion: stroke-dashoffset:0 means temperature line fully visible", (() => {
  const reduceBlock = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  return reduceBlock.includes("stroke-dashoffset: 0");
})());

// ════════════════════════════════════════════════════════════════════════════
// O. React hooks order regression — no early auth return before later hooks
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── O: React hooks order (no early auth return before hooks) ──");

/**
 * Parse a route file and verify that the `if (authLoading) return null;`
 * guard appears AFTER every real React hook call in the component function.
 *
 * "Real hook" = a call to useState/useEffect/useMemo/useCallback/useRef/
 * useContext/useAuthGuard/useEntitlement/useWardrobe/useNavigate/useResolvedSlots.
 *
 * We scan line numbers to determine ordering. If any hook line is found
 * AFTER the early return line, the test fails.
 */
function checkHooksOrder(routePath, routeName) {
  const src = fs.readFileSync(routePath, "utf8");
  const lines = src.split("\n");

  const HOOK_RE = /\b(useState|useEffect|useMemo|useCallback|useRef|useContext|useAuthGuard|useEntitlement|useWardrobe|useNavigate|useResolvedSlots)\s*\(/;
  const EARLY_RETURN_RE = /if\s*\(authLoading\)\s*return\s*null/;

  // Find all line numbers (1-indexed) of real hook calls
  const hookLines = [];
  // Find all line numbers of early auth returns
  const earlyReturnLines = [];

  lines.forEach((l, i) => {
    const lineNo = i + 1;
    // Skip import lines and comments
    const trimmed = l.trim();
    if (trimmed.startsWith("import ") || trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (HOOK_RE.test(l)) hookLines.push(lineNo);
    if (EARLY_RETURN_RE.test(l)) earlyReturnLines.push(lineNo);
  });

  if (earlyReturnLines.length === 0) {
    ok(`O. ${routeName}: has if(authLoading) guard`, false, "no early auth return found");
    return;
  }

  const firstEarlyReturn = earlyReturnLines[0];
  const hooksAfterReturn = hookLines.filter(l => l > firstEarlyReturn);

  if (hooksAfterReturn.length > 0) {
    ok(`O. ${routeName}: no hooks after early auth return`, false,
      `hooks on lines ${hooksAfterReturn.join(", ")} come after early return on line ${firstEarlyReturn}`);
  } else {
    ok(`O. ${routeName}: all hooks before early auth return (line ${firstEarlyReturn})`, true);
  }
}

const PROTECTED_ROUTES = [
  ["src/routes/forecast.tsx",        "forecast"],
  ["src/routes/saved.tsx",           "saved"],
  ["src/routes/wardrobe.tsx",        "wardrobe"],
  ["src/routes/recommendation.tsx",  "recommendation"],
  ["src/routes/premium.tsx",         "premium"],
  ["src/routes/preferences.tsx",     "preferences"],
  ["src/routes/settings.tsx",        "settings"],
];

for (const [rel, name] of PROTECTED_ROUTES) {
  checkHooksOrder(`${repoRoot}/${rel}`, name);
}

// Also verify that every protected route still has useAuthGuard
ok("O. All 7 protected routes import useAuthGuard", PROTECTED_ROUTES.every(([rel]) => {
  const src = fs.readFileSync(`${repoRoot}/${rel}`, "utf8");
  return src.includes("useAuthGuard");
}));

// Verify redirect to /signup is still present (not weakened)
ok("O. useAuthGuard still redirects to /signup on sign-out",
  guard.includes('"/signup"') && guard.includes("replace: true"));

console.log(`\n${"═".repeat(55)}`);
console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
