/**
 * wardrobe-ai-handler.ts — Server-only Wardrobe AI scan handler.
 *
 * IMPORTED ONLY FROM src/server.ts. Must NEVER be imported from client-side code.
 *
 * Route: POST /api/wardrobe/scan
 *
 * ── QUOTA MODEL ───────────────────────────────────────────────────────────────
 *
 * Free accounts:
 *   FREE_LIFETIME_LIMIT  = 3 successful scans, total, for the life of the account.
 *   Failed scans (all provider attempts exhausted) do NOT consume the allowance.
 *   Recommendations using already-scanned items consume zero scans.
 *
 * Premium / active trial accounts:
 *   PREMIUM_DAILY_LIMIT      = 15 successful scans per UTC day.
 *   PREMIUM_ROLLING_30_LIMIT = 100 successful scans per rolling 30-day window.
 *   Both limits are enforced independently (the stricter limit takes effect).
 *   Free lifetime allowance is separate and unaffected by Premium scans.
 *   cancel_at_period_end: Premium limits apply until entitlement.active becomes false.
 *   Transition back to Free: remaining Free lifetime allowance resumes.
 *
 * Reserve-before-call:
 *   Both counters are pre-incremented inside a Firestore transaction before calling
 *   Gemini. Concurrent requests see the updated count and are rejected if at the
 *   limit. On total provider failure, both counters are refunded atomically.
 *   Retries within a single user scan request do NOT consume additional allowance.
 *
 * ── FAIL-CLOSED PRODUCTION CHECK ─────────────────────────────────────────────
 *
 *   GEMINI_SERVICE_TIER=paid   must be set in production (server-only, never VITE_*).
 *   If absent or not "paid", scanning is disabled with a clear configuration error.
 *   This prevents accidental use of a Free-tier key in production with personal data.
 *
 * ── PRIVACY ───────────────────────────────────────────────────────────────────
 *
 *   Image bytes are NOT persisted after analysis.
 *   No image data, prompts, garment descriptions, email, name, Firebase ID token,
 *   or API key are written to logs.
 *   Token usage metadata IS logged for cost and quota monitoring (safe operational data).
 *
 * ── ENV VARS (server-only, NEVER VITE_*) ─────────────────────────────────────
 *
 *   GEMINI_API_KEY           — Gemini API key (Paid project key in production)
 *   GEMINI_WARDROBE_MODEL    — model name (default: gemini-3.6-flash)
 *   GEMINI_SERVICE_TIER      — must be "paid" in production
 *   (Quota limits are policy-locked constants, not env-var overrides in production)
 */

import { verifyFirebaseToken, verifyEntitlementServer, getAdminDb, ApiError, apiErrorResponse } from "./stripe-server";
import {
  POLICY_FREE_LIFETIME_SCANS,
  POLICY_PREMIUM_DAILY_SCANS,
  POLICY_PREMIUM_ROLLING_SCANS,
  POLICY_ROLLING_WINDOW_DAYS,
} from "./policyVersions";
import { FieldValue } from "firebase-admin/firestore";
import type { ClothingAnalysis, ScanResponse } from "./wardrobe-types";

// ── Configuration constants ───────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB after client compression

// ── Policy-locked quota constants ────────────────────────────────────────────
//
// These values are the customer-facing promises in the Terms of Service.
// They MUST match the POLICY_* constants in policyVersions.ts.
// Production startup asserts the match — divergence is a configuration error.
// There are no runtime environment overrides in production.
// Development may use WARDROBE_QUOTA_DEV_OVERRIDE=true to lower limits for testing.

/** Free accounts: 3 successful scans for the life of the account. */
const FREE_LIFETIME_LIMIT = POLICY_FREE_LIFETIME_SCANS;

/** Premium / active trial: successful scans per UTC calendar day. */
const PREMIUM_DAILY_LIMIT = POLICY_PREMIUM_DAILY_SCANS;

/** Premium / active trial: successful scans per rolling 30-day window. */
const PREMIUM_ROLLING_30_LIMIT = POLICY_PREMIUM_ROLLING_SCANS;

/** Rolling window duration in milliseconds (30 full days). */
const ROLLING_WINDOW_MS = POLICY_ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

/**
 * Assert that runtime quota values match the customer-facing policy constants.
 * Called once at startup. Prevents silent Terms-vs-code divergence in production.
 */
