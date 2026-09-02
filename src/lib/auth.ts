import { getFirebaseAuth, isFirebaseConfigured } from "./firebase";
import { loadPrefs, savePrefs, loadFavorites, FAV_KEY } from "./preferences";
import { cloudSync } from "./cloudSync";

/**
 * Auth abstraction — Email+Password via Firebase Auth.
 *
 * Two implementations:
 *   localOnlyAuth        — active when Firebase env vars are absent. Everything
 *                          stays in localStorage. Identical behaviour to the MVP.
 *   firebaseEmailAuth    — active when Firebase is configured. Uses
 *                          createUserWithEmailAndPassword / signInWithEmailAndPassword.
 *                          On first authenticated sign-in, migrates local prefs and
 *                          favorites to users/{uid} in Firestore. Subsequent operations
 *                          use the real Firebase Auth uid, not an email-derived key.
 *
 * Why Email+Password over Email-Link (magic link):
 *   Email-link requires authDomain configuration, email delivery testing, and
 *   special handling for the link-open flow across devices. Email+Password works
 *   as soon as "Email/Password" is enabled in Firebase Console → Authentication
 *   → Sign-in method. The UX is one extra field (password ≥ 6 chars) in exchange
 *   for immediate, reliable, testable authentication.
 */

export interface AuthProvider {
  id: string;
  isActive(): boolean;
  signIn(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

// ─── Local-only (Firebase not configured) ─────────────────────────────────
export const localOnlyAuth: AuthProvider = {
  id: "local-only",
  isActive: () => false,
  async signIn(name, email) {
    const prefs = loadPrefs();
    savePrefs({ ...prefs, name, email, onboarded: true });
  },
  async signOut() {
    const prefs = loadPrefs();
    savePrefs({ ...prefs, name: undefined, email: undefined, onboarded: false });
  },
};

// ─── Firebase Email+Password ────────────────────────────────────────────────
export const firebaseEmailAuth: AuthProvider = {
  id: "firebase-email-password",
  isActive: isFirebaseConfigured,

  async signIn(name, email, password) {
    const fbAuth = await getFirebaseAuth();
    if (!fbAuth) throw new Error("Firebase is not configured.");

    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } =
      await import("firebase/auth");
    const { FirebaseError } = await import("firebase/app");

    let uid: string;

    try {
      // Try to create the account first.
      const cred = await createUserWithEmailAndPassword(fbAuth, email, password);
      uid = cred.user.uid;
      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }
    } catch (rawErr: unknown) {
      if (rawErr instanceof FirebaseError && rawErr.code === "auth/email-already-in-use") {
        // Returning user — sign them in with their password.
        const cred = await signInWithEmailAndPassword(fbAuth, email, password);
        uid = cred.user.uid;
        // Update display name if it changed
        if (name && cred.user.displayName !== name) {
          await updateProfile(cred.user, { displayName: name }).catch(() => {});
        }
      } else {
        throw rawErr;
      }
    }

    await afterSignIn(uid, name, email);
  },

  async signOut() {
    // Clean up the current device's FCM token and Firestore record before
    // signing out. We do this while the uid is still available.
    // Failure is non-fatal — sign-out always completes.
    try {
      const uid = await getUid();
      if (uid) {
        const { cleanupDeviceOnSignOut } = await import("./notifications");
        await cleanupDeviceOnSignOut(uid);
      }
    } catch {
      // Non-fatal — proceed with sign-out
    }
    const fbAuth = await getFirebaseAuth();
    if (fbAuth) {
      const { signOut } = await import("firebase/auth");
      await signOut(fbAuth);
    }
    const prefs = loadPrefs();
    savePrefs({ ...prefs, onboarded: false });
  },
};

/**
 * Called after a successful Firebase sign-in.
 *
 * Draft handling:
 *   Reads the dedicated onboarding draft key (aeruvo:onboarding-draft:v1) —
 *   never weatherwear:prefs — so User A's persisted prefs cannot contaminate
 *   User B's new account. The draft is only applied when it was explicitly
 *   completed by the user in the current new-user journey (draft.completed===true).
 *
 *   For NEW users (no Firestore document): draft fields fill the base payload.
 *   For RETURNING users (cloud doc exists): cloud wins for all existing fields;
 *   draft is not applied to avoid overwriting the user's stored preferences.
 *   (pullAndMergePrefs already implements cloud-wins logic.)
 *
 *   Draft is cleared after successful persistence.
 */
