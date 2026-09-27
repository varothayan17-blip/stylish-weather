/**
 * wardrobe-ai-handler.ts — Server-only Wardrobe AI scan handler.
 *
 * IMPORTED ONLY FROM src/server.ts. Must NEVER be imported from client-side code.
 *
 * Routes:
 *   POST /api/wardrobe/scan
 *   POST /api/wardrobe/acknowledge
 *   GET  /api/wardrobe/ack-status
 *
 * ── PROVIDER ─────────────────────────────────────────────────────────────────
 *
 *   Anthropic Claude (claude-haiku-4-5-20251001) via the native Messages API.
 *   Raw fetch — no SDK dependency.
 *   Structured Outputs (GA): output_config.format = { type: "json_schema", schema: ... }
 *   Anthropic is the sole AI provider. See git history for the previous implementation.
 *
 * ── QUOTA MODEL ───────────────────────────────────────────────────────────────
 *
 * Free accounts:
 *   FREE_LIFETIME_LIMIT  = 3 successful scans, total, for the life of the account.
 *   Failed / rejected scans do NOT consume the allowance.
 *
 * Premium / active trial accounts:
 *   PREMIUM_DAILY_LIMIT      = 15 successful scans per UTC day.
 *   PREMIUM_ROLLING_30_LIMIT = 100 successful scans per rolling 30-day window.
 *
 * Reserve-before-call:
 *   Counters are pre-incremented inside a Firestore transaction before calling
 *   Anthropic. Refunded atomically on provider rejection or failure.
 *
 * ── ABUSE RATE LIMIT ──────────────────────────────────────────────────────────
 *
 *   Max 5 scan *attempts* per uid per 60 seconds, tracked in Firestore.
 *   Independent of product quota — abuse attempts are counted even when provider
 *   rejects or fails. Race-safe via Firestore transaction.
 *
 * ── ACKNOWLEDGEMENT ───────────────────────────────────────────────────────────
 *
 *   Users must complete a versioned first-use acknowledgement before scanning:
 *     - Age 15+ attestation
 *     - AI disclosure acknowledgement
 *     - Upload policy acknowledgement
 *     - Guardian permission (if age band is 15-17)
 *   Stored in users/{uid}/scannerAck/{SCANNER_ACK_VERSION}
 *   Server enforces this before quota reservation and provider call.
 *
 * ── PRIVACY ───────────────────────────────────────────────────────────────────
 *
 *   Image bytes: NOT persisted after analysis. Never logged.
 *   Evidence text: NOT returned to client. Not stored anywhere.
 *   API key: server-only, never logged, never in client bundle.
 *   Logs: model name, attempt number, HTTP status, token counts only.
 *   No uid, email, name, FID, image, prompt, or garment description in logs.
 *
 * ── DATA RETENTION AT ANTHROPIC ───────────────────────────────────────────────
 *
 *   Model: claude-haiku-4-5-20251001 (not a Covered Model)
 *   Per Anthropic's API and data retention documentation
 *   (platform.claude.com/docs/en/manage-claude/api-and-data-retention,
 *   verified September 2026):
 *   - Conversation content (prompts and outputs) is NOT retained by default for
 *     this configuration. The Messages API is ZDR-eligible.
 *   - The JSON schema used with Structured Outputs may be cached for up to 24
 *     hours for grammar compilation optimisation. No prompt or response data is
 *     retained in this cache.
 *   - Content flagged by Anthropic's automated trust-and-safety systems may be
 *     retained for up to two years.
 *   - Aeruvo does not currently have a contractual Zero Data Retention (ZDR)
 *     arrangement with Anthropic.
 *   ⚠️ This statement must be re-verified before public launch and whenever
 *      Anthropic's retention policy changes. See privacy.tsx.
 *
 * ── ENV VARS (server-only, NEVER VITE_*) ─────────────────────────────────────
 *
 *   ANTHROPIC_API_KEY          — Anthropic API key
 *   WARDROBE_AI_SCANNING_ENABLED — must be "true" to enable scanning (default: off)
 */

import { verifyFirebaseToken, verifyEntitlementServer, getAdminDb, ApiError, apiErrorResponse } from "./stripe-server";
import {
  POLICY_FREE_LIFETIME_SCANS,
  POLICY_PREMIUM_DAILY_SCANS,
  POLICY_PREMIUM_ROLLING_SCANS,
  POLICY_ROLLING_WINDOW_DAYS,
} from "./policyVersions";
import { FieldValue } from "firebase-admin/firestore";
import type {
  ClothingAnalysis,
  ScanResponse,
  ScanSuccessResponse,
  ScanErrorResponse,
  ScanResult,
  RejectionReasonCode,
  ScannerAgeBand,
} from "./wardrobe-types";
import { SCANNER_ACK_VERSION } from "./wardrobe-types";

// ── Configuration constants ───────────────────────────────────────────────────

const MAX_IMAGE_BYTES         = 8 * 1024 * 1024; // 8 MB
const ANTHROPIC_MODEL         = "claude-haiku-4-5-20251001";
const PROVIDER_MAX_ATTEMPTS   = 2;
const PROVIDER_TOTAL_DEADLINE_MS = 50_000;

// Abuse rate limit: max N scan attempts per uid per window
const ABUSE_MAX_ATTEMPTS      = 5;
const ABUSE_WINDOW_MS         = 60_000; // 60 seconds

// ── Policy-locked quota constants ─────────────────────────────────────────────

const FREE_LIFETIME_LIMIT      = POLICY_FREE_LIFETIME_SCANS;
const PREMIUM_DAILY_LIMIT      = POLICY_PREMIUM_DAILY_SCANS;
const PREMIUM_ROLLING_30_LIMIT = POLICY_PREMIUM_ROLLING_SCANS;
const ROLLING_WINDOW_MS        = POLICY_ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