function assertQuotaMatchesPolicy(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return; // dev/test may use adjusted values
  const mismatches: string[] = [];
  if (FREE_LIFETIME_LIMIT    !== POLICY_FREE_LIFETIME_SCANS)   mismatches.push(`FREE_LIFETIME: code=${FREE_LIFETIME_LIMIT} policy=${POLICY_FREE_LIFETIME_SCANS}`);
  if (PREMIUM_DAILY_LIMIT    !== POLICY_PREMIUM_DAILY_SCANS)   mismatches.push(`DAILY: code=${PREMIUM_DAILY_LIMIT} policy=${POLICY_PREMIUM_DAILY_SCANS}`);
  if (PREMIUM_ROLLING_30_LIMIT !== POLICY_PREMIUM_ROLLING_SCANS) mismatches.push(`ROLLING: code=${PREMIUM_ROLLING_30_LIMIT} policy=${POLICY_PREMIUM_ROLLING_SCANS}`);
  if (mismatches.length > 0) {
    throw new Error(
      "FATAL: Quota constants do not match customer-facing policy. " +
      "Terms of Service would be inaccurate. Fix before deploying. " +
      mismatches.join("; ")
    );
  }
}

// Retry configuration for Gemini API calls.
const GEMINI_RETRYABLE         = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS      = 2;
const GEMINI_TOTAL_DEADLINE_MS = 50_000;

const ACCEPTED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/heic", "image/heif",
]);

// ── Production feature flag ──────────────────────────────────────────────────

/**
 * WARDROBE_AI_SCANNING_ENABLED=false disables scanning completely.
 * No quota reservation and no Gemini call occur.
 *
 * This is the primary on/off switch for AI scanning, independent of the
 * Paid-tier check. Set to "false" while the feature is under review.
 * When "true" (or unset in dev), the Paid-tier check runs next.
 *
 * Returns a stable error code so the client can show a friendly message
 * rather than a generic crash: "wardrobe_scanning_temporarily_unavailable".
 */
function assertScanningEnabled(): void {
  const enabled = process.env.WARDROBE_AI_SCANNING_ENABLED;
  // Treat missing as "true" in development so local dev works without extra config.
  // In production, an explicit "true" is required (fail-closed).
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && enabled !== "true") {
    throw new ApiError(
      503,
      "Wardrobe scanning is temporarily unavailable while we improve it. " +
      "You can still add clothing manually.",
      "wardrobe_scanning_temporarily_unavailable",
    );
  }
  if (!isProd && enabled === "false") {
    throw new ApiError(
      503,
      "Wardrobe scanning is temporarily unavailable while we improve it. " +
      "You can still add clothing manually.",
      "wardrobe_scanning_temporarily_unavailable",
    );
  }
}

// ── Fail-closed Paid-tier check ───────────────────────────────────────────────

/**
 * Verifies that scanning is configured for a Paid Gemini project.
 * Only reached when WARDROBE_AI_SCANNING_ENABLED=true.
 *
 * In production, GEMINI_SERVICE_TIER must be "paid".
 * Never infer Paid status from the API key text.
 */
function assertPaidServiceConfigured(): void {
  const tier   = process.env.GEMINI_SERVICE_TIER;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && tier !== "paid") {
    throw new ApiError(
      503,
      "Wardrobe scanning is not available. " +
      "GEMINI_SERVICE_TIER=paid must be set in production. " +
      "Contact support if this is unexpected.",
    );
  }
  if (!isProd && !tier) {
    throw new ApiError(
      503,
      "Wardrobe scanning requires GEMINI_SERVICE_TIER to be configured. " +
      "Set GEMINI_SERVICE_TIER=development for local testing. " +
      "Personal data must not be submitted to Unpaid Services.",
    );
  }
}

function getGeminiModel(): string {
  return process.env.GEMINI_WARDROBE_MODEL ?? "gemini-3.6-flash";
}

function getGeminiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new ApiError(503, "AI service not configured");
  return k;
}

// ── Quota schema ──────────────────────────────────────────────────────────────

/**
 * Firestore document: users/{uid}/quotas/wardrobeAi
 *
 * MIGRATION: legacy documents may be missing rolling30Count / rolling30StartMs.
 * All reads default to 0 for missing fields — safe migration.
 *
 * lifetimeFreeScans — count of successful Free scans after all refunds are
 *   applied. May be decremented by a refund when the Free window is still active
 *   (Free has no reset window, so refund applies whenever it occurs).
 */
type QuotaData = {
  lifetimeFreeScans:  number;
  scansToday:         number;
  resetDate:          string;   // "YYYY-MM-DD" UTC
  rolling30Count:     number;
  rolling30StartMs:   number;   // epoch ms
  lastScanAt:         number;
  updatedAt:          number;
};

