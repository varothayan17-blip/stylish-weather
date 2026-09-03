/**
 * rainNowDecision.ts
 *
 * Single shared, pure function that determines precipitation-now state and
 * produces the effective current condition for ALL surfaces (hero label,
 * hero icon, recommendation wording, umbrella card).
 *
 * ── Timezone-safe provider timestamps ───────────────────────────────────────
 *
 * Open-Meteo returns ISO 8601 local-time strings WITHOUT a UTC offset suffix,
 * e.g. "2026-08-31T15:15". These are the location's local time (Toronto EDT,
 * Tokyo JST, etc.) — NOT UTC.
 *
 * parseIsoLocal("2026-08-31T15:15") calls Date.UTC(2026, 7, 31, 15, 15),
 * producing an epoch value where the UTC components (getUTCHours etc.) return
 * the LOCATION's wall-clock time. This is a pseudo-epoch, NOT a real UTC
 * instant.
 *
 * openMeteo.ts computes:
 *   nowLocalMs = Date.now() + utc_offset_seconds * 1000
 *   nowLocalIso = new Date(nowLocalMs).toISOString().slice(0, 16)
 *
 * This produces the same "local-as-UTC" scale: .getUTCHours() returns the
 * location's local hour. Both nowLocalMs and parseIsoLocal(slotTimeIso) are
 * in the same pseudo-epoch frame.
 *
 * rainNowDecision therefore uses weather.nowLocalMs (not Date.now()) for the
 * m15 tolerance calculation. This makes tolerance correct regardless of:
 *   - the browser's system timezone
 *   - a Node.js server running in UTC
 *   - Toronto EDT vs EST (DST transitions)
 *
 * For providerDataAgeMs, openMeteo.ts computes the difference as:
 *   parse(nowFullKey) - parse(currentTime)
 * where both sides use the same parseIsoLocal convention, so providerDataAgeMs
 * is already timezone-safe and does not need re-computation here.
 *
 * ── Amount-only active precipitation (effectiveCurrentCode selection) ────────
 *
 * When P2 fires (current-block amount > threshold) but P1 did not (WMO code
 * is dry), the WMO code has not yet caught up to the measured precipitation.
 * We synthesize a conservative WMO code for the hero icon:
 *
 *   currentShowersMm > AMOUNT_THRESHOLD_MM → code 80 (Rain showers)
 *   currentRainMm    > AMOUNT_THRESHOLD_MM → code 61 (Light rain)
 *   currentPrecipMm  > AMOUNT_THRESHOLD_MM → code 61 (Light rain, most conservative)
 *
 * Priority: showers > rain > total precipitation.
 * Code 61 (Light rain) is the most conservative honest rain code.
 * Code 80 (Rain showers) is used when c.showers specifically is elevated.
 *
 * ── Design principles ────────────────────────────────────────────────────────
 *
 * Active precipitation evidence (ordered by confidence):
 *
 *   P1 — Current WMO code is an active precipitation code.
 *        weather.code (after Guards A–D in openMeteo.ts).
 *
 *   P2 — Current-block measured precipitation amount > threshold.
 *        weather.currentPrecipMm, .currentRainMm, or .currentShowersMm.
 *        Dry WMO code + nonzero amount → code hasn't updated; trust amount.
 *
 *   P3 — Nearest minutely_15 slot within strict timestamp tolerance.
 *        Only the current slot (not future look-ahead). Validated by comparing
 *        weather.m15CurrentTimeIso to weather.nowLocalMs using parseIsoLocal —
 *        both in the same "local-as-UTC" pseudo-epoch frame.
 *        Tolerance: M15_MAX_AGE_MS (22 min).
 *
 * NOT evidence of active precipitation:
 *   • hourly[0].code  — 60-min forecast, not a current observation
 *   • hourly[0].precipProb — probability, not amount
 *   • any precipitation probability at any level
 *   • future minutely_15 slots
 *   • m15 slots outside M15_MAX_AGE_MS
 */

