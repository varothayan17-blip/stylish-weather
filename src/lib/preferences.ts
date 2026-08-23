export type Commute = "walk" | "ttc" | "drive" | "cycle";
export type Prefs = {
  coldSensitivity: "cold" | "normal" | "hot";
  commute: Commute;
  city?: {
    name: string;
    lat: number;
    lon: number;
    /**
     * ISO 3166-1 alpha-2 country code, e.g. "CA".
     * Populated when the city was chosen from a search result.
     * Optional so existing saved preferences without this field
     * continue to load correctly (countryCode simply missing = no
     * country boost in search ranking).
     */
    countryCode?: string;
  };
  theme: "light" | "dark" | "system";
  name?: string;
  email?: string;
  onboarded?: boolean;
  /**
   * @deprecated Removed in P1 premium security hardening.
   * Premium is now determined exclusively by users/{uid}/entitlements/premium
   * in Firestore (backend-written, client-readable only).
   * These fields remain typed as optional so existing localStorage values
   * parse without errors, but they MUST NOT be used to gate any feature.
   * They are stripped before Firestore writes in cloudSync.sanitizePrefs.
   */
  /** @deprecated Use entitlements/premium. Never authoritative. */
  premium?: never;
  /** @deprecated Use entitlements/premium. Never authoritative. */
  trialEndsAt?: never;
  /**
   * Which clothing profile to use when building outfit recommendations.
   * Existing users who have no value saved default to "neutral" (gender-neutral),
   * preserving their existing experience exactly.
   * Imported from clothingProfiles.ts — kept here so Prefs is self-contained
   * and the cloudSync schema validator can include it.
   */
  clothingProfile?: import("./clothingProfiles").ClothingProfileId;
};

/**
 * Notification preferences stored in Firestore under users/{uid}.notificationPrefs.
 *
 * IMPORTANT — field-write restrictions:
 *   enabled, timezone, reminderHour, reminderMinute — client-writable.
 *   nextCheckAt — NEVER written by the client. Set and advanced exclusively
 *                 by the backend Cloud Function via Admin SDK (which bypasses
 *                 Firestore Security Rules). The client rules explicitly exclude
 *                 this field from allowed client writes.
 *
 * nextCheckAt is stored here as an optional read-only field so the client can
 * display "next reminder at ..." in a future settings UI without writing it.
 *
 * Default reminder time: 07:30 local time (hour=7, minute=30).
 * Timezone: IANA string from Intl.DateTimeFormat().resolvedOptions().timeZone.
 */
export type NotificationPrefs = {
  /** Whether the user has opted in to morning umbrella reminders. */
  enabled: boolean;
  /** IANA timezone identifier, e.g. "America/Toronto". */
  timezone: string;
  /** Local hour for the morning reminder (0–23). Default: 7. */
  reminderHour: number;
  /** Local minute for the morning reminder (0–59). Default: 30. */
  reminderMinute: number;
  /**
   * Client-incrementable counter. Incremented whenever the client changes
   * enabled, timezone, reminderHour, or reminderMinute.
   *
   * Serves two purposes in the Stage E backend:
   *
   * 1. TRIGGER ENTRY / RECURSION GUARD
   *    The Firestore onDocumentUpdated trigger compares
   *    before.schedulingVersion === after.schedulingVersion.
   *    If equal → the write came from the backend (which never changes
   *    schedulingVersion) → exit immediately to prevent infinite loops.
   *    If different → client changed scheduling fields → recompute nextCheckAt.
   *
   * 2. IDEMPOTENCY ON RETRY
   *    If the trigger fails and retries, schedulingVersion == lastProcessedVersion
   *    means "already processed this version" → skip to avoid double-writes.
   *    (Note: on retry, schedulingVersion != lastProcessedVersion because
   *    lastProcessedVersion was not yet written before the failure.)
   *
   * The client controls only "signal that rescheduling is needed",
   * never the actual nextCheckAt value.
   */
  schedulingVersion: number;
  /**
   * UTC epoch ms of the next scheduled check.
   * SET AND ADVANCED BY THE BACKEND ONLY (Admin SDK / Cloud Function).
   * Read-only on the client. The Firestore rule prevents the client from
   * writing this field.
   *
   * When enabled = false, the backend DELETES this field (FieldValue.delete())
   * so the document is definitively absent from the due-user query
   * (WHERE notificationPrefs.nextCheckAt <= now). Documents with a missing
   * field are excluded by Firestore inequality queries without requiring
   * a composite index. Do not use null — rely on field absence instead.
   */
  nextCheckAt?: number;
  /**
   * The schedulingVersion the backend last successfully processed.
   * Written by the Firestore trigger after computing nextCheckAt.
   * The morning scheduler also checks schedulingVersion vs lastProcessedVersion
   * as a fallback: if they differ (trigger failed), it recalculates before
   * sending. BACKEND-ONLY. Never written by the client.
   */
  lastProcessedVersion?: number;
};