/**
 * Reservation record: users/{uid}/quotaReservations/{reservationId}
 *
 * Written by reserveQuota before calling Gemini. Used by refundQuota to
 * apply the refund only to the window that was reserved — not the current
 * window if a day or rolling boundary crossed between reservation and refund.
 *
 * STATUS lifecycle:
 *   "reserved"  → created before Gemini call
 *   "succeeded" → Gemini succeeded; finalised idempotently
 *   "refunded"  → Gemini failed; counters refunded idempotently
 *
 * Cleanup: documents in terminal states ("succeeded", "refunded") may be
 * deleted after 7 days by a background Admin task. They are never deleted
 * by the client. "reserved" documents older than 5 minutes can be treated
 * as stale (the request crashed before Gemini could succeed or fail).
 *
 * What is NOT stored: image bytes, prompts, garment descriptions, API keys.
 */
type ReservationStatus = "reserved" | "succeeded" | "refunded";

type QuotaReservationRecord = {
  reservationId:     string;   // UUID, also the Firestore doc ID
  uid:               string;
  isPremium:         boolean;
  reservedDate:      string;   // "YYYY-MM-DD" UTC at time of reservation
  reservedRolling30StartMs: number | null;  // rolling window start at reservation
  reservedFree:      boolean;  // true if Free lifetime counter was incremented
  reservedDaily:     boolean;  // true if daily counter was incremented
  reservedRolling:   boolean;  // true if rolling counter was incremented
  status:            ReservationStatus;
  createdAt:         number;   // ms epoch
  finalizedAt:       number | null;
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
  remainingFreeScans:  number | null;  // null for premium
  remainingDaily:      number | null;  // null for free
  remaining30Day:      number | null;  // null for free
  dailyResetAt:        string | null;  // "YYYY-MM-DD" of next UTC midnight
  rolling30ResetMs:    number | null;  // epoch ms when 30-day window resets
};

/**
 * Atomically reserve one scan against all applicable limits.
 * Writes a QuotaReservationRecord with a server-generated ID.
 * The record captures the exact window parameters at reservation time so that
 * refundQuota can safely refund the correct window even if a day or rolling
 * boundary has since expired.
 */