import type { Weather } from "./weatherProviders/types";
import type { RadarPrecipObservation } from "./radar-types";
import { RADAR_RAIN_THRESHOLD_MM_PER_HR } from "./radar-types";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum measured precipitation amount (mm) to confirm active precipitation
 * from current-block or minutely_15 amounts.
 * Open-Meteo current-block values are 15-min accumulations; 0.05 mm is above
 * the sensor/rounding noise floor but detects genuine drizzle.
 */
export const AMOUNT_THRESHOLD_MM = 0.05;

/**
 * Maximum age (ms) of a radar observation for it to be used as P0 evidence.
 * Radar composites update every ~6 minutes. We allow 3 cycles (18 min)
 * as a conservative maximum — beyond that, Open-Meteo evidence is fresher.
 * Validated against radar.observedAt (UTC ISO string) using nowMs.
 * Observations with future timestamps (beyond RADAR_CLOCK_SKEW_MS) are rejected.
 */
export const RADAR_MAX_AGE_MS = 18 * 60 * 1000; // 18 minutes

/**
 * Maximum allowable clock skew for radar observedAt timestamps.
 * Observations with observedAt up to 60 seconds in the future are accepted
 * (NTP drift, server clock variation). Beyond this they are rejected.
 */
export const RADAR_CLOCK_SKEW_MS = 60 * 1000; // 60 seconds

/**
 * Maximum age (ms) of the m15 current slot for it to count as "current."
 * 22 minutes = one 15-min interval + 7-min grace for model processing lag.
 *
 * Used directionally: ageMs = nowLocalMs - slotMs (not Math.abs).
 * A slot is valid only when 0 <= ageMs <= M15_MAX_AGE_MS.
 * Negative ageMs means the slot is in the future → always rejected.
 * This guard is applied in rainNowDecision even though openMeteo.ts
 * normally selects only past/current slots — defense in depth.
 */
export const M15_MAX_AGE_MS = 22 * 60 * 1000;

// WMO codes that represent active precipitation.
const ACTIVE_PRECIP_CODES = new Set([
  51, 53, 55, 56, 57,       // drizzle / freezing drizzle
  61, 63, 65, 66, 67,       // rain / freezing rain
  71, 73, 75, 77,           // snow
  80, 81, 82,               // showers
  85, 86,                   // snow showers
  95, 96, 99,               // thunderstorm
]);

// ── Result type ──────────────────────────────────────────────────────────────

export type PrecipIntensity =
  | "drizzle" | "light-rain" | "rain" | "heavy-rain"
  | "showers" | "heavy-showers" | "snow" | "thunder" | "none";

export type NowEvidence =
  | "radar-precipitation"  // fresh covered ECCC radar: precipitation > threshold
  | "radar-dry"            // fresh covered ECCC radar: confirmed dry; vetoes OMe P1–P3
  | "current-wmo-code"     // weather.code is a rain/thunder code
  | "current-amount"       // c.precipitation/rain/showers > AMOUNT_THRESHOLD_MM
  | "m15-wmo-code"         // m15 current slot WMO is active-precip (within tolerance)
  | "m15-amount"           // m15 current slot amount > AMOUNT_THRESHOLD_MM (within tolerance)
  | "none";

export interface RainNowDecision {
  /** True when provider data indicates active precipitation NOW. Never true from probability alone. */
  isPrecipitatingNow: boolean;

  /**
   * The WMO code ALL surfaces must use for hero icon and condition label.
   * When P1 fires: equals weather.code.
   * When P2 fires with no rain WMO code: synthesized conservative code
   *   (80 = showers when currentShowersMm is elevated; 61 = light rain otherwise).
   * When evidence="none": equals weather.code unchanged.
   * Hero and recommendation are guaranteed to use the same code.
   */
  effectiveCurrentCode: number;

  /** Intensity classification derived from effectiveCurrentCode. "none" when not precipitating. */
  intensity: PrecipIntensity;

  /** Primary evidence source. "none" when isPrecipitatingNow is false. */
  evidence: NowEvidence;

