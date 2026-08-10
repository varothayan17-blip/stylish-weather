/**
 * notifications.ts — Firebase Cloud Messaging client for Aeruvo (Stage D)
 *
 * Firebase 12.15.0 API used (all current, non-deprecated):
 *   register(messaging, options)            — initiate FID-based registration
 *   onRegistered(messaging, callback)       — persistent listener; receives FID on
 *                                            registration and whenever FID changes
 *   unregister(messaging)                  — cleanly deregister
 *   onMessage(messaging, callback)         — foreground message listener
 *   isSupported()                          — browser capability check
 *
 * NOT used (deprecated in 12.15.0):
 *   getToken() — use register()+onRegistered() instead
 *   deleteToken() — use unregister() instead
 *
 * Service worker config:
 *   public/firebase-sw-config.js is AUTO-GENERATED at build time by
 *   scripts/generate-sw-config.cjs from VITE_FIREBASE_* env vars.
 *   The SW importScripts() it at startup — no postMessage, no cold-start gap.
 */

import { getFirebaseApp, getFirestoreDb } from "./firebase";
import { getUid } from "./auth";
import { buildNotificationPrefs, type NotificationPrefs } from "./preferences";
import { cloudSync } from "./cloudSync";

// ── Device-ID persistence ─────────────────────────────────────────────────

const DEVICE_ID_KEY = "weatherwear:device-id";

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEVICE_ID_KEY);
}

// ── Push support detection ────────────────────────────────────────────────

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("Notification" in window)) return false;
  if (!("PushManager" in window)) return false;
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

// ── Result type ───────────────────────────────────────────────────────────

export type NotificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "denied"
        | "dismissed"
        | "registration-failed"
        | "firestore-failed"
        | "prefs-failed"
        | "no-app"
        | "no-uid";
    };

// ── Persistent FID synchronisation ───────────────────────────────────────

/**
 * Establish the persistent onRegistered listener for the current session.
 *
 * Firebase calls onRegistered() when:
 *   • The FID is first issued after register()
 *   • The FID changes (e.g. browser/service worker lifecycle rotation)
 *
 * This function should be called once per session at app startup when
 * all of these are true:
 *   • VITE_NOTIFICATIONS_ENABLED
 *   • user is authenticated (uid available)
 *   • notificationPrefs.enabled === true
 *   • push is supported
 *
 * On each FID delivery: updates THIS device's Firestore record only —
 * preserves createdAt, updates fid + updatedAt + enabled=true.
 *
 * FIDs are not logged.
 *
 * Returns a cleanup function that removes the listener.
 * Errors are non-fatal: if this fails, enable/disable still works.
 */
export async function initRegistrationSync(uid: string): Promise<() => void> {
  try {
    const supported = await isPushSupported();
    if (!supported) return () => {};

    // Do NOT request permission automatically at startup.
    // Only proceed if permission was already granted by a previous explicit action.
    if (typeof Notification === "undefined") return () => {};
    if (Notification.permission !== "granted") return () => {};

    const app = await getFirebaseApp();
    if (!app) return () => {};

    const { getMessaging, register, onRegistered } = await import("firebase/messaging");
    const messaging = getMessaging(app);

    // Step A: establish onRegistered listener BEFORE calling register().
    // Firebase may call this immediately (if FID is cached) or after async
    // registration completes. Setting up the listener first avoids a race
    // where register() resolves before the listener is attached.
    const unsubscribe = onRegistered(messaging, async (fid) => {
      // FID refreshed or rotated — update only THIS device's Firestore record.
      // Preserves createdAt, updates fid + updatedAt + enabled=true.
      // FID value is not logged.
      try {
        await writeDeviceRecord(uid, fid, true, false /* isCreate=false: preserve createdAt */);
      } catch {
        // Non-fatal: Stage E will discover stale FIDs when sends fail.
        if (import.meta.env.DEV) {
          console.warn("[aeruvo:notifications] FID sync write failed");
        }
      }
    });

    // Step B: call register() to trigger/refresh FID resolution.
    // This is safe to call on every startup — Firebase returns the existing
    // FID if it is still valid, or issues a new one if it has rotated.
    // vapidKey and serviceWorkerRegistration are supplied so FCM can match
    // the subscription to the correct Web Push endpoint.
    const swReg = await navigator.serviceWorker.ready;
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    register(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swReg,
    }).catch(() => {
      // Non-fatal: register() failure at startup does not prevent the app
      // from working. If FID is stale, Stage E will detect the delivery
      // failure and the next startup attempt will retry.
    });

    return unsubscribe;
  } catch {
    return () => {};
  }
}

