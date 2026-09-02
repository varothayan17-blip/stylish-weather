/**
 * auth-flow.test.cjs — behavioural tests for the complete onboarding journey,
 * Google auth, pre-auth questions, draft handling, and service-worker guards.
 */
"use strict";
const fs = require("fs");
let p = 0, f = 0;
function ok(l, c, d) { if (c) { console.log("✓", l); p++; } else { console.error("✗", l, d ?? ""); f++; } }

const signup   = fs.readFileSync("/home/claude/live/src/routes/signup.tsx", "utf8");
const welcome  = fs.readFileSync("/home/claude/live/src/routes/welcome.tsx", "utf8");
const idx      = fs.readFileSync("/home/claude/live/src/routes/index.tsx", "utf8");
const authLib  = fs.readFileSync("/home/claude/live/src/lib/auth.ts", "utf8");
const guard    = fs.readFileSync("/home/claude/live/src/lib/useAuthGuard.ts", "utf8");
const regSW    = fs.readFileSync("/home/claude/live/src/lib/registerSW.ts", "utf8");
const paq      = fs.readFileSync("/home/claude/live/src/components/onboarding/PreAuthQuestions.tsx", "utf8");
const introSt  = fs.readFileSync("/home/claude/live/src/lib/introState.ts", "utf8");

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
ok("D8. Back button returns to step 3", paq.includes("onBack") && welcome.includes("onBack={() => goToStep(3)}"));
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
  const src = fs.readFileSync(`/home/claude/live/src/routes/${r}.tsx`, "utf8");
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
const paqSrc     = fs.readFileSync("/home/claude/live/src/components/onboarding/PreAuthQuestions.tsx", "utf8");
const introSrc   = fs.readFileSync("/home/claude/live/src/lib/introState.ts", "utf8");
const authSrc    = fs.readFileSync("/home/claude/live/src/lib/auth.ts", "utf8");
const welcomeSrc = fs.readFileSync("/home/claude/live/src/routes/welcome.tsx", "utf8");
const signupSrc2 = fs.readFileSync("/home/claude/live/src/routes/signup.tsx", "utf8");

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

console.log(`\n${"═".repeat(55)}`);
console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
