/**
 * feedback-types.ts — Shared types for the Aeruvo feedback system.
 *
 * Imported by the feedback bottom sheet (client) and the server handler.
 * No secrets, no admin SDK imports.
 */

export const FEEDBACK_CATEGORIES = [
  "weather-incorrect",
  "outfit-recommendation",
  "app-problem",
  "feature-idea",
  "report-ai-scan",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const WEATHER_ISSUE_TYPES = [
  "raining-but-shows-dry",
  "dry-but-shows-raining",
  "temperature",
  "condition-or-icon",
  "rain-timing",
  "other-weather",
] as const;
export type WeatherIssueType = (typeof WEATHER_ISSUE_TYPES)[number];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  "weather-incorrect":    "Weather seems incorrect",
  "outfit-recommendation":"Outfit recommendation",
  "app-problem":          "App problem",
  "feature-idea":         "Feature idea",
  "report-ai-scan":       "Report AI clothing scan",
  "other":                "Other",
};

export const WEATHER_ISSUE_LABELS: Record<WeatherIssueType, string> = {
  "raining-but-shows-dry":  "It is raining, but Aeruvo says it is dry",
  "dry-but-shows-raining":  "It is dry, but Aeruvo says it is raining",
  "temperature":            "Temperature",
  "condition-or-icon":      "Condition or icon",
  "rain-timing":            "Rain timing",
  "other-weather":          "Other weather issue",
};

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 1000;

/**
 * Diagnostic snapshot attached to weather-related reports.
 * Contains only non-sensitive, display-level data.
 * Exact GPS coordinates are never included.
 */
export interface FeedbackDiagnostics {
  displayedLocation:      string | null;
  displayedCondition:     string | null;
  displayedWeatherCode:   number | null;
  displayedTemperatureC:  number | null;
  isPrecipitatingNow:     boolean | null;
  precipitationEvidence:  string | null;
  effectiveCurrentCode:   number | null;
  radarStatus:            "precipitation" | "dry" | "no-coverage" | "unavailable" | null;
  radarRateMmPerHour:     number | null;
  radarObservedAt:        string | null;
  weatherObservedAt:      string | null;
  clientSubmittedAt:      string;
  appVersion:             string | null;
}

/** The body POSTed to /api/feedback by the client. */
export interface FeedbackPayload {
  category:         FeedbackCategory;
  weatherIssueType: WeatherIssueType | null;
  message:          string;
  contactEmail:     string | null;
  mayContact:       boolean;
  diagnostics:      FeedbackDiagnostics | null;
}
