/**
 * onNotifPrefsUpdate.ts
 *
 * Firestore trigger: fires whenever a users/{uid} document changes.
 * Responsibility: maintain notificationPrefs.nextCheckAt.
 *
 * RECURSION GUARD:
 *   This function itself writes nextCheckAt and lastProcessedVersion to
 *   Firestore via Admin SDK. Those writes also trigger onDocumentUpdated.
 *   Guard: compare before.notificationPrefs.schedulingVersion vs
 *          after.notificationPrefs.schedulingVersion.
 *   If equal → the write came from the backend (which never changes
 *   schedulingVersion) → exit immediately.
 *
 * RETRY SAFETY:
 *   Cloud Functions v2 with retry=true may call this multiple times.
 *   Guard 2: if schedulingVersion == lastProcessedVersion → already processed
 *   this scheduling intent → exit (idempotent).
 *   Permanent data errors (bad timezone, invalid hours) → log + return, no
 *   throw (otherwise Functions would retry forever on bad data).
 *   Infrastructure errors → throw (triggers Cloud Functions retry).
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { computeNextCheckAt } from "./shared/scheduling";

export const onNotifPrefsUpdate = onDocumentUpdated(
  {
    document: "users/{uid}",
    region: "northamerica-northeast1",
    // retry=true: Cloud Functions retries on infrastructure failures (throw).
    // Permanent data errors return early — they never throw — to stop retries.
    retry: true,
    timeoutSeconds: 30,
    maxInstances: 3,  // Low cap — trigger fires per-user-write, not at scale bursts
    minInstances: 0,  // Never keep warm instances; cold start is fine here
  },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before.data();
    const after  = event.data?.after.data();

    if (!before || !after) return;

    const npBefore = before.notificationPrefs as Record<string, unknown> | undefined;
    const npAfter  = after.notificationPrefs  as Record<string, unknown> | undefined;

    // If notificationPrefs was not changed at all, exit immediately
    if (!npAfter) return;

    const svBefore = (npBefore?.schedulingVersion as number) ?? -1;
    const svAfter  = (npAfter.schedulingVersion as number) ?? -1;

    // ── Recursion guard ────────────────────────────────────────────────────
    // The backend never changes schedulingVersion. If it is the same before
    // and after, this write originated from our own backend → skip.
    if (svBefore === svAfter) {
      logger.debug("onNotifPrefsUpdate: schedulingVersion unchanged — backend write, skipping");
      return;
    }

    // ── Idempotency guard ──────────────────────────────────────────────────
    // If we already processed this schedulingVersion, skip (handles retries).
    const lastProcessed = (npAfter.lastProcessedVersion as number) ?? -1;
    if (svAfter === lastProcessed) {
      logger.debug("onNotifPrefsUpdate: already processed sv=%d — skipping", svAfter, { uid });
      return;
    }

    logger.info("onNotifPrefsUpdate: scheduling change detected", {
      uid: uid.slice(0, 4) + "***",
      svBefore,
      svAfter,
      enabled: npAfter.enabled,
    });

    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);

    // ── Disabled → delete nextCheckAt ──────────────────────────────────────
    if (npAfter.enabled === false) {
      await userRef.update({
        "notificationPrefs.nextCheckAt": FieldValue.delete(),
        "notificationPrefs.lastProcessedVersion": svAfter,
      });
      logger.info("onNotifPrefsUpdate: disabled — deleted nextCheckAt", { uid: uid.slice(0, 4) + "***" });
      return;
    }

    // ── Validate scheduling fields ─────────────────────────────────────────
    const timezone  = npAfter.timezone as string | undefined;
    const remHour   = npAfter.reminderHour   as number | undefined;
    const remMinute = npAfter.reminderMinute as number | undefined;

    if (
      !timezone ||
      typeof timezone !== "string" ||
      timezone.length === 0 ||
      typeof remHour !== "number" ||
      remHour < 0 || remHour > 23 ||
      typeof remMinute !== "number" ||
      remMinute < 0 || remMinute > 59
    ) {
      // Permanent data error — log and mark as processed to stop retries.
      logger.warn("onNotifPrefsUpdate: invalid scheduling fields — skipping", {
        uid: uid.slice(0, 4) + "***",
        timezone,
        remHour,
        remMinute,
      });
      await userRef.update({
        "notificationPrefs.lastProcessedVersion": svAfter,
      });
      return;
    }

    // ── Compute nextCheckAt (DST-safe) ────────────────────────────────────
    const nowUtcMs = Date.now();
    const nextCheckAt = computeNextCheckAt(nowUtcMs, timezone, remHour, remMinute);

    if (nextCheckAt === null) {
      logger.warn("onNotifPrefsUpdate: computeNextCheckAt returned null — invalid timezone?", {
        uid: uid.slice(0, 4) + "***",
        timezone,
      });
      await userRef.update({
        "notificationPrefs.lastProcessedVersion": svAfter,
      });
      return;
    }

    // ── Write nextCheckAt + lastProcessedVersion ───────────────────────────
    // These writes do NOT change schedulingVersion → recursion guard will
    // detect sv unchanged on the next trigger invocation and exit immediately.
    await userRef.update({
      "notificationPrefs.nextCheckAt": nextCheckAt,
      "notificationPrefs.lastProcessedVersion": svAfter,
    });

    logger.info("onNotifPrefsUpdate: scheduled next check", {
      uid: uid.slice(0, 4) + "***",
      nextCheckAt: new Date(nextCheckAt).toISOString(),
    });
  },
);
