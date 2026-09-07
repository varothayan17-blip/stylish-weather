/**
 * styleProfile.ts — Personal Style Profile types, defaults and validation.
 *
 * Storage path: users/{uid}/styleProfile  (own Firestore subcollection document)
 * NOT merged into prefs — kept separate to avoid polluting the existing prefs
 * schema and to make entitlement-gating clear.
 *
 * Security: client may read/write ONLY their own styleProfile document.
 * Firestore rules enforce that the profile document passes isValidStyleProfile().
 *
 * Phase 1 fields are chosen to:
 *   1. Personalize layering, outfit ranking and commute guidance.
 *   2. Provide a reusable foundation for later occasion planning.
 *   3. Never store inferred sensitive traits, precise location, or wardrobe images.
 *
 * Backward compatibility: existing users without this document receive safe
 * defaults (DEFAULT_STYLE_PROFILE) and the recommendation output is identical
 * to the current behaviour — personalizeRecommendation() is a no-op when the
 * profile is null or the entitlement is inactive.
 */

// ── Enum types (narrow string unions) ──────────────────────────────────────

export type LayeringPreference = "minimal" | "balanced" | "prefer";
export type StylePreference = "casual" | "sporty" | "streetwear" | "minimal" | "smart" | "formal";
export type CommuteMode = "walk" | "transit" | "drive" | "mixed";
export type WeatherSensitivity = "low" | "normal" | "high";
export type CommonActivity = "college" | "work" | "gym" | "casual" | "events";

// ── Allow-lists for validation ──────────────────────────────────────────────

export const LAYERING_PREFERENCES: LayeringPreference[] = ["minimal", "balanced", "prefer"];
export const STYLE_PREFERENCES:    StylePreference[]    = ["casual", "sporty", "streetwear", "minimal", "smart", "formal"];
export const COMMUTE_MODES:        CommuteMode[]        = ["walk", "transit", "drive", "mixed"];
export const WEATHER_SENSITIVITIES: WeatherSensitivity[] = ["low", "normal", "high"];
export const COMMON_ACTIVITIES:    CommonActivity[]     = ["college", "work", "gym", "casual", "events"];

// ── Profile type ────────────────────────────────────────────────────────────

export interface PersonalStyleProfile {
  /** How the user prefers to handle changing weather via layers. */
  layeringPreference: LayeringPreference;
  /** Aesthetic styles the user identifies with (multi-select). */
  stylePreferences: StylePreference[];
  /** Primary commute mode — influences outdoor exposure guidance. */
  commuteMode: CommuteMode;
  /** How much wind affects the user's comfort. */
  windSensitivity: WeatherSensitivity;
  /** How tolerant the user is of rain before it affects outfit choice. */
  rainTolerance: WeatherSensitivity;
  /**
   * Contexts the user commonly dresses for.
   * Phase 1: stored but not used for occasion-specific recommendations.
   * Phase 2: occasion planner will consume this.
   */
  commonActivities: CommonActivity[];
  /** Unix ms timestamp when the user completed the full profile wizard. Null = incomplete. */
  completedAt: number | null;
  /** Unix ms timestamp of the last update. Always set on write. */
  updatedAt: number;
  /** Schema version — allows safe future migrations. */
  version: 1;
}

// ── Safe defaults ────────────────────────────────────────────────────────────

export const DEFAULT_STYLE_PROFILE: PersonalStyleProfile = {
  layeringPreference: "balanced",
  stylePreferences:   ["casual"],
  commuteMode:        "mixed",
  windSensitivity:    "normal",
  rainTolerance:      "normal",
  commonActivities:   [],
  completedAt:        null,
  updatedAt:          0,
  version:            1,
};

// ── Validation / sanitization ─────────────────────────────────────────────

/**
 * Validate and sanitize an untrusted object into a PersonalStyleProfile.
 * Unknown keys are silently discarded.
 * Invalid enum values fall back to the default for that field.
 * Returns null when the input is not an object at all.
 */
export function sanitizeStyleProfile(raw: unknown): PersonalStyleProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const layeringPreference: LayeringPreference =
    LAYERING_PREFERENCES.includes(r.layeringPreference as LayeringPreference)
      ? (r.layeringPreference as LayeringPreference)
      : DEFAULT_STYLE_PROFILE.layeringPreference;

  const stylePreferences: StylePreference[] = Array.isArray(r.stylePreferences)
    ? (r.stylePreferences as unknown[]).filter(
        (v): v is StylePreference => STYLE_PREFERENCES.includes(v as StylePreference),
      )
    : DEFAULT_STYLE_PROFILE.stylePreferences;

  const commuteMode: CommuteMode =
    COMMUTE_MODES.includes(r.commuteMode as CommuteMode)
      ? (r.commuteMode as CommuteMode)
      : DEFAULT_STYLE_PROFILE.commuteMode;

  const windSensitivity: WeatherSensitivity =
    WEATHER_SENSITIVITIES.includes(r.windSensitivity as WeatherSensitivity)
      ? (r.windSensitivity as WeatherSensitivity)
      : DEFAULT_STYLE_PROFILE.windSensitivity;

  const rainTolerance: WeatherSensitivity =
    WEATHER_SENSITIVITIES.includes(r.rainTolerance as WeatherSensitivity)
      ? (r.rainTolerance as WeatherSensitivity)
      : DEFAULT_STYLE_PROFILE.rainTolerance;

  const commonActivities: CommonActivity[] = Array.isArray(r.commonActivities)
    ? (r.commonActivities as unknown[]).filter(
        (v): v is CommonActivity => COMMON_ACTIVITIES.includes(v as CommonActivity),
      )
    : DEFAULT_STYLE_PROFILE.commonActivities;

  const completedAt: number | null =
    typeof r.completedAt === "number" && isFinite(r.completedAt) ? r.completedAt : null;

  const updatedAt: number =
    typeof r.updatedAt === "number" && isFinite(r.updatedAt) ? r.updatedAt : Date.now();

  return {
    layeringPreference,
    stylePreferences: stylePreferences.length > 0 ? stylePreferences : ["casual"],
    commuteMode,
    windSensitivity,
    rainTolerance,
    commonActivities,
    completedAt,
    updatedAt,
    version: 1,
  };
}

/**
 * Serialize a profile for Firestore. Only known keys are included.
 * Never includes sensitive or computed fields.
 */
export function serializeStyleProfile(p: PersonalStyleProfile): Record<string, unknown> {
  return {
    layeringPreference: p.layeringPreference,
    stylePreferences:   p.stylePreferences,
    commuteMode:        p.commuteMode,
    windSensitivity:    p.windSensitivity,
    rainTolerance:      p.rainTolerance,
    commonActivities:   p.commonActivities,
    completedAt:        p.completedAt,
    updatedAt:          p.updatedAt,
    version:            1,
  };
}
