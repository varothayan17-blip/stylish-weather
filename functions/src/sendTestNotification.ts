/**
 * sendTestNotification.ts — Authenticated HTTPS endpoint for end-to-end
 * notification testing (Aeruvo Stage E).
 *
 * Security model:
 *  - Firebase ID token verified with Admin SDK (Authorization: Bearer <token>).
 *  - UID is taken exclusively from the verified token; request body is ignored
 *    for identity — a body-supplied UID would allow one user to trigger sends
 *    on behalf of another.
 *  - FID (Firebase Installation ID / FCM token) is never logged or returned.
 *  - Only shortened UID (first 8 chars) and shortened device doc ID (first 8
 *    chars) are written to logs.
 *
 * Rate limit:
 *  - Firestore document users/{uid}/testNotificationRateLimit/{RATE_LIMIT_DOC}
 *    records the last attempt timestamp.
 *  - 60-second cooldown enforced before allowing another send.
 *  - The rate-limit write is performed at the start of the send path, inside a
 *    Firestore transaction, so concurrent calls are serialised.
 *
 * FCM message contract (identical to morningRainCheck):
 *  data:    { title, body, url: "/" }
 *  apns:    { payload: { aps: { "content-available": 1 } } }
 *  android: { priority: "high" }
 *
 * Response shape:
 *  { ok: boolean; attemptedCount: number; acceptedCount: number; failedCount: number }
 *  (plus { error: string } when ok=false and no sends were attempted)
 */

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max enabled devices queried per user (mirrors morningRainCheck). */
const MAX_DEVICES_PER_USER = 5;

/** Cooldown in milliseconds between test sends per user. */
const RATE_LIMIT_MS = 60_000;

/** Firestore sub-collection document ID for rate-limit records. */
const RATE_LIMIT_DOC = "testNotification";

/** FCM error codes that indicate a permanently stale device. */
const PERMANENT_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/installation-id-not-registered",
]);

// ── Response helpers ──────────────────────────────────────────────────────────

function jsonResponse(
  res: Parameters<Parameters<typeof onRequest>[0]>[1],
  status: number,
  body: object,
): void {
  res.status(status).json(body);
}

// ── Cloud Function ─────────────────────────────────────────────────────────────

