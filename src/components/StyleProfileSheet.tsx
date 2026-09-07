/**
 * StyleProfileSheet.tsx — Multi-step Personal Style Profile wizard.
 *
 * Opens as a premium bottom sheet from Settings.
 * Steps: layering → style → commute → sensitivities → activities
 * Focus trap, Escape closes, focus restored on close.
 * Never closes on failed save — preserves all entered selections.
 */
import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Check, Loader2, AlertCircle } from "lucide-react";
import {
  LAYERING_PREFERENCES,
  STYLE_PREFERENCES,
  COMMUTE_MODES,
  WEATHER_SENSITIVITIES,
  COMMON_ACTIVITIES,
  DEFAULT_STYLE_PROFILE,
  type PersonalStyleProfile,
  type LayeringPreference,
  type StylePreference,
  type CommuteMode,
  type WeatherSensitivity,
  type CommonActivity,
} from "@/lib/styleProfile";

const TOTAL_STEPS = 5;

interface Props {
  isOpen:          boolean;
  onClose:         () => void;
  initialProfile:  PersonalStyleProfile | null;
  onSave:          (profile: PersonalStyleProfile) => Promise<void>;
}

type Phase = "form" | "saving" | "success" | "error";

const LAYERING_LABELS: Record<LayeringPreference, { label: string; desc: string }> = {
  minimal:  { label: "Minimal layers",   desc: "Keep it simple — one weather-appropriate piece" },
  balanced: { label: "Balanced",          desc: "Aeruvo picks what the weather calls for" },
  prefer:   { label: "Prefer layers",     desc: "I like having a removable layer on hand" },
};

const STYLE_LABELS: Record<StylePreference, string> = {
  casual:     "Casual",
  sporty:     "Sporty",
  streetwear: "Streetwear",
  minimal:    "Minimal",
  smart:      "Smart",
  formal:     "Formal",
};

const COMMUTE_LABELS: Record<CommuteMode, { label: string; desc: string }> = {
  walk:    { label: "Walk",    desc: "I walk most places" },
  transit: { label: "Transit", desc: "Bus, subway or train" },
  drive:   { label: "Drive",   desc: "Mostly by car" },
  mixed:   { label: "Mixed",   desc: "It varies" },
};

const SENSITIVITY_LABELS: Record<WeatherSensitivity, string> = {
  low:    "Low",
  normal: "Normal",
  high:   "High",
};

const ACTIVITY_LABELS: Record<CommonActivity, string> = {
  college: "College",
  work:    "Work",
  gym:     "Gym",
  casual:  "Casual / errands",
  events:  "Events / going out",
};

