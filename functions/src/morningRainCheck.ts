/**
 * morningRainCheck.ts — Stage E scheduled rain-reminder delivery.
 *
 * COST SAFETY DESIGN
 * ──────────────────
 * This function is designed to degrade gracefully rather than scale freely.
 * Every limit below has been chosen to protect a student/startup Firebase
 * project from unexpected bills.
 *
 * maxInstances: 1
 *   Only one copy of this function runs at a time. Cloud Scheduler fires
 *   every 10 minutes; if a run is still in progress when the next schedule
 *   fires, Cloud Functions will queue the invocation but maxInstances=1
 *   prevents a second instance from starting. The queued invocation runs
 *   after the current one finishes. This caps Firestore reads/writes and
 *   Open-Meteo requests to one batch at a time.
 *
 * concurrency: 1
 *   Cloud Functions v2 defaults to concurrency=80 (multiple requests per
 *   instance). With concurrency=1 the single instance processes one
 *   invocation at a time, which is correct for a scheduler (not an HTTP
 *   server handling parallel requests).
 *
 * MAX_USERS_PER_RUN = 20
 *   Processes at most 20 due users per invocation. Remaining due users
 *   stay at nextCheckAt <= now and are picked up by the next run.
 *   No reminder is permanently lost — they are processed on the next
 *   invocation. At 10 min cadence: 20 users × 6 runs/hour = 120 users/hr.
 *
 * MAX_DEVICES_PER_USER = 5
 *   Protects against a user who somehow has hundreds of device records.
 *   Only the 5 most-recently-updated enabled devices receive the push.
 *
 * WEATHER_FETCH_TIMEOUT_MS = 8_000
 *   Open-Meteo must respond within 8 seconds or the fetch is aborted.
 *   If it times out, the event doc is deleted and the user is retried on
 *   the next scheduler run. The Open-Meteo retry itself is bounded by
 *   WEATHER_FETCH_MAX_RETRIES (within one invocation) or natural re-queue
 *   on the next scheduler invocation.
 *
 * WEATHER_FETCH_MAX_RETRIES = 1
 *   Within a single invocation, a failed Open-Meteo fetch is retried once
 *   with a short delay. If it fails again, the user is left for the next
 *   scheduler run. This prevents a globally-down Open-Meteo from causing
 *   the function to exhaust its 60-second timeout on a single user.
 *
 * retryCount: 0 (scheduler retries)
 *   Cloud Scheduler does not retry invocations that fail. A crashed
 *   invocation is simply skipped. The next 10-minute invocation handles
 *   any remaining due users. This prevents retry storms if the whole batch
 *   crashes (e.g. Firestore outage).
 *
 * OPEN-METEO STORM PROTECTION
 *   If Open-Meteo is globally down, each user's weather fetch is aborted
 *   at WEATHER_FETCH_TIMEOUT_MS. With MAX_USERS_PER_RUN=20 and one retry
 *   each, the worst case is 20×2×8s = 320 seconds — exceeding timeoutSeconds.
 *   To prevent this, per-invocation total elapsed time is checked before
 *   each user and processing stops early if < INVOCATION_HEADROOM_MS remain.
 *   Remaining users stay due for the next run.
 *
 * DEDUPLICATION
 *   Event doc is created with status="processing" before the weather fetch.
 *   If the function crashes after creation, the user sees status="processing"
 *   on the next run and skips. A stale "processing" doc older than
 *   STALE_PROCESSING_AGE_MS is treated as a previous crash and the user is
 *   re-processed (with a new event doc write — the stale one is deleted first).
 *
 * PERMANENT FAILURE TERMINAL STATE
 *   failed-weather-permanent: set after WEATHER_FETCH_MAX_RETRIES exhausted
 *     within one invocation AND the user has been retried across
 *     MAX_WEATHER_RETRY_RUNS scheduler runs today. User waits until tomorrow.
 *   failed-fcm: all devices failed with permanent errors. Not retried.
 *   Both states result in nextCheckAt being advanced to tomorrow so the user
 *   is not re-queried every 5/10 minutes indefinitely.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import {
  lookAheadUmbrellaAdvice,
  notificationEligible,
  type HourlyPrecipSlot,
} from "./shared/precipDecision";
import { fetchTodayPrecip } from "./shared/weatherFetch";
import { computeNextCheckAt, todayEventId } from "./shared/scheduling";

// ── Cost-safety constants ────────────────────────────────────────────────────
// Change these to tune cost vs throughput. Document changes in ARCHITECTURE.md.

/** Max users processed per scheduler invocation. */
const MAX_USERS_PER_RUN = 20;

