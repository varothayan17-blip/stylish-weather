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
 * The Anthropic provider populates this; the client uses it to pre-fill
 * the confirmation screen.
 *
 * NOTE ON evidence: The `evidence` field was present in older versions of this
 * type and may appear in items already saved in localStorage. New items never
 * receive or persist an evidence field. Existing items load without error because
 * the field is optional.
 *
 * IMPORTANT: Numeric confidence fields are [0, 1]. Values < 0.60 should be
 * displayed with an "Estimated" indicator in the UI. The AI is instructed to
 * use "unknown" rather than hallucinate unverifiable physical properties.
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
   * Optional evidence from legacy saved items only.
   * New items never have this field set (it is stripped before saving).
   * Kept as optional so old localStorage items continue to load without error.
   * @deprecated Do not set on new items. Strip before persisting.
   */
  evidence?: string;
};

// ── Discriminated scan result (provider output before client mapping) ─────────

/**
 * Reason codes for provider rejection.
 * The server maps each code to a safe, non-accusatory user-facing message.
 * Reason codes are never exposed to the client directly.
 */
export type RejectionReasonCode =
  | "person_present"
  | "multiple_items"
  | "id_or_document"
  | "unsafe_content"
  | "not_clothing"
  | "unusable_image";

/**
 * Discriminated union: what the Anthropic provider returns after parsing.
 * The server validates and normalises this before returning to the client.
 */
export type ScanResult =
  | { status: "accepted"; analysis: ClothingAnalysis }
  | { status: "rejected"; reasonCode: RejectionReasonCode };

// ── Scan API request/response ─────────────────────────────────────────────────

export type ScanQuotaInfo = {
  isPremium:        boolean;
  remainingDaily:   number | null;   // null for free users
  remaining30Day:   number | null;   // null for free users
  rolling30ResetMs: number | null;   // epoch ms; null for free users
};

export type ScanSuccessResponse = {
  ok: true;
  analysis: ClothingAnalysis;   // evidence field will never be set on new scans
  /** Remaining free scans (null = unlimited / premium) */
  remainingFreeScans: number | null;
  /** Quota information for display */
  quota?: ScanQuotaInfo;
};

export type ScanErrorResponse = {
  ok: false;
  error: string;
  /** 'quota' | 'auth' | 'size' | 'type' | 'ai' | 'server' | 'rejected' | 'ack' | 'abuse' */
  code: string;
};

export type ScanResponse = ScanSuccessResponse | ScanErrorResponse;

// ── Scanner acknowledgement ───────────────────────────────────────────────────

/**
 * Age band for scanner acknowledgement.
 * Stored server-side in the acknowledgement record.
 * We never store full date of birth.
 */
export type ScannerAgeBand = "15-17" | "18-plus";

/**
 * The current acknowledgement schema version.
 * Increment when the attestation text changes materially.
 * Users who accepted an older version will be shown the new one.
 */
export const SCANNER_ACK_VERSION = "1" as const;

// ── Scan state machine (client) ───────────────────────────────────────────────

export type ScanStep =
  | "status-check"     // checking /api/wardrobe/status on sheet open
  | "scan-unavailable" // status returned false — show friendly message
  | "manual"           // manual entry form (no photo, no AI)
  | "manual-success"   // manual item saved successfully
  | "ack-required"     // first-use acknowledgement required before scanning
  | "pick"             // initial: no image chosen
  | "preview"          // image selected, waiting for user to confirm
  | "compressing"      // client-side compression in progress
  | "detecting"        // on-device face/person detection in progress
  | "analyzing"        // server AI call in flight
  | "confirm"          // analysis complete, confirmation form
  | "error";           // any unrecoverable error