function assertQuotaMatchesPolicy(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;
  const mismatches: string[] = [];
  if (FREE_LIFETIME_LIMIT      !== POLICY_FREE_LIFETIME_SCANS)   mismatches.push(`FREE_LIFETIME`);
  if (PREMIUM_DAILY_LIMIT      !== POLICY_PREMIUM_DAILY_SCANS)   mismatches.push(`DAILY`);
  if (PREMIUM_ROLLING_30_LIMIT !== POLICY_PREMIUM_ROLLING_SCANS) mismatches.push(`ROLLING`);
  if (mismatches.length > 0) {
    throw new Error("FATAL: Quota constants do not match customer-facing policy. " + mismatches.join("; "));
  }
}

// ── Feature flags ─────────────────────────────────────────────────────────────

/**
 * Fail-closed in every environment.
 * Scanning is enabled ONLY when WARDROBE_AI_SCANNING_ENABLED is the exact
 * lowercase string "true". Any other value — undefined, empty, "false", "TRUE",
 * or absent — blocks scanning. No environment exception.
 */
function assertScanningEnabled(): void {
  if (process.env.WARDROBE_AI_SCANNING_ENABLED !== "true") {
    throw new ApiError(
      503,
      "Wardrobe scanning is temporarily unavailable while we improve it. " +
      "You can still add clothing manually.",
      "wardrobe_scanning_temporarily_unavailable",
    );
  }
}

/** Fail-closed: block in every environment if the API key is absent. */
function assertAnthropicConfigured(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(
      503,
      "Wardrobe scanning is not available. Contact support if this is unexpected.",
    );
  }
}

function getAnthropicKey(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new ApiError(503, "AI service not configured");
  return k;
}

// ── MIME allowlist + magic-byte validation ────────────────────────────────────

const ACCEPTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
// HEIC/HEIF and GIF are NOT accepted. Client converts HEIC→JPEG via canvas.

/**
 * Structural validation of image bytes.
 *
 * This is structural truncation detection, NOT full image decoding.
 * It validates well-known structural markers to reject:
 *   - MIME/content mismatches (e.g. PNG bytes claimed as JPEG)
 *   - Files truncated after a valid header
 *   - PDF, ZIP, or other non-image bytes
 *   - Files too small to be valid images
 *
 * JPEG: SOI marker (FF D8 FF) at start; EOI marker (FF D9) at end;
 *       minimum size 100 bytes (no valid JPEG is smaller).
 * PNG:  Full 8-byte signature at start; exact 12-byte IEND chunk
 *       (00 00 00 00 49 45 4E 44 AE 42 60 82) at the final 12 bytes;
 *       minimum size 67 bytes (signature + IHDR + IEND chunks).
 * WebP: RIFF at bytes 0-3; WEBP at bytes 8-11; little-endian RIFF size
 *       field (bytes 4-7) must equal buf.length - 8 exactly (riffSize + 8 === buf.length).
 *       Rejects both truncated files (declared larger) and files with trailing garbage
 *       (declared smaller). Uses unsigned right-shift for correct uint32 arithmetic.
 *       Minimum size 30 bytes (RIFF header + WEBP tag + one VP8 chunk header).
 *
 * These checks significantly reduce the attack surface without performing
 * full pixel decoding. A deliberately crafted file with a valid structure
 * but corrupt compressed data would pass; actual decoding is not performed.
 */
const JPEG_MIN_BYTES = 100;
const PNG_MIN_BYTES  = 67;
const WEBP_MIN_BYTES = 30;

function validateMagicBytes(buf: Uint8Array, claimedMime: string): void {
  if (buf.length === 0) {
    throw new ApiError(400, "Image file is empty.");
  }

  const normalized = claimedMime === "image/jpg" ? "image/jpeg" : claimedMime;

  switch (normalized) {
    case "image/jpeg": {
      if (buf.length < JPEG_MIN_BYTES) {
        throw new ApiError(400, "Image file is too small to be a valid JPEG.");
      }
      // SOI: FF D8 FF at start
      if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
        throw new ApiError(415, "File content does not match the claimed image type.");
      }
      // EOI: FF D9 at end (last two bytes of a valid JPEG stream)
      const n = buf.length;
      if (buf[n - 2] !== 0xFF || buf[n - 1] !== 0xD9) {
        throw new ApiError(400, "Image appears truncated or corrupt (missing JPEG end marker).");
      }
      break;
    }
    case "image/png": {
      if (buf.length < PNG_MIN_BYTES) {
        throw new ApiError(400, "Image file is too small to be a valid PNG.");
      }
      // Full PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const pngSig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      for (let i = 0; i < pngSig.length; i++) {
        if (buf[i] !== pngSig[i]) {
          throw new ApiError(415, "File content does not match the claimed image type.");
        }
      }
      // Exact 12-byte terminal IEND chunk must be the last 12 bytes of the file:
      //   00 00 00 00  — chunk data length (0 bytes)
      //   49 45 4E 44  — chunk type "IEND"
      //   AE 42 60 82  — CRC-32 of "IEND"
      // Searching for "IEND" text anywhere in the tail is insufficient: a file
      // truncated after the IEND type bytes, or one with trailing bytes after IEND,
      // would pass that weaker check but fail this one.
      const IEND_CHUNK = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
      const end = buf.length;
      if (end < IEND_CHUNK.length) {
        throw new ApiError(400, "Image appears truncated or corrupt (PNG too small for IEND).");
      }
      for (let i = 0; i < IEND_CHUNK.length; i++) {
        if (buf[end - IEND_CHUNK.length + i] !== IEND_CHUNK[i]) {
          throw new ApiError(400, "Image appears truncated or corrupt (missing exact PNG IEND terminal chunk).");
        }
      }
      break;
    }
    case "image/webp": {
      if (buf.length < WEBP_MIN_BYTES) {
        throw new ApiError(400, "Image file is too small to be a valid WebP.");
      }
      // RIFF: 52 49 46 46 at bytes 0-3
      if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46) {
        throw new ApiError(415, "File content does not match the claimed image type.");
      }
      // WEBP: 57 45 42 50 at bytes 8-11
      if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) {
        throw new ApiError(415, "File content does not match the claimed image type.");
      }
      // RIFF size field (bytes 4-7, little-endian uint32):
      //   file size = riffSize + 8  (4-byte RIFF tag + 4-byte size field)
      // Require EXACT equality: riffSize + 8 === buf.length.
      //   - Declared larger than actual → file is truncated.
      //   - Declared smaller than actual → trailing garbage bytes present.
      // Use >>> 0 to ensure unsigned 32-bit arithmetic (avoids sign-extension
      // on values ≥ 0x80000000 that would otherwise produce a negative int32).
      const riffSize = ((buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24)) >>> 0);
      if (riffSize + 8 !== buf.length) {
        throw new ApiError(400, "Image appears truncated or corrupt (WebP RIFF size mismatch).");
      }
      break;
    }
    default:
      throw new ApiError(415, "Unsupported image type. Please use JPEG, PNG, or WebP.");
  }
}

