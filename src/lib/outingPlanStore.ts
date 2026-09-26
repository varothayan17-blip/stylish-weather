/**
 * outingPlanStore.ts — localStorage persistence for locked Outing Plans.
 *
 * Key pattern: "aeruvo:outing-plans:v2:{uid}"
 * Legacy key "aeruvo:outing-plans:v1" is silently ignored on load.
 *
 * Issue 1 — Atomic replacement:
 *   Drafts exist only in React state (memory), never persisted.
 *   When the user confirms "Use this plan", commitPlan() atomically:
 *     - Saves the new plan as "upcoming"
 *     - Marks any prior active/upcoming plan as "replaced"
 *   in a single saveAll() call, so the store is never in an inconsistent state.
 *   confirmReplacement() is removed — replaced by commitPlan().
 *
 * Issue 2 — Stale recheck state:
 *   loadById() reads the latest persisted record before throttle decisions.
 *   Callers must pass the persisted plan to needsRecheck(), not a stale
 *   React state object captured before recordAttempt().
 *
 * Issue 6 — Complete validation:
 *   Validates every field: version (v2 only), status, ISO strings,
 *   arrays, PlannedItem fields, WeatherSummary numbers/booleans,
 *   coordinates, adaptationNote, attemptedAt, lastCheckedAt.
 *   NaN and Infinity both rejected. Invalid records silently dropped.
 *
 * Issue 7 — Throttle via attemptedAt:
 *   needsRecheck() uses attemptedAt ?? lastCheckedAt.
 *   recordAttempt() writes to storage immediately so the next
 *   loadById() sees the updated timestamp.
 */

import type { OutingPlanRecommendation } from "./outingPlanner";

export type PlanStatus =
  | "upcoming" | "active" | "completed" | "cancelled" | "replaced";

export type LockedPlan = {
  id:             string;
  uid:            string;
  status:         PlanStatus;
  /** Immutable snapshot — never mutated after commit */
  snapshot:       OutingPlanRecommendation;
  adaptationNote: string | null;
  lockedAt:       number;
  /** Timestamp of last recheck attempt (success or failure) */
  attemptedAt:    number | null;
  /** Timestamp of last successful recheck */
  lastCheckedAt:  number | null;
  /** ID of the plan this one replaced */
  replacesId?:    string;
};

/** Plans auto-complete 2 hours after their return time */
export const GRACE_PERIOD_MS = 2 * 60 * 60 * 1_000;
/** Throttle: no recheck sooner than 5 min after any attempt */
export const RECHECK_THROTTLE_MS = 5 * 60 * 1_000;

// Only the current schema version is accepted from storage.
const SUPPORTED_VERSION = 2;
const VALID_STATUSES = new Set<string>(
  ["upcoming","active","completed","cancelled","replaced"]
);
/**
 * Semantic ISO local datetime validator (issue 6).
 *
 * Validates "YYYY-MM-DDTHH:mm" strings:
 *   - Structural pattern must match
 *   - Month 1–12, Day 1–days-in-month (accounts for leap years and short months)
 *   - Hour 0–23, Minute 0–59
 *   - Round-trips: parsing and re-formatting must reproduce the original value
 *
 * Rejects: 2026-99-01T00:00, 2026-02-30T00:00, 2026-01-01T25:00,
 *   malformed strings, strings that normalize silently.
 */
function isValidIsoLocal(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return false;
  const [datePart, timePart] = v.split("T");
  const [year, month, day]   = datePart.split("-").map(Number);
  const [hour, minute]       = timePart.split(":").map(Number);
  if (month < 1 || month > 12) return false;
  if (hour  < 0 || hour  > 23) return false;
  if (minute < 0 || minute > 59) return false;
  // Validate day using Date constructor round-trip
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  return (
    d.getFullYear() === year  &&
    d.getMonth()    === month - 1 &&
    d.getDate()     === day   &&
    d.getHours()    === hour  &&
    d.getMinutes()  === minute
  );
}

function isBrowser(): boolean { return typeof window !== "undefined"; }

