/**
 * introState.ts — versioned onboarding introduction state
 *
 * Tracks ONLY the introductory screens (the 4-screen value proposition tour).
 * Separate from prefs.onboarded and Firebase Auth state.
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Both status and step are stored in a single localStorage record:
 *   Key:   "aeruvo:intro-v1"
 *   Value: { status: IntroStatus; step: number }
 *
 * localStorage persists across browser close/reopen so a visitor who closes
 * mid-tour resumes at the exact screen they left.
 * Malformed or missing data falls back to { status: "new", step: 0 }.
 *
 * ── States ───────────────────────────────────────────────────────────────────
 *   "new"         — never seen any intro screen
 *   "in-progress" — currently moving through screens 1–3
 *   "skipped"     — pressed "Skip introduction"
 *   "done"        — reached the final screen and pressed "Create your free account"
 *
 * ── Existing-user protection ──────────────────────────────────────────────────
 * shouldShowIntro(onboarded) returns false whenever onboarded === true.
 * Bumping the key version only affects non-onboarded users who previously
 * skipped or completed the OLD tour. It NEVER forces onboarded users back.
 *
 * ── First-setup marker ───────────────────────────────────────────────────────
 * A separate key "aeruvo:first-setup" signals that the current authenticated
 * user needs to complete required preferences before entering the app.
 * Preferences writes this on detecting a post-auth first-time visit,
 * and clears it after "Save and continue" succeeds.
 * Existing authenticated users editing preferences from Settings never
 * trigger this key.
 *
 * ── Legacy guest cleanup ─────────────────────────────────────────────────────
 * Previous versions allowed guest access and stored "aeruvo:guest-setup".
 * clearObsoleteGuestMarker() removes ONLY that routing marker. It never
 * deletes user data (prefs, wardrobe, favorites). Call this on app mount.
 */

const INTRO_KEY      = "aeruvo:intro-v1";
export const FIRST_SETUP_KEY = "aeruvo:first-setup";

export type IntroStatus = "new" | "in-progress" | "skipped" | "done";

export interface IntroRecord {
  status: IntroStatus;
  /** Which step the user is on: 0=welcome, 1=plan, 2=wardrobe, 3=scan */
  step: number;
}

const DEFAULT: IntroRecord = { status: "new", step: 0 };

function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, value); } catch {}
}
function lsRemove(key: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch {}
}

export function loadIntro(): IntroRecord {
  const raw = lsGet(INTRO_KEY);
  if (!raw) return { ...DEFAULT };
  try { return { ...DEFAULT, ...(JSON.parse(raw) as Partial<IntroRecord>) }; }
  catch { return { ...DEFAULT }; }
}

export function saveIntro(record: IntroRecord): void {
  lsSet(INTRO_KEY, JSON.stringify(record));
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
 * Returns true when the intro tour should be shown.
 * Always false when the user is already onboarded (auth'd + prefs done).
 */
export function shouldShowIntro(onboarded: boolean): boolean {
  if (onboarded) return false;
  const { status } = loadIntro();
  return status === "new" || status === "in-progress";
}

// ── UID-scoped first-setup marker ────────────────────────────────────────────
/**
 * First-setup state is scoped to the authenticated UID.
 * This prevents User A's incomplete setup from affecting User B when they
 * sign in on the same browser.
 *
 * Key format: "aeruvo:first-setup:<uid>"
 * The uid suffix means each user gets an independent marker.
 * Sign-out does not automatically clear the marker, but since the key is
 * uid-scoped, it cannot interfere with a different user's session.
 * The marker is cleared on successful "Save and continue" completion.
 */

function firstSetupKey(uid: string): string {
  return `${FIRST_SETUP_KEY}:${uid}`;
}

/** True when the specified authenticated user still needs to complete setup. */
export function isFirstSetupPending(uid: string): boolean {
  return lsGet(firstSetupKey(uid)) === "1";
}

/** Set when routing a post-auth user to /preferences for the first time. */
export function markFirstSetupPending(uid: string): void {
  lsSet(firstSetupKey(uid), "1");
}

/** Clear after "Save and continue" succeeds. Only affects the specified user. */
export function clearFirstSetupPending(uid: string): void {
  lsRemove(firstSetupKey(uid));
}

// ── Legacy guest cleanup ─────────────────────────────────────────────────────

/**
 * Remove the now-obsolete "aeruvo:guest-setup" routing marker from any
 * browser that still has it from the previous guest-access architecture.
 *
 * SAFE: removes only the routing marker, never prefs, wardrobe or favorites.
 * The user's local data remains intact for migration after authentication.
 */
export function clearObsoleteGuestMarker(): void {
  lsRemove("aeruvo:guest-setup");
}

// ── Pre-auth onboarding draft ─────────────────────────────────────────────────
/**
 * Dedicated localStorage key for pre-authentication personalization answers.
 *
 * WHY a separate key (not weatherwear:prefs):
 *   weatherwear:prefs can contain a previous authenticated user's data on a shared
 *   browser. Writing pre-auth answers there would cause User B to inherit or
 *   overwrite User A's city, sensitivity, commute or clothing profile, and
 *   afterSignIn() would upload mixed data to User B's cloud account.
 *
 *   This key is ONLY for the unauthenticated onboarding journey.
 *   It is never merged into weatherwear:prefs before Firebase authentication.
 *   After successful authentication, auth.ts reads the draft, merges it
 *   deliberately, then clears it.
 *
 * Draft fields (subset of Prefs — no name, email, onboarded, theme):
 *   clothingProfile, coldSensitivity, commute, city
 *
 * draft.completed: true when the user has answered all questions and tapped
 *   "Continue to create your account". This distinguishes a complete draft
 *   (should be applied for new accounts) from a partially-filled one.
 *   It does NOT mean the user is authenticated or onboarded.
 */
const DRAFT_KEY = "aeruvo:onboarding-draft:v1";

export interface OnboardingDraft {
  clothingProfile?: string;
  coldSensitivity?: "cold" | "normal" | "hot";
  commute?: string;
  city?: { name: string; lat: number; lon: number; countryCode?: string };
  /** True only after the user taps "Continue to create your account". */
  completed?: boolean;
}

export function loadOnboardingDraft(): OnboardingDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as OnboardingDraft;
  } catch {
    return {};
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

/** Mark draft as completed (user tapped "Continue to create your account"). */
export function markDraftCompleted(): void {
  const draft = loadOnboardingDraft();
  saveOnboardingDraft({ ...draft, completed: true });
}
