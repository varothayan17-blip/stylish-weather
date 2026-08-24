/**
 * wardrobe-ai-handler.ts — Server-only Wardrobe AI scan handler.
 *
 * IMPORTED ONLY FROM src/server.ts.
 * Must NEVER be imported from client-side code.
 *
 * Route: POST /api/wardrobe/scan
 *
 * Security:
 *   1. Verify Firebase ID token (uid from token, never from body)
 *   2. Enforce image size limit (MAX_IMAGE_BYTES)
 *   3. Enforce accepted MIME types
 *   4. Check/increment quota via Firestore transaction (Admin SDK)
 *   5. Call Gemini with base64 image
 *   6. Validate structured JSON response
 *   7. Return sanitized result — no AI internals leaked
 *
 * Env vars required (server-only, NEVER VITE_*):
 *   GEMINI_API_KEY          — Gemini API key
 *   GEMINI_WARDROBE_MODEL   — model name (default: gemini-3.7-flash)
 *
 * Privacy:
 *   Image bytes are NOT persisted after analysis.
 *   No image data, tokens, or API keys are logged.
 */

import { verifyFirebaseToken, verifyEntitlementServer, getAdminDb, ApiError, apiErrorResponse } from "./stripe-server";
import { FieldValue } from "firebase-admin/firestore";
import type { ClothingAnalysis, ScanResponse } from "./wardrobe-types";

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES     = 8 * 1024 * 1024; // 8 MB after client compression
const FREE_LIFETIME_LIMIT = 3;
const PREMIUM_DAILY_LIMIT = parseInt(process.env.PREMIUM_WARDROBE_SCANS_PER_DAY ?? "20", 10);

const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function getGeminiModel(): string {
  return process.env.GEMINI_WARDROBE_MODEL ?? "gemini-3.7-flash";
}

function getGeminiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new ApiError(503, "AI service not configured");
  return k;
}

// ── Quota helpers (Admin SDK — server only) ───────────────────────────────────

type QuotaData = {
  lifetimeFreeScans: number;
  scansToday: number;
  resetDate: string;  // "YYYY-MM-DD" UTC
  lastScanAt: number;
  updatedAt: number;
};

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * QUOTA DESIGN — reserve-then-refund pattern
 *
 * WHY reserve before Gemini:
 *   If we increment after Gemini, two parallel requests from the same user can
 *   both read lifetimeFreeScans=2 (below the 3 limit), both call Gemini, then
 *   both increment — using 2 scans where only 1 is allowed. The transaction
 *   reserve blocks this: the second concurrent request sees the updated count
 *   and is rejected with 429.
 *
 * WHY refund on AI failure:
 *   Gemini timeouts, 5xx errors, or unvalidatable responses are not the user's
 *   fault. refundQuota() atomically decrements after any such failure so the
 *   user does not lose a free scan.
 *
 * CRASH TRADEOFF:
 *   If the Vercel function crashes (OOM, hard timeout) after reserveQuota()
 *   but before refundQuota() runs, the counter is left incremented and no
 *   refund occurs. This is unavoidable in any reserve/refund design.
 *   The exposure is bounded: at most 1 lost scan per crash event.
 */

type QuotaReservation = {
  remainingFreeScans: number | null;
  isPremium: boolean;
};

/**
 * Atomically check quota and reserve (pre-increment) one scan.
 * Parallel requests are blocked at the limit by the transaction.
 */
async function reserveQuota(
  uid: string,
  isPremium: boolean,
): Promise<QuotaReservation> {
  const db  = getAdminDb();
  const ref = db.doc(`users/${uid}/quotas/wardrobeAi`);
  const today = todayUTC();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as Partial<QuotaData>;

    const lifetimeFree = data.lifetimeFreeScans ?? 0;
    const scansToday   = data.resetDate === today ? (data.scansToday ?? 0) : 0;

    if (isPremium) {
      if (scansToday >= PREMIUM_DAILY_LIMIT) {
        throw new ApiError(429, `Daily scan limit reached. Try again tomorrow.`);
      }
      tx.set(ref, {
        lifetimeFreeScans: lifetimeFree,
        scansToday: scansToday + 1,
        resetDate: today,
        lastScanAt: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { remainingFreeScans: null, isPremium: true };
    } else {
      if (lifetimeFree >= FREE_LIFETIME_LIMIT) {
        throw new ApiError(429, `Free scan limit reached. Upgrade to Premium for more scans.`);
      }
      const remaining = FREE_LIFETIME_LIMIT - lifetimeFree - 1;
      tx.set(ref, {
        lifetimeFreeScans: lifetimeFree + 1,
        scansToday: scansToday + 1,
        resetDate: today,
        lastScanAt: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { remainingFreeScans: remaining, isPremium: false };
    }
  });
}

/**
 * Refund one reserved scan on Gemini/validation failure.
 * Best-effort: if this call itself fails, the scan is not refunded
 * (bounded to 1 lost scan per incident — same as a crash scenario).
 */
async function refundQuota(uid: string, isPremium: boolean): Promise<void> {
  try {
    const db  = getAdminDb();
    const ref = db.doc(`users/${uid}/quotas/wardrobeAi`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.data() ?? {}) as Partial<QuotaData>;
      const today = todayUTC();
      const scansToday = data.resetDate === today ? (data.scansToday ?? 0) : 0;
      const updates: Partial<QuotaData> = {
        scansToday: Math.max(0, scansToday - 1),
        updatedAt:  Date.now(),
      };
      if (!isPremium) {
        updates.lifetimeFreeScans = Math.max(0, (data.lifetimeFreeScans ?? 0) - 1);
      }
      tx.set(ref, updates, { merge: true });
    });
  } catch (refundErr) {
    const safe = refundErr instanceof Error
      ? { name: refundErr.name, message: refundErr.message }
      : { message: String(refundErr) };
    console.error("[wardrobe-ai] quota refund failed:", safe);
  }
}