export function storageKeyForUid(uid: string): string {
  return `aeruvo:outing-plans:v2:${uid}`;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// isIsoLocal is now isValidIsoLocal (semantic validation above)

function isNullableFiniteNum(v: unknown): boolean {
  return v === null || isFiniteNum(v);
}

function isValidPlannedItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const r = item as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length === 0) return false;
  if (r.wardrobeId !== null && typeof r.wardrobeId !== "string") return false;
  if (typeof r.fromWardrobe !== "boolean") return false;
  if (typeof r.reason !== "string") return false;
  return true;
}

/** Complete v2 runtime validation — issue 6 */
function isValidPlan(p: unknown, uid: string): p is LockedPlan {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;

  // Top-level
  if (typeof r.id !== "string" || r.id.length === 0) return false;
  if (typeof r.uid !== "string" || r.uid !== uid) return false;
  if (typeof r.status !== "string" || !VALID_STATUSES.has(r.status)) return false;
  if (!isFiniteNum(r.lockedAt)) return false;
  // adaptationNote: null or string
  if (r.adaptationNote !== null && typeof r.adaptationNote !== "string") return false;
  // attemptedAt / lastCheckedAt: null or finite number
  if (!isNullableFiniteNum(r.attemptedAt)) return false;
  if (!isNullableFiniteNum(r.lastCheckedAt)) return false;

  const snap = r.snapshot as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== "object") return false;

  // Version — only v2 from UID-scoped storage
  if (snap.recommendationVersion !== SUPPORTED_VERSION) return false;

  // Coverage strings
  if (!isValidIsoLocal(snap.coverageStart)) return false;
  if (!isValidIsoLocal(snap.coverageEnd))   return false;

  // Location with valid geographic ranges
  if (!isFiniteNum(snap.locationLat) || !isFiniteNum(snap.locationLon)) return false;
  if ((snap.locationLat as number) < -90 || (snap.locationLat as number) > 90) return false;
  if ((snap.locationLon as number) < -180 || (snap.locationLon as number) > 180) return false;
  // Logical ordering: coverageStart before coverageEnd
  if (snap.coverageStart >= snap.coverageEnd) return false;

  // String fields
  if (typeof snap.locationLabel !== "string") return false;
  if (typeof snap.occasion !== "string")      return false;
  if (typeof snap.personalizationExplanation !== "string") return false;
  if (typeof snap.generatedAt !== "string" || isNaN(Date.parse(snap.generatedAt as string))) return false;
  if ("assumption" in snap && snap.assumption !== undefined &&
      typeof snap.assumption !== "string") return false;
  // replacesId: absent or non-empty string
  if (r.replacesId !== undefined &&
      (typeof r.replacesId !== "string" || r.replacesId.length === 0)) return false;

  // Arrays of PlannedItem
  if (!Array.isArray(snap.baseItems))       return false;
  if (!Array.isArray(snap.removableLayers)) return false;
  if (!Array.isArray(snap.footwear))        return false;
  if (!Array.isArray(snap.accessories))     return false;
  const allItems = [
    ...(snap.baseItems as unknown[]),
    ...(snap.removableLayers as unknown[]),
    ...(snap.footwear as unknown[]),
    ...(snap.accessories as unknown[]),
  ];
  if (!allItems.every(isValidPlannedItem)) return false;

  // timelineGuidance array — Issue 5: timestamps constrained to plan interval
  if (!Array.isArray(snap.timelineGuidance)) return false;
  // coverageStart/End already validated above; use them as bounds
  const cs = snap.coverageStart as string;
  const ce = snap.coverageEnd   as string;
  for (const g of snap.timelineGuidance as unknown[]) {
    if (!g || typeof g !== "object") return false;
    const tg = g as Record<string, unknown>;
    if (!isValidIsoLocal(tg.startTime)) return false;
    if (typeof tg.instruction !== "string") return false;
    if (typeof tg.reason !== "string") return false;
    // startTime must be within [coverageStart, coverageEnd]
    if ((tg.startTime as string) < cs || (tg.startTime as string) > ce) return false;
    // endTime: absent, or valid ISO local + within [startTime, coverageEnd]
    if (tg.endTime !== undefined) {
      if (!isValidIsoLocal(tg.endTime)) return false;
      if ((tg.endTime as string) < (tg.startTime as string)) return false;
      if ((tg.endTime as string) > ce) return false;
    }
  }

  // WeatherSummary
  const ws = snap.weatherSummary as Record<string, unknown> | undefined;
  if (!ws || typeof ws !== "object") return false;
  if (!isFiniteNum(ws.rawMinApparentTempC)) return false;
  if (!isFiniteNum(ws.rawMaxApparentTempC)) return false;
  if (!isFiniteNum(ws.effectiveMinC))       return false;
  if (!isFiniteNum(ws.effectiveMaxC))       return false;
  if (!isFiniteNum(ws.peakPrecipitationProbability)) return false;
  if (!isFiniteNum(ws.maxWindSpeedKph))     return false;
  if (!isBool(ws.hasRain))                  return false;
  if (!isBool(ws.hasSnow))                  return false;
  if (!isBool(ws.isWindy))                  return false;
  if (!isBool(ws.hasActiveRainCode))        return false;
  // destinationMinC and destinationMaxC (v2 two-track model)
  if (!isFiniteNum(ws.destinationMinC))     return false;
  if (!isFiniteNum(ws.destinationMaxC))     return false;
  // Precipitation probability in valid range 0–100
  const pp = ws.peakPrecipitationProbability as number;
  if (pp < 0 || pp > 100) return false;

  return true;
}