async function reserveQuota(
  uid: string,
  isPremium: boolean,
): Promise<QuotaReservation> {
  const db    = getAdminDb();
  const ref   = db.doc(`users/${uid}/quotas/wardrobeAi`);
  const today = todayUTC();
  const nowMs = Date.now();
  const reservationId = crypto.randomUUID();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw  = (snap.data() ?? {}) as Partial<QuotaData>;

    // Daily: reset if today has changed
    const scansToday = raw.resetDate === today ? (raw.scansToday ?? 0) : 0;

    // Rolling 30-day: default start = now if missing (fresh window for legacy docs)
    const rolling30Start  = raw.rolling30StartMs ?? nowMs;
    const windowExpiredMs = rolling30Start + ROLLING_WINDOW_MS;
    const windowExpired   = nowMs >= windowExpiredMs;
    const rolling30Count  = windowExpired ? 0 : (raw.rolling30Count ?? 0);
    const rolling30StartMs = windowExpired ? nowMs : rolling30Start;

    if (isPremium) {
      if (scansToday >= PREMIUM_DAILY_LIMIT) {
        throw new ApiError(429,
          `Daily scan limit reached (${PREMIUM_DAILY_LIMIT} per day). ` +
          `Resets at midnight UTC.`);
      }
      if (rolling30Count >= PREMIUM_ROLLING_30_LIMIT) {
        const resetDate = new Date(rolling30StartMs + ROLLING_WINDOW_MS).toISOString().slice(0, 10);
        throw new ApiError(429,
          `Scan limit reached (${PREMIUM_ROLLING_30_LIMIT} per 30 days). ` +
          `Resets on ${resetDate}.`);
      }

      tx.set(ref, {
        lifetimeFreeScans:  raw.lifetimeFreeScans ?? 0,
        scansToday:          scansToday + 1,
        resetDate:           today,
        rolling30Count:      rolling30Count + 1,
        rolling30StartMs,
        lastScanAt:          nowMs,
        updatedAt:           FieldValue.serverTimestamp() as unknown as number,
      }, { merge: true });

      return {
        reservationId,
        isPremium:          true,
        remainingFreeScans: null,
        remainingDaily:     PREMIUM_DAILY_LIMIT - (scansToday + 1),
        remaining30Day:     PREMIUM_ROLLING_30_LIMIT - (rolling30Count + 1),
        dailyResetAt:       today,
        rolling30ResetMs:   rolling30StartMs + ROLLING_WINDOW_MS,
        // Window info for safe refund
        _reservedDate:      today,
        _reservedRolling30StartMs: rolling30StartMs,
      } as QuotaReservation & { _reservedDate: string; _reservedRolling30StartMs: number };

    } else {
      const lifetimeFree = raw.lifetimeFreeScans ?? 0;
      if (lifetimeFree >= FREE_LIFETIME_LIMIT) {
        throw new ApiError(429,
          `Free scan limit reached (${FREE_LIFETIME_LIMIT} lifetime). ` +
          `Upgrade to Premium for more scans.`);
      }

      tx.set(ref, {
        lifetimeFreeScans: lifetimeFree + 1,
        scansToday:         scansToday + 1,
        resetDate:          today,
        rolling30Count:     raw.rolling30Count ?? 0,
        rolling30StartMs:   rolling30StartMs,
        lastScanAt:         nowMs,
        updatedAt:          FieldValue.serverTimestamp() as unknown as number,
      }, { merge: true });

      return {
        reservationId,
        isPremium:          false,
        remainingFreeScans: FREE_LIFETIME_LIMIT - (lifetimeFree + 1),
        remainingDaily:     null,
        remaining30Day:     null,
        dailyResetAt:       null,
        rolling30ResetMs:   null,
        _reservedDate:      today,
        _reservedRolling30StartMs: null,
      } as QuotaReservation & { _reservedDate: string; _reservedRolling30StartMs: number | null };
    }
  });

  // Write the reservation record (outside the quota transaction so the quota
  // transaction is not blocked by this additional write).
  const extended = result as QuotaReservation & {
    _reservedDate: string;
    _reservedRolling30StartMs: number | null;
  };
  const record: QuotaReservationRecord = {
    reservationId,
    uid,
    isPremium,
    reservedDate:              extended._reservedDate,
    reservedRolling30StartMs:  extended._reservedRolling30StartMs ?? null,
    reservedFree:              !isPremium,
    reservedDaily:             isPremium,
    reservedRolling:           isPremium,
    status:                    "reserved",
    createdAt:                 nowMs,
    finalizedAt:               null,
  };
  await getAdminDb().doc(reservationPath(uid, reservationId)).set(record);

  return result;
}

/**
 * Finalize the reservation as succeeded (Gemini returned a valid result).
 * Idempotent: safe to call multiple times; only the first call takes effect.
 */
async function finalizeQuotaSuccess(uid: string, reservationId: string): Promise<void> {
  try {
    const ref = getAdminDb().doc(reservationPath(uid, reservationId));
    await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const rec = snap.data() as QuotaReservationRecord;
      if (rec.status !== "reserved") return; // already finalized
      tx.update(ref, { status: "succeeded", finalizedAt: Date.now() });
    });
  } catch (e) {
    // Non-fatal: reservation record failure does not affect the scan result
    const safe = e instanceof Error ? e.message : String(e);
    console.error("[wardrobe-ai] reservation finalize-success failed:", safe);
  }
}

/**
 * Refund the quota reservation after total provider failure.
 * Window-safe: only decrements the counter for the exact window that was reserved.
 * If a UTC day or rolling window boundary has passed since reservation, the
 * current counter has already reset — nothing to decrement.
 * Idempotent: only the first call performs the decrement (status guard).
 */
