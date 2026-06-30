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
 * Migrates local prefs+favorites to Firestore under the real uid,
 * then pulls and merges cloud data back.
 */
async function afterSignIn(uid: string, name: string, email: string): Promise<void> {
  const local = loadPrefs();
  const withIdentity = { ...local, name: name || local.name, email, onboarded: true };

  // Pull cloud prefs and merge — cloud premium/trial/settings win.
  const merged = await cloudSync.pullAndMergePrefs(uid, withIdentity);
  savePrefs(merged);

  // Push merged prefs back (covers both new user and returning user).
  await cloudSync.syncPrefs(uid, merged);

  // Migrate/restore favorites.
  await migrateFavorites(uid).catch(() => {});
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
export async function getUid(): Promise<string | null> {
  const fbAuth = await getFirebaseAuth();
  return fbAuth?.currentUser?.uid ?? null;
}

/**
 * Subscribes to Firebase Auth state changes.
 * On session resume (app reopen, page refresh), syncs Firestore prefs
 * so premium status and trial info stay current.
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
        merged.premium !== local.premium ||
        merged.trialEndsAt !== local.trialEndsAt ||
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