/** Max enabled devices to send per user. Protects against device-record bloat. */
const MAX_DEVICES_PER_USER = 5;

/** Open-Meteo fetch timeout in ms. Aborts slow responses early. */
const WEATHER_FETCH_TIMEOUT_MS = 8_000;

/**
 * Per-invocation weather retries per user (after initial attempt).
 * 1 = one retry = 2 total attempts. Keeps per-user time bounded.
 */
const WEATHER_FETCH_MAX_RETRIES = 1;

/**
 * How many scheduler runs today may retry a failed-weather user before
 * marking the event as permanently failed and advancing nextCheckAt.
 * Prevents open-ended retries if Open-Meteo is down all day.
 */
const MAX_WEATHER_RETRY_RUNS = 3;

/**
 * Stop processing new users if less than this many ms remain in the
 * invocation window. Prevents timeouts caused by many slow weather fetches.
 *
 * Firebase Functions v2 scheduled functions support up to 540 s timeout.
 * We use timeoutSeconds=120 (generous for 20 sequential users).
 *
 * IMPORTANT: INVOCATION_START_MS is captured inside the handler function,
 * NOT here at module scope. Module-scope Date.now() runs once at container
 * cold-start and is stale for all subsequent invocations of the same
 * container — the headroom guard would fire immediately on warm invocations.
 */
const INVOCATION_HEADROOM_MS = 20_000;
// INVOCATION_START_MS intentionally NOT set here — see handler body.

/**
 * A "processing" event doc older than this is treated as a stale crash
 * remnant and replaced. 30 minutes >> any normal invocation duration.
 */
const STALE_PROCESSING_AGE_MS = 30 * 60 * 1_000;

const REGION = "northamerica-northeast1";

// ── Scheduled function ────────────────────────────────────────────────────────