// ── Shared orchestration — enable ─────────────────────────────────────────

/**
 * Atomic enable orchestration. Used by BOTH Home card and Settings toggle
 * so behavior cannot diverge.
 *
 * Step A: request browser Notification permission
 * Step B: register() → onRegistered() → receive FID
 * Step C: write device record to Firestore (enabled=true)
 * Step D: syncNotificationPrefs(enabled=true)
 *
 * Rollback on failure at step D:
 *   → delete device record (undo C)
 *   → best-effort unregister() (undo B)
 *   → return { ok: false, reason: "prefs-failed" }
 *   → caller must NOT set enabled=true in UI
 *
 * Only returns { ok: true } when all four steps succeed.
 *
 * @param uid           Authenticated user ID
 * @param existingPrefs Current notificationPrefs (may be null)
 */
export async function orchestrateEnable(
  uid: string,
  existingPrefs: NotificationPrefs | null,
): Promise<NotificationResult> {
  // Step A — permission
  const supported = await isPushSupported();
  if (!supported) return { ok: false, reason: "unsupported" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "denied" };
  }
  if (permission === "denied") return { ok: false, reason: "denied" };
  if (permission !== "granted") return { ok: false, reason: "dismissed" };

  // Step B — FID registration
  const app = await getFirebaseApp();
  if (!app) return { ok: false, reason: "no-app" };

  let fid: string;
  try {
    const { getMessaging, register, onRegistered } = await import("firebase/messaging");
    const messaging = getMessaging(app);
    const swReg = await navigator.serviceWorker.ready;
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

    fid = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Registration timeout")), 15_000);
      const unsubscribe = onRegistered(messaging, (receivedFid) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(receivedFid);
      });
      register(messaging, {
        vapidKey: vapidKey || undefined,
        serviceWorkerRegistration: swReg,
      }).catch((err) => {
        clearTimeout(timeout);
        unsubscribe();
        reject(err);
      });
    });
  } catch {
    return { ok: false, reason: "registration-failed" };
  }

  const deviceId = getOrCreateDeviceId();

  // Step C — write device record (first-create path)
  try {
    await writeDeviceRecord(uid, fid, true, true /* is create */);
  } catch {
    // Rollback B: unregister locally
    try {
      const { getMessaging, unregister } = await import("firebase/messaging");
      const appAgain = await getFirebaseApp();
      if (appAgain) await unregister(getMessaging(appAgain));
    } catch {
      if (import.meta.env.DEV) {
        console.warn("[aeruvo:notifications] rollback unregister failed");
      }
    }
    return { ok: false, reason: "firestore-failed" };
  }

  // Step D — sync notificationPrefs
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextPrefs = buildNotificationPrefs(existingPrefs, {
    enabled: true,
    timezone: tz,
    reminderHour: existingPrefs?.reminderHour ?? 7,
    reminderMinute: existingPrefs?.reminderMinute ?? 30,
  });

  try {
    await cloudSync.syncNotificationPrefs(uid, nextPrefs);
  } catch {
    // Rollback C: delete device record so no active device with disabled prefs
    try {
      const db = await getFirestoreDb();
      if (db) {
        const { doc, deleteDoc } = await import("firebase/firestore");
        await deleteDoc(doc(db, "users", uid, "devices", deviceId));
      }
    } catch {
      if (import.meta.env.DEV) {
        console.warn("[aeruvo:notifications] rollback device delete failed");
      }
    }
    // Rollback B: best-effort unregister
    try {
      const { getMessaging, unregister } = await import("firebase/messaging");
      const appAgain = await getFirebaseApp();
      if (appAgain) await unregister(getMessaging(appAgain));
    } catch {}
    return { ok: false, reason: "prefs-failed" };
  }

  return { ok: true };
}

// ── Shared orchestration — disable ────────────────────────────────────────

/**
 * Atomic disable orchestration. Used by BOTH Settings toggle and any future
 * disable path.
 *
 * Server-safe order (fail-safe):
 *   Step 1: syncNotificationPrefs(enabled=false) — server stops scheduling
 *   Step 2: deleteDoc(devices/{deviceId})       — remove active device
 *   Step 3: best-effort unregister()             — local cleanup
 *
 * Step 1 first: if step 2 or 3 fail, the server already knows not to send.
 * Step 2 before step 3: Firestore record cleaned up before local state changes.
 *
 * Returns the updated NotificationPrefs for the caller to set in state.
 * Throws if step 1 fails (caller must show error and not claim disabled).
 *
 * @param uid           Authenticated user ID
 * @param existingPrefs Current notificationPrefs (must not be null)
 */