function loadRaw(uid: string): LockedPlan[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(storageKeyForUid(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(p => isValidPlan(p, uid));
  } catch {
    return [];
  }
}

function saveAll(uid: string, plans: LockedPlan[]): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(storageKeyForUid(uid), JSON.stringify(plans)); }
  catch { /* QuotaExceededError — non-fatal */ }
}

/** Safari-safe ISO local date parser — splits on "T", never uses .replace("T"," ") */
export function parseIsoLocal(iso: string): Date {
  const [datePart, timePart = "00:00"] = iso.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute]     = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function computeCurrentStatus(plan: LockedPlan): PlanStatus {
  if (
    plan.status === "cancelled" ||
    plan.status === "completed" ||
    plan.status === "replaced"
  ) return plan.status;
  const now  = Date.now();
  const dept = parseIsoLocal(plan.snapshot.coverageStart).getTime();
  const ret  = parseIsoLocal(plan.snapshot.coverageEnd).getTime();
  if (now < dept) return "upcoming";
  if (now < ret + GRACE_PERIOD_MS) return "active";
  return "completed";
}

/**
 * Compare fresh raw forecast against locked raw values.
 * Compares both min and max. Never compares effective values.
 *
 * Issue 4: freshHasRain and freshHasActiveRainCode are checked independently
 * so a WMO rain code at 5% probability triggers an adaptation note.
 * "Was rainy" considers both the locked probability AND the locked hasRain/hasActiveRainCode
 * so a plan locked during active rain is not re-notified.
 */
export function computeAdaptationNote(
  plan:                    LockedPlan,
  freshRawMin:             number,
  freshRawMax:             number,
  freshPrecip:             number,
  freshHasRain:            boolean,
  freshHasActiveRainCode:  boolean,
): string | null {
  const ws = plan.snapshot.weatherSummary;
  const lockedMin = ws.rawMinApparentTempC;
  const lockedMax = ws.rawMaxApparentTempC;
  const now       = Date.now();
  const dept      = parseIsoLocal(plan.snapshot.coverageStart).getTime();
  const departed  = now >= dept;
  // "Was rainy" = plan was locked with rain evidence from probability OR active code
  const wasRainy  = ws.peakPrecipitationProbability >= 40 ||
                    ws.hasRain || ws.hasActiveRainCode;
  const notes: string[] = [];

  const minDelta = freshRawMin - lockedMin;
  const maxDelta = freshRawMax - lockedMax;

  if (minDelta <= -4) {
    notes.push(departed
      ? `It's ${Math.abs(minDelta).toFixed(0)} °C colder than forecast. If possible, grab a layer before heading home.`
      : `The minimum temperature is now ${Math.abs(minDelta).toFixed(0)} °C colder. Consider adding a warmer layer.`
    );
  } else if (minDelta >= 4) {
    notes.push("It's warmer than the forecast minimum — you may not need your layer.");
  }

  if (maxDelta <= -4) {
    notes.push("The peak temperature is also lower than forecast — the warmest period will be cooler.");
  } else if (maxDelta >= 4 && !departed) {
    notes.push("The peak temperature is higher than forecast — lighter clothing may be more comfortable.");
  }

  // Issue 4: trigger on active rain code even when probability is below 40%
  const freshIsRainy = freshHasRain || freshHasActiveRainCode || freshPrecip >= 40;
  if (!wasRainy && freshIsRainy) {
    notes.push(departed
      ? "Rain is now expected before you return. An umbrella may be useful if one is available."
      : "Rain is now expected — bring an umbrella."
    );
  }
  return notes.length === 0 ? null : notes.join(" ");
}