// ── Quota schema ──────────────────────────────────────────────────────────────

type QuotaData = {
  lifetimeFreeScans:  number;
  scansToday:         number;
  resetDate:          string;
  rolling30Count:     number;
  rolling30StartMs:   number;
  lastScanAt:         number;
  updatedAt:          number;
};

type ReservationStatus = "reserved" | "succeeded" | "refunded";

type QuotaReservationRecord = {
  reservationId:            string;
  uid:                      string;
  isPremium:                boolean;
  reservedDate:             string;
  reservedRolling30StartMs: number | null;
  reservedFree:             boolean;
  reservedDaily:            boolean;
  reservedRolling:          boolean;
  status:                   ReservationStatus;
  createdAt:                number;
  finalizedAt:              number | null;
};

function reservationPath(uid: string, id: string) {
  return `users/${uid}/quotaReservations/${id}`;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

type QuotaReservation = {
  reservationId:       string;
  isPremium:           boolean;
  remainingFreeScans:  number | null;
  remainingDaily:      number | null;
  remaining30Day:      number | null;
  dailyResetAt:        string | null;
  rolling30ResetMs:    number | null;
};

async function reserveQuota(uid: string, isPremium: boolean): Promise<QuotaReservation> {
  const db    = getAdminDb();
  const ref   = db.doc(`users/${uid}/quotas/wardrobeAi`);
  const today = todayUTC();
  const nowMs = Date.now();
  const reservationId = crypto.randomUUID();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw  = (snap.data() ?? {}) as Partial<QuotaData>;

    const scansToday      = raw.resetDate === today ? (raw.scansToday ?? 0) : 0;
    const rolling30Start  = raw.rolling30StartMs ?? nowMs;
    const windowExpiredMs = rolling30Start + ROLLING_WINDOW_MS;
    const windowExpired   = nowMs >= windowExpiredMs;
    const rolling30Count  = windowExpired ? 0 : (raw.rolling30Count ?? 0);
    const rolling30StartMs = windowExpired ? nowMs : rolling30Start;

    if (isPremium) {
      if (scansToday >= PREMIUM_DAILY_LIMIT) {
        throw new ApiError(429, `Daily scan limit reached (${PREMIUM_DAILY_LIMIT} per day). Resets at midnight UTC.`);
      }
      if (rolling30Count >= PREMIUM_ROLLING_30_LIMIT) {
        const resetDate = new Date(rolling30StartMs + ROLLING_WINDOW_MS).toISOString().slice(0, 10);
        throw new ApiError(429, `Scan limit reached (${PREMIUM_ROLLING_30_LIMIT} per 30 days). Resets on ${resetDate}.`);
      }
      tx.set(ref, {
        lifetimeFreeScans: raw.lifetimeFreeScans ?? 0,
        scansToday:         scansToday + 1,
        resetDate:          today,
        rolling30Count:     rolling30Count + 1,
        rolling30StartMs,
        lastScanAt:         nowMs,
        updatedAt:          FieldValue.serverTimestamp() as unknown as number,
      }, { merge: true });
      return {
        reservationId, isPremium: true,
        remainingFreeScans: null,
        remainingDaily: PREMIUM_DAILY_LIMIT - (scansToday + 1),
        remaining30Day: PREMIUM_ROLLING_30_LIMIT - (rolling30Count + 1),
        dailyResetAt: today,
        rolling30ResetMs: rolling30StartMs + ROLLING_WINDOW_MS,
        _reservedDate: today,
        _reservedRolling30StartMs: rolling30StartMs,
      } as QuotaReservation & { _reservedDate: string; _reservedRolling30StartMs: number };
    } else {
      const lifetimeFree = raw.lifetimeFreeScans ?? 0;
      if (lifetimeFree >= FREE_LIFETIME_LIMIT) {
        throw new ApiError(429, `Free scan limit reached (${FREE_LIFETIME_LIMIT} lifetime). Upgrade to Premium for more scans.`);
      }
      tx.set(ref, {
        lifetimeFreeScans: lifetimeFree + 1,
        scansToday:         scansToday + 1,
        resetDate:          today,
        rolling30Count:     raw.rolling30Count ?? 0,
        rolling30StartMs,
        lastScanAt:         nowMs,
        updatedAt:          FieldValue.serverTimestamp() as unknown as number,
      }, { merge: true });
      return {
        reservationId, isPremium: false,
        remainingFreeScans: FREE_LIFETIME_LIMIT - (lifetimeFree + 1),
        remainingDaily: null, remaining30Day: null,
        dailyResetAt: null, rolling30ResetMs: null,
        _reservedDate: today,
        _reservedRolling30StartMs: null,
      } as QuotaReservation & { _reservedDate: string; _reservedRolling30StartMs: number | null };
    }
  });

  const extended = result as QuotaReservation & { _reservedDate: string; _reservedRolling30StartMs: number | null };
  const record: QuotaReservationRecord = {
    reservationId, uid, isPremium,
    reservedDate:             extended._reservedDate,
    reservedRolling30StartMs: extended._reservedRolling30StartMs ?? null,
    reservedFree:    !isPremium,
    reservedDaily:   isPremium,
    reservedRolling: isPremium,
    status:      "reserved",
    createdAt:   nowMs,
    finalizedAt: null,
  };
  await getAdminDb().doc(reservationPath(uid, reservationId)).set(record);
  return result;
}