export const morningRainCheck = onSchedule(
  {
    schedule: "every 10 minutes",   // 10-min cadence: good UX, 1/3 fewer invocations
    region: REGION,
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,               // Only one copy runs at a time — hard cost cap
    concurrency: 1,                // One invocation at a time per instance
    retryCount: 0,                 // Never retry a failed/crashed invocation
    minInstances: 0,               // Never keep warm instances — no idle cost
  },
  async (_event) => {
    // Capture start time HERE inside the handler, not at module scope.
    const invocationStartMs = Date.now();
    const db  = getFirestore();
    const msg = getMessaging();
    const nowUtcMs = invocationStartMs;

    // ── Query due users ──────────────────────────────────────────────────
    // Uses the composite index on notificationPrefs.enabled + nextCheckAt.
    // Does NOT scan the full users collection — only documents where
    // enabled=true AND nextCheckAt <= now are read.
    const snap = await db
      .collection("users")
      .where("notificationPrefs.enabled", "==", true)
      .where("notificationPrefs.nextCheckAt", "<=", nowUtcMs)
      .limit(MAX_USERS_PER_RUN)
      .get();

    if (snap.empty) {
      // No-op log only at debug level — avoids Cloud Logging cost on quiet runs
      return;
    }

    logger.info("morningRainCheck: run started", { dueUsers: snap.size });

    for (const userDoc of snap.docs) {
      // ── Invocation time guard ──────────────────────────────────────────
      // Stop processing if we're running low on time. Remaining due users
      // keep their nextCheckAt <= now and are processed next run.
      const TIMEOUT_MS = 120_000; // must match timeoutSeconds above
      const elapsed = Date.now() - invocationStartMs;
      if (elapsed > TIMEOUT_MS - INVOCATION_HEADROOM_MS) {
        logger.warn("morningRainCheck: approaching timeout — stopping early", {
          processedSoFar: snap.docs.indexOf(userDoc),
          remainingMs: TIMEOUT_MS - elapsed,
        });
        break;
      }

      const uid = userDoc.id;
      try {
        await processUser(uid, userDoc.data(), nowUtcMs, db, msg);
      } catch (err) {
        // Log safe error info (no FIDs, no credentials), continue batch
        logger.error("morningRainCheck: user processing error", {
          uid: uid.slice(0, 4) + "***",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  },
);

// ── Per-user processing ────────────────────────────────────────────────────────

async function processUser(
  uid: string,
  data: FirebaseFirestore.DocumentData,
  nowUtcMs: number,
  db: FirebaseFirestore.Firestore,
  msg: ReturnType<typeof getMessaging>,
): Promise<void> {
  const np = data.notificationPrefs as Record<string, unknown> | undefined;
  if (!np) return;

  const timezone  = np.timezone      as string | undefined;
  const remHour   = np.reminderHour   as number | undefined;
  const remMinute = np.reminderMinute as number | undefined;
  const sv        = np.schedulingVersion    as number | undefined;
  const lastSv    = np.lastProcessedVersion as number | undefined;
  const prefs     = data.prefs as Record<string, unknown> | undefined;
  const city      = prefs?.city as { lat?: number; lon?: number } | undefined;
  const shortUid  = uid.slice(0, 4) + "***";

  // ── Validate ────────────────────────────────────────────────────────────
  if (
    !timezone || typeof timezone !== "string" ||
    typeof remHour !== "number" || remHour < 0 || remHour > 23 ||
    typeof remMinute !== "number" || remMinute < 0 || remMinute > 59 ||
    !city?.lat || !city?.lon
  ) {
    // Permanent data issue — advance to tomorrow so this user is not
    // re-queried every 10 minutes indefinitely.
    logger.warn("morningRainCheck: invalid prefs — advancing to tomorrow", { uid: shortUid });
    await advanceNextCheckAt(uid, nowUtcMs, timezone ?? "UTC", remHour ?? 7, remMinute ?? 30, db);
    return;
  }

  // ── Stale scheduling check ─────────────────────────────────────────────
  if (typeof sv === "number" && typeof lastSv === "number" && sv !== lastSv) {
    logger.info("morningRainCheck: stale sv — recomputing nextCheckAt", { uid: shortUid });
    const nca = computeNextCheckAt(nowUtcMs, timezone, remHour, remMinute);
    if (nca !== null) {
      await db.collection("users").doc(uid).update({
        "notificationPrefs.nextCheckAt": nca,
        "notificationPrefs.lastProcessedVersion": sv,
      });
    }
    return;
  }

  // ── Deduplication ──────────────────────────────────────────────────────
  const eventId  = todayEventId(nowUtcMs, timezone);
  const eventRef = db
    .collection("users").doc(uid)
    .collection("notificationEvents").doc(eventId);

  let weatherRetryRuns = 0;
  let skipToTomorrow   = false;

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      if (existing.exists) {
        const existingData = existing.data()!;
        const status = existingData.status as string;

        // Terminal states — already handled today
        if (
          status === "sent" ||
          status === "no-rain" ||
          status === "failed-fcm" ||
          status === "failed-weather-permanent"
        ) {
          throw new AlreadyHandledError(status);
        }

        // Stale "processing" from a previous crashed invocation
        if (status === "processing") {
          const startedAt = (existingData.startedAt as Timestamp)?.toMillis() ?? 0;
          if (Date.now() - startedAt > STALE_PROCESSING_AGE_MS) {
            // Replace with fresh processing doc
            tx.delete(eventRef);
            tx.create(eventRef, freshEventDoc(eventId));
            weatherRetryRuns = existingData.weatherRetryRuns as number ?? 0;
          } else {
            // Still within normal processing time — concurrent run, skip
            throw new AlreadyHandledError("processing-active");
          }
          return;
        }

        // "failed-weather" — count retries to enforce MAX_WEATHER_RETRY_RUNS
        if (status === "failed-weather") {
          weatherRetryRuns = (existingData.weatherRetryRuns as number ?? 0) + 1;
          if (weatherRetryRuns >= MAX_WEATHER_RETRY_RUNS) {
            // Give up for today — advance to tomorrow
            tx.update(eventRef, { status: "failed-weather-permanent", updatedAt: Timestamp.now() });
            skipToTomorrow = true;
            throw new AlreadyHandledError("failed-weather-permanent");
          }
          // Replace with new processing doc carrying retry counter
          tx.delete(eventRef);
          tx.create(eventRef, { ...freshEventDoc(eventId), weatherRetryRuns });
          return;
        }

        // Unknown status — treat as terminal to avoid infinite loops
        throw new AlreadyHandledError(status);
      }

      // First run today — create the dedup doc
      tx.create(eventRef, freshEventDoc(eventId));
    });
  } catch (err) {
    if (err instanceof AlreadyHandledError) {
      if (err.status !== "failed-weather") {
        // Already handled or terminal: advance nextCheckAt if needed
        const shouldAdvance =
          err.status === "sent" ||
          err.status === "no-rain" ||
          err.status === "failed-fcm" ||
          err.status === "failed-weather-permanent";
        if (shouldAdvance) {
          await advanceNextCheckAt(uid, nowUtcMs, timezone, remHour, remMinute, db);
        }
        if (skipToTomorrow) {
          await advanceNextCheckAt(uid, nowUtcMs, timezone, remHour, remMinute, db);
        }
      }
      return;
    }
    throw err; // Unexpected Firestore error — bubble up to batch handler
  }

  if (skipToTomorrow) {
    await advanceNextCheckAt(uid, nowUtcMs, timezone, remHour, remMinute, db);
    return;
  }

  // ── Fetch weather (bounded timeout + bounded retry) ────────────────────
  let hourlyPrecip: HourlyPrecipSlot[] | null = null;
  for (let attempt = 0; attempt <= WEATHER_FETCH_MAX_RETRIES; attempt++) {
    try {
      const forecast = await fetchTodayPrecip(
        city.lat,
        city.lon,
        timezone,
        WEATHER_FETCH_TIMEOUT_MS,
      );
      hourlyPrecip = forecast.hourlyPrecip;
      break;
    } catch (err) {
      const isLast = attempt === WEATHER_FETCH_MAX_RETRIES;
      if (!isLast) {
        // Brief pause before retry (does not log to save Cloud Logging cost)
        await sleep(1_000);
      }
    }
  }

  if (hourlyPrecip === null) {
    // All attempts failed — mark as failed-weather with retry counter
    // The next scheduler run will retry up to MAX_WEATHER_RETRY_RUNS times.
    await eventRef.update({
      status: "failed-weather",
      weatherRetryRuns,
      updatedAt: Timestamp.now(),
    });
    // Do NOT advance nextCheckAt — user stays due for retry
    return;
  }

  // ── Rain evaluation ────────────────────────────────────────────────────
  const nowFrac = remHour + remMinute / 60;
  const advice  = lookAheadUmbrellaAdvice(hourlyPrecip, nowFrac);
  const eligible = advice !== null && notificationEligible(advice);

  if (!eligible) {
    await eventRef.update({
      status: "no-rain",
      umbrellaLevel: advice?.level ?? 0,
      // evaluatedAt: when the weather check completed — NOT sentAt,
      // because no push was attempted on this path.
      evaluatedAt: Timestamp.now(),
    });
    await advanceNextCheckAt(uid, nowUtcMs, timezone, remHour, remMinute, db);
    return;
  }

  // ── Notification content ───────────────────────────────────────────────
  // Level 1 (35–49%): gentle nudge — possible rain.
  // Level 2 (≥ 50%): confident recommendation — rain is likely.
  // Level 3 (≥ 65% or thunder): strong recommendation.
  const hasThunder = advice.level === 3 && advice.timing.toLowerCase().includes("thunderstorm");
  const title = hasThunder
    ? "Thunderstorms later today ⛈️"
    : advice.level === 3
    ? "Bring an umbrella ☔"
    : advice.level === 2
    ? "Rain likely later today ☔"
    : "Possible rain later today 🌂";  // level 1
  const body = advice.level >= 2
    ? `${advice.timing} Rain is likely — take an umbrella.`
    : `${advice.timing} You might want to bring an umbrella just in case.`;

  // ── Send to enabled devices (bounded) ────────────────────────────────
  // Limit to most-recently-updated enabled devices to protect against
  // a user with hundreds of device records.
  const devicesSnap = await db
    .collection("users").doc(uid)
    .collection("devices")
    .where("enabled", "==", true)
    .orderBy("updatedAt", "desc")
    .limit(MAX_DEVICES_PER_USER)
    .get();

  let sentCount = 0, failedCount = 0;
  const permanentCodes = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ]);

  for (const deviceDoc of devicesSnap.docs) {
    const fid = deviceDoc.data().fid as string | undefined;
    if (!fid || typeof fid !== "string" || fid.length === 0) continue;

    try {
      await msg.send({
        fid,
        data: { title, body, url: "/" },
        apns:    { payload: { aps: { "content-available": 1 } } },
        android: { priority: "high" },
      });
      sentCount++;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "unknown";
      if (permanentCodes.has(code)) {
        // Stale FID — disable device. Never log the FID value.
        await deviceDoc.ref.update({ enabled: false, updatedAt: Date.now() });
      }
      // Log safe metadata only (no FID, no credentials)
      logger.warn("morningRainCheck: FCM error", {
        uid: shortUid,
        code,
        permanent: permanentCodes.has(code),
      });
      failedCount++;
    }
  }

  // ── Finalise ───────────────────────────────────────────────────────────
  await eventRef.update({
    status: sentCount > 0 ? "sent" : "failed-fcm",
    umbrellaLevel: advice.level,
    sentAt: Timestamp.now(),
    sentCount,
    failedCount,
  });

  logger.info("morningRainCheck: done", {
    uid: shortUid,
    level: advice.level,
    sentCount,
    failedCount,
  });

  await advanceNextCheckAt(uid, nowUtcMs, timezone, remHour, remMinute, db);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

class AlreadyHandledError extends Error {
  constructor(public readonly status: string) {
    super(`Already handled: ${status}`);
    this.name = "AlreadyHandledError";
  }
}

function freshEventDoc(eventId: string) {
  return {
    type: "rain-reminder",
    localDate: eventId.replace("rain-", ""),
    status: "processing",
    startedAt: Timestamp.now(),
    umbrellaLevel: null,
    weatherRetryRuns: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function advanceNextCheckAt(
  uid: string,
  nowUtcMs: number,
  timezone: string,
  remHour: number,
  remMinute: number,
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const nextCheckAt = computeNextCheckAt(nowUtcMs + 60_000, timezone, remHour, remMinute);
  if (nextCheckAt === null) return;
  await db.collection("users").doc(uid).update({
    "notificationPrefs.nextCheckAt": nextCheckAt,
  });
}
