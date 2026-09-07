/**
 * styleProfileSync.ts — Firestore read/write for PersonalStyleProfile.
 *
 * Path: users/{uid}/styleProfile (a document, not a subcollection)
 * Written with merge:false so the entire profile is replaced atomically.
 *
 * Premium gate: this module does NOT check entitlement — the UI and
 * personalizeRecommendation() enforce it. Sync is always permitted so that
 * a lapsed-Premium user's data is preserved and can be restored.
 */

import { sanitizeStyleProfile, serializeStyleProfile } from "./styleProfile";
import type { PersonalStyleProfile } from "./styleProfile";

const PROFILE_SUBPATH = "styleProfile";

/**
 * Load the style profile for the authenticated user from Firestore.
 * Returns null when the document is absent or Firebase is not configured.
 * Never throws.
 */
export async function loadStyleProfile(uid: string): Promise<PersonalStyleProfile | null> {
  try {
    const { getFirestoreDb } = await import("./firebase");
    const db = await getFirestoreDb();
    if (!db) return null;

    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "users", uid, PROFILE_SUBPATH, "v1"));
    if (!snap.exists()) return null;
    return sanitizeStyleProfile(snap.data());
  } catch {
    return null;
  }
}

/**
 * Persist the style profile to Firestore.
 * Uses setDoc (not merge) so stale unknown keys are always removed.
 * Throws on Firestore write failure so the caller can show an error.
 */
export async function saveStyleProfile(
  uid: string,
  profile: PersonalStyleProfile,
): Promise<void> {
  const { getFirestoreDb } = await import("./firebase");
  const db = await getFirestoreDb();
  if (!db) throw new Error("Firestore is not available.");

  const { doc, setDoc } = await import("firebase/firestore");
  await setDoc(
    doc(db, "users", uid, PROFILE_SUBPATH, "v1"),
    serializeStyleProfile(profile),
  );
}