async function finalizeQuotaSuccess(uid: string, reservationId: string): Promise<void> {
  try {
    const ref = getAdminDb().doc(reservationPath(uid, reservationId));
    await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const rec = snap.data() as QuotaReservationRecord;
      if (rec.status !== "reserved") return;
      tx.update(ref, { status: "succeeded", finalizedAt: Date.now() });
    });
  } catch (e) {
    console.error("[wardrobe-ai] reservation finalize-success failed:", e instanceof Error ? e.message : String(e));
  }
}

async function refundQuota(uid: string, reservationId: string): Promise<void> {
  try {
    const db      = getAdminDb();
    const recRef  = db.doc(reservationPath(uid, reservationId));
    const quotaRef = db.doc(`users/${uid}/quotas/wardrobeAi`);
    const today   = todayUTC();
    const nowMs   = Date.now();

    await db.runTransaction(async (tx) => {
      const [recSnap, quotaSnap] = await Promise.all([tx.get(recRef), tx.get(quotaRef)]);
      if (!recSnap.exists) return;
      const rec = recSnap.data() as QuotaReservationRecord;
      if (rec.status !== "reserved") return;

      const raw     = (quotaSnap.data() ?? {}) as Partial<QuotaData>;
      const updates: Partial<QuotaData> = { updatedAt: nowMs };

      if (!rec.isPremium && rec.reservedFree) {
        updates.lifetimeFreeScans = Math.max(0, (raw.lifetimeFreeScans ?? 0) - 1);
      }
      if (rec.isPremium && rec.reservedDaily) {
        const currentDate = raw.resetDate ?? today;
        const scansToday  = currentDate === today ? (raw.scansToday ?? 0) : 0;
        if (rec.reservedDate === today) updates.scansToday = Math.max(0, scansToday - 1);
      }
      if (rec.isPremium && rec.reservedRolling && rec.reservedRolling30StartMs !== null) {
        const currentWindowStart = raw.rolling30StartMs ?? 0;
        if (currentWindowStart === rec.reservedRolling30StartMs) {
          updates.rolling30Count = Math.max(0, (raw.rolling30Count ?? 0) - 1);
        }
      }
      tx.set(quotaRef, updates, { merge: true });
      tx.update(recRef, { status: "refunded", finalizedAt: nowMs });
    });
  } catch (e) {
    console.error("[wardrobe-ai] quota refund failed:", e instanceof Error ? { name: e.name, message: e.message } : {});
  }
}

// ── Abuse rate limit ──────────────────────────────────────────────────────────

/**
 * Enforce per-uid abuse rate limit: max ABUSE_MAX_ATTEMPTS scan attempts
 * per ABUSE_WINDOW_MS. Tracked in Firestore via atomic transaction.
 * Independent of product quota — counted even when provider rejects/fails.
 *
 * Document: users/{uid}/scannerRateLimit/current
 * Fields: windowStartMs, attempts
 */
async function checkAbuseRateLimit(uid: string): Promise<void> {
  const db     = getAdminDb();
  const ref    = db.doc(`users/${uid}/scannerRateLimit/current`);
  const nowMs  = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw  = snap.data() ?? { windowStartMs: nowMs, attempts: 0 };
    const { windowStartMs, attempts } = raw as { windowStartMs: number; attempts: number };

    const windowExpired = nowMs - windowStartMs >= ABUSE_WINDOW_MS;
    const currentAttempts = windowExpired ? 0 : attempts;
    const newWindowStart  = windowExpired ? nowMs : windowStartMs;

    if (currentAttempts >= ABUSE_MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil((newWindowStart + ABUSE_WINDOW_MS - nowMs) / 1000);
      throw new ApiError(
        429,
        `Too many scan attempts. Please wait ${retryAfterSec} seconds before trying again.`,
        "abuse",
      );
    }

    tx.set(ref, {
      windowStartMs: newWindowStart,
      attempts:      currentAttempts + 1,
      updatedAt:     nowMs,
    });
  });
}

// ── Scanner acknowledgement ───────────────────────────────────────────────────

/**
 * Verify that the user has completed the required scanner acknowledgement
 * at the current version. Throws 403 with code "ack" if not.
 *
 * Document: users/{uid}/scannerAck/{SCANNER_ACK_VERSION}
 */
