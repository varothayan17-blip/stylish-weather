/**
 * radar-types.ts — Shared types for the ECCC MSC GeoMet radar overlay.
 *
 * Imported by both the server handler (radar-handler.ts) and the client
 * (weather fetch in index.tsx → rainNowDecision.ts).
 */

/**
 * Result of a single radar point query for a user's coordinates.
 *
 * status values:
 *   "precipitation"  — radar-covered cell with rate > RADAR_RAIN_THRESHOLD_MM_PER_HR
 *   "dry"            — radar-covered cell with measured rate at or below threshold
 *   "no-coverage"    — the point is outside the radar mosaic coverage area
 *                      (null/empty GetFeatureInfo result, or no valid layer time)
 *   "unavailable"    — request timed out, network error, parse failure,
 *                      or any other condition preventing a reliable reading
 *
 * Transparent WMS pixels are classified as "no-coverage," NOT "dry."
 * We only say "dry" when there is a positive measurement of ≤ threshold.
 *
 * rateMmPerHour is only set when status="precipitation" and a numeric value
 * was returned by GetFeatureInfo. It is NOT inferred from pixel colour.
 *
 * observedAt is the UTC ISO timestamp of the radar composite used (from the
 * WMS TIME parameter). It is the most-recent available image, approximately
 * 6–12 minutes behind real time.
 *
 * This type must be kept in sync with the JSON schema returned by
 * GET /api/radar-now.
 */
export interface RadarPrecipObservation {
  status: "precipitation" | "dry" | "no-coverage" | "unavailable";
  /** Precipitation rate in mm/hour, only present when status="precipitation". */
  rateMmPerHour?: number;
  /** UTC ISO timestamp of the radar composite used, e.g. "2026-08-31T15:12:00Z". */
  observedAt?: string;
  source: "eccc-radar";
}

/**
 * Minimum precipitation rate (mm/hour) to classify a radar cell as "precipitation."
 * The WMS layer represents 1km²-averaged rates. A threshold of 0.1 mm/hr is
 * above digitization noise and represents a genuine (if light) rain signal.
 * Values below this but above 0 are classified "dry" by our decision logic.
 * This mirrors Environment Canada's own "trace" precipitation definition.
 */
export const RADAR_RAIN_THRESHOLD_MM_PER_HR = 0.1;