async function refundQuota(uid: string, reservationId: string): Promise<void> {
  try {
    const db     = getAdminDb();
    const recRef = db.doc(reservationPath(uid, reservationId));
    const quotaRef = db.doc(`users/${uid}/quotas/wardrobeAi`);
    const today  = todayUTC();
    const nowMs  = Date.now();

    await db.runTransaction(async (tx) => {
      // Read both reservation record and current quota atomically
      const [recSnap, quotaSnap] = await Promise.all([tx.get(recRef), tx.get(quotaRef)]);

      if (!recSnap.exists) return; // reservation lost — best-effort, nothing to do
      const rec = recSnap.data() as QuotaReservationRecord;
      if (rec.status !== "reserved") return; // already succeeded or refunded — idempotent

      const raw = (quotaSnap.data() ?? {}) as Partial<QuotaData>;

      const updates: Partial<QuotaData> = { updatedAt: nowMs };

      if (!rec.isPremium && rec.reservedFree) {
        // Free lifetime counter: refund always (no reset window)
        updates.lifetimeFreeScans = Math.max(0, (raw.lifetimeFreeScans ?? 0) - 1);
      }

      if (rec.isPremium && rec.reservedDaily) {
        // Daily counter: only refund if the reserved day is still current
        const currentDate  = raw.resetDate ?? today;
        const scansToday   = currentDate === today ? (raw.scansToday ?? 0) : 0;
        if (rec.reservedDate === today) {
          updates.scansToday = Math.max(0, scansToday - 1);
        }
        // If rec.reservedDate !== today: the day has rolled over; the current
        // scansToday counter has already reset to 0. No decrement needed.
      }

      if (rec.isPremium && rec.reservedRolling && rec.reservedRolling30StartMs !== null) {
        // Rolling counter: only refund if the reserved window is still active
        const currentWindowStart = raw.rolling30StartMs ?? 0;
        if (currentWindowStart === rec.reservedRolling30StartMs) {
          updates.rolling30Count = Math.max(0, (raw.rolling30Count ?? 0) - 1);
        }
        // If window has rotated: rolling30StartMs has changed; current counter
        // counts from the new window start. No decrement needed.
      }

      tx.set(quotaRef, updates, { merge: true });
      tx.update(recRef, { status: "refunded", finalizedAt: nowMs });
    });
  } catch (e) {
    const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
    console.error("[wardrobe-ai] quota refund failed:", safe);
  }
}

// ── Token-usage telemetry ─────────────────────────────────────────────────────

/**
 * Safe telemetry record for a Gemini call.
 * Contains ONLY numeric/categorical operational metadata — no PII, no content.
 */
type GeminiTelemetry = {
  model:          string;
  inputTokens:    number;
  outputTokens:   number;
  thinkingTokens: number;
  totalTokens:    number;
  retryOccurred:  boolean;
  success:        boolean;
  timestampMs:    number;
};

function emitTelemetry(t: GeminiTelemetry): void {
  try {
    // Log only safe operational data — no prompt text, image bytes, or user identifiers.
    console.info("[wardrobe-ai-telemetry]", JSON.stringify({
      model:          t.model,
      inputTokens:    t.inputTokens,
      outputTokens:   t.outputTokens,
      thinkingTokens: t.thinkingTokens,
      totalTokens:    t.totalTokens,
      retryOccurred:  t.retryOccurred,
      success:        t.success,
      timestampMs:    t.timestampMs,
    }));
  } catch {
    // Telemetry failures must never break a successful scan.
  }
}

// ── Scanner provider interface ───────────────────────────────────────────────

/**
 * WardrobeScanProvider — decouples the quota/UI layer from the AI provider.
 *
 * Gemini is the current implementation. This interface allows a future
 * teen-compatible provider (self-hosted model, different API) to be swapped
 * in without rewriting quota reservation, response validation, or client UI.
 *
 * A provider receives only the already-base64-encoded image and its MIME type.
 * It must return a ClothingAnalysis (already validated) and usage telemetry.
 * The provider MUST NOT log image bytes, prompts, or garment descriptions.
 */
interface WardrobeScanProvider {
  readonly name: string;
  analyze(
    base64Image: string,
    mimeType:    string,
  ): Promise<{ analysis: ClothingAnalysis; retryOccurred: boolean }>;
}

// ── Gemini system prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clothing analysis assistant for a weather-aware wardrobe app called Aeruvo.

Analyze the clothing item in the photo and return ONLY a JSON object. No markdown, no preamble, no explanation.

CRITICAL HONESTY RULES:
- Never hallucinate physical properties that cannot be observed visually.
- waterResistance and windProtection: use "unknown" unless the item is visually obvious outerwear (e.g., rain jacket with taped seams, rubber boots, transparent waterproof panel). A black hoodie is "none". A fleece is "low". Only assign "medium" or "high" if there is strong visual evidence.
- materialEstimate: describe what it LOOKS like ("appears to be cotton", "likely synthetic fleece"). Never claim certainty about fabric composition from a photo.
- Use low confidence values (< 0.60) when genuinely uncertain.
- fitEstimate: use "unknown" if you cannot clearly tell from the photo.

