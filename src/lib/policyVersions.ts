/**
 * policyVersions.ts — Server-authoritative policy version identifiers.
 *
 * These constants are the single source of truth for which Terms of Service
 * and Privacy Policy versions are currently in effect.
 *
 * The server validates that the client's accepted version identifiers match
 * before creating a Checkout Session. If versions are bumped here, any client
 * that hasn't re-read the updated disclosure will be blocked at checkout and
 * shown the new disclosure.
 *
 * Format: ISO date string "YYYY-MM-DD" matching the policy effective date.
 *
 * HOW TO UPDATE:
 *  1. Update the version string to the new effective date.
 *  2. Update the corresponding policy route (terms.tsx / privacy.tsx) with
 *     the same date in LAST_UPDATED.
 *  3. Existing users will be shown the checkbox again on their next checkout.
 *  4. Existing consent records are retained for their full retention period.
 */

export const CURRENT_TERMS_VERSION   = "2026-08-26" as const;
export const CURRENT_PRIVACY_VERSION = "2026-08-26" as const;

/**
 * The authoritative recurring-payment disclosure text presented to the user
 * beside the acceptance checkbox. The server constructs this from its own
 * constants — the client never supplies its own disclosure text.
 */
export const SUBSCRIPTION_DISCLOSURE =
  "7 days free, then CA$2.99 CAD per month plus applicable taxes. " +
  "Automatically renews monthly until cancelled. " +
  "Cancel before the trial ends to avoid being charged.";

/** Price currency (server-authoritative). */
export const SUBSCRIPTION_CURRENCY = "CAD" as const;

/** Trial duration in days (server-authoritative). */
export const SUBSCRIPTION_TRIAL_DAYS = 7 as const;