async function afterSignIn(uid: string, name: string, email: string): Promise<void> {
  // Import draft functions without circular deps — introState has no auth dep.
  const { loadOnboardingDraft, clearOnboardingDraft } = await import("./introState");
  const draft = loadOnboardingDraft();

  // Base payload: authenticated identity + onboarded flag.
  // We deliberately do NOT spread weatherwear:prefs here to avoid User A
  // contaminating User B on a shared browser.
  const base: import("./preferences").Prefs = {
    coldSensitivity: "normal",
    commute: "walk",
    theme: "system",
    name: name,
    email,
    onboarded: true,
    ...(draft.completed === true
      ? {
          // Apply draft fields only when the user completed the question flow.
          ...(draft.coldSensitivity ? { coldSensitivity: draft.coldSensitivity } : {}),
          ...(draft.commute ? { commute: draft.commute as import("./preferences").Commute } : {}),
          ...(draft.clothingProfile
            ? { clothingProfile: draft.clothingProfile as import("./clothingProfiles").ClothingProfileId }
            : {}),
          ...(draft.city ? { city: draft.city } : {}),
        }
      : {}),
  };

  // Pull cloud prefs and merge — cloud settings win for returning users.
  // For new users (no doc), base values are written as-is.
  const merged = await cloudSync.pullAndMergePrefs(uid, base);
  savePrefs(merged);
  await cloudSync.syncPrefs(uid, merged);
  await migrateFavorites(uid).catch(() => {});

  // Clear draft only after successful persistence.
  clearOnboardingDraft();
}

async function migrateFavorites(uid: string): Promise<void> {
  const cloudFavs = await cloudSync.pullFavorites(uid);
  const localFavs = loadFavorites();

  if (cloudFavs.length === 0) {
    // New user or first sign-in — push all local favorites to cloud.
    for (const fav of localFavs) {
      await cloudSync.syncFavorite(uid, fav);
    }
    return;
  }

  // Merge: add local-only favorites that aren't already in cloud.
  const cloudIds = new Set(cloudFavs.map((f) => f.id));
  const localOnly = localFavs.filter((f) => !cloudIds.has(f.id));
  for (const fav of localOnly) {
    await cloudSync.syncFavorite(uid, fav);
  }

  // Restore the combined list locally.
  const combined = [...localOnly, ...cloudFavs].slice(0, 50);
  if (typeof window !== "undefined") {
    localStorage.setItem(FAV_KEY, JSON.stringify(combined));
  }
}

export const auth: AuthProvider = isFirebaseConfigured() ? firebaseEmailAuth : localOnlyAuth;

/**
 * Returns the Firebase Auth uid of the currently signed-in user, or null.
 * Used by billing.ts, index.tsx, and recommendation.tsx when syncing favorites
 * without going through a full sign-in call.
 */
/**
 * Sign in with Google via Firebase redirect flow.
 *
 * ARCHITECTURE NOTE — same-origin authDomain is required:
 *   signInWithRedirect stores pending state and recovers it via the
 *   /__/auth/handler endpoint. In Safari 16.1+, Firefox 109+, and Chrome
 *   with third-party storage partitioning, the result can only be read back
 *   when that endpoint is same-origin with the app.
 *
 *   Production (www.aeruvo.app) requires:
 *     1. vercel.json rewrite: /__/auth/** → wethra-1aa65.firebaseapp.com/__/auth/**
 *     2. VITE_FIREBASE_AUTH_DOMAIN=www.aeruvo.app
 *   Local dev: VITE_FIREBASE_AUTH_DOMAIN=wethra-1aa65.firebaseapp.com
 *
 *   See: https://firebase.google.com/docs/auth/web/redirect-best-practices
 *
 * iOS PWA NOTE:
 *   Installed-PWA redirect behaviour on iOS requires real-device verification
 *   by the owner before this method can be declared production-ready for that
 *   platform. Firebase does not guarantee redirect reliability in standalone mode.
 *
 * Call from a direct user gesture. getGoogleRedirectResult() must be called
 * on every subsequent mount to consume the pending credential.
 */