export const PREFS_KEY = "weatherwear:prefs";

/**
 * Compute the next NotificationPrefs from an existing state and desired changes.
 * Increments schedulingVersion exactly once when ANY scheduling field changes:
 *   enabled | timezone | reminderHour | reminderMinute
 * Does NOT increment when none of these change (idempotent saves).
 * Never writes nextCheckAt or lastProcessedVersion (backend-only fields).
 *
 * @param existing  Current stored prefs, or null if first-time opt-in.
 * @param desired   Partial fields the caller wants to set.
 * @returns         Complete NotificationPrefs ready to pass to syncNotificationPrefs().
 */
export function buildNotificationPrefs(
  existing: NotificationPrefs | null,
  desired: Pick<NotificationPrefs, "enabled" | "timezone" | "reminderHour" | "reminderMinute">,
): NotificationPrefs {
  const base: NotificationPrefs = existing ?? {
    enabled: false,
    timezone: desired.timezone,
    reminderHour: 7,
    reminderMinute: 30,
    schedulingVersion: 0,
  };
  // Detect any scheduling-field change
  const schedulingChanged =
    desired.enabled !== base.enabled ||
    desired.timezone !== base.timezone ||
    desired.reminderHour !== base.reminderHour ||
    desired.reminderMinute !== base.reminderMinute;
  return {
    enabled: desired.enabled,
    timezone: desired.timezone,
    reminderHour: desired.reminderHour,
    reminderMinute: desired.reminderMinute,
    schedulingVersion: schedulingChanged
      ? base.schedulingVersion + 1
      : base.schedulingVersion,
  };
}

export const FAV_KEY = "weatherwear:favs";
/** Key for the one-time notification discovery card dismissal. */
export const NOTIF_DISMISSED_KEY = "weatherwear:notif-prompt-dismissed";

/**
 * Feature flag: notification UI is visible only when
 * VITE_NOTIFICATIONS_ENABLED=true is set in the environment.
 *
 * Stage C UI is hidden in production until Stage D/E (FCM token registration
 * and Cloud Function scheduling) are implemented and tested end-to-end.
 * This prevents users from "enabling" a feature that cannot yet deliver
 * reminders, while allowing the UI to be tested on a dev/preview build.
 *
 * To enable during development: add VITE_NOTIFICATIONS_ENABLED=true to .env.local
 */
export const NOTIFICATIONS_ENABLED =
  import.meta.env.VITE_NOTIFICATIONS_ENABLED === "true";

export const defaultPrefs: Prefs = {
  coldSensitivity: "normal",
  commute: "walk",
  theme: "system",
};

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch {
    return defaultPrefs;
  }
}
export function savePrefs(p: Prefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

/**
 * Save prefs locally AND push to Firestore if the user has an email and
 * Firebase is configured. Import this in screens that modify preferences so
 * changes sync cross-device automatically. Falls back silently on any error.
 */
export async function saveAndSyncPrefs(p: Prefs): Promise<void> {
  savePrefs(p);
  try {
    const { cloudSync } = await import("./cloudSync");
    if (!cloudSync.isActive()) return;
    const { getUid } = await import("./auth");
    const uid = await getUid();
    if (uid) {
      await cloudSync.syncPrefs(uid, p);
    }
  } catch {
    // Sync failure is non-fatal — local state is always the source of truth
  }
}

export type Favorite = {
  id: string;
  title: string;
  items: string[];
  tempC: number;
  condition: string;
  savedAt: number;
};

export function loadFavorites(): Favorite[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function saveFavorite(f: Favorite) {
  const all = loadFavorites();
  all.unshift(f);
  localStorage.setItem(FAV_KEY, JSON.stringify(all.slice(0, 50)));
}
export function removeFavorite(id: string) {
  const all = loadFavorites().filter((f) => f.id !== id);
  localStorage.setItem(FAV_KEY, JSON.stringify(all));
}

/**
 * crypto.randomUUID() requires iOS 15.4+. On older devices it throws a
 * TypeError which silently kills the entire save handler. This function
 * provides a fallback UUID-shaped string for devices that don't support it.
 */
export function safeUUID(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback: timestamp + random hex — not cryptographically strong but
    // sufficient for a locally-scoped favorite ID.
    const ts = Date.now().toString(16);
    const rand = Math.random().toString(16).slice(2, 10);
    return `${ts}-${rand}-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}
