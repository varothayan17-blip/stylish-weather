/**
 * FeedbackSheet.tsx — Reusable feedback bottom sheet / modal.
 *
 * Opened from:
 *   1. Hero overflow menu → "Report weather"
 *   2. Settings → Help & Feedback → Send feedback
 *
 * Privacy: no exact GPS coordinates, no wardrobe data, no auth tokens.
 * Diagnostics contain only display-level state passed by the caller.
 */
import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, Send, Check, AlertCircle, Loader2 } from "lucide-react";
import {
  FEEDBACK_CATEGORIES,
  WEATHER_ISSUE_TYPES,
  CATEGORY_LABELS,
  WEATHER_ISSUE_LABELS,
  MESSAGE_MIN,
  MESSAGE_MAX,
  type FeedbackCategory,
  type WeatherIssueType,
  type FeedbackDiagnostics,
} from "@/lib/feedback-types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select a category (e.g. "weather-incorrect" from hero menu). */
  initialCategory?: FeedbackCategory;
  /** Diagnostic snapshot from the current hero state. */
  diagnostics?: FeedbackDiagnostics | null;
}

type Phase = "form" | "submitting" | "success" | "error";

export function FeedbackSheet({ isOpen, onClose, initialCategory, diagnostics }: Props) {
  const [category,         setCategory]         = useState<FeedbackCategory | "">(initialCategory ?? "");
  const [weatherIssueType, setWeatherIssueType] = useState<WeatherIssueType | "">("");
  const [message,          setMessage]          = useState("");
  const [contactEmail,     setContactEmail]      = useState("");
  const [mayContact,       setMayContact]        = useState(false);
  const [phase,            setPhase]             = useState<Phase>("form");
  const [errorMsg,         setErrorMsg]          = useState<string | null>(null);
  const [fieldErrors,      setFieldErrors]       = useState<Record<string, string>>({});

  const sheetRef       = useRef<HTMLDivElement>(null);
  const firstFocusRef  = useRef<HTMLButtonElement>(null);
  const triggerRef     = useRef<HTMLElement | null>(null);

  // Remember which element triggered the sheet so we can return focus on close
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      // Reset form when opened with a new category
      setCategory(initialCategory ?? "");
      setWeatherIssueType("");
      setPhase("form");
      setErrorMsg(null);
      setFieldErrors({});
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen, initialCategory]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!category) errors.category = "Please select a category.";
    const trimmed = message.trim();
    if (trimmed.length < MESSAGE_MIN) errors.message = `Please enter at least ${MESSAGE_MIN} characters.`;
    if (trimmed.length > MESSAGE_MAX) errors.message = `Message must not exceed ${MESSAGE_MAX} characters.`;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (phase === "submitting") return;
    if (!validate()) return;
    setPhase("submitting");
    setErrorMsg(null);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const auth = await getFirebaseAuth();
      const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      if (!idToken) throw new Error("Not signed in");

      const payload = {
        category,
        weatherIssueType: category === "weather-incorrect" && weatherIssueType ? weatherIssueType : null,
        message: message.trim(),
        contactEmail: contactEmail.trim() || null,
        mayContact,
        diagnostics: category === "weather-incorrect" ? (diagnostics ?? null) : null,
      };

      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Server error (${resp.status})`);
      }
      setPhase("success");
    } catch (err: unknown) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (!isOpen) return null;

  const trimmedLen = message.trim().length;
  const isWeather  = category === "weather-incorrect";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-background shadow-2xl
                   max-h-[92dvh] overflow-y-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {/* Drag handle (mobile) */}
        <div aria-hidden className="mx-auto mt-3 h-1 w-10 rounded-full bg-border sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-lg font-semibold text-foreground">Send feedback</h2>
          <button
            ref={firstFocusRef}
            onClick={onClose}
            aria-label="Close feedback"
            className="press -m-2 rounded-full p-2 text-muted-foreground hover:text-foreground
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pb-8 space-y-5">
          {/* ── Success state ─────────────────────────────────────────────── */}
          {phase === "success" && (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-4 py-8 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-7 w-7 text-primary" aria-hidden />
              </div>
              <p className="text-base font-semibold text-foreground">
                Thank you — your feedback was sent.
              </p>
              <p className="text-sm text-muted-foreground">
                We appreciate you taking the time to help us improve Aeruvo.
              </p>
              <button
                onClick={onClose}
                className="mt-2 rounded-2xl bg-foreground px-8 py-3 text-sm font-semibold
                           text-background focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Done
              </button>
            </div>
          )}

          {/* ── Form state ────────────────────────────────────────────────── */}
          {(phase === "form" || phase === "submitting" || phase === "error") && (
            <>
              <p className="text-sm text-muted-foreground">
                Help us improve Aeruvo. You can report a weather issue, share an idea or tell us about a problem.
              </p>

              {/* Category */}
              <div>
                <label
                  htmlFor="fb-category"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Category <span aria-hidden className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <select
                    id="fb-category"
                    value={category}
                    onChange={e => { setCategory(e.target.value as FeedbackCategory); setWeatherIssueType(""); }}
                    aria-required="true"
                    aria-describedby={fieldErrors.category ? "fb-category-err" : undefined}
                    aria-invalid={!!fieldErrors.category}
                    className="glass-card w-full appearance-none rounded-2xl px-4 py-3 pr-10 text-sm
                               focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                    disabled={phase === "submitting"}
                  >
                    <option value="">Select a category…</option>
                    {FEEDBACK_CATEGORIES.map(c => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
                {fieldErrors.category && (
                  <p id="fb-category-err" role="alert" className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {fieldErrors.category}
                  </p>
                )}
              </div>

              {/* Weather issue type — only shown for weather-incorrect */}
              {isWeather && (
                <div>
                  <label
                    htmlFor="fb-wit"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    What seems incorrect?
                  </label>
                  <div className="relative">
                    <select
                      id="fb-wit"
                      value={weatherIssueType}
                      onChange={e => setWeatherIssueType(e.target.value as WeatherIssueType)}
                      className="glass-card w-full appearance-none rounded-2xl px-4 py-3 pr-10 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                      disabled={phase === "submitting"}
                    >
                      <option value="">Select an issue…</option>
                      {WEATHER_ISSUE_TYPES.map(t => (
                        <option key={t} value={t}>{WEATHER_ISSUE_LABELS[t]}</option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              )}

              {/* Message */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label
                    htmlFor="fb-message"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Message <span aria-hidden className="text-destructive">*</span>
                  </label>
                  <span
                    aria-live="polite"
                    aria-label={`${trimmedLen} of ${MESSAGE_MAX} characters`}
                    className={`text-xs tabular-nums ${trimmedLen > MESSAGE_MAX ? "text-destructive" : "text-muted-foreground/60"}`}
                  >
                    {trimmedLen}/{MESSAGE_MAX}
                  </span>
                </div>
                <textarea
                  id="fb-message"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Describe the issue or idea…"
                  aria-required="true"
                  aria-describedby={fieldErrors.message ? "fb-message-err" : undefined}
                  aria-invalid={!!fieldErrors.message}
                  disabled={phase === "submitting"}
                  className="glass-card w-full resize-none rounded-2xl px-4 py-3 text-sm
                             placeholder:text-muted-foreground/60 focus:outline-none
                             focus:ring-2 focus:ring-primary disabled:opacity-60"
                />
                {fieldErrors.message && (
                  <p id="fb-message-err" role="alert" className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {fieldErrors.message}
                  </p>
                )}
              </div>

              {/* Contact email */}
              <div>
                <label
                  htmlFor="fb-email"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Contact email <span className="font-normal text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  id="fb-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="your@email.com"
                  disabled={phase === "submitting"}
                  className="glass-card w-full rounded-2xl px-4 py-3 text-sm
                             placeholder:text-muted-foreground/60 focus:outline-none
                             focus:ring-2 focus:ring-primary disabled:opacity-60"
                />
              </div>

              {/* Permission to contact */}
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={mayContact}
                  onChange={e => setMayContact(e.target.checked)}
                  disabled={phase === "submitting"}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-primary"
                />
                <span className="text-sm text-muted-foreground">
                  I'm open to being contacted about this feedback.
                </span>
              </label>

              {/* Privacy disclosure */}
              <p className="rounded-2xl bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                {isWeather
                  ? "Your report may include the current weather state and general location shown in Aeruvo so we can investigate the issue. Exact GPS coordinates are not included."
                  : "Your feedback is used only to improve Aeruvo. We don't share it with third parties."}
              </p>

              {/* Server error */}
              {phase === "error" && errorMsg && (
                <p role="alert" className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle aria-hidden className="h-4 w-4 shrink-0" />
                  {errorMsg}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  disabled={phase === "submitting"}
                  className="flex-1 rounded-2xl border border-border py-3 text-sm font-medium
                             text-muted-foreground hover:text-foreground disabled:opacity-50
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={phase === "submitting"}
                  aria-live="polite"
                  aria-label={phase === "submitting" ? "Sending feedback…" : "Send feedback"}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-foreground
                             py-3 text-sm font-semibold text-background disabled:opacity-60
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {phase === "submitting"
                    ? <><Loader2 aria-hidden className="h-4 w-4 animate-spin" />Sending…</>
                    : <><Send aria-hidden className="h-4 w-4" />Send feedback</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
