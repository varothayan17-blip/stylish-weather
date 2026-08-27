/**
 * wardrobe-types.ts
 *
 * Shared type definitions for the Wardrobe AI pipeline.
 * Used by: AddClothingSheet (client), wardrobe-ai-handler (server).
 * No backend imports here — pure types only.
 */

// ── Wardrobe item categories ──────────────────────────────────────────────────

export type WardrobeCategory =
  | "tops"
  | "bottoms"
  | "outerwear"
  | "shoes"
  | "accessories"
  | "dress"
  | "other";

export type WarmthLabel =
  | "very-light"
  | "light"
  | "medium"
  | "warm"
  | "very-warm";

export type Pattern =
  | "solid"
  | "striped"
  | "checked"
  | "graphic"
  | "patterned"
  | "other";

export type LayerRole = "base" | "mid" | "outer" | "standalone";

export type WaterResistance = "none" | "low" | "medium" | "high" | "unknown";

export type WindProtection = "low" | "medium" | "high" | "unknown";

export type FitEstimate =
  | "slim"
  | "regular"
  | "relaxed"
  | "oversized"
  | "unknown";

// ── AI analysis result ────────────────────────────────────────────────────────

/**
 * Structured clothing analysis returned by /api/wardrobe/scan.
 * Gemini populates this; the client uses it to pre-fill the confirmation screen.
 *
 * IMPORTANT: Numeric confidence fields are [0, 1]. Values < 0.60 should be
 * displayed with an "Estimated" indicator in the UI. The AI is instructed to
 * use "unknown" rather than hallucinate unverifiable physical properties
 * (waterproofness, exact fabric composition, thermal rating, etc.).
 */
export type ClothingAnalysis = {
  /** Short human-readable name, e.g. "Navy wool overcoat" */
  name: string;
  category: WardrobeCategory;
  /** More specific type, e.g. "Puffer jacket", "Straight-leg denim" */
  subcategory: string;
  /** Primary colour as a readable word/phrase, e.g. "Navy blue" */
  primaryColor: string;
  /** Any other visible colours, e.g. ["White", "Silver"] */
  secondaryColors: string[];
  pattern: Pattern;
  /**
   * Material estimate — what it LOOKS like from the photo.
   * Always an estimate; AI is instructed not to claim certainty.
   * e.g. ["Cotton", "Fleece-lined"]
   */
  materialEstimate: string[];
  layerRole: LayerRole;
  warmth: {
    /** 1 = very light, 5 = very warm */
    score: number;
    label: WarmthLabel;
  };
  /** Physical water resistance — UNKNOWN unless visually obvious (e.g. rain gear) */
  waterResistance: WaterResistance;
  /** Wind protection — UNKNOWN unless visually obvious */
  windProtection: WindProtection;
  /** e.g. ["Mild", "Cool"] — weather conditions the item suits */
  weatherFit: string[];
  /** e.g. ["Casual", "Smart-casual"] */
  styles: string[];
  /** e.g. ["Fall", "Winter"] */
  seasons: string[];
  fitEstimate: FitEstimate;
  /**
   * Per-field confidence [0, 1]. Values < 0.60 → show "Estimated" in UI.
   * AI is expected to be honest; it is better to give low confidence than
   * to fabricate certainty about unverifiable properties.
   */
  confidence: {
    category: number;
    color: number;
    material: number;
    warmth: number;
    waterResistance: number;
    style: number;
  };
  /**
   * Optional short user-facing evidence string (≤ 120 chars).
   * e.g. "Looks like a medium-weight cotton-blend hoodie."
   * Never a raw chain-of-thought or model reasoning.
   */
  evidence?: string;
};

// ── Scan API request/response ─────────────────────────────────────────────────

export type ScanQuotaInfo = {
  isPremium:        boolean;
  remainingDaily:   number | null;   // null for free users
  remaining30Day:   number | null;   // null for free users
  rolling30ResetMs: number | null;   // epoch ms; null for free users
};

export type ScanSuccessResponse = {
  ok: true;
  analysis: ClothingAnalysis;
  /** Remaining free scans (null = unlimited / premium) */
  remainingFreeScans: number | null;
  /** Quota information for display */
  quota?: ScanQuotaInfo;
};

export type ScanErrorResponse = {
  ok: false;
  error: string;
  /** 'quota' | 'auth' | 'size' | 'type' | 'ai' | 'server' */
  code: string;
};

export type ScanResponse = ScanSuccessResponse | ScanErrorResponse;

// ── Scan state machine (client) ───────────────────────────────────────────────

export type ScanStep =
  | "status-check"    // checking /api/wardrobe/status on sheet open
  | "scan-unavailable"// status returned false — show friendly message
  | "manual"          // manual entry form (no photo, no AI)
  | "manual-success"  // manual item saved successfully
  | "pick"            // initial: no image chosen
  | "preview"         // image selected, waiting for user to confirm
  | "compressing"     // client-side compression in progress
  | "analyzing"       // server AI call in flight
  | "confirm"         // analysis complete, confirmation form
  | "error";          // any unrecoverable error
