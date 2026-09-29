/**
 * ScanConsentSheet.tsx — One-time AI scan setup sheet.
 *
 * Shown the first time an authenticated user taps "Set up AI scan".
 * After confirmation the sheet is never shown again for the same UID
 * (unless the schema version changes, the UID changes, or consent is revoked).
 *
 * Safety guarantees preserved:
 *  - Under-15 is explicitly shown and permanently blocked from AI scanning.
 *    The UI displays "Under 15" as a selectable option that reveals a calm
 *    refusal message and "Add manually instead". No server request is ever
 *    made, and no consent record is ever stored for under-15 users.
 *  - Minimum server age of 15 preserved: ScannerAgeBand server type remains
 *    "15-17" | "18-plus". The local AgeChoice type is UI-only.
 *  - 15–17: guardian-permission checkbox is REQUIRED to proceed.
 *  - "Add manually instead" is always available.
 *  - Server-side acknowledgement (`/api/wardrobe/acknowledge`) is called
 *    AFTER the user confirms here, so server-side enforcement remains intact.
 *  - No API key in client bundle.
 *  - No image is sent to Anthropic until server ack is confirmed and all
 *    local safety checks (localDetector) pass — that ordering is in AddClothingSheet.
 *  - WARDROBE_AI_SCANNING_ENABLED is not changed here.
 *
 * Ownership guards (item 5):
 *  - submitServerAck receives expectedUid and verifies auth.currentUser.uid
 *    matches before obtaining an ID token or sending a request.
 *  - After every awaited operation the current UID is re-verified before
 *    saving consent, calling onComplete, showing errors or closing the sheet.
 *  - A requestId counter ensures stale responses from a previous open cannot
 *    update the current open's state.
 *
 * State reset (item 3):
 *  - key={uid} on the component resets all useState on uid change.
 *  - An effect keyed on [open, uid] resets internal state when reopened or
 *    when the uid changes without unmounting.
 *
 * Photo retention disclosure (item 10):
 *  - Uses three-sentence disclosure: Aeruvo claim (proven by handler comments),
 *    plus explicit statement that Anthropic processes under its Privacy Policy.
 *  - Does NOT claim Anthropic retains no data or has a special data-handling agreement.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PenLine, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { ScannerAgeBand } from "@/lib/wardrobe-types";
import { getUid } from "@/lib/auth";
import { saveConsent } from "@/lib/scanConsentStore";
import { submitServerAck } from "@/lib/scanConsentApi";

// ── Local age-choice type (UI only — never sent to server) ─────────────────
// The server ScannerAgeBand type remains "15-17" | "18-plus".
// "under-15" is a UI-only sentinel that blocks submission.
type AgeChoice = "under-15" | "15-17" | "18-plus";

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  uid: string; // UID of the authenticated user requesting setup
  onComplete: () => void; // consent saved; proceed to photo picker
  onManual: () => void; // user chose "Add manually instead"
  onClose: () => void; // dismissed without completing
}

/**
 * ScanConsentSheet
 *
 * Rendered with key={uid} by the parent so React unmounts and remounts
 * this component whenever the uid changes, resetting all useState.
 * An internal effect additionally resets state when open changes to true
 * (reopening after a close without uid change).
 */