// ── Gemini structured-output prompt ──────────────────────────────────────────

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
  "evidence": "string (optional: one short sentence about what you can see, e.g. 'Looks like a medium-weight cotton hoodie with a kangaroo pocket.' Max 120 chars.)"
}`;

// ── Gemini API call ───────────────────────────────────────────────────────────

async function callGemini(
  base64Image: string,
  mimeType: string,
): Promise<ClothingAnalysis> {
  const model  = getGeminiModel();
  const apiKey = getGeminiKey();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType === "image/heic" || mimeType === "image/heif"
              ? "image/jpeg" // Gemini treats HEIC as JPEG after browser decode
              : mimeType,
            data: base64Image,
          },
        },
        { text: SYSTEM_PROMPT },
      ],
    }],
    generationConfig: {
      // temperature is not supported by gemini-3.7-flash thinking models;
      // removed to avoid warnings or unexpected API behaviour.
      // 512 output tokens is ample for our JSON schema (~350 tokens typical).
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
    // thinkingConfig: request low-budget thinking for gemini-3.7-flash.
    // Without this, the model defaults to extended thinking which can take
    // 20-40 s for image tasks. Budget of 512 tokens gives fast structured
    // classification while preserving image understanding quality.
    // See: ai.google.dev/gemini-api/docs/thinking
    thinkingConfig: {
      thinkingBudget: 512,
    },
  };

  const controller = new AbortController();
  // 50 s: gemini-3.7-flash with thinkingBudget=512 can take 20–40 s for images.
  // Vercel hobby functions run up to 60 s; 50 s leaves a safe buffer.
  const timeout    = setTimeout(() => controller.abort(), 50_000);
  const t0 = Date.now();

  // Safe log: model name only — no key, no image bytes, no token
  console.info(`[wardrobe-ai] calling model=${model} thinkingBudget=512 maxOutputTokens=512`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.includes("aborted");
    console.error(`[wardrobe-ai] fetch failed elapsed=${elapsed}ms timedOut=${timedOut}`);
    if (timedOut) throw new ApiError(504, "AI analysis timed out. Please try again.");
    throw new ApiError(502, "AI service temporarily unavailable.");
  }
  clearTimeout(timeout);

  const elapsed = Date.now() - t0;
  if (!res.ok) {
    // Read the error body for diagnostics.
    // We log only safe structural fields — never the API key, token, or image.
    let errCode: string | undefined;
    let errMessage: string | undefined;
    let errDetails: string | undefined;
    try {
      const errBody = await res.json() as {
        error?: {
          code?: number;
          message?: string;
          status?: string;
          details?: Array<{ "@type"?: string; fieldViolations?: Array<{ field?: string; description?: string }> }>;
        };
      };
      errCode    = String(errBody?.error?.code    ?? "");
      errMessage = String(errBody?.error?.message ?? "").slice(0, 300); // cap length
      errDetails = JSON.stringify(
        (errBody?.error?.details ?? []).map(d => ({
          type:            d["@type"],
          fieldViolations: (d.fieldViolations ?? []).map(v => ({
            field:       v.field,
            description: v.description,
          })),
        }))
      ).slice(0, 500); // cap length
    } catch {
      errMessage = "<could not parse error body>";
    }
    // Safe log: Google error code/message/field violations only.
    // No API key, no UID, no image bytes, no Firebase token.
    console.error(
      `[wardrobe-ai] Gemini HTTP error status=${res.status} elapsed=${elapsed}ms` +
      ` errCode=${errCode} errMessage=${errMessage} details=${errDetails}`
    );
    if (res.status === 429) throw new ApiError(503, "AI service is busy. Please try again shortly.");
    throw new ApiError(502, "AI analysis failed. Please try another photo.");
  }
  console.info(`[wardrobe-ai] Gemini responded status=${res.status} elapsed=${elapsed}ms`);

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    console.error("[wardrobe-ai] Gemini returned empty text in candidates");
    throw new ApiError(502, "AI returned an empty response. Please try again.");
  }

  // Log output length only — never the content (could contain user clothing details)
  console.info(`[wardrobe-ai] validating response length=${text.length}`);
  const result = validateAnalysis(text);
  console.info(`[wardrobe-ai] validation ok category=${result.category}`);
  return result;
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
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new ApiError(502, "AI returned an unreadable response. Please try another photo.");
  }

  const category  = VALID_CATEGORIES.has(String(parsed.category))  ? String(parsed.category) as ClothingAnalysis["category"]  : "other";
  const pattern   = VALID_PATTERNS.has(String(parsed.pattern))      ? String(parsed.pattern)  as ClothingAnalysis["pattern"]   : "solid";
  const layerRole = VALID_LAYER_ROLES.has(String(parsed.layerRole)) ? String(parsed.layerRole) as ClothingAnalysis["layerRole"] : "standalone";
  const waterRes  = VALID_WATER_RES.has(String(parsed.waterResistance)) ? String(parsed.waterResistance) as ClothingAnalysis["waterResistance"] : "unknown";
  const windProt  = VALID_WIND_PROT.has(String(parsed.windProtection))  ? String(parsed.windProtection)  as ClothingAnalysis["windProtection"]  : "unknown";
  const fitEst    = VALID_FIT.has(String(parsed.fitEstimate))            ? String(parsed.fitEstimate)      as ClothingAnalysis["fitEstimate"]      : "unknown";

  const rawWarmth = (parsed.warmth ?? {}) as Record<string, unknown>;
  const warmthScore = clamp(rawWarmth.score, 1, 5);
  const warmthLabel = VALID_WARMTH_LBLS.has(String(rawWarmth.label))
    ? String(rawWarmth.label) as ClothingAnalysis["warmth"]["label"]
    : "medium";

  const rawConf = (parsed.confidence ?? {}) as Record<string, unknown>;

  return {
    name:             str(parsed.name, "Clothing item"),
    category,
    subcategory:      str(parsed.subcategory, ""),
    primaryColor:     str(parsed.primaryColor, "Unknown"),
    secondaryColors:  arrStr(parsed.secondaryColors),
    pattern,
    materialEstimate: arrStr(parsed.materialEstimate),
    layerRole,
    warmth: { score: warmthScore, label: warmthLabel },
    waterResistance: waterRes,
    windProtection:  windProt,
    weatherFit:      arrStr(parsed.weatherFit),
    styles:          arrStr(parsed.styles),
    seasons:         arrStr(parsed.seasons),
    fitEstimate:     fitEst,
    confidence: {
      category:        clamp(rawConf.category,        0, 1),
      color:           clamp(rawConf.color,           0, 1),
      material:        clamp(rawConf.material,        0, 1),
      warmth:          clamp(rawConf.warmth,          0, 1),
      waterResistance: clamp(rawConf.waterResistance, 0, 1),
      style:           clamp(rawConf.style,           0, 1),
    },
    evidence: typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 120) : undefined,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleWardrobeScan(request: Request): Promise<Response> {
  try {
    // 1. Verify Firebase Auth — uid is ALWAYS from the verified token
    const uid = await verifyFirebaseToken(request);

    // 2. Read raw body with size guard
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new ApiError(413, "Image too large. Please use a smaller photo.");
    }

    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await request.arrayBuffer();
    } catch {
      throw new ApiError(400, "Could not read request body.");
    }
    if (bodyBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new ApiError(413, "Image too large. Please use a smaller photo.");
    }

    // 3. Validate content type
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_MIME.has(contentType)) {
      throw new ApiError(415, "Unsupported image type. Please use JPEG, PNG, or WebP.");
    }

    // 4. Check entitlement + atomically reserve quota
    //    Increment BEFORE Gemini so parallel requests cannot bypass the limit.
    //    On Gemini failure, refundQuota() reverses the increment.
    const entitlement = await verifyEntitlementServer(uid);
    const isPremium   = entitlement.active;
    const reservation = await reserveQuota(uid, isPremium);

    // 5. Convert to base64 (no logging of image bytes)
    const base64 = Buffer.from(bodyBuffer).toString("base64");

    // 6. Call Gemini — refund quota on any provider/validation failure
    let analysis: import("./wardrobe-types").ClothingAnalysis;
    try {
      analysis = await callGemini(base64, contentType);
    } catch (aiErr) {
      await refundQuota(uid, isPremium);
      throw aiErr;
    }

    // 7. Return sanitized result — never includes raw AI response
    const response: ScanResponse = {
      ok: true,
      analysis,
      remainingFreeScans: reservation.remainingFreeScans,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    const response: ScanResponse = {
      ok: false,
      error: err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      code:  err instanceof ApiError ? mapStatusToCode(err.status) : "server",
    };
    return new Response(JSON.stringify(response), {
      status: err instanceof ApiError ? err.status : 500,
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
