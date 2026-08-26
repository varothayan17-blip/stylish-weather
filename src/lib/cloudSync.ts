import { getFirestoreDb, isFirebaseConfigured } from "./firebase";
import type { Prefs, Favorite, NotificationPrefs } from "./preferences";
import { normalizeFavorite } from "./preferences";

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
    // premium and trialEndsAt intentionally omitted — P1 security hardening.
    // These fields are no longer written to Firestore prefs by the client.
    // Premium entitlement is stored exclusively in users/{uid}/entitlements/premium.
    clothingProfile: p.clothingProfile ?? "neutral",
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
  /**
   * Write the client-owned notification preference fields to Firestore.
   * Only writes: enabled, timezone, reminderHour, reminderMinute.
   * Never writes nextCheckAt — that field is backend-only.
   */
  syncNotificationPrefs(uid: string, prefs: NotificationPrefs): Promise<void>;
  /**
   * Read notification preferences from Firestore for the current user.
   * Returns null if the document does not exist or has no notificationPrefs.
   */
  pullNotificationPrefs(uid: string): Promise<NotificationPrefs | null>;
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
  async syncNotificationPrefs() {},
  async pullNotificationPrefs() {
    return null;
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

      // cloudHasMorePremium logic removed in P1 security hardening.
      // prefs.premium is no longer a source of truth. Premium state lives
      // exclusively in users/{uid}/entitlements/premium (backend-written).

      const merged: Prefs = {
        coldSensitivity: cloud.coldSensitivity ?? local.coldSensitivity ?? "normal",
        commute: cloud.commute ?? local.commute ?? "walk",
        city: local.city ?? cloud.city,
        theme: cloud.theme ?? local.theme ?? "system",
        name: cloud.name ?? local.name,
        email: cloud.email ?? local.email,
        onboarded: cloud.onboarded ?? local.onboarded,
        // premium and trialEndsAt omitted — not part of prefs merge in P1+.
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
    // Write both slots (v2) and items (legacy compatibility).
    // slots is the authoritative representation; items is kept for
    // backward compatibility with devices that have not yet updated.
    // Firestore rules validate this exact shape.
    const safe = {
      id:        favorite.id ?? "",
      title:     favorite.title ?? "",
      slots:     favorite.slots ?? [],
      items:     (favorite.slots ?? []).map((s) =>
        s.matched ? s.itemName : s.genericText
      ),
      tempC:     favorite.tempC ?? 0,
      condition: favorite.condition ?? "",
      savedAt:   favorite.savedAt ?? Date.now(),
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
      return snap.docs.map((d) => normalizeFavorite(d.data() as Favorite & { items?: string[] }));
    } catch {
      return [];
    }
  },

  async syncNotificationPrefs(uid, prefs) {
    const db = await getFirestoreDb();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore");
    // Write only the client-owned fields. Defense-in-depth: nextCheckAt
    // and lastProcessedVersion are intentionally excluded here — the
    // Firestore rule also blocks them, but excluding them client-side
    // means even a future code change cannot accidentally write them.
    const safe: Record<string, unknown> = {
      enabled: prefs.enabled,
      timezone: prefs.timezone,
      reminderHour: prefs.reminderHour,
      reminderMinute: prefs.reminderMinute,
      schedulingVersion: prefs.schedulingVersion,
    };
    await setDoc(
      doc(db, "users", uid),
      { notificationPrefs: safe },
      { merge: true },
    );
  },

  async pullNotificationPrefs(uid) {
    const db = await getFirestoreDb();
    if (!db) return null;
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return null;
      const data = snap.data()?.notificationPrefs;
      if (!data) return null;
      return {
        enabled: data.enabled ?? false,
        timezone: data.timezone ?? "",
        reminderHour: data.reminderHour ?? 7,
        reminderMinute: data.reminderMinute ?? 30,
        schedulingVersion: data.schedulingVersion ?? 0,
        nextCheckAt: data.nextCheckAt,        // backend-owned, read-only
        lastProcessedVersion: data.lastProcessedVersion, // backend-owned, read-only
      } satisfies NotificationPrefs;
    } catch {
      return null;
    }
  },
};

export const cloudSync: CloudSync = isFirebaseConfigured() ? firestoreSync : localOnlySync;