export async function orchestrateDisable(
  uid: string,
  existingPrefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  const nextPrefs = buildNotificationPrefs(existingPrefs, {
    enabled: false,
    timezone: existingPrefs.timezone,
    reminderHour: existingPrefs.reminderHour,
    reminderMinute: existingPrefs.reminderMinute,
  });

  // Step 1 — prefs disabled on server FIRST (fail-safe)
  await cloudSync.syncNotificationPrefs(uid, nextPrefs); // throws on failure

  // Step 2 — delete device record (best-effort after step 1)
  const deviceId = getStoredDeviceId();
  if (deviceId) {
    try {
      const db = await getFirestoreDb();
      if (db) {
        const { doc, deleteDoc } = await import("firebase/firestore");
        await deleteDoc(doc(db, "users", uid, "devices", deviceId));
      }
    } catch {
      if (import.meta.env.DEV) {
        console.warn("[aeruvo:notifications] device delete failed on disable");
      }
    }
  }

  // Step 3 — local unregistration (best-effort)
  try {
    const app = await getFirebaseApp();
    if (app) {
      const { getMessaging, unregister } = await import("firebase/messaging");
      await unregister(getMessaging(app));
    }
  } catch {}

  return nextPrefs;
}

// ── Sign-out cleanup ──────────────────────────────────────────────────────

/**
 * Called in auth.ts signOut() before Firebase signOut, while uid is still valid.
 * Deletes THIS device's Firestore record and unregisters locally.
 * Never throws — sign-out always completes.
 * Only touches THIS device; other devices for the same account are untouched.
 */
export async function cleanupDeviceOnSignOut(uid: string): Promise<void> {
  const deviceId = getStoredDeviceId();
  if (!deviceId) return;

  // Firestore deletion first (fail-safe server state)
  try {
    const db = await getFirestoreDb();
    if (db) {
      const { doc, deleteDoc } = await import("firebase/firestore");
      await deleteDoc(doc(db, "users", uid, "devices", deviceId));
    }
  } catch {
    if (import.meta.env.DEV) {
      console.warn("[aeruvo:notifications] sign-out device cleanup failed");
    }
  }

  // Best-effort local unregistration
  try {
    const app = await getFirebaseApp();
    if (app) {
      const { getMessaging, unregister } = await import("firebase/messaging");
      await unregister(getMessaging(app));
    }
  } catch {}
}

// ── Foreground message handler ────────────────────────────────────────────

/**
 * Listen for FCM messages when the app is foregrounded.
 * Stage D: no-op stub. Stage E: display in-app banner or update advice.
 */
export async function listenForForegroundMessages(): Promise<() => void> {
  try {
    const app = await getFirebaseApp();
    if (!app) return () => {};
    const { getMessaging, onMessage } = await import("firebase/messaging");
    return onMessage(getMessaging(app), (_payload) => {
      if (import.meta.env.DEV) {
        console.debug("[aeruvo:notifications] foreground message received");
      }
    });
  } catch {
    return () => {};
  }
}

// ── Internal: write device record ─────────────────────────────────────────

/**
 * Create or update the Firestore device document for this browser.
 *
 * isCreate=true: include fid + createdAt (Firestore create rule requires both)
 * isCreate=false: update fid + updatedAt only (createdAt must not change)
 *
 * When fid is null (legacy disable path): only update enabled + updatedAt.
 * FIDs are not logged.
 */
async function writeDeviceRecord(
  uid: string,
  fid: string | null,
  enabled: boolean,
  isCreate: boolean,
): Promise<void> {
  const db = await getFirestoreDb();
  if (!db) throw new Error("Firestore unavailable");

  const { doc, setDoc } = await import("firebase/firestore");
  const deviceId = getOrCreateDeviceId();
  const now = Date.now();

  const data: Record<string, unknown> = {
    platform: "web",
    enabled,
    updatedAt: now,
  };

  if (fid !== null) {
    data.fid = fid;
    if (isCreate) {
      data.createdAt = now; // required on create; immutable after that
    }
  }

  // merge:true preserves createdAt on update-path writes
  await setDoc(doc(db, "users", uid, "devices", deviceId), data, { merge: true });
}