Return this exact JSON schema:
{
  "name": "string (short descriptive name, e.g. 'Navy wool overcoat')",
  "category": "tops|bottoms|outerwear|shoes|accessories|dress|other",
  "subcategory": "string (e.g. 'Hoodie', 'Chinos', 'Puffer jacket')",
  "primaryColor": "string (e.g. 'Navy blue', 'Charcoal grey')",
  "secondaryColors": ["string"],
  "pattern": "solid|striped|checked|graphic|patterned|other",
  "materialEstimate": ["string"],
  "layerRole": "base|mid|outer|standalone",
  "warmth": {
    "score": number (1-5, where 1=very light e.g. tank top, 5=very warm e.g. puffer),
    "label": "very-light|light|medium|warm|very-warm"
  },
  "waterResistance": "none|low|medium|high|unknown",
  "windProtection": "low|medium|high|unknown",
  "weatherFit": ["string (e.g. 'Mild', 'Cool', 'Cold', 'Rainy')"],
  "styles": ["string (e.g. 'Casual', 'Smart-casual', 'Formal')"],
  "seasons": ["string (e.g. 'Spring', 'Fall', 'Winter')"],
  "fitEstimate": "slim|regular|relaxed|oversized|unknown",
  "confidence": {
    "category": number (0.0-1.0),
    "color": number (0.0-1.0),
    "material": number (0.0-1.0),
    "warmth": number (0.0-1.0),
    "waterResistance": number (0.0-1.0),
    "style": number (0.0-1.0)
  },
  "evidence": "string (optional: one short sentence about what you can see. Max 120 chars.)"
}`;

// ── Gemini API call ───────────────────────────────────────────────────────────

class GeminiHttpError extends Error {
  constructor(public readonly geminiStatus: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

async function callGemini(
  base64Image: string,
  mimeType:    string,
  attempt:     number,
): Promise<{ analysis: ClothingAnalysis; telemetry: Omit<GeminiTelemetry, "retryOccurred" | "success"> }> {
  const model  = getGeminiModel();
  const apiKey = getGeminiKey();
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType === "image/heic" || mimeType === "image/heif"
              ? "image/jpeg"
              : mimeType,
            data: base64Image,
          },
        },
        { text: SYSTEM_PROMPT },
      ],
    }],
    generationConfig: {
      maxOutputTokens:  512,
      responseMimeType: "application/json",
      thinkingConfig:   { thinkingBudget: 512 },
    },
  };

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 50_000);
  const t0         = Date.now();

  // Log only model + attempt number — no key, no image, no prompt content
  console.info(`[wardrobe-ai] attempt=${attempt} model=${model}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const elapsed   = Date.now() - t0;
    const msg       = err instanceof Error ? err.message : String(err);
    const timedOut  = msg.includes("aborted");
    console.error(`[wardrobe-ai] fetch failed elapsed=${elapsed}ms timedOut=${timedOut}`);
    if (timedOut) throw new ApiError(504, "AI analysis timed out. Please try again.");
    throw new ApiError(502, "AI service temporarily unavailable.");
  }
  clearTimeout(timeout);
  const elapsed = Date.now() - t0;

  if (!res.ok) {
    let errCode = "", errMessage = "";
    try {
      const errBody = await res.json() as { error?: { code?: number; message?: string } };
      errCode    = String(errBody?.error?.code ?? "");
      errMessage = String(errBody?.error?.message ?? "").slice(0, 200);
    } catch { errMessage = "<unreadable>"; }
    // Log only HTTP status and Google error code — no key, no image, no PII
    console.error(`[wardrobe-ai] attempt=${attempt} status=${res.status} elapsed=${elapsed}ms errCode=${errCode} errMessage=${errMessage}`);
    throw new GeminiHttpError(res.status, `Gemini ${res.status}`);
  }

  console.info(`[wardrobe-ai] status=${res.status} elapsed=${elapsed}ms`);

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?:    number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?:  number;
      totalTokenCount?:     number;
    };
  };

  // Extract usage metadata for telemetry — purely numeric, no content
  const usage          = json.usageMetadata ?? {};
  const inputTokens    = usage.promptTokenCount     ?? 0;
  const outputTokens   = usage.candidatesTokenCount ?? 0;
  const thinkingTokens = usage.thoughtsTokenCount   ?? 0;
  const totalTokens    = usage.totalTokenCount       ?? (inputTokens + outputTokens + thinkingTokens);

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    console.error("[wardrobe-ai] Gemini returned empty text");
    throw new ApiError(502, "AI returned an empty response. Please try again.");
  }

  // Log output length only — never the content
  console.info(`[wardrobe-ai] validating response length=${text.length}`);
  const analysis = validateAnalysis(text);
  console.info(`[wardrobe-ai] validation ok category=${analysis.category}`);

  return {
    analysis,
    telemetry: {
      model,
      inputTokens,
      outputTokens,
      thinkingTokens,
      totalTokens,
      timestampMs: Date.now(),
    },
  };
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

