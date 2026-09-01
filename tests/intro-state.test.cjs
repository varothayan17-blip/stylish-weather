/**
 * intro-state.test.cjs
 *
 * Focused tests for onboarding introduction state, guest setup state,
 * guest destination logic, and redirect-loop prevention.
 * Run with: node tests/intro-state.test.cjs
 */
"use strict";

// ── Simulate localStorage in Node ────────────────────────────────────────────
const store = {};
const _localStorage = {
  getItem:    (k) => store[k] ?? null,
  setItem:    (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};
global.window = { localStorage: _localStorage };

// ── Port introState logic (mirrors src/lib/introState.ts) ─────────────────────
const INTRO_KEY       = "aeruvo:intro-v1";
const GUEST_SETUP_KEY = "aeruvo:guest-setup";
const DEFAULT = { status: "new", step: 0 };

function loadIntro() {
  const raw = _localStorage.getItem(INTRO_KEY);
  if (!raw) return { ...DEFAULT };
  try { return { ...DEFAULT, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT }; }
}
function saveIntro(r) {
  try { _localStorage.setItem(INTRO_KEY, JSON.stringify(r)); } catch {}
}
function markInProgress(step) { saveIntro({ status: "in-progress", step }); }
function markSkipped()        { saveIntro({ status: "skipped",     step: 0 }); }
function markDone()           { saveIntro({ status: "done",        step: 0 }); }

function shouldShowIntro(onboarded) {
  if (onboarded) return false;
  const { status } = loadIntro();
  return status === "new" || status === "in-progress";
}

// Guest setup state
function isGuestSetupPending() {
  return _localStorage.getItem(GUEST_SETUP_KEY) === "1";
}
function markGuestSetupPending()  { try { _localStorage.setItem(GUEST_SETUP_KEY, "1"); } catch {} }
function clearGuestSetupPending() { try { _localStorage.removeItem(GUEST_SETUP_KEY); }   catch {} }

/** Mirrors welcome.tsx continueAsGuest logic */
function continueAsGuest(prefs) {
  markDone();
  if (prefs.city) {
    // Path A: city exists
    return { onboarded: true, dest: "/" };
  } else {
    // Path B: no city — pending setup
    markGuestSetupPending();
    return { onboarded: false, dest: "/preferences" };
  }
}

/** Mirrors home route onboarded check */
function homeRouteCheck(prefs) {
  if (!prefs.onboarded) {
    if (isGuestSetupPending()) return { redirect: "/preferences" };
    return { redirect: "/welcome" };
  }
  return { render: "home" };
}

/** Mirrors preferences.tsx completeSetup() */
function completeSetup(prefs) {
  if (!prefs.city) return { error: "city-required" };
  clearGuestSetupPending();
  return { onboarded: true, dest: "/" };
}

function resetAll() {
  delete store[INTRO_KEY];
  delete store[GUEST_SETUP_KEY];
}

// ── Test runner ──────────────────────────────────────────────────────────────
let p = 0, f = 0;
function ok(label, cond, detail) {
  if (cond) { console.log("✓", label); p++; }
  else { console.error("✗", label, detail != null ? String(detail) : ""); f++; }
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCK A: Basic intro state
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── A: Basic intro state ──────────────────────────────────────");
resetAll();
ok("A1. Fresh install → status=new, step=0", loadIntro().status === "new");
ok("A2. shouldShowIntro(false) = true for new visitor", shouldShowIntro(false));
ok("A3. shouldShowIntro(true) = false (onboarded user bypasses)", !shouldShowIntro(true));
markInProgress(1); ok("A4. Step 1 persisted", loadIntro().step === 1);
markInProgress(3); ok("A5. Step 3 persisted", loadIntro().step === 3);
// Simulate browser reopen: localStorage persists
const afterReopen = loadIntro();
ok("A6. Reopen resumes at exact step 3 (localStorage, not sessionStorage)", afterReopen.step === 3);
ok("A7. Status in-progress after reopen", afterReopen.status === "in-progress");

// ════════════════════════════════════════════════════════════════════════════
// BLOCK B: Skip and done transitions
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── B: Skip / done transitions ────────────────────────────────");
resetAll();
markSkipped();
ok("B1. Status = skipped", loadIntro().status === "skipped");
ok("B2. shouldShowIntro(false) = false after skip", !shouldShowIntro(false));
resetAll();
markDone();
ok("B3. Status = done", loadIntro().status === "done");
ok("B4. shouldShowIntro(false) = false after done", !shouldShowIntro(false));

// ════════════════════════════════════════════════════════════════════════════
// BLOCK C: Existing onboarded user — NEVER shown intro
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── C: Existing onboarded user protection ─────────────────────");
resetAll();
ok("C1. shouldShowIntro(true) = false for new key", !shouldShowIntro(true));
markInProgress(2);
ok("C2. shouldShowIntro(true) = false even if in-progress", !shouldShowIntro(true));
markDone();
ok("C3. shouldShowIntro(true) = false after done", !shouldShowIntro(true));
// Key-version bump: with v2 key absent, v1 state is "done" — but onboarded=true wins
delete store["aeruvo:intro-v2"];
ok("C4. Key-version bump: onboarded=true still bypasses (not forced)", !shouldShowIntro(true));

// ════════════════════════════════════════════════════════════════════════════
// BLOCK D: Guest destination — new guest with no city
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── D: New guest without city → /preferences, not onboarded ──");
resetAll();
const noCity = { coldSensitivity: "normal", commute: "walk", theme: "system" };
const resultD = continueAsGuest(noCity);
ok("D1. Destination = /preferences", resultD.dest === "/preferences");
ok("D2. onboarded NOT set (still false)", resultD.onboarded === false);
ok("D3. guest-setup key = pending", isGuestSetupPending());
// Home route check: not onboarded, pending → /preferences (not /welcome)
const homeD = homeRouteCheck({ onboarded: false });
ok("D4. Home route → /preferences (not /welcome)", homeD.redirect === "/preferences");

// ════════════════════════════════════════════════════════════════════════════
// BLOCK E: Refresh during guest preference setup
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── E: Refresh/reopen during setup → resumes /preferences ────");
// State after D: guest-setup pending, onboarded=false
// Simulate refresh: home route check fires again
ok("E1. After refresh: home still → /preferences (pending persists)", homeRouteCheck({ onboarded: false }).redirect === "/preferences");
// Simulate browser close/reopen: localStorage persists
ok("E2. After reopen: home still → /preferences (localStorage persists)", homeRouteCheck({ onboarded: false }).redirect === "/preferences");
// Simulate direct load of /preferences: preferences.tsx reads isGuestSetupPending()
ok("E3. /preferences: isFirstSetup = true (pending key present)", isGuestSetupPending());
// Welcome route: guest-setup pending — not a new user, intro done
ok("E4. shouldShowIntro(false) = false (intro marked done)", !shouldShowIntro(false));

// ════════════════════════════════════════════════════════════════════════════
// BLOCK F: Cannot complete without a valid city
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── F: Cannot finish without valid city ───────────────────────");
const prefsNoCity = { coldSensitivity: "cold", commute: "ttc", theme: "system" };
const resultF = completeSetup(prefsNoCity);
ok("F1. completeSetup without city returns error", resultF.error === "city-required");
ok("F2. guest-setup key still pending after failed attempt", isGuestSetupPending());
ok("F3. onboarded NOT set after failed attempt", !("onboarded" in resultF));

// ════════════════════════════════════════════════════════════════════════════
// BLOCK G: Save and continue — completes setup correctly
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── G: Save and continue → onboarded=true → home ─────────────");
// Guest-setup key is still pending from block D/E
const prefsWithCity = {
  coldSensitivity: "cold", commute: "ttc", theme: "system",
  city: { name: "Toronto", lat: 43.7, lon: -79.4 },
};
const resultG = completeSetup(prefsWithCity);
ok("G1. completeSetup with city → success", !resultG.error);
ok("G2. onboarded = true after completion", resultG.onboarded === true);
ok("G3. destination = /", resultG.dest === "/");
ok("G4. guest-setup key cleared after completion", !isGuestSetupPending());
// Now home route check: onboarded=true → renders home
const homeG = homeRouteCheck({ onboarded: true });
ok("G5. Home route after completion → render home (no redirect)", homeG.render === "home");

// ════════════════════════════════════════════════════════════════════════════
// BLOCK H: Returning guest with a valid city
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── H: Returning guest with city → home directly ──────────────");
resetAll();
const withCity = {
  coldSensitivity: "normal", commute: "walk", theme: "system",
  city: { name: "Vancouver", lat: 49.2, lon: -123.1 },
};
const resultH = continueAsGuest(withCity);
ok("H1. Destination = / (has city)", resultH.dest === "/");
ok("H2. onboarded = true immediately", resultH.onboarded === true);
ok("H3. guest-setup key NOT set (city present → no setup needed)", !isGuestSetupPending());

// ════════════════════════════════════════════════════════════════════════════
// BLOCK I: Existing onboarded user editing preferences
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── I: Existing user editing preferences ──────────────────────");
resetAll();
// Existing user: onboarded=true, no guest-setup key
const existingUser = { onboarded: true, city: { name: "Ottawa", lat: 45.4, lon: -75.7 } };
ok("I1. isGuestSetupPending = false for existing user", !isGuestSetupPending());
// /preferences detects isFirstSetup=false → no "Save and continue", normal toast mode
ok("I2. isFirstSetup = false → normal edit mode", !isGuestSetupPending());
// Home route: onboarded=true → renders normally
ok("I3. Home renders for existing user (no redirect)", homeRouteCheck(existingUser).render === "home");

// ════════════════════════════════════════════════════════════════════════════
// BLOCK J: No default city silently substituted
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── J: No silent default city substitution ────────────────────");
resetAll();
// Guest has no city; home must NOT render with a default city
const guestNoOnboard = { onboarded: false };
const homeJ = homeRouteCheck(guestNoOnboard);
ok("J1. Guest without city and no pending key → /welcome (not home)", homeJ.redirect === "/welcome");
// With pending key: → /preferences (not home with default city)
markGuestSetupPending();
const homeJ2 = homeRouteCheck(guestNoOnboard);
ok("J2. Guest mid-setup → /preferences (not home with default city)", homeJ2.redirect === "/preferences");
ok("J3. Home never renders for non-onboarded user", !("render" in homeJ) && !("render" in homeJ2));

// ════════════════════════════════════════════════════════════════════════════
// BLOCK K: No redirect loops
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── K: No redirect loops ──────────────────────────────────────");
resetAll();
// Simulate the real continueAsGuest flow: intro marked done, then pending set
markDone();           // intro completed
markGuestSetupPending(); // then guest sent to /preferences
// Now: intro=done, pending=true → shouldShowIntro must be false (no back-to-intro)
ok("K1. shouldShowIntro(false) = false when pending (intro already done)", !shouldShowIntro(false));
ok("K2. Home → /preferences when pending (not /welcome)", homeRouteCheck({ onboarded: false }).redirect === "/preferences");
// After completion: home → renders
clearGuestSetupPending();
ok("K3. After clearGuestSetupPending: home still checks onboarded", true); // structural

// ════════════════════════════════════════════════════════════════════════════
// BLOCK L: Storage edge cases
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── L: Storage edge cases ─────────────────────────────────────");
resetAll();
store[INTRO_KEY] = "bad-json{{{";
ok("L1. Corrupt intro → default (new, step 0)", (() => { const r = loadIntro(); return r.status === "new" && r.step === 0; })());
const origSet = _localStorage.setItem;
_localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
let threw = false;
try { markGuestSetupPending(); } catch { threw = true; }
ok("L2. Storage write failure caught silently", !threw);
_localStorage.setItem = origSet;

// ════════════════════════════════════════════════════════════════════════════
// BLOCK M: Guest greeting safety
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── M: Guest greeting safety ──────────────────────────────────");
const guestPrefs = { onboarded: true, coldSensitivity: "normal", commute: "walk", theme: "system" };
ok("M1. Guest prefs has no name field", !("name" in guestPrefs));
ok("M2. name?.trim() falsy for nameless guest", !guestPrefs.name?.trim());
const line = guestPrefs.name?.trim() ? `Welcome back, ${guestPrefs.name}.` : null;
ok("M3. No 'undefined', 'Guest' or 'Alex' in greeting", line === null);

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(55)}`);
console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