async function verifyAcknowledgement(uid: string): Promise<void> {
  const db  = getAdminDb();
  const ref = db.doc(`users/${uid}/scannerAck/${SCANNER_ACK_VERSION}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ApiError(
      403,
      "Please complete the AI scanner acknowledgement before scanning.",
      "ack",
    );
  }
  const data = snap.data() as { version?: string; acceptedAt?: unknown };
  if (data.version !== SCANNER_ACK_VERSION) {
    throw new ApiError(
      403,
      "The AI scanner terms have been updated. Please review and accept them to continue.",
      "ack",
    );
  }
}

// ── Acknowledgement submission ────────────────────────────────────────────────

/**
 * Handle POST /api/wardrobe/acknowledge
 * Records a versioned scanner acknowledgement server-side.
 * uid is from the verified Firebase token — never from the request body.
 */
export async function handleWardrobeAcknowledge(request: Request): Promise<Response> {
  try {
    assertScanningEnabled();
    const uid = await verifyFirebaseToken(request);

    let body: unknown;
    try { body = await request.json(); }
    catch { throw new ApiError(400, "Invalid request body."); }

    const { ageBand, guardianPermissionConfirmed } = body as {
      ageBand?: unknown;
      guardianPermissionConfirmed?: unknown;
    };

    if (ageBand !== "15-17" && ageBand !== "18-plus") {
      throw new ApiError(400, "Invalid age band. Must be '15-17' or '18-plus'.");
    }

    // If under 18 (15-17), guardian permission confirmation is required
    if (ageBand === "15-17" && guardianPermissionConfirmed !== true) {
      throw new ApiError(400, "Guardian permission confirmation is required for users aged 15–17.");
    }

    const db    = getAdminDb();
    const ref   = db.doc(`users/${uid}/scannerAck/${SCANNER_ACK_VERSION}`);
    const nowMs = Date.now();

    const record: {
      version:                    string;
      ageBand:                    ScannerAgeBand;
      guardianPermissionConfirmed?: boolean;
      acceptedAt:                 FirebaseFirestore.FieldValue;
      acceptedAtMs:               number;
    } = {
      version:    SCANNER_ACK_VERSION,
      ageBand:    ageBand as ScannerAgeBand,
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedAtMs: nowMs,
    };

    if (ageBand === "15-17") {
      // Only record when applicable; omit the field for 18-plus
      record.guardianPermissionConfirmed = true;
    }

    await ref.set(record);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok:    false,
        error: err instanceof ApiError ? err.message : "Something went wrong.",
        code:  err instanceof ApiError ? mapStatusToCode(err.status) : "server",
      }),
      {
        status:  err instanceof ApiError ? err.status : 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Handle GET /api/wardrobe/ack-status
 * Returns whether the user has completed the current acknowledgement version.
 */
export async function handleWardrobeAckStatus(request: Request): Promise<Response> {
  try {
    assertScanningEnabled();
    const uid  = await verifyFirebaseToken(request);
    const db   = getAdminDb();
    const snap = await db.doc(`users/${uid}/scannerAck/${SCANNER_ACK_VERSION}`).get();
    const acknowledged = snap.exists && (snap.data() as { version?: string })?.version === SCANNER_ACK_VERSION;
    return new Response(JSON.stringify({ acknowledged, version: SCANNER_ACK_VERSION }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof ApiError ? err.message : "Server error" }),
      { status: err instanceof ApiError ? err.status : 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

type ScanTelemetry = {
  model:          string;
  inputTokens:    number;
  outputTokens:   number;
  totalTokens:    number;
  retryOccurred:  boolean;
  success:        boolean;
  timestampMs:    number;
};

function emitTelemetry(t: ScanTelemetry): void {
  try {
    // Safe operational data only — no prompt, no image, no garment text, no uid
    console.info("[wardrobe-ai-telemetry]", JSON.stringify({
      model:         t.model,
      inputTokens:   t.inputTokens,
      outputTokens:  t.outputTokens,
      totalTokens:   t.totalTokens,
      retryOccurred: t.retryOccurred,
      success:       t.success,
      timestampMs:   t.timestampMs,
    }));
  } catch {
    // Telemetry must never break a successful scan
  }
}

// ── Provider interface ────────────────────────────────────────────────────────

interface WardrobeScanProvider {
  readonly name: string;
  analyze(base64Image: string, mimeType: string): Promise<{ result: ScanResult; retryOccurred: boolean }>;
}

// ── Anthropic JSON schema (Structured Outputs GA) ────────────────────────────

/**
 * Flat JSON schema for output_config.format.schema (Anthropic Structured Outputs GA).
 *
 * Anthropic does NOT support `oneOf`, `anyOf`, `allOf`, `if/then/else`, or `const`
 * at schema-evaluation time (400 "Schema type 'oneOf' is not supported").
 *
 * Replacement strategy:
 * - Single flat object with all top-level keys present.
 * - `status` is an enum discriminator: "accepted" | "rejected".
 * - `analysis` and `reasonCode` are both declared as optional properties.
 * - Runtime validation (validateScanResult / validateClothingAnalysis) is unchanged
 *   and enforces the discriminated-union constraint after parsing.
 *
 * Supported keywords (Anthropic Structured Outputs GA):
 *   type, properties, required, additionalProperties, enum, items.
 * NOT used (unsupported and omitted):
 *   oneOf, anyOf, allOf, const, if/then/else, $ref, not, pattern (regex),
 *   format, unevaluatedProperties, minimum, maximum, minLength, maxLength,
 *   maxItems, minItems, multipleOf.
 * Range / length / array-size constraints are enforced by runtime validation
 * (validateScanResult / validateClothingAnalysis) after JSON parsing.
 */
const SCAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    // Discriminator — always present.
    // "accepted" → analysis must be populated; reasonCode is absent.
    // "rejected" → reasonCode must be populated; analysis is absent.
    status: {
      type: "string",
      enum: ["accepted", "rejected"],
    },

    // Present only when status="accepted".
    analysis: {
      type: "object",
      additionalProperties: false,
      required: [
        "name", "category", "subcategory", "primaryColor", "secondaryColors",
        "pattern", "materialEstimate", "layerRole", "warmth",
        "waterResistance", "windProtection", "weatherFit", "styles",
        "seasons", "fitEstimate", "confidence",
      ],
      properties: {
        name:             { type: "string" },
        category:         { type: "string", enum: ["tops","bottoms","outerwear","shoes","accessories","dress","other"] },
        subcategory:      { type: "string" },
        primaryColor:     { type: "string" },
        secondaryColors:  { type: "array", items: { type: "string" } },
        pattern:          { type: "string", enum: ["solid","striped","checked","graphic","patterned","other"] },
        materialEstimate: { type: "array", items: { type: "string" } },
        layerRole:        { type: "string", enum: ["base","mid","outer","standalone"] },
        warmth: {
          type: "object",
          additionalProperties: false,
          required: ["score", "label"],
          properties: {
            score: { type: "number" },
            label: { type: "string", enum: ["very-light","light","medium","warm","very-warm"] },
          },
        },
        waterResistance: { type: "string", enum: ["none","low","medium","high","unknown"] },
        windProtection:  { type: "string", enum: ["low","medium","high","unknown"] },
        weatherFit:      { type: "array", items: { type: "string" } },
        styles:          { type: "array", items: { type: "string" } },
        seasons:         { type: "array", items: { type: "string" } },
        fitEstimate:     { type: "string", enum: ["slim","regular","relaxed","oversized","unknown"] },
        confidence: {
          type: "object",
          additionalProperties: false,
          required: ["category","color","material","warmth","waterResistance","style"],
          properties: {
            category:        { type: "number" },
            color:           { type: "number" },
            material:        { type: "number" },
            warmth:          { type: "number" },
            waterResistance: { type: "number" },
            style:           { type: "number" },
          },
        },
      },
    },

    // Present only when status="rejected".
    reasonCode: {
      type: "string",
      enum: ["person_present","multiple_items","id_or_document","unsafe_content","not_clothing","unusable_image"],
    },
  },
} as const;

// ── Anthropic system prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clothing analysis assistant for a weather-aware wardrobe app called Aeruvo.

SAFETY RULES (checked first, before analysis):
- If the image contains a person, face, body, or body part: set status="rejected", reasonCode="person_present".
- If the image contains multiple clothing items that are clearly separate garments: set status="rejected", reasonCode="multiple_items".
- If the image contains an identification document, passport, driver's licence, credit card, or any document showing personal information: set status="rejected", reasonCode="id_or_document".
- If the image contains nudity, sexual content, graphic violence, hate symbols, or other clearly unsafe content: set status="rejected", reasonCode="unsafe_content".
- If the image does not appear to show a clothing item (e.g. food, furniture, landscape, animal, printed paper, etc.): set status="rejected", reasonCode="not_clothing".
- If the image is too blurry, too dark, or otherwise impossible to analyze reliably: set status="rejected", reasonCode="unusable_image".
- Do NOT analyze identity, face, body type, attractiveness, race, age, or any personal characteristics.

HONESTY RULES (when status="accepted"):
- Never hallucinate properties that cannot be observed visually.
- waterResistance and windProtection: use "unknown" unless visually obvious outerwear (rain jacket with taped seams, rubber boots). A black hoodie is "none". A fleece is "low".
- materialEstimate: describe what it LOOKS like ("appears to be cotton"). Never claim certainty.
- Use confidence values < 0.60 when genuinely uncertain.
- fitEstimate: use "unknown" if you cannot clearly tell from the photo.

Return ONLY the JSON structure matching the provided schema. No explanation, no markdown, no preamble.`;

// ── Anthropic API call ────────────────────────────────────────────────────────

class AnthropicHttpError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message);
    this.name = "AnthropicHttpError";
  }
}