  /**
   * ISO local-time string of the evidence (m15 slot time, or provider c.time).
   * In the "local-as-UTC" format used by Open-Meteo, e.g. "2026-08-31T15:15".
   */
  evidenceTimestamp: string | undefined;

  /**
   * Age of the Open-Meteo current-block data in ms at fetch time.
   * = parse(nowFullKey) - parse(c.time), both in "local-as-UTC" pseudo-epoch.
   * Already computed timezone-safely by openMeteo.ts; passed through here.
   */
  providerDataAgeMs: number;

  /**
   * ISO local-time string of c.time (the model boundary, e.g. "2026-08-31T15:15").
   * Used in the UI: "Conditions for 3:15 PM · checked just now".
   */
  providerTimeIso: string | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse an Open-Meteo local-time ISO string ("YYYY-MM-DDTHH:MM") into the
 * "local-as-UTC" pseudo-epoch: Date.UTC(y, mo-1, da, hh, mi).
 *
 * This is NOT a real UTC timestamp. It matches the scale of weather.nowLocalMs
 * (Date.now() + utcOffsetSec * 1000), enabling timezone-safe comparisons of
 * Open-Meteo slot times against the current local wall clock time, regardless
 * of the browser/server system timezone.
 *
 * NEVER use new Date(offsetlessIso) or Date.parse(offsetlessIso) here —
 * those functions would interpret the string as UTC or local depending on
 * the runtime, producing wrong results in non-UTC environments.
 */
export function parseIsoLocal(iso: string): number {
  const [d, t] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [hh, mi] = t.split(":").map(Number);
  return Date.UTC(y, mo - 1, da, hh, mi);
}

function intensityFromCode(code: number): PrecipIntensity {
  if ([95, 96, 99].includes(code)) return "thunder";
  if (code === 82) return "heavy-showers";
  if ([80, 81].includes(code)) return "showers";
  if ([65, 66, 67].includes(code)) return "heavy-rain";
  if (code === 63) return "rain";
  if (code === 61) return "light-rain";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if (code >= 71 && code <= 86) return "snow";
  return "none";
}

/**
 * Select the effective WMO code when amount evidence fires but the WMO code
 * is dry (P2 without P1). Conservative synthesis rules:
 *
 *   currentShowersMm > threshold → 80 (Rain showers) — convective signal
 *   currentRainMm    > threshold → 61 (Light rain)   — stratiform signal
 *   currentPrecipMm  > threshold → 61 (Light rain)   — total precipitation
 *
 * Priority: showers → rain → total precip.
 */
function synthCodeForAmounts(
  currentShowersMm: number,
  currentRainMm: number,
): 80 | 61 {
  if (currentShowersMm > AMOUNT_THRESHOLD_MM) return 80;
  if (currentRainMm    > AMOUNT_THRESHOLD_MM) return 61;
  return 61; // total precipitation (currentPrecipMm path)
}

// ── Main decision function ───────────────────────────────────────────────────

/**
 * Produce the shared precipitation-now decision consumed by ALL UI surfaces.
 *
 * @param weather   The Weather object from the active provider.
 * @param radar     Optional fresh ECCC radar observation for the same coordinates.
 *
 *   When status="precipitation" and fresh:
 *     → isPrecipitatingNow=true, evidence="radar-precipitation".
 *     → Preserves OMe thunderstorm code (95/96/99) because radar measures rain
 *       rate not lightning; otherwise uses code 80 (Rain showers, conservative).
 *
 *   When status="dry" and fresh (coverage confirmed, numeric rate ≤ threshold):
 *     → isPrecipitatingNow=false, evidence="radar-dry".
 *     → VETOES Open-Meteo P1, P2, P3 — stale OMe fields cannot reactivate
 *       precipitation. This fixes the reverse-lag bug: rain stops, radar reports
 *       covered+dry, but delayed OMe still shows rain code/amount.
 *     → effectiveCurrentCode: if OMe code is already dry, keep it.
 *       If OMe code is a precipitation code, fall back to WMO 3 (Overcast).
 *
 *   When status="no-coverage", "unavailable", stale, or invalid:
 *     → Ignore radar; use Open-Meteo P1–P3 as before.
 *
 * Decision order:
 *   P0-precip — Fresh ECCC radar: precipitation
 *   P0-dry    — Fresh ECCC radar: covered+dry  (vetoes P1–P3)
 *   P1        — Open-Meteo current WMO code (only when radar unavailable/stale)
 *   P2        — Open-Meteo current amounts   (only when radar unavailable/stale)
 *   P3        — Open-Meteo minutely_15        (only when radar unavailable/stale)
 */
export function rainNowDecision(
  weather: Weather,
  radar?: RadarPrecipObservation,
  nowMs: number = Date.now(),
): RainNowDecision {
  const providerDataAgeMs = weather.providerDataAgeMs ?? 0;
  const providerTimeIso   = weather.currentTimeIso;

  // ── P0: Fresh ECCC radar — authoritative in both directions ─────────────
  //
  // A fresh covered radar observation is the most reliable current-precipitation
  // evidence available. It is authoritative in BOTH directions:
  //   precipitation → isPrecipitatingNow=true  (overrides dry OMe fields)
  //   dry           → isPrecipitatingNow=false (overrides stale rain OMe fields)
  //
  // The radar-dry veto fixes the reverse-lag bug: rain stops, ECCC radar
  // reports covered+dry within ~6 minutes, but Open-Meteo's NWP model may
  // not update its current-block fields for 15–30 more minutes. Without the
  // veto, Aeruvo would keep showing rain for up to 30 minutes after it stops.
  //
  // Freshness guard (applied here as a pure boundary, defense-in-depth):
  //   valid range: -RADAR_CLOCK_SKEW_MS ≤ (nowMs - observedAtMs) ≤ RADAR_MAX_AGE_MS
  //   Invalid / stale / future → ignore radar, fall through to OMe P1–P3.

  const isActionableRadar = (r: RadarPrecipObservation | undefined): boolean => {
    if (!r || !r.observedAt) return false;
    const observedAtMs = Date.parse(r.observedAt);
    if (isNaN(observedAtMs)) return false;
    const ageMs = nowMs - observedAtMs;
    return ageMs >= -RADAR_CLOCK_SKEW_MS && ageMs <= RADAR_MAX_AGE_MS;
  };

  if (isActionableRadar(radar)) {
    if (radar!.status === "precipitation") {
      // P0-precip: confirmed covered + rain rate > threshold.
      // Thunderstorm preservation: if OMe already has a thunder code, keep it
      // (radar measures rate, not lightning; thunder is the more severe label).
      const THUNDER_CODES = new Set([95, 96, 99]);
      const effectiveCode = THUNDER_CODES.has(weather.code) ? weather.code : 80;
      return {
        isPrecipitatingNow: true,
        effectiveCurrentCode: effectiveCode,
        intensity: intensityFromCode(effectiveCode),
        evidence: "radar-precipitation",
        evidenceTimestamp: radar!.observedAt,
        providerDataAgeMs,
        providerTimeIso,
      };
    }

    if (radar!.status === "dry") {
      // P0-dry: confirmed covered + numeric rate ≤ threshold.
      // Veto Open-Meteo P1–P3: stale OMe rain codes/amounts cannot override
      // a fresh physical observation that it is not raining here right now.
      //
      // effectiveCurrentCode must be a non-precipitation code:
      //   - If weather.code is already dry (not in ACTIVE_PRECIP_CODES), keep it.
      //   - If weather.code is a precipitation code (stale OMe), use WMO 3 (Overcast)
      //     as the safest neutral fallback — honest about cloud cover, not claiming rain.
      const dryCode = ACTIVE_PRECIP_CODES.has(weather.code) ? 3 : weather.code;
      return {
        isPrecipitatingNow: false,
        effectiveCurrentCode: dryCode,
        intensity: "none",
        evidence: "radar-dry",
        evidenceTimestamp: radar!.observedAt,
        providerDataAgeMs,
        providerTimeIso,
      };
    }
  }
  // Radar is absent, stale, no-coverage, or unavailable → fall through to OMe.


  // ── P1: Current WMO code is an active precipitation code ────────────────
  if (ACTIVE_PRECIP_CODES.has(weather.code)) {
    return {
      isPrecipitatingNow: true,
      effectiveCurrentCode: weather.code,
      intensity: intensityFromCode(weather.code),
      evidence: "current-wmo-code",
      evidenceTimestamp: providerTimeIso,
      providerDataAgeMs,
      providerTimeIso,
    };
  }

  // ── P2: Current-block measured precipitation amount > threshold ──────────
  // Each field is checked independently to choose the correct synthCode.
  const cShowers = weather.currentShowersMm ?? 0;
  const cRain    = weather.currentRainMm    ?? 0;
  const cPrecip  = weather.currentPrecipMm  ?? 0;
  const currentAnyPrecipMm = Math.max(cShowers, cRain, cPrecip);

  if (currentAnyPrecipMm > AMOUNT_THRESHOLD_MM) {
    const synthCode = synthCodeForAmounts(cShowers, cRain);
    return {
      isPrecipitatingNow: true,
      effectiveCurrentCode: synthCode,
      intensity: intensityFromCode(synthCode),
      evidence: "current-amount",
      evidenceTimestamp: providerTimeIso,
      providerDataAgeMs,
      providerTimeIso,
    };
  }

  // ── P3: Nearest minutely_15 slot within strict timestamp tolerance ───────
  //
  // Timezone-safe comparison:
  //   weather.nowLocalMs  = Date.now() + utcOffsetSec*1000  (from openMeteo.ts)
  //   parseIsoLocal(m15TimeIso) = Date.UTC(y, mo-1, da, hh, mi)
  // Both are in the same "local-as-UTC" pseudo-epoch, so their difference
  // correctly represents the wall-clock gap between now and the m15 slot.
  //
  // Using raw Date.now() here would introduce a 4-hour error for Toronto EDT,
  // making all m15 slots appear to be 4 hours away — outside tolerance.
  const m15TimeIso   = weather.m15CurrentTimeIso;
  const nowLocalMs   = weather.nowLocalMs ?? Date.now(); // safe fallback for legacy callers

  if (m15TimeIso) {
    const slotMs = parseIsoLocal(m15TimeIso);
    // Directional age: positive = slot is in the past, negative = slot is in the future.
    // Only past/current slots (ageMs >= 0) are valid evidence for "precipitating now."
    // Future slots are forecast evidence and must never establish active precipitation,
    // even when their absolute distance from now is within M15_MAX_AGE_MS.
    // Math.abs is intentionally NOT used here.
    const ageMs = nowLocalMs - slotMs;

    if (ageMs >= 0 && ageMs <= M15_MAX_AGE_MS) {
      if (weather.m15CurrentIsRain === true) {
        return {
          isPrecipitatingNow: true,
          effectiveCurrentCode: weather.code, // retain existing code; m15 WMO not stored separately
          intensity: "showers",
          evidence: "m15-wmo-code",
          evidenceTimestamp: m15TimeIso,
          providerDataAgeMs,
          providerTimeIso,
        };
      }
      const m15PrecipMm = Math.max(
        weather.m15CurrentPrecipMm ?? 0,
        weather.m15CurrentRainMm   ?? 0,
      );
      if (m15PrecipMm > AMOUNT_THRESHOLD_MM) {
        return {
          isPrecipitatingNow: true,
          effectiveCurrentCode: weather.code,
          intensity: "showers",
          evidence: "m15-amount",
          evidenceTimestamp: m15TimeIso,
          providerDataAgeMs,
          providerTimeIso,
        };
      }
    }
    // m15 slot outside tolerance — ignore.
  }

  // ── No active precipitation evidence ────────────────────────────────────
  return {
    isPrecipitatingNow: false,
    effectiveCurrentCode: weather.code,
    intensity: "none",
    evidence: "none",
    evidenceTimestamp: providerTimeIso,
    providerDataAgeMs,
    providerTimeIso,
  };
}
