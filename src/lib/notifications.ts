/**
 * notifications.ts — Firebase Cloud Messaging client for Aeruvo (Stage D)
 *
 * Firebase 12.15.0 API used (all current, non-deprecated):
 *   register(messaging, options)     — initiate FID-based registration
 *   onRegistered(messaging, cb)      — persistent FID delivery listener
 *   unregister(messaging)            — cleanly deregister
 *   onMessage(messaging, cb)         — foreground message listener
 *   isSupported()                    — browser capability check
 *
 * NOT used (deprecated):
 *   getToken() / deleteToken()
 */

import { getFirebaseApp, getFirestoreDb } from "./firebase";
import { ensureServiceWorkerRegistration, ServiceWorkerError } from "./registerSW";
import { getUid } from "./auth";
import { buildNotificationPrefs, type NotificationPrefs } from "./preferences";
import { cloudSync } from "./cloudSync";

// ── Diagnostic logging ────────────────────────────────────────────────────
// Always-on so logs appear whether or not Safari Web Inspector is connected.
// NEVER logs: FID, VAPID key, Firebase config values, auth token, email.

let _t0 = 0;
function notifLog(label: string, extra?: string) {
  const elapsed = _t0 ? `+${Date.now() - _t0}ms` : "";
  const msg = extra
    ? `[notif] ${label} ${extra} ${elapsed}`
    : `[notif] ${label} ${elapsed}`;
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
      reason:
        | "unsupported"
        | "denied"
        | "dismissed"
        | "registration-failed"
        | "firestore-failed"
        | "prefs-failed"
        | "no-app"
        | "no-uid";
      /**
       * Visible error code shown in the UI.
       * SW_READY_TIMEOUT    — navigator.serviceWorker.ready did not resolve in 10 s
       * FID_TIMEOUT         — SW ready, register() ran, onRegistered never fired in 15 s
       * REGISTER_FAILED     — register() itself threw/rejected (see console for Firebase error)
       * DEVICE_WRITE_FAILED — Firestore setDoc for device record failed
       * PREFS_WRITE_FAILED  — Firestore syncNotificationPrefs failed
       * NO_APP              — Firebase app not initialised (check VITE_FIREBASE_* vars)
       * UNSUPPORTED         — FCM not available on this browser/OS
       * PERMISSION_DENIED   — OS notification permission blocked
       * PERMISSION_DISMISSED — user dismissed the permission prompt
       */
      errorCode: string;
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

export async function orchestrateEnable(
  uid: string,
  existingPrefs: NotificationPrefs | null,
): Promise<NotificationResult> {
  _t0 = Date.now();
  notifLog("enable:start");

  // ── Step A: push support check ────────────────────────────────────────
  const supported = await isPushSupported();
  if (!supported) {
    notifLog("support:false");
    return { ok: false, reason: "unsupported", errorCode: "UNSUPPORTED" };
  }
  notifLog("support:ok");

  // ── Step B: notification permission (already-granted fast-path) ───────
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

  // ── Step C: Firebase app ──────────────────────────────────────────────
  const app = await getFirebaseApp();
  if (!app) {
    notifLog("no-app");
    return { ok: false, reason: "no-app", errorCode: "NO_APP" };
  }

  // ── Step D: ensure SW is registered and active ───────────────────────
  // Uses ensureServiceWorkerRegistration() which:
  //   1. Checks for an existing /sw.js registration
  //   2. Registers /sw.js immediately if not found (no load-event race)
  //   3. Waits for activation with a 10-second bounded timeout
  //   4. Returns the active ServiceWorkerRegistration
  //
  // This replaces navigator.serviceWorker.ready which hangs indefinitely
  // when no SW is registered (SW_NOT_REGISTERED case).
  let swReg: ServiceWorkerRegistration;
  notifLog("sw:wait");
  try {
    swReg = await ensureServiceWorkerRegistration(10_000);
    notifLog("sw:ready",
      `scope=${swReg.scope} ` +
      `script=${swReg.active?.scriptURL ?? "no-active"} ` +
      `state=${swReg.active?.state ?? "none"}`,
    );
  } catch (swErr) {
    const code = swErr instanceof ServiceWorkerError ? swErr.code : "SW_SCRIPT_FAILED";
    const msg  = swErr instanceof Error ? swErr.message : String(swErr);
    notifLog("sw:error", `${code}: ${msg}`);
    return { ok: false, reason: "registration-failed", errorCode: code };
  }

  // ── Step E: FID registration (Phase 2, 15-second timeout) ────────────
  // Only starts AFTER serviceWorker.ready has resolved.
  // register() + onRegistered() are separate: register() resolving does NOT
  // mean a FID was delivered. onRegistered fires asynchronously.
  // FID_TIMEOUT fires if onRegistered never delivers within 15 s.
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  notifLog("vapid:present", vapidKey ? "yes" : "NO — FID registration will likely fail");

  let fid: string;
  let fidErrorCode = "FID_TIMEOUT";
  try {
    const { getMessaging, register, onRegistered } = await import("firebase/messaging");
    const messaging = getMessaging(app);

    fid = await new Promise<string>((resolve, reject) => {
      const fidTimeout = setTimeout(() => {
        notifLog("fid-timeout");
        fidErrorCode = "FID_TIMEOUT";
        reject(new Error("FID_TIMEOUT"));
      }, 15_000);

      // Attach listener BEFORE calling register() — avoids race condition
      // where FID is delivered before the listener is set up.
      notifLog("listener:attached");
      const unsubscribe = onRegistered(messaging, (receivedFid) => {
        clearTimeout(fidTimeout);
        unsubscribe();
        notifLog("onRegistered:fired");
        // FID is intentionally NOT logged
        resolve(receivedFid);
      });

      notifLog("register:start");
      register(messaging, {
        vapidKey: vapidKey || undefined,
        serviceWorkerRegistration: swReg,
      }).then(() => {
        notifLog("register:resolved");
        // Note: register() resolving ≠ FID delivered.
        // onRegistered fires separately, possibly later.
      }).catch((err: unknown) => {
        clearTimeout(fidTimeout);
        unsubscribe();
        fidErrorCode = "REGISTER_FAILED";
        // Log Firebase error code only (not secrets)
        const errMsg = err instanceof Error ? err.message : String(err);
        notifLog("register:error", errMsg);
        reject(err);
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notifLog(`fid-phase-failed errorCode=${fidErrorCode}`, msg);
    return { ok: false, reason: "registration-failed", errorCode: fidErrorCode };
  }

  const deviceId = getOrCreateDeviceId();

  // ── Step F: write device record ───────────────────────────────────────
  notifLog("device-write:start");
  try {
    await writeDeviceRecord(uid, fid, true, true);
    notifLog("device-write:success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifLog("device-write:error", msg);
    notifLog("rollback:start");
    try {
      const { getMessaging, unregister } = await import("firebase/messaging");
      const appAgain = await getFirebaseApp();
      if (appAgain) await unregister(getMessaging(appAgain));
    } catch {}
    notifLog("rollback:done");
    return { ok: false, reason: "firestore-failed", errorCode: "DEVICE_WRITE_FAILED" };
  }

  // ── Step G: sync notificationPrefs ───────────────────────────────────
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
    const msg = err instanceof Error ? err.message : String(err);
    notifLog("prefs-write:error", msg);
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
    } catch {}
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
  } catch {}

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