/** Gemini implementation of WardrobeScanProvider. */
const geminiProvider: WardrobeScanProvider = {
  name: "gemini",
  async analyze(base64Image, mimeType) {
    return callGeminiWithRetry(base64Image, mimeType);
  },
};

async function callGeminiWithRetry(
  base64Image: string,
  mimeType:    string,
): Promise<{ analysis: ClothingAnalysis; retryOccurred: boolean }> {
  const overallDeadline = Date.now() + GEMINI_TOTAL_DEADLINE_MS;
  let retryOccurred     = false;
  let lastTelemetry: Omit<GeminiTelemetry, "retryOccurred" | "success"> | null = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const isLast = attempt === GEMINI_MAX_ATTEMPTS;
    try {
      const { analysis, telemetry } = await callGemini(base64Image, mimeType, attempt);
      lastTelemetry = telemetry;
      emitTelemetry({ ...telemetry, retryOccurred, success: true });
      return { analysis, retryOccurred };

    } catch (err) {
      if (err instanceof ApiError) {
        emitTelemetry({
          model: getGeminiModel(), inputTokens: 0, outputTokens: 0,
          thinkingTokens: 0, totalTokens: 0, timestampMs: Date.now(),
          retryOccurred, success: false,
        });
        throw err;
      }

      if (err instanceof GeminiHttpError) {
        const retryable = GEMINI_RETRYABLE.has(err.geminiStatus);
        console.warn(`[wardrobe-ai] attempt=${attempt} geminiStatus=${err.geminiStatus} retryable=${retryable} isLast=${isLast}`);

        if (!retryable || isLast) {
          emitTelemetry({
            model: getGeminiModel(), inputTokens: 0, outputTokens: 0,
            thinkingTokens: 0, totalTokens: 0, timestampMs: Date.now(),
            retryOccurred, success: false,
          });
          if (err.geminiStatus === 429) throw new ApiError(503, "AI service is busy. Please try again shortly.");
          throw new ApiError(502, "AI analysis failed. Please try another photo.");
        }

        const backoffMs = 1_000 + Math.floor(Math.random() * 500);
        if (Date.now() + backoffMs >= overallDeadline) {
          emitTelemetry({
            model: getGeminiModel(), inputTokens: 0, outputTokens: 0,
            thinkingTokens: 0, totalTokens: 0, timestampMs: Date.now(),
            retryOccurred, success: false,
          });
          throw new ApiError(504, "AI analysis timed out. Please try again.");
        }
        console.info(`[wardrobe-ai] retrying in ${backoffMs}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})`);
        retryOccurred = true;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      throw err;
    }
  }
  throw new ApiError(502, "AI analysis failed. Please try another photo.");
}

// ── Response validation ───────────────────────────────────────────────────────

const VALID_CATEGORIES  = new Set(["tops","bottoms","outerwear","shoes","accessories","dress","other"]);
const VALID_PATTERNS    = new Set(["solid","striped","checked","graphic","patterned","other"]);
const VALID_LAYER_ROLES = new Set(["base","mid","outer","standalone"]);
const VALID_WARMTH_LBLS = new Set(["very-light","light","medium","warm","very-warm"]);
const VALID_WATER_RES   = new Set(["none","low","medium","high","unknown"]);
const VALID_WIND_PROT   = new Set(["low","medium","high","unknown"]);
const VALID_FIT         = new Set(["slim","regular","relaxed","oversized","unknown"]);