/**
 * Returns true when the app is running on localhost/127.0.0.1.
 * On localhost, signInWithRedirect fails because the auth redirect handler
 * (/__/auth/handler) is served cross-origin from firebaseapp.com — browsers
 * block the third-party storage access needed to recover the result.
 * signInWithPopup works correctly on localhost and is used instead.
 */
function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

/**
 * Google sign-in — popup on localhost, redirect on production.
 *
 * Localhost: signInWithPopup — avoids cross-origin storage issue with redirect.
 * Production: signInWithRedirect — works with the /__/auth/** Vercel proxy
 *   and VITE_FIREBASE_AUTH_DOMAIN=www.aeruvo.app (same-origin authDomain).
 *   iOS PWA note: redirect must be verified on a real device.
 *
 * Both paths call afterSignIn exactly once and return the uid.
 * Popup path returns the uid directly. Redirect path returns void — the uid
 * is returned after the redirect by getGoogleRedirectResult().
 */
export async function signInWithGoogle(): Promise<string | null> {
  const fbAuth = await getFirebaseAuth();
  if (!fbAuth) throw new Error("Firebase is not configured.");
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");

  if (isLocalhost()) {
    // Popup: completes in this tab, no page reload needed.
    const result = await signInWithPopup(fbAuth, provider);
    const user = result.user;
    const name = user.displayName ?? "";
    const email = user.email ?? "";
    console.info("[google-auth] popup uid:", user.uid.slice(0, 4) + "***");
    await afterSignIn(user.uid, name, email);
    return user.uid;
  } else {
    // Redirect: navigates away; result recovered by getGoogleRedirectResult().
    await signInWithRedirect(fbAuth, provider);
    return null; // execution resumes on next page load
  }
}

/** @deprecated Use signInWithGoogle() — kept for backward compat if referenced elsewhere. */
export async function signInWithGoogleRedirect(): Promise<void> {
  const fbAuth = await getFirebaseAuth();
  if (!fbAuth) throw new Error("Firebase is not configured.");
  const { GoogleAuthProvider, signInWithRedirect } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  await signInWithRedirect(fbAuth, provider);
}

/**
 * Process the result of a Google redirect sign-in.
 * Must be called on every page mount (including after redirects) to consume
 * the pending credential. Returns null if no redirect result is pending.
 * Returns the uid on success, null if no result, throws on error.
 */
export async function getGoogleRedirectResult(): Promise<string | null> {
  const fbAuth = await getFirebaseAuth();
  if (!fbAuth) return null;
  const { getRedirectResult } = await import("firebase/auth");
  const result = await getRedirectResult(fbAuth);
  if (!result) return null;

  const user = result.user;
  const name = user.displayName ?? "";
  const email = user.email ?? "";

  console.info("[google-auth] redirect result uid:", user.uid.slice(0, 4) + "***");
  await afterSignIn(user.uid, name, email);
  return user.uid;
}

export async function getUid(): Promise<string | null> {
  const fbAuth = await getFirebaseAuth();
  return fbAuth?.currentUser?.uid ?? null;
}

/**
 * Subscribes to Firebase Auth state changes.
 * On session resume (app reopen, page refresh), syncs Firestore prefs
 * so preferences stay current.
 * Returns an unsubscribe function. Call from __root.tsx on app mount.
 * No-op (returns immediate unsubscribe) when Firebase is not configured.
 */
export async function subscribeToAuthState(
  onUidChange: (uid: string | null) => void,
): Promise<() => void> {
  const fbAuth = await getFirebaseAuth();
  if (!fbAuth) return () => {};

  const { onAuthStateChanged } = await import("firebase/auth");

  return onAuthStateChanged(fbAuth, async (user) => {
    if (!user) {
      onUidChange(null);
      return;
    }

    // User has an active session — sync Firestore prefs silently.
    const local = loadPrefs();
    try {
      const merged = await cloudSync.pullAndMergePrefs(user.uid, {
        ...local,
        name: user.displayName ?? local.name,
        email: user.email ?? local.email,
        onboarded: true,
      });
      // Only write back if something relevant changed.
      if (
        // premium/trialEndsAt comparisons removed in P1 — not in prefs anymore.
        merged.name !== local.name
      ) {
        savePrefs(merged);
      }
    } catch {
      // Silent failure — local state is always the fallback.
    }

    onUidChange(user.uid);
  });
}