export function ScanConsentSheet({ open, uid, onComplete, onManual, onClose }: Props) {
  const [ageChoice, setAgeChoice] = useState<AgeChoice | null>(null);
  const [guardianChecked, setGuardianChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoInfoOpen, setPhotoInfoOpen] = useState(false);

  // requestId guards against stale async responses from a prior open, close, or unmount.
  // Incremented on:
  //   - open → true  (new open)
  //   - open → false (close)
  //   - uid change   (via [open, uid] dep)
  //   - unmount      (cleanup function)
  const requestIdRef = useRef(0);

  // Reset internal state when the sheet is opened or closed, or when uid changes.
  // Incrementing requestIdRef on close (open→false) ensures that any in-flight
  // submission from the previous open cannot call setError/setSubmitting/onComplete.
  useEffect(() => {
    // Invalidate in-flight requests on every open/close transition and uid change
    requestIdRef.current += 1;

    if (open) {
      setAgeChoice(null);
      setGuardianChecked(false);
      setSubmitting(false);
      setError(null);
      setPhotoInfoOpen(false);
    }

    // Also invalidate on unmount
    return () => {
      requestIdRef.current += 1;
    };
  }, [open, uid]);

  // Whether the primary button should be enabled
  const canSubmit =
    ageChoice !== null &&
    ageChoice !== "under-15" &&
    (ageChoice === "18-plus" || guardianChecked) &&
    !submitting;

  async function handleSubmit() {
    if (!ageChoice || ageChoice === "under-15") return;
    if (ageChoice === "15-17" && !guardianChecked) {
      setError("Please confirm permission from a parent or guardian.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Snapshot request ID and intended UID at start of async flow
    const myRequestId = requestIdRef.current;
    const intendedUid = uid;

    try {
      // 1. Server-side acknowledgement (submitServerAck checks uid at 4 points)
      const serverRes = await submitServerAck(
        intendedUid,
        ageChoice as ScannerAgeBand,
        ageChoice === "15-17",
      );

      // Stale-response guard: bail if a newer open/close/unmount started
      if (requestIdRef.current !== myRequestId) return;

      // uid_changed means the account switched during the request — bail silently
      if (!serverRes.ok && serverRes.reason === "uid_changed") return;

      const currentUid = await getUid();
      if (requestIdRef.current !== myRequestId) return;
      if (currentUid !== intendedUid) {
        // No UI update — the component will be reset by the parent
        return;
      }

      if (!serverRes.ok) {
        if (requestIdRef.current !== myRequestId) return;
        setError(
          (serverRes as { ok: false; error?: string }).error ?? "Could not save. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      // 2. Client-side consent record (with async ownership guard)
      const saved = await saveConsent(intendedUid, ageChoice as ScannerAgeBand, getUid);

      // Final stale-response guard
      if (requestIdRef.current !== myRequestId) return;
      const finalUid = await getUid();
      if (finalUid !== intendedUid) return;

      if (!saved.ok) {
        if (saved.reason === "uid_changed") {
          // Account changed mid-flow — do not proceed
          setError("Account changed. Please sign in again and retry.");
          setSubmitting(false);
          return;
        }
        // Storage error — server ack succeeded so we can still proceed,
        // but log the issue (next open will re-check server)
        console.warn("scanConsentStore: localStorage write failed; server ack succeeded");
      }

      onComplete();
    } catch {
      if (requestIdRef.current !== myRequestId) return;
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !submitting) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[2rem] p-5 pb-[env(safe-area-inset-bottom,1.25rem)] sm:mb-6 sm:rounded-[2rem]"
        // Prevent closing via Escape while submitting
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault();
        }}
        aria-describedby="consent-description"
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <SheetHeader className="mb-5 items-start text-left">
          <SheetTitle className="text-lg font-semibold tracking-tight">
            Set up AI clothing scan
          </SheetTitle>
          <SheetDescription
            id="consent-description"
            className="mt-0.5 text-sm text-muted-foreground"
          >
            A quick one-time check—then you can scan normally.
          </SheetDescription>
        </SheetHeader>

        {/* ── Error banner ────────────────────────────────────────────── */}
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {/* ── Age section ─────────────────────────────────────────────── */}
        <section aria-labelledby="age-section-label" className="mb-4">
          <p id="age-section-label" className="mb-2 text-sm font-semibold text-foreground">
            Your age
          </p>
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-labelledby="age-section-label"
          >
            {[
              { value: "under-15" as AgeChoice, label: "Under 15" },
              { value: "15-17" as AgeChoice, label: "15–17" },
              { value: "18-plus" as AgeChoice, label: "18 or older" },
            ].map(({ value, label }) => {
              const selected = ageChoice === value;
              return (
                <label
                  key={value}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-2xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                    selected
                      ? "bg-primary/15 text-primary ring-primary/30"
                      : "bg-foreground/[0.04] text-muted-foreground ring-transparent"
                  }`}
                >
                  <input
                    type="radio"
                    name="scan-age-choice"
                    value={value}
                    checked={selected}
                    onChange={() => {
                      setAgeChoice(value);
                      setError(null);
                      if (value !== "15-17") setGuardianChecked(false);
                    }}
                    className="sr-only"
                    aria-label={label}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </section>

        {/* ── Under-15 block ────────────────────────────────────────────
            Never enables submission, never calls the server, never stores
            a consent record. Shows calm message + manual-only path. */}
        {ageChoice === "under-15" && (
          <div className="mb-4 rounded-2xl bg-foreground/[0.04] px-4 py-4 text-sm">
            <p className="font-medium text-foreground">
              AI clothing scan is available for ages 15 and older.
            </p>
            <p className="mt-1 text-muted-foreground">
              You can still build your wardrobe by adding items manually.
            </p>
          </div>
        )}

        {/* ── Guardian checkbox (15-17 only) ────────────────────────── */}
        {ageChoice === "15-17" && (
          <label
            className="mb-4 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl bg-foreground/[0.04] px-4 py-3"
            aria-required="true"
          >
            <input
              type="checkbox"
              checked={guardianChecked}
              onChange={(e) => {
                setGuardianChecked(e.target.checked);
                setError(null);
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
              aria-required="true"
            />
            <span className="text-sm">
              I have permission from a parent or guardian to use AI clothing scan.
            </span>
          </label>
        )}

        {/* ── Photo safety section (hidden for under-15) ──────────────── */}
        {ageChoice !== "under-15" && (
          <section aria-labelledby="safety-section-label" className="mb-4">
            <p id="safety-section-label" className="mb-2 text-sm font-semibold text-foreground">
              Photo safety
            </p>
            <div className="space-y-1.5">
              {[
                "Photograph one clothing item",
                "Keep people, faces, IDs and personal details out of the photo",
                "AI suggests clothing details—you review everything before saving",
              ].map((item) => (
                <div
                  key={item}
                  className="flex min-h-[44px] items-start gap-3 rounded-2xl bg-foreground/[0.04] px-4 py-3"
                  aria-label={item}
                >
                  <span className="mt-0.5 text-sm leading-snug text-foreground/80">{item}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── AI disclosure (progressive disclosure) — hidden for under-15 ── */}
        {ageChoice !== "under-15" && (
          <div className="mb-5">
            <button
              type="button"
              aria-expanded={photoInfoOpen}
              onClick={() => setPhotoInfoOpen((v) => !v)}
              className="press flex w-full items-center justify-between rounded-2xl bg-foreground/[0.04] px-4 py-3 text-left text-sm font-medium text-foreground/70"
            >
              How photos are handled
              {photoInfoOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </button>
            {photoInfoOpen && (
              <div className="mt-2 space-y-1 px-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your photo is analyzed by Anthropic Claude to suggest clothing details. Aeruvo
                  does not store the original image after processing. Anthropic processes it under
                  its{" "}
                  <a
                    href="https://www.anthropic.com/legal/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 underline underline-offset-2"
                  >
                    Privacy Policy
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                  .
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  After analysis, you can optionally save a small cleaned reference thumbnail on
                  this device so Aeruvo can visually identify the exact wardrobe item. That optional
                  thumbnail is not uploaded to Aeruvo or Firebase.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <a href="/privacy" className="underline underline-offset-2">
                    Aeruvo Privacy Policy
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Primary action ───────────────────────────────────────────── */}
        {ageChoice !== "under-15" && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            aria-busy={submitting}
            className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save and choose photo"}
          </button>
        )}

        {/* ── Secondary action ─────────────────────────────────────────── */}
        <button
          type="button"
          onClick={onManual}
          className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden />
          Add manually instead
        </button>
      </SheetContent>
    </Sheet>
  );
}