function clamp(n: unknown, lo: number, hi: number): number {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  if (isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function arrStr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").slice(0, 8);
  return [];
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : fallback;
}

function validateAnalysis(raw: string): ClothingAnalysis {
  let parsed: Record<string, unknown>;
  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new ApiError(502, "AI returned an unreadable response. Please try another photo.");
  }

  const category  = VALID_CATEGORIES.has(String(parsed.category))   ? String(parsed.category)  as ClothingAnalysis["category"]  : "other";
  const pattern   = VALID_PATTERNS.has(String(parsed.pattern))       ? String(parsed.pattern)   as ClothingAnalysis["pattern"]   : "solid";
  const layerRole = VALID_LAYER_ROLES.has(String(parsed.layerRole))  ? String(parsed.layerRole) as ClothingAnalysis["layerRole"] : "standalone";
  const waterRes  = VALID_WATER_RES.has(String(parsed.waterResistance)) ? String(parsed.waterResistance) as ClothingAnalysis["waterResistance"] : "unknown";
  const windProt  = VALID_WIND_PROT.has(String(parsed.windProtection))  ? String(parsed.windProtection)  as ClothingAnalysis["windProtection"]  : "unknown";
  const fitEst    = VALID_FIT.has(String(parsed.fitEstimate))           ? String(parsed.fitEstimate)      as ClothingAnalysis["fitEstimate"]      : "unknown";
  const rawWarmth = (parsed.warmth ?? {}) as Record<string, unknown>;
  const warmthScore = clamp(rawWarmth.score, 1, 5);
  const warmthLabel = VALID_WARMTH_LBLS.has(String(rawWarmth.label)) ? String(rawWarmth.label) as ClothingAnalysis["warmth"]["label"] : "medium";
  const rawConf = (parsed.confidence ?? {}) as Record<string, unknown>;

  return {
    name: str(parsed.name, "Clothing item"), category, subcategory: str(parsed.subcategory, ""),
    primaryColor: str(parsed.primaryColor, "Unknown"), secondaryColors: arrStr(parsed.secondaryColors),
    pattern, materialEstimate: arrStr(parsed.materialEstimate), layerRole,
    warmth: { score: warmthScore, label: warmthLabel },
    waterResistance: waterRes, windProtection: windProt,
    weatherFit: arrStr(parsed.weatherFit), styles: arrStr(parsed.styles), seasons: arrStr(parsed.seasons),
    fitEstimate: fitEst,
    confidence: {
      category: clamp(rawConf.category, 0, 1), color: clamp(rawConf.color, 0, 1),
      material: clamp(rawConf.material, 0, 1), warmth: clamp(rawConf.warmth, 0, 1),
      waterResistance: clamp(rawConf.waterResistance, 0, 1), style: clamp(rawConf.style, 0, 1),
    },
    evidence: typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 120) : undefined,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleWardrobeScan(request: Request): Promise<Response> {
  try {
    // 0a. Feature flag: scanning must be explicitly enabled in production
    assertScanningEnabled();
    // 0b. Fail-closed: Gemini project tier check (only runs when scanning is enabled)
    assertPaidServiceConfigured();
    assertQuotaMatchesPolicy();

    // 1. Verify Firebase Auth — uid is ALWAYS from the verified token
    const uid = await verifyFirebaseToken(request);

    // 2. Read raw body with size guard
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) throw new ApiError(413, "Image too large. Please use a smaller photo.");

    let bodyBuffer: ArrayBuffer;
    try { bodyBuffer = await request.arrayBuffer(); }
    catch { throw new ApiError(400, "Could not read request body."); }
    if (bodyBuffer.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "Image too large. Please use a smaller photo.");

    // 3. Validate content type
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_MIME.has(contentType)) throw new ApiError(415, "Unsupported image type. Please use JPEG, PNG, or WebP.");

    // 4. Check entitlement + atomically reserve quota (both daily and rolling for premium)
    const entitlement = await verifyEntitlementServer(uid);
    const isPremium   = entitlement.active;
    const reservation = await reserveQuota(uid, isPremium);

    // 5. Convert to base64 (never logged)
    const base64 = Buffer.from(bodyBuffer).toString("base64");

    // 6. Call the scan provider — refund reservation on total provider failure
    const provider = geminiProvider; // swap here to use a different provider
    let analysis: ClothingAnalysis;
    try {
      const result = await provider.analyze(base64, contentType);
      analysis = result.analysis;
      // Finalize reservation as succeeded (idempotent)
      await finalizeQuotaSuccess(uid, reservation.reservationId);
    } catch (aiErr) {
      await refundQuota(uid, reservation.reservationId);
      throw aiErr;
    }

    // 7. Return sanitized result
    const response: ScanResponse = {
      ok: true,
      analysis,
      remainingFreeScans: reservation.remainingFreeScans,
      // Pass quota info for the UI to display
      quota: {
        isPremium,
        remainingDaily:   reservation.remainingDaily,
        remaining30Day:   reservation.remaining30Day,
        rolling30ResetMs: reservation.rolling30ResetMs,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    const response: ScanResponse = {
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
  if (status === 413) return "size";
  if (status === 415) return "type";
  if (status === 429) return "quota";
  if (status >= 500)  return "ai";
  return "server";
}
