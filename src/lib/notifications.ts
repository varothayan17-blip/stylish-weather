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

// ── Diagnostic logging ────────────────────────────────────────────────────
// Always-on (not DEV-only) so they appear in iPhone PWA console via
// Safari Web Inspector OR can be captured in the UI error string.
// NEVER logs FID, VAPID key, Firebase config, auth tokens, or email.

let _t0 = 0;
function notifLog(label: string, extra?: string) {
  const elapsed = _t0 ? `+${Date.now() - _t0}ms` : "";
  const msg = extra ? `[notif] ${label} ${extra} ${elapsed}` : `[notif] ${label} ${elapsed}`;
  console.log(msg);
}

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
      // errorCode is a short machine-readable token shown in the UI on Windows
      // where Safari Web Inspector is unavailable. Also appears in console logs.
      reason:
        | "unsupported"
        | "denied"
        | "dismissed"
        | "registration-failed"
        | "firestore-failed"
        | "prefs-failed"
        | "no-app"
        | "no-uid";
      errorCode: string; // e.g. "UNSUPPORTED", "REG_TIMEOUT", "FID_NOT_RECEIVED"
    };

// ── Persistent FID synchronisation ───────────────────────────────────────

export async function initRegistrationSync(uid: string): Promise<() => void> {
  try {
    const supported = await isPushSupported();
    if (!supported) return () => {};

    if (typeof Notification === "undefined") return () => {};
    if (Notification.permission !== "granted") return () => {};

    const app = await getFirebaseApp();
    if (!app) return () => {};

    const { getMessaging, register, onRegistered } = await import("firebase/messaging");
    const messaging = getMessaging(app);

    const unsubscribe = onRegistered(messaging, async (fid) => {
      try {
        await writeDeviceRecord(uid, fid, true, false);
      } catch {
        if (import.meta.env.DEV) {
          console.warn("[aeruvo:notifications] FID sync write failed");
        }
      }
    });

    const swReg = await navigator.serviceWorker.ready;
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    register(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swReg,
    }).catch(() => {});

    return unsubscribe;
  } catch {
    return () => {};
  }
}

// ── Shared orchestration — enable ─────────────────────────────────────────

/**
 * Atomic enable orchestration with milestone logging and visible error codes.
 *
 * Error codes surfaced in UI (for Windows debugging without Safari Inspector):
 *   UNSUPPORTED         — browser/OS does not support push
 *   PERMISSION_DENIED   — user denied in OS settings
 *   PERMISSION_DISMISSED — user dismissed without allowing
 *   NO_APP              — Firebase app not initialised
 *   NO_UID              — not signed in
 *   REG_TIMEOUT         — register() called but onRegistered never fired in 15s
 *   REGISTER_FAILED     — register() threw an error
 *   FID_NOT_RECEIVED    — onRegistered promise rejected for unknown reason
 *   DEVICE_WRITE_FAILED — Firestore write of device record failed
 *   PREFS_WRITE_FAILED  — Firestore write of notificationPrefs failed
 */
