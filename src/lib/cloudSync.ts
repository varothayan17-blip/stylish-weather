import { getFirestoreDb, isFirebaseConfigured } from "./firebase";
import type { Prefs, Favorite } from "./preferences";

/**
 * Firestore read/write — now keyed by Firebase Auth uid.
 *
 * Document paths:
 *   users/{uid}                     — profile + prefs
 *   users/{uid}/favorites/{favId}   — saved outfits
 *
 * The uid comes from Firebase Auth (request.auth.uid in security rules).
 * This replaces the previous email-key approach, which allowed anyone who
 * knew an email to read/write that profile.
 */

function sanitizePrefs(p: Prefs): Record<string, unknown> {
  return {
    coldSensitivity: p.coldSensitivity ?? "normal",
    commute: p.commute ?? "walk",
    theme: p.theme ?? "system",
    name: p.name ?? null,
    email: p.email ?? null,
    onboarded: p.onboarded ?? false,
    premium: p.premium ?? false,
    trialEndsAt: p.trialEndsAt ?? null,
    ...(p.city != null ? { city: { name: p.city.name, lat: p.city.lat, lon: p.city.lon } } : {}),
  };
}

export interface CloudSync {
  id: string;
  isActive(): boolean;
  syncPrefs(uid: string, prefs: Prefs): Promise<void>;
  pullAndMergePrefs(uid: string, local: Prefs): Promise<Prefs>;
  syncFavorite(uid: string, favorite: Favorite): Promise<void>;
  pullFavorites(uid: string): Promise<Favorite[]>;
}

export const localOnlySync: CloudSync = {
  id: "local-only",
  isActive: () => false,
  async syncPrefs() {},
  async pullAndMergePrefs(_uid, local) {
    return local;
  },
  async syncFavorite() {},
  async pullFavorites() {
    return [];
  },
};

export const firestoreSync: CloudSync = {
  id: "firestore",
  isActive: isFirebaseConfigured,

  async syncPrefs(uid, prefs) {
    const db = await getFirestoreDb();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "users", uid), { prefs: sanitizePrefs(prefs) }, { merge: true });
  },

  async pullAndMergePrefs(uid, local) {
    const db = await getFirestoreDb();
    if (!db) return local;
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(db, "users", uid));

      if (!snap.exists()) {
        await firestoreSync.syncPrefs(uid, local);
        return local;
      }

      const cloud = (snap.data()?.prefs ?? {}) as Partial<Prefs>;

      const cloudHasMorePremium =
        cloud.premium === true &&
        (local.premium !== true ||
          (cloud.trialEndsAt != null &&
            (local.trialEndsAt == null || cloud.trialEndsAt > local.trialEndsAt)));

      const merged: Prefs = {
        coldSensitivity: cloud.coldSensitivity ?? local.coldSensitivity ?? "normal",
        commute: cloud.commute ?? local.commute ?? "walk",
        city: local.city ?? cloud.city,
        theme: cloud.theme ?? local.theme ?? "system",
        name: cloud.name ?? local.name,
        email: cloud.email ?? local.email,
        onboarded: cloud.onboarded ?? local.onboarded,
        premium: cloudHasMorePremium ? cloud.premium : (local.premium ?? cloud.premium),
        trialEndsAt: cloudHasMorePremium
          ? cloud.trialEndsAt
          : (local.trialEndsAt ?? cloud.trialEndsAt),
      };

      return merged;
    } catch {
      return local;
    }
  },

  async syncFavorite(uid, favorite) {
    const db = await getFirestoreDb();
    if (!db) return;
    const { doc, setDoc, collection } = await import("firebase/firestore");
    const safe = {
      id: favorite.id ?? "",
      title: favorite.title ?? "",
      items: favorite.items ?? [],
      tempC: favorite.tempC ?? 0,
      condition: favorite.condition ?? "",
      savedAt: favorite.savedAt ?? Date.now(),
    };
    await setDoc(doc(collection(db, "users", uid, "favorites"), safe.id), safe);
  },

  async pullFavorites(uid) {
    const db = await getFirestoreDb();
    if (!db) return [];
    try {
      const { collection, getDocs, query, orderBy, limit } = await import("firebase/firestore");
      const snap = await getDocs(
        query(collection(db, "users", uid, "favorites"), orderBy("savedAt", "desc"), limit(50)),
      );
      return snap.docs.map((d) => d.data() as Favorite);
    } catch {
      return [];
    }
  },
};

export const cloudSync: CloudSync = isFirebaseConfigured() ? firestoreSync : localOnlySync;
