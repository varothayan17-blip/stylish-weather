/**
 * introState.ts — versioned onboarding introduction state
 *
 * Tracks ONLY the introductory screens (the 4-screen value proposition tour).
 * Separate from prefs.onboarded (which gates the main app experience).
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Both status and step are stored together in a single localStorage record:
 *   Key:   "aeruvo:intro-v1"
 *   Value: { status: IntroStatus; step: number }
 *
 * localStorage is used (not sessionStorage) so the exact step survives
 * browser close/reopen. A returning visitor who closed the browser mid-tour
 * resumes at the exact screen they left. Malformed or missing data falls
 * back to { status: "new", step: 0 }.
 *
 * ── States ───────────────────────────────────────────────────────────────────
 *   "new"         — never seen any intro screen (truly new visitor)
 *   "in-progress" — currently moving through screens 1–3
 *   "skipped"     — pressed "Skip introduction"
 *   "done"        — pressed final "Continue" or "Continue as guest"
 *
 * ── Existing-user protection ──────────────────────────────────────────────────
 * shouldShowIntro(onboarded) returns false whenever onboarded === true.
 * This check is always the outer gate — it is independent of the intro key.
 * Bumping the key version (e.g. "aeruvo:intro-v2") only affects users who
 * are NOT yet onboarded and had previously skipped or completed the OLD tour
 * under the old key. It NEVER forces onboarded users back through the intro.
 *
 * ── Version ──────────────────────────────────────────────────────────────────
 * Do not bump the key without a product decision. Bumping does NOT affect
 * any user who has prefs.onboarded === true.
 */

const INTRO_KEY = "aeruvo:intro-v1";

export type IntroStatus = "new" | "in-progress" | "skipped" | "done";

export interface IntroRecord {
  status: IntroStatus;
  /** Which step the user is on: 0=welcome, 1=plan, 2=wardrobe, 3=scan */
  step: number;
}

const DEFAULT: IntroRecord = { status: "new", step: 0 };

export function loadIntro(): IntroRecord {
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(INTRO_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<IntroRecord>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveIntro(record: IntroRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INTRO_KEY, JSON.stringify(record));
  } catch {
    // localStorage unavailable (e.g. private browsing quota) — continue silently
  }
}

export function markInProgress(step: number): void {
  saveIntro({ status: "in-progress", step });
}

export function markSkipped(): void {
  saveIntro({ status: "skipped", step: 0 });
}

export function markDone(): void {
  saveIntro({ status: "done", step: 0 });
}

/**
 * Returns true when the intro should be shown to this visitor.
 *
 * ALWAYS returns false when onboarded === true — existing authenticated users
 * and guests who completed setup are never shown the intro regardless of
 * which intro version key is present.
 */
export function shouldShowIntro(onboarded: boolean): boolean {
  if (onboarded) return false;
  const { status } = loadIntro();
  return status === "new" || status === "in-progress";
}

/**
 * Guest-safe post-intro destination.
 *
 * Mirrors signup.tsx postSignInDestination():
 *   prefs.city present → "/" (home has everything it needs)
 *   no city            → "/preferences" (guest must pick a city first)
 *
 * Call this AFTER setting onboarded=true so that the home route will not
 * redirect back to /welcome when the guest eventually navigates to "/".
 */
export function guestDestination(prefs: { city?: unknown }): "/" | "/preferences" {
  return prefs.city ? "/" : "/preferences";
}

// ── Guest setup state ─────────────────────────────────────────────────────────
/**
 * Separate key for tracking a guest who has dismissed the intro tour but
 * has not yet completed the required city preference setup.
 *
 * States:
 *   absent / false  — no pending setup (normal user, or setup complete)
 *   true            — guest is mid-setup in /preferences
 *
 * Lifecycle:
 *   1. continueAsGuest() in welcome.tsx sets this when guest has no city.
 *   2. /preferences reads it and shows the "Save and continue" button.
 *   3. Completing /preferences (with a city) calls markGuestSetupComplete()
 *      which sets prefs.onboarded=true and clears this flag.
 *   4. / (home route) checks this key: if set, redirect to /preferences
 *      instead of /welcome, and do NOT set onboarded=true yet.
 *
 * This prevents a guest from being silently treated as fully onboarded
 * before they have chosen a city, while still preserving all their
 * existing local data across refresh and browser close/reopen.
 */
const GUEST_SETUP_KEY = "aeruvo:guest-setup";

/** Returns true when a guest has a pending incomplete city-preference setup. */
export function isGuestSetupPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(GUEST_SETUP_KEY) === "1";
  } catch {
    return false;
  }
}

/** Call when a cityless guest is sent to /preferences. */
export function markGuestSetupPending(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GUEST_SETUP_KEY, "1");
  } catch {}
}

/** Call when the guest completes /preferences (city chosen, onboarded set). */
export function clearGuestSetupPending(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GUEST_SETUP_KEY);
  } catch {}
}
