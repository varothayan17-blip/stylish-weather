/**
 * /plan — Outing Planner page.
 *
 * Premium-only. No AI calls. No WARDROBE_AI_SCANNING_ENABLED dependency.
 *
 * Issue 2: displays raw apparent temperature as "Apparent" not "Feels like".
 * Issue 3: full-containment error shows ISO date+time not only clock.
 * Issue 7: stable recheck — in-flight ref prevents concurrent checks.
 * Issue 8: recheck triggered from this page only (home triggers separately).
 * Issue 10: UID-scoped localStorage keys.
 * Issue 11: replacement semantics — old plan survives until user confirms.
 * Issue 12: no "choose different outfit" without real alternatives (excluded IDs).
 * Issue 17: reject materially past custom departure.
 * Issue 18: Safari-safe date parsing via parseIsoLocal.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { useEntitlement } from "@/lib/entitlement";
import { loadPrefs } from "@/lib/preferences";
import { CANADIAN_CITIES } from "@/lib/weather";
import { useWardrobe } from "@/components/wardrobe/wardrobeStore";
import {
  planOuting,
  formatHour,
  OUTING_PLAN_VERSION,
  type OutingInput,
  type OutingOccasion,
  type OutingActivity,
  type OutingContext,
  type OutingPlanRecommendation,
  type PlannedItem,
  type WeatherSummary,
} from "@/lib/outingPlanner";
import {
  fetchOutingForecast,
  RAIN_CODES,
  type OutingForecastSlice,
} from "@/lib/outingForecast";
import {
  outingPlanStore,
  computeAdaptationNote,
  parseIsoLocal,
  RECHECK_THROTTLE_MS,
  type LockedPlan,
} from "@/lib/outingPlanStore";
import { loadStyleProfile } from "@/lib/styleProfileSync";
import type { PersonalStyleProfile } from "@/lib/styleProfile";
import {
  MapPin, Clock, Crown, ChevronLeft, CheckCircle2, AlertCircle,
  RefreshCw, X, Shirt, Layers, Footprints, Umbrella, Info,
} from "lucide-react";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Outing Planner — Aeruvo" },
      { name: "description", content: "Plan your outing. One adaptable outfit for the whole trip." },
    ],
  }),
  component: PlanPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function nowIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addHoursToIso(iso: string, h: number): string {
  const d = parseIsoLocal(iso);  // Safari-safe (issue 18)
  const n = new Date(d.getTime() + h * 3600_000);
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

function todayAt(hour: number, min = 0): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}`;
}

function dateOf(iso: string) { return iso.slice(0, 10); }

function formatCoverage(rec: OutingPlanRecommendation): string {
  return `${formatHour(rec.coverageStart)}–${formatHour(rec.coverageEnd)}`;
}

/** Format ISO datetime for user-facing display including date (issue 3) */
function formatIsoDateTime(iso: string): string {
  const d = parseIsoLocal(iso);
  const day  = d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const time = formatHour(iso);
  return `${day} at ${time}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={[
        "press rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors",
        selected
          ? "bg-primary/15 text-primary ring-primary/30"
          : "bg-foreground/[0.04] text-muted-foreground ring-transparent hover:bg-foreground/[0.07]",
      ].join(" ")}>
      {label}
    </button>
  );
}

function ItemRow({ item }: { item: PlannedItem }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0">
        <p className="font-medium leading-snug">{item.name}</p>
        {item.fromWardrobe && (
          <p className="mt-0.5 text-xs text-primary">From your wardrobe</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{item.reason}</p>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{className?:string}>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    </div>
  );
}

function UpgradeTeaser() {
  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Crown className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold">Outing Planner</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
          Plan any outing and Aeruvo checks the full forecast interval. One stable outfit that adapts.
        </p>
      </div>
      <ul className="space-y-2 text-sm text-left w-full max-w-xs">
        {["Full-interval forecast analysis","Base + removable layer strategy","Matched from your wardrobe","Live forecast recheck"].map(f => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{f}</span>
          </li>
        ))}
      </ul>
      <Link {...{to: "/premium" as any}}
        className="press flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground">
        <Crown className="h-4 w-4" /> Upgrade to Premium
      </Link>
      <Link {...{to: "/" as any}} className="text-sm text-muted-foreground underline underline-offset-2">
        Back to today
      </Link>
    </div>
  );
}

function PlanResult({
  plan, onLock, isLocked, adaptationNote, onCancelOrReplace,
}: {
  plan:               OutingPlanRecommendation;
  onLock?:            () => void;
  isLocked:           boolean;
  adaptationNote?:    string | null;
  onCancelOrReplace?: () => void;
}) {
  const s = plan.weatherSummary;
  // Issue 2: label effective range accurately — NOT "Feels like"
  const effectiveLabel = s.effectiveMinC !== undefined
    ? `${Math.round(s.effectiveMinC)}–${Math.round(s.effectiveMaxC)} °C (adjusted for you)`
    : `${Math.round(s.rawMinApparentTempC)}–${Math.round(s.rawMaxApparentTempC)} °C apparent`;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              {isLocked ? "Your outfit plan" : "Draft plan — review before locking"}
            </p>
            <h2 className="mt-1 text-lg font-bold leading-tight">{formatCoverage(plan)}</h2>
            <p className="mt-1 text-sm text-muted-foreground capitalize">
              {plan.occasion} · {plan.locationLabel}
            </p>
            {/* Issue 2: accurate label */}
            <p className="mt-1 text-sm text-muted-foreground">{effectiveLabel}</p>
          </div>
          {isLocked && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Locked
            </span>
          )}
        </div>
      </div>

      {plan.assumption && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-500/10 px-4 py-3">
          <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-300">{plan.assumption}</p>
        </div>
      )}

      {adaptationNote && (
        <div className="flex items-start gap-3 rounded-2xl bg-blue-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-300">{adaptationNote}</p>
        </div>
      )}

      {plan.baseItems.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Shirt} title="Base outfit" />
          <div className="flex flex-col gap-3">{plan.baseItems.map((item,i) => <ItemRow key={i} item={item} />)}</div>
        </div>
      )}

      {plan.departureLayers && plan.departureLayers.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Layers} title="Wear when leaving" />
          <div className="flex flex-col gap-3">{plan.departureLayers.map((item,i) => <ItemRow key={i} item={item} />)}</div>
          {plan.adaptationHint && (
            <p className="mt-3 text-xs text-muted-foreground leading-snug">{plan.adaptationHint}</p>
          )}
        </div>
      )}

      {plan.carryLayers && plan.carryLayers.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Layers} title="Pack for later" />
          <div className="flex flex-col gap-3">{plan.carryLayers.map((item,i) => <ItemRow key={i} item={item} />)}</div>
        </div>
      )}

      {/* Safety fallback: v3 always has departureLayers/carryLayers; this path is unreachable
          for validated v3 plans but guards against future schema drift or unit-test mocks. */}
      {(!plan.departureLayers && !plan.carryLayers) && plan.removableLayers.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Layers} title="Bring for later" />
          <div className="flex flex-col gap-3">{plan.removableLayers.map((item,i) => <ItemRow key={i} item={item} />)}</div>
        </div>
      )}

      {plan.footwear.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Footprints} title="Footwear" />
          <div className="flex flex-col gap-3">{plan.footwear.map((item,i) => <ItemRow key={i} item={item} />)}</div>
        </div>
      )}

      {plan.accessories.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Umbrella} title="Accessories" />
          <div className="flex flex-col gap-3">{plan.accessories.map((item,i) => <ItemRow key={i} item={item} />)}</div>
        </div>
      )}

      {plan.timelineGuidance.length > 0 && (
        <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
          <SectionHeader icon={Clock} title="Timeline" />
          <div className="flex flex-col gap-3">
            {plan.timelineGuidance.map((g,i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-xs font-medium text-muted-foreground w-16 shrink-0 mt-0.5">
                  {formatHour(g.startTime)}
                </span>
                <p className="text-sm leading-snug">{g.instruction}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-3xl bg-foreground/[0.04] px-5 py-4">
        <SectionHeader icon={Info} title="Why this plan" />
        <p className="text-sm text-muted-foreground leading-relaxed">{plan.personalizationExplanation}</p>
      </div>

      {!isLocked && onLock && (
        <button type="button" onClick={onLock}
          className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background">
          <CheckCircle2 className="h-4 w-4" /> Use this plan
        </button>
      )}

      {isLocked && onCancelOrReplace && (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={onCancelOrReplace}
            className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground/[0.04] py-2.5 text-sm text-muted-foreground">
            <X className="h-4 w-4" /> Cancel outing
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Step = "form" | "loading" | "result" | "locked";

const OCCASIONS: { id: OutingOccasion; label: string }[] = [
  { id: "gym",     label: "Gym"           },
  { id: "college", label: "College"       },
  { id: "work",    label: "Work"          },
  { id: "casual",  label: "Casual outing" },
  { id: "event",   label: "Event"         },
  { id: "other",   label: "Other"         },
];

const OCCASION_DEFAULTS: Record<OutingOccasion, { activity: OutingActivity; context: OutingContext }> = {
  gym:     { activity: "active",   context: "mixed"   },
  college: { activity: "low",      context: "mixed"   },
  work:    { activity: "low",      context: "indoors" },
  casual:  { activity: "moderate", context: "mixed"   },
  event:   { activity: "low",      context: "indoors" },
  other:   { activity: "moderate", context: "mixed"   },
};

function PlanPage() {
  const { authLoading, uid }     = useAuthGuard();
  const entitlement              = useEntitlement();
  const wardrobeItems            = useWardrobe();
  const prefs                    = loadPrefs();
  const isPremium = !entitlement.loading && (entitlement as {active?:boolean}).active === true;

  const [occasion,      setOccasion]      = useState<OutingOccasion>("college");
  const [departureMode, setDepartureMode] = useState<"now"|"+1h"|"custom">("now");
  const [customDepart,  setCustomDepart]  = useState(nowIso());
  const [returnMode,    setReturnMode]    = useState<"before18"|"18-22"|"after22"|"custom"|"unknown">("before18");
  const [customReturn,  setCustomReturn]  = useState(todayAt(17, 0));
  const [activity,      setActivity]      = useState<OutingActivity>("low");
  const [context,       setContext]       = useState<OutingContext>("mixed");
  const [formError,     setFormError]     = useState<string|null>(null);

  const [step,         setStep]         = useState<Step>("form");
  const [draft,        setDraft]        = useState<OutingPlanRecommendation|null>(null);
  const [draftUid,     setDraftUid]     = useState<string|null>(null); // owner of the current draft
  const [lockedPlan,   setLockedPlan]   = useState<LockedPlan|null>(null);
  const [error,        setError]        = useState<string|null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [styleProfile,       setStyleProfile]       = useState<PersonalStyleProfile | null>(null);
  /** True only after the profile load has resolved (success or null result). */
  const [styleProfileLoaded, setStyleProfileLoaded] = useState(false);

  // Generation request ID — monotonically increasing, invalidated on UID/premium change
  const generationRequestIdRef = useRef(0);
  // Recheck in-flight token: {uid, planId} or null. Prevents boolean cross-user leakage.
  const recheckToken = useRef<{uid:string;planId:string}|null>(null);

  const effectiveDeparture: string = (() => {
    if (departureMode === "now")  return nowIso();
    if (departureMode === "+1h")  return addHoursToIso(nowIso(), 1);
    return customDepart;
  })();

  const effectiveReturn: string|null = (() => {
    if (returnMode === "unknown") return null;
    const d = dateOf(effectiveDeparture);
    if (returnMode === "before18") return `${d}T17:30`;
    if (returnMode === "18-22")    return `${d}T21:00`;
    if (returnMode === "after22")  return `${d}T23:30`;
    return customReturn;
  })();

  useEffect(() => {
    const def = OCCASION_DEFAULTS[occasion];
    setActivity(def.activity);
    setContext(def.context);
  }, [occasion]);

  // UID guard ref — checked after every async await to prevent stale-UID writes.
  const currentUidRef = useRef<string | null>(null);

  // On UID / premium change: immediately clear ALL account-scoped UI state,
  // then load the new account's plan and profile.
  // "cancelled" prevents promise callbacks from a prior UID resolving late.
  useEffect(() => {
    let cancelled = false;

    // Immediately clear every piece of account-scoped state before loading
    // the new user's data, preventing cross-account leakage.
    setLockedPlan(null);
    setDraft(null);
    setDraftUid(null);
    setStep("form");
    setError(null);
    setFormError(null);
    setRefreshing(false);
    setStyleProfile(null);
    setStyleProfileLoaded(false);
    // Invalidate any in-flight generation and recheck
    generationRequestIdRef.current += 1;
    recheckToken.current = null;

    if (!isPremium || !uid) {
      currentUidRef.current = null;
      return () => { cancelled = true; };
    }

    currentUidRef.current = uid;

    // Load the new account's relevant plan
    const p = outingPlanStore.getMostRelevantPlan(uid);
    if (p) { setLockedPlan(p); setStep("locked"); }

    // Load new account's style profile with cancellation guard
    loadStyleProfile(uid)
      .then(sp  => { if (!cancelled) setStyleProfile(sp); })
      .catch(()  => { if (!cancelled) setStyleProfile(null); })
      .finally(() => { if (!cancelled) setStyleProfileLoaded(true); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, uid]);

  // Recheck: uses recheckToken {uid, planId} instead of a bare boolean.
  // A stale finally block can only clear the token when the token still matches
  // the request it started — never a newer user's or plan's state.
  const doRecheck = useCallback(async (planId: string, uidVal: string) => {
    // Prevent concurrent rechecks for the SAME plan; different plans are fine
    if (recheckToken.current?.uid === uidVal && recheckToken.current?.planId === planId) return;
    const freshPlan = outingPlanStore.loadById(uidVal, planId);
    if (!freshPlan) return;
    if (!outingPlanStore.needsRecheck(freshPlan)) return;
    // Own the token before the first await
    recheckToken.current = { uid: uidVal, planId };
    // Only set refreshing if we're the current user
    if (currentUidRef.current === uidVal) setRefreshing(true);
    const recorded = outingPlanStore.recordAttempt(uidVal, planId);
    if (recorded && currentUidRef.current === uidVal) setLockedPlan(recorded);
    try {
      const snap = freshPlan.snapshot;
      const result = await fetchOutingForecast(
        snap.locationLat, snap.locationLon,
        snap.coverageStart, snap.coverageEnd,
      );
      // Guard: token and UID must still match after the await
      if (result.ok &&
          currentUidRef.current === uidVal &&
          recheckToken.current?.uid === uidVal &&
          recheckToken.current?.planId === planId) {
        const note = computeAdaptationNote(
          freshPlan,
          result.slice.rawMinApparentC,
          result.slice.rawMaxApparentC,
          result.slice.peakPrecipProb,
          result.slice.hasRain,
          result.slice.slots.some(s => RAIN_CODES.has(s.code)),
        );
        const updated = outingPlanStore.updateAdaptation(uidVal, planId, note);
        if (updated && currentUidRef.current === uidVal) setLockedPlan(updated);
      }
    } catch { /* non-fatal */ }
    finally {
      // Only clear token and refreshing if this request still owns the token
      if (recheckToken.current?.uid === uidVal && recheckToken.current?.planId === planId) {
        recheckToken.current = null;
        if (currentUidRef.current === uidVal) setRefreshing(false);
      }
    }
  }, []);

  // Visibility + focus recheck — plan page only (issue 2: pass ID not stale object)
  useEffect(() => {
    if (!lockedPlan || step !== "locked" || !uid) return;
    const planId = lockedPlan.id;
    const uidVal = uid;

    // Immediate check on mount
    doRecheck(planId, uidVal);

    const onVisible = () => {
      if (document.visibilityState === "visible") doRecheck(planId, uidVal);
    };
    const onFocus = () => doRecheck(planId, uidVal);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedPlan?.id, step, uid]);

  function validate(): string|null {
    // Issue 17: reject materially past departure (> 30 min in the past)
    const depMs  = parseIsoLocal(effectiveDeparture).getTime();
    const now30  = Date.now() - 30 * 60_000;
    if (departureMode === "custom" && depMs < now30) {
      return "Departure time is in the past. Please choose a current or future time.";
    }
    if (effectiveReturn !== null && effectiveReturn <= effectiveDeparture) {
      return "Return time must be later than departure time.";
    }
    return null;
  }

  async function generate() {
    const err = validate();
    if (err) { setFormError(err); return; }
    // Capture ownership before any await — both UID and a monotonic request ID.
    // If either changes before we resume, all post-await writes are discarded.
    const capturedUid = uid;
    if (!capturedUid) return;
    generationRequestIdRef.current += 1;
    const capturedRequestId = generationRequestIdRef.current;

    setFormError(null);
    setError(null);
    setStep("loading");

    let retIso = effectiveReturn;
    let assumption: string|undefined;
    if (!retIso) {
      retIso = addHoursToIso(effectiveDeparture, 8);
      assumption = "Return time isn't set, so this plan covers the next 8 hours.";
    }

    const city = prefs.city ?? CANADIAN_CITIES[0];

    let forecastResult: Awaited<ReturnType<typeof fetchOutingForecast>>;
    try {
      forecastResult = await fetchOutingForecast(
        city.lat, city.lon, effectiveDeparture, retIso,
      );
    } catch {
      // Guard: only write if UID and request-ID still match
      if (currentUidRef.current === capturedUid &&
          generationRequestIdRef.current === capturedRequestId) {
        setError("Could not fetch the forecast. Please check your connection and try again.");
        setStep("form");
      }
      return;
    }

    // Guard: discard results if user or request changed since the await
    if (currentUidRef.current !== capturedUid ||
        generationRequestIdRef.current !== capturedRequestId) {
      return;
    }

    if (!forecastResult.ok) {
      if (forecastResult.reason === "out_of_range") {
        setError(
          `The selected interval is outside the available forecast.\n` +
          `Available: ${formatIsoDateTime(forecastResult.availableStart)} – ` +
          `${formatIsoDateTime(forecastResult.availableEnd)}.\n` +
          `Please choose a departure within that window.`
        );
      } else {
        setError("Could not fetch the forecast. Please check your connection and try again.");
      }
      setStep("form");
      return;
    }

    const input: OutingInput = {
      occasion, departureTime: effectiveDeparture, returnTime: effectiveReturn,
      activity, context, locationLabel: city.name,
    };

    const rec = planOuting(input, forecastResult.slice, wardrobeItems, prefs, retIso, styleProfile);
    if (assumption) {
      (rec as OutingPlanRecommendation & {assumption?:string}).assumption = assumption;
    }
    // Guard: one final check before writing React state
    if (currentUidRef.current === capturedUid &&
        generationRequestIdRef.current === capturedRequestId) {
      setDraft(rec);
      setDraftUid(capturedUid);
      setStep("result");
    }
  }

  function lockDraft() {
    // Guard: only commit if the draft was generated for the current user
    if (!draft || !uid || draftUid !== uid) return;
    const priorId = (lockedPlan && lockedPlan.uid === uid) ? lockedPlan.id : null;
    const committed = outingPlanStore.commitPlan(uid, draft, priorId);
    setLockedPlan(committed);
    setDraft(null);
    setDraftUid(null);
    setStep("locked");
  }

  function startReplace() {
    if (!lockedPlan || !uid || lockedPlan.uid !== uid) return;
    if (!window.confirm(
      "This will generate a new plan draft. Your current plan stays locked until you confirm the new one."
    )) return;
    setDraft(null);
    setDraftUid(null);
    setStep("form");
  }

  async function manualRefresh() {
    if (!lockedPlan || !uid || lockedPlan.uid !== uid) return;
    await doRecheck(lockedPlan.id, uid);
  }

  function cancelPlan() {
    if (!lockedPlan || !uid || lockedPlan.uid !== uid) return;
    outingPlanStore.cancelPlan(uid, lockedPlan.id);
    setLockedPlan(null);
    setStep("form");
  }

  if (authLoading || entitlement.loading) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!isPremium) {
    return (
      <AppShell>
        <div className="px-4 py-6">
          <Link {...{to: "/" as any}} className="flex items-center gap-1 text-sm text-muted-foreground mb-6">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
          <UpgradeTeaser />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link {...{to: "/" as any}} className="text-muted-foreground" aria-label="Back to home">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex-1 text-xl font-bold">Outing Planner</h1>
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Crown className="h-3 w-3" /> Premium
          </span>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3 whitespace-pre-line" role="alert">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {step === "loading" && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            <p className="text-sm text-muted-foreground">Fetching forecast for your outing…</p>
          </div>
        )}

        {step === "locked" && lockedPlan && lockedPlan.uid === uid && (
          <>
            <PlanResult
              plan={lockedPlan.snapshot}
              isLocked
              adaptationNote={lockedPlan.adaptationNote}
              onCancelOrReplace={cancelPlan}
            />
            <div className="flex flex-col gap-2 mt-2">
              <button type="button" onClick={startReplace}
                className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground/[0.06] py-3 text-sm font-medium text-foreground">
                <RefreshCw className="h-4 w-4" /> Generate new plan
              </button>
              <button type="button" onClick={manualRefresh} disabled={refreshing}
                className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground/[0.04] py-2.5 text-sm text-muted-foreground disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Checking forecast…" : "Recheck forecast"}
              </button>
            </div>
          </>
        )}

        {step === "result" && draft && draftUid === uid && (
          <PlanResult plan={draft} isLocked={false} onLock={lockDraft} />
        )}

        {step === "form" && (
          <div className="flex flex-col gap-6 pb-8">
            <section>
              <label className="mb-2 block text-sm font-semibold">What's the occasion?</label>
              <div className="flex flex-wrap gap-2">
                {OCCASIONS.map(({ id, label }) => (
                  <Chip key={id} label={label} selected={occasion===id} onClick={() => setOccasion(id)} />
                ))}
              </div>
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">Location</label>
              <div className="flex items-center gap-2 rounded-2xl bg-foreground/[0.04] px-4 py-3">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">{prefs.city?.name ?? "Current location"}</span>
                <Link {...{to: "/preferences" as any}} className="ml-auto text-xs text-primary underline underline-offset-2 shrink-0">
                  Change
                </Link>
              </div>
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">When are you leaving?</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {([["now","Now"],["+1h","In 1 hour"],["custom","Choose time"]] as [typeof departureMode,string][])
                  .map(([mode,label]) => (
                  <Chip key={mode} label={label} selected={departureMode===mode}
                    onClick={() => setDepartureMode(mode)} />
                ))}
              </div>
              {departureMode === "custom" && (
                <input type="datetime-local" value={customDepart}
                  onChange={e => setCustomDepart(e.target.value)}
                  className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  aria-label="Departure date and time" />
              )}
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">When do you expect to be back?</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {([
                  ["before18","Before 6 PM"],["18-22","6–10 PM"],
                  ["after22","After 10 PM"],["custom","Choose time"],["unknown","Not sure"],
                ] as [typeof returnMode,string][]).map(([mode,label]) => (
                  <Chip key={mode} label={label} selected={returnMode===mode} onClick={() => setReturnMode(mode)} />
                ))}
              </div>
              {returnMode === "custom" && (
                <input type="datetime-local" value={customReturn}
                  onChange={e => setCustomReturn(e.target.value)}
                  className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  aria-label="Return date and time" />
              )}
              {returnMode === "unknown" && (
                <p className="text-xs text-muted-foreground mt-1">We'll plan for 8 hours from when you leave.</p>
              )}
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">Where will you spend most of your time?</label>
              <div className="flex flex-wrap gap-2">
                {([["indoors","Mostly indoors"],["mixed","Mixed"],["outdoors","Mostly outdoors"]] as [OutingContext,string][])
                  .map(([id,label]) => (
                  <Chip key={id} label={label} selected={context===id} onClick={() => setContext(id)} />
                ))}
              </div>
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">Activity level</label>
              <div className="flex flex-wrap gap-2">
                {([["low","Low"],["moderate","Moderate"],["active","Active"]] as [OutingActivity,string][])
                  .map(([id,label]) => (
                  <Chip key={id} label={label} selected={activity===id} onClick={() => setActivity(id)} />
                ))}
              </div>
            </section>

            {formError && (
              <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3" role="alert">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            <button type="button" onClick={generate}
              disabled={!styleProfileLoaded}
            className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50 disabled:cursor-not-allowed">
              {!styleProfileLoaded ? "Loading your preferences…" : "Build my outfit plan"}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
