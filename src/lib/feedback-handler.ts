/**
 * feedback-handler.ts — Server-only POST /api/feedback handler.
 *
 * IMPORTED ONLY FROM src/server.ts.
 * Never imported from client-side code.
 *
 * Security model:
 *   1. Firebase ID token verified server-side — uid from token, never from body.
 *   2. All payload fields validated; unknown keys are ignored.
 *   3. Diagnostics re-constructed from only the permitted subset.
 *   4. Server generates timestamp and status:"new".
 *   5. Rate limit: max 10 submissions per user per hour (in-memory, server-wide).
 *   6. Body capped at 16 KB before parsing.
 */

import {
  FEEDBACK_CATEGORIES,
  WEATHER_ISSUE_TYPES,
  MESSAGE_MIN,
  MESSAGE_MAX,
  type FeedbackPayload,
  type FeedbackDiagnostics,
} from "./feedback-types";
import { verifyFirebaseToken, getAdminDb } from "./stripe-server";
import { ApiError } from "./stripe-server";

// ── Rate limiting (in-memory, per server instance) ────────────────────────────
// Resets on cold-start. Sufficient for abuse prevention on Vercel serverless.
const RATE_WINDOW_MS  = 60 * 60 * 1000; // 1 hour
const RATE_MAX        = 10;              // submissions per user per window

interface RateEntry { count: number; windowStart: number; }
const rateMap = new Map<string, RateEntry>();

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const entry = rateMap.get(uid);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(uid, { count: 1, windowStart: now });
    return;
  }
  if (entry.count >= RATE_MAX) {
    throw new ApiError(429, "Too many feedback submissions. Please try again later.");
  }
  entry.count += 1;
}

// ── Payload size guard ────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 16 * 1024; // 16 KB

// ── Validation helpers ────────────────────────────────────────────────────────

function trim(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.trim();
}

function validateEmail(v: unknown): string | null {
  const s = trim(v);
  if (!s) return null;
  // Simple but reasonable RFC 5322 subset check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.slice(0, 200) : null;
}

/**
 * Build the permitted diagnostics subset from the client-supplied object.
 * NEVER trusts the client for uids or exact coordinates.
 * Unknown keys are silently discarded.
 */
function sanitizeDiagnostics(d: unknown): FeedbackDiagnostics | null {
  if (typeof d !== "object" || d === null) return null;
  const src = d as Record<string, unknown>;

  const radarStatus = src.radarStatus;
  const validRadar = ["precipitation", "dry", "no-coverage", "unavailable", null];

  return {
    displayedLocation:    typeof src.displayedLocation    === "string" ? src.displayedLocation.slice(0, 100) : null,
    displayedCondition:   typeof src.displayedCondition   === "string" ? src.displayedCondition.slice(0, 100) : null,
    displayedWeatherCode: typeof src.displayedWeatherCode === "number" && isFinite(src.displayedWeatherCode)
      ? Math.round(src.displayedWeatherCode) : null,
    displayedTemperatureC:typeof src.displayedTemperatureC=== "number" && isFinite(src.displayedTemperatureC)
      ? Math.round(src.displayedTemperatureC * 10) / 10 : null,
    isPrecipitatingNow:   typeof src.isPrecipitatingNow   === "boolean" ? src.isPrecipitatingNow : null,
    precipitationEvidence:typeof src.precipitationEvidence=== "string" ? src.precipitationEvidence.slice(0, 50) : null,
    effectiveCurrentCode: typeof src.effectiveCurrentCode === "number" && isFinite(src.effectiveCurrentCode)
      ? Math.round(src.effectiveCurrentCode) : null,
    radarStatus:          validRadar.includes(radarStatus as string | null)
      ? (radarStatus as FeedbackDiagnostics["radarStatus"]) : null,
    radarRateMmPerHour:   typeof src.radarRateMmPerHour   === "number" && isFinite(src.radarRateMmPerHour)
      ? src.radarRateMmPerHour : null,
    radarObservedAt:      typeof src.radarObservedAt       === "string" ? src.radarObservedAt.slice(0, 40) : null,
    weatherObservedAt:    typeof src.weatherObservedAt     === "string" ? src.weatherObservedAt.slice(0, 40) : null,
    clientSubmittedAt:    typeof src.clientSubmittedAt     === "string" ? src.clientSubmittedAt.slice(0, 40)
      : new Date().toISOString(),
    appVersion:           typeof src.appVersion            === "string" ? src.appVersion.slice(0, 30) : null,
  };
}

// ── Public handler ────────────────────────────────────────────────────────────

export async function handleFeedback(request: Request): Promise<Response> {
  // 1. Auth — uid from verified token only, never from body
  const uid = await verifyFirebaseToken(request);

  // 2. Rate limit
  checkRateLimit(uid);

  // 3. Body size guard (read as text first)
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    throw new ApiError(413, "Request body too large");
  }

  // 4. Parse JSON
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "Body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;

  // 5. Validate category
  const category = raw.category;
  if (!FEEDBACK_CATEGORIES.includes(category as typeof FEEDBACK_CATEGORIES[number])) {
    throw new ApiError(400, "Invalid category");
  }

  // 6. Validate weatherIssueType (required only for weather-incorrect, optional for others)
  const rawWIT = raw.weatherIssueType ?? null;
  let weatherIssueType: FeedbackPayload["weatherIssueType"] = null;
  if (rawWIT !== null) {
    if (!WEATHER_ISSUE_TYPES.includes(rawWIT as typeof WEATHER_ISSUE_TYPES[number])) {
      throw new ApiError(400, "Invalid weatherIssueType");
    }
    weatherIssueType = rawWIT as typeof WEATHER_ISSUE_TYPES[number];
  }

  // 7. Validate message
  const rawMessage = trim(raw.message);
  if (!rawMessage || rawMessage.length < MESSAGE_MIN) {
    throw new ApiError(400, `Message must be at least ${MESSAGE_MIN} characters`);
  }
  if (rawMessage.length > MESSAGE_MAX) {
    throw new ApiError(400, `Message must not exceed ${MESSAGE_MAX} characters`);
  }

  // 8. Optional fields
  const contactEmail = validateEmail(raw.contactEmail);
  const mayContact   = typeof raw.mayContact === "boolean" ? raw.mayContact : false;

  // 9. Diagnostics — only for weather reports, sanitized
  const diagnostics = category === "weather-incorrect"
    ? sanitizeDiagnostics(raw.diagnostics)
    : null;

  // 10. Write to Firestore via Admin SDK
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  await db.collection("userFeedback").add({
    userId:           uid,                // from verified token — never from body
    category,
    weatherIssueType,
    message:          rawMessage,
    contactEmail,
    mayContact,
    diagnostics,
    createdAt:        FieldValue.serverTimestamp(),
    status:           "new",
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