export async function orchestrateEnable(
  uid: string,
  existingPrefs: NotificationPrefs | null,
): Promise<NotificationResult> {
  _t0 = Date.now();
  notifLog("enable:start");

  // Step A — support + permission
  const supported = await isPushSupported();
  if (!supported) {
    notifLog("support:false");
    return { ok: false, reason: "unsupported", errorCode: "UNSUPPORTED" };
  }
  notifLog("support:ok");

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    notifLog("permission:error");
    return { ok: false, reason: "denied", errorCode: "PERMISSION_DENIED" };
  }
  notifLog(`permission:${permission}`);
  if (permission === "denied")  return { ok: false, reason: "denied",    errorCode: "PERMISSION_DENIED" };
  if (permission !== "granted") return { ok: false, reason: "dismissed", errorCode: "PERMISSION_DISMISSED" };

  // Step B — Firebase app
  const app = await getFirebaseApp();
  if (!app) {
    notifLog("no-app");
    return { ok: false, reason: "no-app", errorCode: "NO_APP" };
  }

  // Step B — FID registration
  let fid: string;
  let registerErrorCode = "FID_NOT_RECEIVED";
  try {
    const { getMessaging, register, onRegistered } = await import("firebase/messaging");
    const messaging = getMessaging(app);
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

    fid = await new Promise<string>((resolve, reject) => {
      // IMPORTANT: the 15-second master timeout covers the ENTIRE registration
      // flow including navigator.serviceWorker.ready. On some iOS PWA states,
      // serviceWorker.ready can hang indefinitely if the SW is in a broken
      // state. Without this outer timeout wrapping sw.ready, the flow could
      // hang forever before the inner timeout even starts.
      const timeout = setTimeout(() => {
        notifLog("timeout");
        registerErrorCode = "REG_TIMEOUT";
        reject(new Error("Registration timeout"));
      }, 15_000);

      // Resolve serviceWorker.ready inside the promise so the master timeout
      // above can cancel it if it hangs.
      notifLog("sw:wait");
      navigator.serviceWorker.ready.then((swReg) => {
        notifLog("sw:ready");

        notifLog("listener:onRegistered-attached");
        const unsubscribe = onRegistered(messaging, (receivedFid) => {
          clearTimeout(timeout);
          unsubscribe();
          notifLog("onRegistered:fired");
          resolve(receivedFid);
        });

        notifLog("register:start");
        register(messaging, {
          vapidKey: vapidKey || undefined,
          serviceWorkerRegistration: swReg,
        }).then(() => {
          notifLog("register:resolved");
        }).catch((err: unknown) => {
          clearTimeout(timeout);
          unsubscribe();
          registerErrorCode = "REGISTER_FAILED";
          notifLog("register:error", String(err instanceof Error ? err.message : err));
          reject(err);
        });
      }).catch((swErr: unknown) => {
        // serviceWorker.ready rejected (very unusual but possible)
        clearTimeout(timeout);
        registerErrorCode = "REGISTER_FAILED";
        notifLog("sw:error", String(swErr instanceof Error ? swErr.message : swErr));
        reject(swErr);
      });
    });
  } catch {
    notifLog(`registration-failed errorCode:${registerErrorCode}`);
    return { ok: false, reason: "registration-failed", errorCode: registerErrorCode };
  }

  const deviceId = getOrCreateDeviceId();

  // Step C — write device record
  notifLog("device-write:start");
  try {
    await writeDeviceRecord(uid, fid, true, true);
    notifLog("device-write:success");
  } catch (err) {
    notifLog("device-write:error", String(err instanceof Error ? err.message : err));
    notifLog("rollback:start");
    try {
      const { getMessaging, unregister } = await import("firebase/messaging");
      const appAgain = await getFirebaseApp();
      if (appAgain) await unregister(getMessaging(appAgain));
    } catch {}
    notifLog("rollback:done");
    return { ok: false, reason: "firestore-failed", errorCode: "DEVICE_WRITE_FAILED" };
  }

  // Step D — sync notificationPrefs
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextPrefs = buildNotificationPrefs(existingPrefs, {
    enabled: true,
    timezone: tz,
    reminderHour: existingPrefs?.reminderHour ?? 7,
    reminderMinute: existingPrefs?.reminderMinute ?? 30,
  });

  notifLog("prefs-write:start");
  try {
    await cloudSync.syncNotificationPrefs(uid, nextPrefs);
    notifLog("prefs-write:success");
  } catch (err) {
    notifLog("prefs-write:error", String(err instanceof Error ? err.message : err));
    notifLog("rollback:start");
    try {
      const db = await getFirestoreDb();
      if (db) {
        const { doc, deleteDoc } = await import("firebase/firestore");
        await deleteDoc(doc(db, "users", uid, "devices", deviceId));
      }
    } catch {}
    try {
      const { getMessaging, unregister } = await import("firebase/messaging");
      const appAgain = await getFirebaseApp();
      if (appAgain) await unregister(getMessaging(appAgain));
    } catch {}
    notifLog("rollback:done");
    return { ok: false, reason: "prefs-failed", errorCode: "PREFS_WRITE_FAILED" };
  }

  notifLog("enable:success");
  return { ok: true };
}

// ── Shared orchestration — disable ────────────────────────────────────────

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

  await cloudSync.syncNotificationPrefs(uid, nextPrefs);

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

export async function cleanupDeviceOnSignOut(uid: string): Promise<void> {
  const deviceId = getStoredDeviceId();
  if (!deviceId) return;

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

  try {
    const app = await getFirebaseApp();
    if (app) {
      const { getMessaging, unregister } = await import("firebase/messaging");
      await unregister(getMessaging(app));
    }
  } catch {}
}

// ── Foreground message handler ────────────────────────────────────────────

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
      data.createdAt = now;
    }
  }

  await setDoc(doc(db, "users", uid, "devices", deviceId), data, { merge: true });
}