export const outingPlanStore = {
  loadAll(uid: string): LockedPlan[] {
    const plans = loadRaw(uid).map(p => {
      const s = computeCurrentStatus(p);
      return s !== p.status ? { ...p, status: s } : p;
    });
    saveAll(uid, plans);
    return plans;
  },

  /** Read a single plan from storage by ID (always fresh — not from React state). */
  loadById(uid: string, id: string): LockedPlan | null {
    return outingPlanStore.loadAll(uid).find(p => p.id === id) ?? null;
  },

  /**
   * Atomically commit a new plan and replace any existing active/upcoming plan.
   * Issue 1: draft lives only in memory until this is called.
   * If replaceId is given, that plan is marked "replaced" in the same write.
   */
  commitPlan(
    uid:       string,
    snapshot:  OutingPlanRecommendation,
    replaceId: string | null,
  ): LockedPlan {
    const existing = outingPlanStore.loadAll(uid);
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newPlan: LockedPlan = {
      id, uid, status: "upcoming", snapshot,
      adaptationNote: null, lockedAt: Date.now(),
      attemptedAt: null, lastCheckedAt: null,
      ...(replaceId ? { replacesId: replaceId } : {}),
    };
    // Issue 6: only replace the exact plan the user confirmed replacing.
    // Unrelated future plans remain untouched.
    const updated = existing.map(p => {
      if (replaceId && p.id === replaceId) return { ...p, status: "replaced" as PlanStatus };
      return p;
    });
    saveAll(uid, [newPlan, ...updated]);
    return newPlan;
  },

  cancelPlan(uid: string, id: string): void {
    saveAll(uid, outingPlanStore.loadAll(uid).map(p =>
      p.id === id ? { ...p, status: "cancelled" as PlanStatus } : p,
    ));
  },

  /** Write attemptedAt to storage immediately — callers must reload to see it */
  recordAttempt(uid: string, id: string): LockedPlan | null {
    const now   = Date.now();
    const plans = outingPlanStore.loadAll(uid).map(p =>
      p.id === id ? { ...p, attemptedAt: now } : p,
    );
    saveAll(uid, plans);
    return plans.find(p => p.id === id) ?? null;
  },

  updateAdaptation(uid: string, id: string, note: string | null): LockedPlan | null {
    const now   = Date.now();
    const plans = outingPlanStore.loadAll(uid).map(p =>
      p.id === id
        ? { ...p, adaptationNote: note, lastCheckedAt: now, attemptedAt: now }
        : p,
    );
    saveAll(uid, plans);
    return plans.find(p => p.id === id) ?? null;
  },

  /**
   * Issue 2/7: Throttle check against the PERSISTED plan, not React state.
   * Callers should call loadById() to get the freshest plan before checking.
   */
  needsRecheck(plan: LockedPlan): boolean {
    const t = plan.attemptedAt ?? plan.lastCheckedAt;
    if (!t) return true;
    return Date.now() - t >= RECHECK_THROTTLE_MS;
  },

  getMostRelevantPlan(uid: string): LockedPlan | null {
    const all = outingPlanStore.loadAll(uid)
      .filter(p => p.status === "upcoming" || p.status === "active");
    if (all.length === 0) return null;
    const active   = all.filter(p => p.status === "active");
    const upcoming = all.filter(p => p.status === "upcoming");
    const pool     = active.length > 0 ? active : upcoming;
    return pool.sort(
      (a, b) =>
        parseIsoLocal(a.snapshot.coverageStart).getTime() -
        parseIsoLocal(b.snapshot.coverageStart).getTime(),
    )[0];
  },

  clearAll(uid: string): void {
    if (!isBrowser()) return;
    try { window.localStorage.removeItem(storageKeyForUid(uid)); } catch { /* ignore */ }
  },
};
