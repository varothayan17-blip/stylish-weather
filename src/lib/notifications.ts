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

// ── iOS environment detection ───────────────────────────────────────────────

/**
 * Returns true when running on iOS or iPadOS Safari.
 * Detects by checking the user-agent for iPhone/iPad/iPod.
 * This is the only reliable cross-version iOS detection without
 * navigator.userAgentData (not available on Safari).
 */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Returns true when the app is running as an installed Home Screen PWA on iOS.
 * navigator.standalone is an Apple extension; it is true only in standalone mode.
 * Fallback: matchMedia("(display-mode: standalone)") for future compatibility.
 */
export function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  // Apple-specific: true when running in standalone (Home Screen) mode
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  // Standard display-mode check (also works on Chrome/Android)
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/**
 * Returns true when the user is on iOS/iPadOS in Safari (not installed PWA).
 * This is the case where Web Push is NOT available but CAN be unlocked
 * by adding to Home Screen.
 */
export function isIosSafariNonInstalled(): boolean {
  return isIosSafari() && !isInstalledPwa();
}

// ── Result type ──────────────────────────────────────────────────────────────

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

// ── Test notification ─────────────────────────────────────────────────────

/**
 * Result type for callSendTestNotification.
 *
 * ok: true  — server accepted the request (check acceptedCount for delivery).
 * ok: false, rateLimited: true — 60-second cooldown not yet elapsed.
 * ok: false, error: string — auth, network, or server error.
 */
export type TestNotificationResult =
  | { ok: true; attemptedCount: number; acceptedCount: number; failedCount: number }
  | { ok: false; rateLimited: true; retryAfterSeconds?: number }
  | { ok: false; rateLimited?: false; error: string };

/**
 * Send a test notification via the sendTestNotification Cloud Function.
 *
 * Uses the current user's Firebase ID token (from the auth module) — the UID
 * is never sent in the request body. The server verifies the token and uses
 * only the verified UID.
 *
 * Never logs or exposes the ID token beyond the Authorization header.
 */
export async function callSendTestNotification(
  getFreshToken: () => Promise<string | null>,
): Promise<TestNotificationResult> {
  let idToken: string | null;
  try {
    idToken = await getFreshToken();
  } catch {
    return { ok: false, error: "Could not get auth token. Please sign in again." };
  }

  if (!idToken) {
    return { ok: false, error: "Not signed in." };
  }

  // Resolve the Cloud Functions base URL.
  //
  // Priority:
  //   1. VITE_FUNCTIONS_BASE_URL — explicit override (e.g. for local emulator).
  //   2. VITE_FIREBASE_PROJECT_ID — derive the canonical northamerica-northeast1 URL.
  //
  // Falling back to the Vercel origin would silently route requests to the
  // wrong server and always return 404, so we throw instead.
  const functionsBase =
    import.meta.env.VITE_FUNCTIONS_BASE_URL ??
    (import.meta.env.VITE_FIREBASE_PROJECT_ID
      ? `https://northamerica-northeast1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`
      : null);

  if (!functionsBase) {
    return {
      ok: false,
      error:
        "App is not configured for notifications (missing VITE_FIREBASE_PROJECT_ID). Contact support.",
    };
  }

  const endpoint = `${functionsBase}/sendTestNotification`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        // Token is sent only in this header; never in the URL or body.
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }

  let body: {
    ok?: boolean;
    error?: string;
    attemptedCount?: number;
    acceptedCount?: number;
    failedCount?: number;
    retryAfterSeconds?: number;
  };
  try {
    body = await res.json() as typeof body;
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }

  if (res.status === 429) {
    return {
      ok: false,
      rateLimited: true,
      retryAfterSeconds: body.retryAfterSeconds,
    };
  }

  if (!body.ok) {
    return { ok: false, error: body.error ?? "Could not send test notification." };
  }

  return {
    ok: true,
    attemptedCount: body.attemptedCount ?? 0,
    acceptedCount:  body.acceptedCount  ?? 0,
    failedCount:    body.failedCount    ?? 0,
  };
}

// ── Internal: write device record ─────────────────────────────────────────

/**
 * Write (or update) a device record in Firestore.
 *
 * createdAt semantics:
 *   - Written ONLY when the document does not already exist (genuinely new device).
 *   - Re-enabling an existing device refreshes fid, enabled and updatedAt
 *     WITHOUT replacing the original createdAt.
 *   - We read the device document first (when isCreate=true) to determine
 *     whether createdAt already exists.
 *   - Read failure: the error is propagated — writeDeviceRecord throws,
 *     orchestrateEnable catches it and rolls back via unregister().
 *     A fabricated createdAt is never written to an existing device.
 *   - initRegistrationSync (isCreate=false) never sets createdAt (correct).
 *
 * Disable behaviour:
 *   orchestrateDisable() deletes the current device's document (identified by
 *   getStoredDeviceId()). It does NOT disable other devices. Only the device
 *   that the user disabled notifications on is affected.
 */
async function writeDeviceRecord(
  uid: string,
  fid: string | null,
  enabled: boolean,
  isCreate: boolean,
): Promise<void> {
  const db = await getFirestoreDb();
  if (!db) throw new Error("Firestore unavailable");

  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const deviceId = getOrCreateDeviceId();
  const now = Date.now();

  const data: Record<string, unknown> = {
    platform: "web",
    enabled,
    updatedAt: now,
  };

  if (fid !== null) {
    data.fid = fid;
  }

  if (isCreate) {
    // Read first to determine whether createdAt already exists.
    // Three cases:
    //   1. Document does not exist (new device)    → set createdAt = now
    //   2. Document exists, createdAt present      → omit from write (merge preserves it)
    //   3. Document exists, createdAt absent       → set createdAt = now (first-time init)
    //
    // Read failure: propagate the error so orchestrateEnable rolls back via its
    // existing unregister() path. Never write a fabricated createdAt to an
    // existing device whose original value cannot be verified — a transient read
    // failure followed by a successful merge write would silently overwrite it.
    const existing = await getDoc(doc(db, "users", uid, "devices", deviceId));
    if (!existing.exists() || existing.data()?.createdAt == null) {
      // Case 1 or 3 — safe to initialise createdAt.
      data.createdAt = now;
    }
    // Case 2: createdAt already set; omit it so merge:true leaves it untouched.
  }

  await setDoc(doc(db, "users", uid, "devices", deviceId), data, { merge: true });
}