export const sendTestNotification = onRequest(
  {
    // Deny cross-origin requests except from the app origin (set via
    // CORS headers). Cloud Functions v2 onRequest does not enforce CORS
    // automatically; we do it manually below.
    region: "northamerica-northeast1",
    // Cost-safety: short timeout, no concurrency beyond Cloud Run default
    timeoutSeconds: 30,
  },
  async (req, res) => {
    // ── CORS pre-flight ──────────────────────────────────────────────────
    // Allow the app origin (any for now; lock down in production if needed).
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    // ── Step 1: Extract and verify Firebase ID token ─────────────────────
    const authHeader = req.headers.authorization ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      jsonResponse(res, 401, { ok: false, error: "Missing Authorization header." });
      return;
    }

    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      jsonResponse(res, 401, { ok: false, error: "Empty token." });
      return;
    }

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      // Do not leak reason — a malformed token could carry sensitive data in
      // its payload; the caller needs only to know it was rejected.
      jsonResponse(res, 401, { ok: false, error: "Invalid or expired token." });
      return;
    }

    const shortUid = uid.slice(0, 8);

    // ── Step 2: Rate limit (Firestore transaction) ────────────────────────
    const db = getFirestore();
    const rateLimitRef = db
      .collection("users")
      .doc(uid)
      .collection("testNotificationRateLimit")
      .doc(RATE_LIMIT_DOC);

    const now = Date.now();

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(rateLimitRef);
        if (snap.exists) {
          const lastAt = snap.data()?.lastAttemptAt as number | undefined;
          if (lastAt && now - lastAt < RATE_LIMIT_MS) {
            const remainingMs = RATE_LIMIT_MS - (now - lastAt);
            const remainingSec = Math.ceil(remainingMs / 1000);
            // Throw to abort the transaction and surface the error to the
            // caller. The document is NOT updated on rate-limit rejection.
            throw Object.assign(
              new Error(`Rate limited. Try again in ${remainingSec}s.`),
              { __rateLimited: true, remainingSec },
            );
          }
        }
        tx.set(rateLimitRef, { lastAttemptAt: now });
      });
    } catch (err) {
      const e = err as { __rateLimited?: boolean; message?: string; remainingSec?: number };
      if (e.__rateLimited) {
        jsonResponse(res, 429, {
          ok: false,
          error: e.message ?? "Rate limited.",
          retryAfterSeconds: e.remainingSec ?? 60,
        });
        return;
      }
      logger.error("sendTestNotification: rate-limit transaction failed", {
        uid: shortUid,
        name: (err as { name?: string }).name,
        code: (err as { code?: string }).code,
        message: (err as { message?: string }).message,
      });
      jsonResponse(res, 503, { ok: false, error: "Could not check rate limit. Try again." });
      return;
    }

    // ── Step 3: Query enabled devices ──────────────────────────────────────
    let devicesSnap: FirebaseFirestore.QuerySnapshot;
    try {
      devicesSnap = await db
        .collection("users")
        .doc(uid)
        .collection("devices")
        .where("enabled", "==", true)
        .orderBy("updatedAt", "desc")
        .limit(MAX_DEVICES_PER_USER)
        .get();
    } catch (err) {
      logger.error("sendTestNotification: device query failed", {
        uid: shortUid,
        name: (err as { name?: string }).name,
        code: (err as { code?: string }).code,
        message: (err as { message?: string }).message,
      });
      jsonResponse(res, 503, { ok: false, error: "Could not load devices. Try again." });
      return;
    }

    if (devicesSnap.empty) {
      logger.info("sendTestNotification: no enabled devices", { uid: shortUid });
      jsonResponse(res, 200, {
        ok: true,
        attemptedCount: 0,
        acceptedCount: 0,
        failedCount: 0,
      });
      return;
    }

    // ── Step 4: Send FCM messages ──────────────────────────────────────────
    const msg = getMessaging();
    let attemptedCount = 0;
    let acceptedCount = 0;
    let failedCount = 0;

    for (const deviceDoc of devicesSnap.docs) {
      const data = deviceDoc.data();
      const fid = data.fid as string | undefined;

      // Skip device records without a valid FID (should not happen in production,
      // but defensive: never log the FID value even in error paths).
      if (!fid || typeof fid !== "string" || fid.length === 0) {
        continue;
      }

      const deviceShortId = deviceDoc.id.slice(0, 8);
      attemptedCount++;

      try {
        await msg.send({
          fid,
          data: {
            title: "Aeruvo test notification",
            body: "Notifications are working on this device.",
            url: "/",
          },
          apns:    { payload: { aps: { "content-available": 1 } } },
          android: { priority: "high" },
        });

        // FID is intentionally NOT logged.
        logger.info("sendTestNotification: FCM accepted", {
          uid: shortUid,
          deviceShortId,
          result: "accepted",
        });
        acceptedCount++;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "unknown";

        if (PERMANENT_ERROR_CODES.has(code)) {
          // Stale token — disable device so morningRainCheck skips it too.
          try {
            await deviceDoc.ref.update({ enabled: false, updatedAt: Date.now() });
          } catch {
            // Best-effort; log nothing sensitive.
          }
        }

        // Log safe metadata only (never FID, never uid beyond short prefix).
        logger.warn("sendTestNotification: FCM error", {
          uid: shortUid,
          deviceShortId,
          code,
        });
        failedCount++;
      }
    }

    // ── Step 5: Respond ───────────────────────────────────────────────────
    jsonResponse(res, 200, {
      ok: true,
      attemptedCount,
      acceptedCount,
      failedCount,
    });
  },
);
