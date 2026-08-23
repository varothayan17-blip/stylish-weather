/**
 * scheduling.ts — DST-safe reminder scheduling helpers.
 *
 * Uses date-fns-tz for reliable timezone/DST arithmetic.
 * Does NOT add exactly 24 * 3600 * 1000 ms — that fails on DST transitions.
 *
 * All functions are pure and synchronous — safe to unit-test without Firebase.
 */

import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  addDays,
  startOfDay,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from "date-fns";

/**
 * Given the current UTC time and a user's notification preferences,
 * compute the next reminder instant as UTC epoch ms.
 *
 * Rules:
 *   1. Build "today's reminder" in the user's local calendar time.
 *   2. If today's reminder is still in the future (with a 60-second buffer),
 *      use it.
 *   3. Otherwise, use "tomorrow's reminder" — constructed from tomorrow's
 *      local calendar date (DST-safe, not +24 h).
 *
 * @param nowUtcMs      Current time in UTC epoch ms.
 * @param timezone      IANA timezone string, e.g. "America/Toronto".
 * @param reminderHour  Local hour (0–23).
 * @param reminderMinute Local minute (0–59).
 * @returns UTC epoch ms of the next reminder, or null if timezone is invalid.
 */
export function computeNextCheckAt(
  nowUtcMs: number,
  timezone: string,
  reminderHour: number,
  reminderMinute: number,
): number | null {
  try {
    const nowLocal = toZonedTime(nowUtcMs, timezone);

    // Build "today's reminder" in local time
    const todayReminder = setMilliseconds(
      setSeconds(
        setMinutes(setHours(startOfDay(nowLocal), reminderHour), reminderMinute),
        0,
      ),
      0,
    );

    // Convert back to UTC
    const todayReminderUtc = fromZonedTime(todayReminder, timezone).getTime();

    // Guard against NaN (invalid timezone does not always throw)
    if (isNaN(todayReminderUtc)) return null;

    // Use today's if it is still >60 seconds in the future
    if (todayReminderUtc > nowUtcMs + 60_000) {
      return todayReminderUtc;
    }

    // Otherwise schedule for tomorrow (addDays is calendar-safe, not +86400 s)
    const tomorrowLocal = addDays(nowLocal, 1);
    const tomorrowReminder = setMilliseconds(
      setSeconds(
        setMinutes(setHours(startOfDay(tomorrowLocal), reminderHour), reminderMinute),
        0,
      ),
      0,
    );
    return fromZonedTime(tomorrowReminder, timezone).getTime();
  } catch {
    // Invalid timezone string or arithmetic error
    return null;
  }
}

/**
 * Compute the event/deduplication ID for today's rain-reminder in the
 * user's local timezone. Format: "rain-YYYY-MM-DD" in local calendar date.
 *
 * Two scheduler runs at e.g. 10:00:01 and 10:00:06 (same minute) will
 * produce the same eventId and the Firestore create-guard prevents a second
 * notification.
 */
export function todayEventId(nowUtcMs: number, timezone: string): string {
  try {
    const local = toZonedTime(nowUtcMs, timezone);
    const y = local.getFullYear();
    const m = String(local.getMonth() + 1).padStart(2, "0");
    const d = String(local.getDate()).padStart(2, "0");
    return `rain-${y}-${m}-${d}`;
  } catch {
    // Fallback: use UTC date (should never happen with validated timezone)
    const d = new Date(nowUtcMs);
    return `rain-${d.toISOString().slice(0, 10)}-utc`;
  }
}
