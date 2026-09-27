/**
 * pickerConsentLogic.ts
 *
 * Pure stateless logic for the picker / consent flow in AddClothingSheet.
 * Extracted for deterministic behavioural testing without React or Firebase.
 *
 * resolvePickerRequestWith — decides what action to take when the user taps
 *   "Take photo" or "Choose from library", given current consent state and deps.
 *
 * The caller is responsible for:
 *   1. Calling input.click() ONLY from the fresh CTA button (pickerReadyAction state).
 *   2. Never calling input.click() from resolvePickerRequestWith itself.
 */

import type { ScanStep } from "@/lib/wardrobe-types";

export type PickerAction = "camera" | "library";

export type AckCache = {
  checked: boolean | null;  // null = unchecked, true = consented, false = not consented
  uid: string | null;       // UID at which the cache was populated
};

/**
 * Result of resolvePickerRequestWith.
 *
 * "picker-ready"  — consent already given; show fresh synchronous CTA for the given action.
 *                   uid is the UID verified at the time of cache hit/consent check.
 * "open-consent"  — no consent yet; open the consent sheet for the given uid.
 *                   uid is the UID verified at two points (before and after checkConsent).
 * "sign-in"       — no authenticated user; show sign-in required screen.
 * "noop"          — manual entry tapped; no consent check needed.
 * "stale"         — request was superseded mid-flight (UID changed between checks);
 *                   caller must discard result entirely.
 */
export type PickerResolveResult =
  | { outcome: "picker-ready"; action: PickerAction; uid: string }
  | { outcome: "open-consent"; uid: string; action: PickerAction }
  | { outcome: "sign-in" }
  | { outcome: "noop" }
  | { outcome: "stale" };

/**
 * Testable version of the picker-request logic.
 *
 * Deps:
 *   getUid          — returns the current authenticated UID (or null)
 *   checkConsent    — returns { uid, acknowledged } for the given UID
 *   ackCache        — mutable ref to the cached ack state (mutated by this fn)
 *   action          — "camera" | "library"
 *   isManualEntry   — true when the user tapped "Add manually instead"
 */
export async function resolvePickerRequestWith(
  action: PickerAction | "manual",
  ackCache: AckCache,
  deps: {
    getUid: () => Promise<string | null>;
    checkConsent: (uid: string) => Promise<{ uid: string | null; acknowledged: boolean }>;
  },
): Promise<PickerResolveResult> {
  // Manual entry never needs consent
  if (action === "manual") {
    return { outcome: "noop" };
  }

  const currentUid = await deps.getUid();

  if (!currentUid) {
    return { outcome: "sign-in" };
  }

  // Invalidate cache on UID change
  if (ackCache.uid !== null && ackCache.uid !== currentUid) {
    ackCache.checked = null;
    ackCache.uid = null;
  }

  // Use cache if available
  let acknowledged = ackCache.checked;

  if (acknowledged === null) {
    const result = await deps.checkConsent(currentUid);
    if (result.uid === null) {
      return { outcome: "sign-in" };
    }
    // Re-verify after async checkConsent: if UID changed, the result belongs to no
    // current user — discard entirely (stale) rather than opening consent or picker
    // for the wrong account.
    const afterUid = await deps.getUid();
    if (afterUid !== currentUid) {
      // UID changed while checkConsent was in flight — stale; caller must discard.
      return { outcome: "stale" };
    }
    if (afterUid !== result.uid) {
      // Server returned a different UID than we sent (edge case) — treat as sign-in.
      return { outcome: "sign-in" };
    }
    ackCache.checked = result.acknowledged;
    ackCache.uid = result.uid;
    acknowledged = result.acknowledged;
  }

  // Re-read currentUid for the picker-ready/open-consent branch so we always
  // embed the most recently verified UID in the result.
  const resolveUid = await deps.getUid();
  if (!resolveUid || resolveUid !== currentUid) {
    // UID changed between cache check and result — discard.
    return { outcome: "stale" };
  }

  if (acknowledged) {
    // Do NOT click input here — return picker-ready for the fresh CTA
    return { outcome: "picker-ready", action, uid: resolveUid };
  } else {
    return { outcome: "open-consent", uid: resolveUid, action };
  }
}

/**
 * Simulates what happens AFTER the consent sheet completes onComplete().
 * Returns the post-consent state: pickerReadyAction to render in the CTA.
 *
 * This is purely synchronous — onComplete() is a sync React state setter call
 * and MUST NOT call input.click() directly.
 */
export function resolveConsentComplete(
  pendingAction: PickerAction | null,
  ackCache: AckCache,
  uid: string,
): { pickerReadyAction: PickerAction | null; step: "picker-ready" | "pick" } {
  // Mark consent as complete in cache
  ackCache.checked = true;
  ackCache.uid = uid;

  if (pendingAction) {
    // Show fresh CTA — do NOT call input.click() here (runs in async context)
    return { pickerReadyAction: pendingAction, step: "picker-ready" };
  }
  return { pickerReadyAction: null, step: "pick" };
}

/**
 * Simulates A→B auth switch: clears all pending/picker-ready state,
 * returns the new step based on whether the new UID exists and scanner status.
 *
 * scanEnabled meanings:
 *   null  — status not yet fetched → "status-check"
 *   false — scanner unavailable   → "scan-unavailable"
 *   true  — scanner available     → "pick"
 *
 * null UID always → "sign-in-required" regardless of scanEnabled.
 */
export function resolveAuthSwitch(
  newUid: string | null,
  ackCache: AckCache,
  scanEnabled: boolean | null = null,
): {
  step: ScanStep;
  consentSheetOpen: false;
  consentSheetUid: null;
  pickerReadyAction: null;
} {
  ackCache.checked = null;
  ackCache.uid = null;

  let step: ScanStep;
  if (!newUid) {
    step = "sign-in-required";
  } else if (scanEnabled === null) {
    step = "status-check";
  } else if (scanEnabled === false) {
    step = "scan-unavailable";
  } else {
    step = "pick";
  }

  return {
    step,
    consentSheetOpen: false,
    consentSheetUid: null,
    pickerReadyAction: null,
  };
}