const ANTHROPIC_RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function callAnthropic(
  base64Image: string,
  mimeType:    string,
  attempt:     number,
): Promise<{ result: ScanResult; telemetry: Omit<ScanTelemetry, "retryOccurred" | "success"> }> {
  const apiKey = getAnthropicKey();
  const url    = "https://api.anthropic.com/v1/messages";

  // Normalise image/jpg → image/jpeg for the Anthropic API
  const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;

  const body = {
    model:      ANTHROPIC_MODEL,
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{
        type: "image",
        source: {
          type:       "base64",
          media_type: normalizedMime as "image/jpeg" | "image/png" | "image/webp",
          data:       base64Image,
        },
      }, {
        type: "text",
        text: "Analyze this clothing item and return the JSON response as specified.",
      }],
    }],
    output_config: {
      format: {
        type:   "json_schema",
        schema: SCAN_JSON_SCHEMA,
      },
    },
  };

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 50_000);
  const t0         = Date.now();

  // Log only model + attempt — no key, no image, no prompt content
  console.info(`[wardrobe-ai] attempt=${attempt} model=${ANTHROPIC_MODEL}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const elapsed  = Date.now() - t0;
    const msg      = err instanceof Error ? err.message : String(err);
    const timedOut = msg.includes("aborted") || msg.includes("abort");
    console.error(`[wardrobe-ai] fetch failed elapsed=${elapsed}ms timedOut=${timedOut}`);
    if (timedOut) throw new ApiError(504, "AI analysis timed out. Please try again.");
    throw new ApiError(502, "AI service temporarily unavailable.");
  }
  clearTimeout(timeout);
  const elapsed = Date.now() - t0;

  if (!res.ok) {
    let errType = "", errMessage = "";
    try {
      const errBody = await res.json() as { error?: { type?: string; message?: string } };
      errType    = String(errBody?.error?.type ?? "");
      errMessage = String(errBody?.error?.message ?? "").slice(0, 200);
    } catch { errMessage = "<unreadable>"; }
    // Log only HTTP status and Anthropic error type — no key, no image, no PII
    console.error(`[wardrobe-ai] attempt=${attempt} status=${res.status} elapsed=${elapsed}ms errType=${errType} errMessage=${errMessage}`);
    throw new AnthropicHttpError(res.status, `Anthropic ${res.status}`);
  }

  console.info(`[wardrobe-ai] status=${res.status} elapsed=${elapsed}ms`);

  const json = await res.json() as {
    content?:     Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?:       { input_tokens?: number; output_tokens?: number };
  };

  const usage        = json.usage ?? {};
  const inputTokens  = usage.input_tokens  ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalTokens  = inputTokens + outputTokens;

  const stopReason = json.stop_reason ?? "";

  // Handle safety refusal from Claude (outside schema — maps to safe rejection)
  if (stopReason === "refusal") {
    console.info(`[wardrobe-ai] stop_reason=refusal → mapping to unsafe_content rejection`);
    return {
      result: { status: "rejected", reasonCode: "unsafe_content" },
      telemetry: { model: ANTHROPIC_MODEL, inputTokens, outputTokens, totalTokens, timestampMs: Date.now() },
    };
  }

  // max_tokens reached: treat as provider failure (not a valid rejection)
  if (stopReason === "max_tokens") {
    console.error(`[wardrobe-ai] stop_reason=max_tokens — increase max_tokens or simplify prompt`);
    throw new ApiError(502, "AI analysis failed. Please try another photo.");
  }

  const text = json?.content?.find((b) => b.type === "text")?.text ?? "";
  if (!text) {
    console.error("[wardrobe-ai] Anthropic returned empty text content");
    throw new ApiError(502, "AI returned an empty response. Please try again.");
  }

  // Log output length only — never the content
  console.info(`[wardrobe-ai] validating response length=${text.length}`);
  const result = validateScanResult(text);
  console.info(`[wardrobe-ai] validation ok status=${result.status}`);

  return {
    result,
    telemetry: { model: ANTHROPIC_MODEL, inputTokens, outputTokens, totalTokens, timestampMs: Date.now() },
  };
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

const anthropicProvider: WardrobeScanProvider = {
  name: "anthropic",
  async analyze(base64Image, mimeType) {
    const overallDeadline = Date.now() + PROVIDER_TOTAL_DEADLINE_MS;
    let retryOccurred = false;

    for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt++) {
      const isLast = attempt === PROVIDER_MAX_ATTEMPTS;
      try {
        const { result, telemetry } = await callAnthropic(base64Image, mimeType, attempt);
        emitTelemetry({ ...telemetry, retryOccurred, success: true });
        return { result, retryOccurred };
      } catch (err) {
        if (err instanceof ApiError) {
          emitTelemetry({
            model: ANTHROPIC_MODEL, inputTokens: 0, outputTokens: 0, totalTokens: 0,
            timestampMs: Date.now(), retryOccurred, success: false,
          });
          throw err;
        }
        if (err instanceof AnthropicHttpError) {
          const retryable = ANTHROPIC_RETRYABLE.has(err.httpStatus);
          console.warn(`[wardrobe-ai] attempt=${attempt} httpStatus=${err.httpStatus} retryable=${retryable} isLast=${isLast}`);

          if (!retryable || isLast) {
            emitTelemetry({
              model: ANTHROPIC_MODEL, inputTokens: 0, outputTokens: 0, totalTokens: 0,
              timestampMs: Date.now(), retryOccurred, success: false,
            });
            if (err.httpStatus === 429) throw new ApiError(503, "AI service is busy. Please try again shortly.");
            throw new ApiError(502, "AI analysis failed. Please try another photo.");
          }

          const backoffMs = 1_000 + Math.floor(Math.random() * 500);
          if (Date.now() + backoffMs >= overallDeadline) {
            emitTelemetry({
              model: ANTHROPIC_MODEL, inputTokens: 0, outputTokens: 0, totalTokens: 0,
              timestampMs: Date.now(), retryOccurred, success: false,
            });
            throw new ApiError(504, "AI analysis timed out. Please try again.");
          }
          console.info(`[wardrobe-ai] retrying in ${backoffMs}ms (attempt ${attempt}/${PROVIDER_MAX_ATTEMPTS})`);
          retryOccurred = true;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
    throw new ApiError(502, "AI analysis failed. Please try another photo.");
  },
};

// ── Response validation ───────────────────────────────────────────────────────

const VALID_CATEGORIES  = new Set(["tops","bottoms","outerwear","shoes","accessories","dress","other"]);
const VALID_PATTERNS    = new Set(["solid","striped","checked","graphic","patterned","other"]);
const VALID_LAYER_ROLES = new Set(["base","mid","outer","standalone"]);
const VALID_WARMTH_LBLS = new Set(["very-light","light","medium","warm","very-warm"]);
const VALID_WATER_RES   = new Set(["none","low","medium","high","unknown"]);
const VALID_WIND_PROT   = new Set(["low","medium","high","unknown"]);
const VALID_FIT         = new Set(["slim","regular","relaxed","oversized","unknown"]);
const VALID_REASON_CODES = new Set(["person_present","multiple_items","id_or_document","unsafe_content","not_clothing","unusable_image"]);

function clamp(n: unknown, lo: number, hi: number): number {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  if (isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function arrStr(v: unknown, maxLen = 8, maxEach = 120): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, maxEach)).slice(0, maxLen);
  return [];
}
function str(v: unknown, fallback: string, maxLen = 120): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, maxLen) : fallback;
}

function validateClothingAnalysis(parsed: Record<string, unknown>): ClothingAnalysis {
  const category  = VALID_CATEGORIES.has(String(parsed.category))  ? String(parsed.category)  as ClothingAnalysis["category"]  : "other";
  const pattern   = VALID_PATTERNS.has(String(parsed.pattern))      ? String(parsed.pattern)   as ClothingAnalysis["pattern"]   : "solid";
  const layerRole = VALID_LAYER_ROLES.has(String(parsed.layerRole)) ? String(parsed.layerRole) as ClothingAnalysis["layerRole"] : "standalone";
  const waterRes  = VALID_WATER_RES.has(String(parsed.waterResistance)) ? String(parsed.waterResistance) as ClothingAnalysis["waterResistance"] : "unknown";
  const windProt  = VALID_WIND_PROT.has(String(parsed.windProtection))  ? String(parsed.windProtection)  as ClothingAnalysis["windProtection"]  : "unknown";
  const fitEst    = VALID_FIT.has(String(parsed.fitEstimate))           ? String(parsed.fitEstimate)      as ClothingAnalysis["fitEstimate"]      : "unknown";
  const rawWarmth = (parsed.warmth ?? {}) as Record<string, unknown>;
  const warmthScore = clamp(rawWarmth.score, 1, 5);
  const warmthLabel = VALID_WARMTH_LBLS.has(String(rawWarmth.label)) ? String(rawWarmth.label) as ClothingAnalysis["warmth"]["label"] : "medium";
  const rawConf = (parsed.confidence ?? {}) as Record<string, unknown>;

  return {
    name: str(parsed.name, "Clothing item"), category,
    subcategory: str(parsed.subcategory, "", 60),
    primaryColor: str(parsed.primaryColor, "Unknown", 60),
    secondaryColors: arrStr(parsed.secondaryColors, 8, 60),
    pattern, materialEstimate: arrStr(parsed.materialEstimate, 8, 80),
    layerRole,
    warmth: { score: warmthScore, label: warmthLabel },
    waterResistance: waterRes, windProtection: windProt,
    weatherFit: arrStr(parsed.weatherFit, 8, 40),
    styles: arrStr(parsed.styles, 8, 40),
    seasons: arrStr(parsed.seasons, 8, 20),
    fitEstimate: fitEst,
    confidence: {
      category:        clamp(rawConf.category,        0, 1),
      color:           clamp(rawConf.color,           0, 1),
      material:        clamp(rawConf.material,        0, 1),
      warmth:          clamp(rawConf.warmth,          0, 1),
      waterResistance: clamp(rawConf.waterResistance, 0, 1),
      style:           clamp(rawConf.style,           0, 1),
    },
    // evidence: deliberately omitted from new items (decision a)
  };
}

function validateScanResult(raw: string): ScanResult {
  let parsed: Record<string, unknown>;
  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new ApiError(502, "AI returned an unreadable response. Please try another photo.");
  }

  const status = String(parsed.status ?? "");

  if (status === "rejected") {
    const reasonCode = String(parsed.reasonCode ?? "");
    if (!VALID_REASON_CODES.has(reasonCode)) {
      // Unknown reason code from model — treat as generic unsafe
      return { status: "rejected", reasonCode: "unsafe_content" };
    }
    return { status: "rejected", reasonCode: reasonCode as RejectionReasonCode };
  }

  if (status === "accepted") {
    const analysisRaw = (parsed.analysis ?? {}) as Record<string, unknown>;
    return { status: "accepted", analysis: validateClothingAnalysis(analysisRaw) };
  }

  // Unrecognised status — treat as provider failure
  throw new ApiError(502, "AI returned an unrecognised response format. Please try again.");
}

// ── Rejection reason → user message mapping ────────────────────────────────────

function rejectionMessage(reasonCode: RejectionReasonCode): string {
  switch (reasonCode) {
    case "person_present":
      return "Please upload the clothing item by itself, without any person, face or body.";
    case "multiple_items":
      return "Please upload one clothing item at a time.";
    case "id_or_document":
      return "Please upload only a clothing item — documents and personal information aren't allowed.";
    case "unsafe_content":
    case "not_clothing":
    case "unusable_image":
    default:
      return "We couldn't safely analyze this image. Please try another clothing-only photo.";
  }
}

// ── Main scan handler ─────────────────────────────────────────────────────────

export async function handleWardrobeScan(request: Request): Promise<Response> {
  try {
    // 0a. Feature flag
    assertScanningEnabled();
    // 0b. Provider configured
    assertAnthropicConfigured();
    assertQuotaMatchesPolicy();

    // 1. Verify Firebase Auth — uid ALWAYS from verified token
    const uid = await verifyFirebaseToken(request);

    // 2. Abuse rate limit — checked before quota reservation or provider call
    await checkAbuseRateLimit(uid);

    // 3. Verify acknowledgement — server-side enforcement, not UI-only
    await verifyAcknowledgement(uid);

    // 4. Read raw body with size guard
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) throw new ApiError(413, "Image too large. Please use a smaller photo.");

    let bodyBuffer: ArrayBuffer;
    try { bodyBuffer = await request.arrayBuffer(); }
    catch { throw new ApiError(400, "Could not read request body."); }
    if (bodyBuffer.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "Image too large. Please use a smaller photo.");
    if (bodyBuffer.byteLength === 0) throw new ApiError(400, "Empty image file.");

    // 5. Validate content type (MIME allowlist)
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_MIME.has(contentType)) {
      throw new ApiError(415, "Unsupported image type. Please use JPEG, PNG, or WebP.");
    }

    // 6. Magic-byte validation — rejects MIME/content mismatches, PDF bytes, HEIC relabeled as JPEG
    const bytes = new Uint8Array(bodyBuffer);
    validateMagicBytes(bytes, contentType);

    // 7. Check entitlement + atomically reserve quota
    const entitlement = await verifyEntitlementServer(uid);
    const isPremium   = entitlement.active;
    const reservation = await reserveQuota(uid, isPremium);

    // 8. Convert to base64 (never logged)
    const base64 = Buffer.from(bodyBuffer).toString("base64");

    // 9. Call Anthropic provider
    let scanResult: ScanResult;
    try {
      const { result } = await anthropicProvider.analyze(base64, contentType);
      scanResult = result;
    } catch (aiErr) {
      await refundQuota(uid, reservation.reservationId);
      throw aiErr;
    }

    // 10. Handle rejection
    if (scanResult.status === "rejected") {
      await refundQuota(uid, reservation.reservationId);
      return new Response(JSON.stringify({
        ok:    false,
        error: rejectionMessage(scanResult.reasonCode),
        code:  "rejected",
      } satisfies ScanErrorResponse), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 11. Accepted — finalize quota
    await finalizeQuotaSuccess(uid, reservation.reservationId);

    // 12. Return response — analysis.evidence is intentionally absent from new scans
    const response: ScanSuccessResponse = {
      ok:       true,
      analysis: scanResult.analysis,  // no evidence field
      remainingFreeScans: reservation.remainingFreeScans,
      quota: {
        isPremium,
        remainingDaily:   reservation.remainingDaily,
        remaining30Day:   reservation.remaining30Day,
        rolling30ResetMs: reservation.rolling30ResetMs,
      },
    };

    return new Response(JSON.stringify(response), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    const response: ScanErrorResponse = {
      ok:    false,
      error: err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      code:  err instanceof ApiError ? mapStatusToCode(err.status) : "server",
    };
    return new Response(JSON.stringify(response), {
      status:  err instanceof ApiError ? err.status : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function mapStatusToCode(status: number): string {
  if (status === 401) return "auth";
  if (status === 403) return "ack";
  if (status === 413) return "size";
  if (status === 415) return "type";
  if (status === 422) return "rejected";
  if (status === 429) return "quota";
  if (status >= 500)  return "ai";
  return "server";
}

// Re-export apiErrorResponse for server.ts compatibility
export { apiErrorResponse };