export function StyleProfileSheet({ isOpen, onClose, initialProfile, onSave }: Props) {
  const defaults = initialProfile ?? DEFAULT_STYLE_PROFILE;

  const [step,            setStep]            = useState(1);
  const [layering,        setLayering]        = useState<LayeringPreference>(defaults.layeringPreference);
  const [styles,          setStyles]          = useState<StylePreference[]>(defaults.stylePreferences);
  const [commute,         setCommute]         = useState<CommuteMode>(defaults.commuteMode);
  const [windSensitivity, setWindSensitivity] = useState<WeatherSensitivity>(defaults.windSensitivity);
  const [rainTolerance,   setRainTolerance]   = useState<WeatherSensitivity>(defaults.rainTolerance);
  const [activities,      setActivities]      = useState<CommonActivity[]>(defaults.commonActivities);
  const [phase,           setPhase]           = useState<Phase>("form");
  const [errorMsg,        setErrorMsg]        = useState<string | null>(null);

  const sheetRef      = useRef<HTMLDivElement>(null);
  const closeRef      = useRef<HTMLButtonElement>(null);
  const triggerRef    = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      const p = initialProfile ?? DEFAULT_STYLE_PROFILE;
      setLayering(p.layeringPreference);
      setStyles(p.stylePreferences);
      setCommute(p.commuteMode);
      setWindSensitivity(p.windSensitivity);
      setRainTolerance(p.rainTolerance);
      setActivities(p.commonActivities);
      setStep(1);
      setPhase("form");
      setErrorMsg(null);
      setTimeout(() => closeRef.current?.focus(), 60);
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen, initialProfile]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const el = sheetRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input,[tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  function toggleStyle(s: StylePreference) {
    setStyles(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }
  function toggleActivity(a: CommonActivity) {
    setActivities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  async function handleSave() {
    if (phase === "saving") return;
    setPhase("saving");
    setErrorMsg(null);
    const now = Date.now();
    const profile: PersonalStyleProfile = {
      layeringPreference: layering,
      stylePreferences:   styles.length > 0 ? styles : ["casual"],
      commuteMode:        commute,
      windSensitivity,
      rainTolerance,
      commonActivities:   activities,
      completedAt:        now,
      updatedAt:          now,
      version:            1,
    };
    try {
      await onSave(profile);
      setPhase("success");
    } catch (err: unknown) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (!isOpen) return null;

  const isLastStep = step === TOTAL_STEPS;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Personal Style Profile"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden onClick={onClose} />

      <div
        ref={sheetRef}
        className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-background shadow-2xl max-h-[92dvh] overflow-y-auto"
      >
        <div aria-hidden className="mx-auto mt-3 h-1 w-10 rounded-full bg-border sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Personal Style Profile</h2>
            {phase === "form" || phase === "saving" || phase === "error" ? (
              <p className="text-xs text-muted-foreground mt-0.5">Step {step} of {TOTAL_STEPS}</p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close style profile"
            className="press -m-2 rounded-full p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar */}
        {(phase === "form" || phase === "saving" || phase === "error") && (
          <div className="px-6 mb-4">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="px-6 pb-8 space-y-5">
          {/* ── Success ──────────────────────────────────────────────────── */}
          {phase === "success" && (
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-7 w-7 text-primary" aria-hidden />
              </div>
              <p className="text-base font-semibold text-foreground">Style profile saved.</p>
              <p className="text-sm text-muted-foreground">
                Aeruvo will use your preferences to personalize outfit recommendations. You can update this any time in Settings.
              </p>
              <button onClick={onClose}
                className="mt-2 rounded-2xl bg-foreground px-8 py-3 text-sm font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Done
              </button>
            </div>
          )}

          {/* ── Form steps ───────────────────────────────────────────────── */}
          {(phase === "form" || phase === "saving" || phase === "error") && (
            <>
              {/* Step 1 — Layering */}
              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">How do you like to dress for changing weather?</p>
                  <p className="text-xs text-muted-foreground">You can update this any time from Settings.</p>
                  <div className="space-y-2">
                    {LAYERING_PREFERENCES.map(lp => (
                      <button key={lp} onClick={() => setLayering(lp)}
                        aria-pressed={layering === lp}
                        className={`glass-card w-full rounded-2xl p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                          ${layering === lp ? "ring-2 ring-primary bg-primary/5" : ""}`}>
                        <p className="text-sm font-semibold text-foreground">{LAYERING_LABELS[lp].label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{LAYERING_LABELS[lp].desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2 — Style */}
              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Which styles feel most like you?</p>
                  <p className="text-xs text-muted-foreground">Pick as many as you like.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLE_PREFERENCES.map(sp => {
                      const active = styles.includes(sp);
                      return (
                        <button key={sp} onClick={() => toggleStyle(sp)}
                          aria-pressed={active}
                          className={`glass-card rounded-2xl px-4 py-3 text-sm font-medium text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                            ${active ? "ring-2 ring-primary bg-primary/5 text-primary" : "text-foreground"}`}>
                          {active && <Check className="inline h-3.5 w-3.5 mr-1.5" aria-hidden />}
                          {STYLE_LABELS[sp]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 3 — Commute */}
              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">How do you usually get around?</p>
                  <p className="text-xs text-muted-foreground">This helps Aeruvo account for outdoor exposure.</p>
                  <div className="space-y-2">
                    {COMMUTE_MODES.map(cm => (
                      <button key={cm} onClick={() => setCommute(cm)}
                        aria-pressed={commute === cm}
                        className={`glass-card w-full rounded-2xl p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                          ${commute === cm ? "ring-2 ring-primary bg-primary/5" : ""}`}>
                        <p className="text-sm font-semibold text-foreground">{COMMUTE_LABELS[cm].label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{COMMUTE_LABELS[cm].desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4 — Sensitivities */}
              {step === 4 && (
                <div className="space-y-5">
                  <p className="text-sm font-medium text-foreground">What affects your comfort?</p>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Wind sensitivity</p>
                      <div className="flex gap-2">
                        {WEATHER_SENSITIVITIES.map(ws => (
                          <button key={ws} onClick={() => setWindSensitivity(ws)}
                            aria-pressed={windSensitivity === ws}
                            className={`flex-1 glass-card rounded-2xl py-2.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                              ${windSensitivity === ws ? "ring-2 ring-primary bg-primary/5 text-primary" : "text-foreground"}`}>
                            {SENSITIVITY_LABELS[ws]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Rain tolerance</p>
                      <div className="flex gap-2">
                        {WEATHER_SENSITIVITIES.map(rt => (
                          <button key={rt} onClick={() => setRainTolerance(rt)}
                            aria-pressed={rainTolerance === rt}
                            className={`flex-1 glass-card rounded-2xl py-2.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                              ${rainTolerance === rt ? "ring-2 ring-primary bg-primary/5 text-primary" : "text-foreground"}`}>
                            {SENSITIVITY_LABELS[rt]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5 — Activities */}
              {step === 5 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Where do you dress for most often?</p>
                  <p className="text-xs text-muted-foreground">Your selections help personalize recommendations in a future update.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {COMMON_ACTIVITIES.map(act => {
                      const active = activities.includes(act);
                      return (
                        <button key={act} onClick={() => toggleActivity(act)}
                          aria-pressed={active}
                          className={`glass-card rounded-2xl px-4 py-3 text-sm font-medium text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                            ${active ? "ring-2 ring-primary bg-primary/5 text-primary" : "text-foreground"}`}>
                          {active && <Check className="inline h-3.5 w-3.5 mr-1.5" aria-hidden />}
                          {ACTIVITY_LABELS[act]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Error */}
              {phase === "error" && errorMsg && (
                <p role="alert" className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle aria-hidden className="h-4 w-4 shrink-0" />
                  {errorMsg}
                </p>
              )}

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                {step > 1 && (
                  <button onClick={() => setStep(s => s - 1)}
                    disabled={phase === "saving"}
                    aria-label="Back"
                    className="flex items-center gap-1 rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <ChevronLeft className="h-4 w-4" aria-hidden /> Back
                  </button>
                )}
                {!isLastStep ? (
                  <button onClick={() => setStep(s => s + 1)}
                    disabled={phase === "saving"}
                    className="flex flex-1 items-center justify-center gap-1 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    Continue <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button onClick={handleSave}
                    disabled={phase === "saving"}
                    aria-live="polite"
                    aria-label={phase === "saving" ? "Saving…" : "Save style profile"}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {phase === "saving"
                      ? <><Loader2 aria-hidden className="h-4 w-4 animate-spin" />Saving…</>
                      : "Save profile"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
