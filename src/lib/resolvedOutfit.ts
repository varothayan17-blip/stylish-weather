/**
 * resolvedOutfit.ts — Shared resolved-outfit store with localStorage persistence.
 *
 * ── Freshness policy ─────────────────────────────────────────────────────
 * A snapshot is fresh when BOTH conditions hold:
 *   1. localDate matches today's local calendar date (YYYY-MM-DD), AND
 *   2. resolvedAt is no older than RESOLVED_OUTFIT_MAX_AGE_MS (60 minutes).
 *
 * Rationale: outfit recommendations change throughout the day (temperature,
 * rain risk). Same-date-only freshness would show stale morning picks at
 * night. The 60-minute TTL ensures Wardrobe Today's picks stays in sync with
 * Home without requiring an active network connection for the picks screen.
 *
 * If a snapshot fails either condition it is rejected and treated as null —
 * Wardrobe shows no picks. Visiting Home recomputes and refreshes the snapshot.
 *
 * ── Account scope / security ─────────────────────────────────────────────
 * The snapshot stores ownerUid so it can only be hydrated by the same
 * Firebase Auth UID. This prevents:
 *   • User A (Premium) signs out → User B (Premium) signing in → User B
 *     seeing User A's clothing item names.
 *   • Free user seeing leftover Premium picks from a previous session.
 *
 * Hydration strategy:
 *   - Module load does NOT hydrate — Auth UID is not yet known at import time.
 *   - Hydration is deferred to hydrateResolvedOutfit(uid), which is called
 *     after Auth has resolved (in OutfitSlotList's useEffect, gated on uid).
 *   - The key is UID-scoped: "aeruvo:resolved-outfit:v1:{uid}" so iOS
 *     localStorage isolation prevents cross-account leakage even without code.
 *
 * On sign-out or UID change: call clearResolvedOutfit() to wipe memory and
 * remove the key for the previous UID so no traces remain.
 *
 * What is stored: headline, effectiveFeelsC, localDate, resolvedAt, ownerUid,
 * and ResolvedSlot[] (item names, IDs, tints — non-sensitive confirmed metadata).
 * Never: email addresses, tokens, images, entitlement documents.
 *
 * ── Anti-emit-loop ────────────────────────────────────────────────────────
 * setResolvedOutfit() performs structural equality before emitting.
 * Unchanged slots never trigger a re-render cascade.
 *
 * wardrobeMatch.ts stays billing-unaware.
 */

import { useSyncExternalStore } from "react";

// ── Constants ─────────────────────────────────────────────────────────────

/** Versioned key prefix. The UID is appended at runtime. */
const STORAGE_KEY_PREFIX = "aeruvo:resolved-outfit:v1:";

/**
 * Maximum age of a resolved-outfit snapshot.
 * 60 minutes: prevents stale morning picks from showing at night.
 */
export const RESOLVED_OUTFIT_MAX_AGE_MS = 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────

export type ResolvedSlot =
  | { matched: false; genericText: string }
  | {
      matched:     true;
      genericText: string;
      /** Saved item display name — snapshot at save time (no "Your " prefix). */
      itemName:    string;
      /** Wardrobe item ID for Wardrobe picks to look up the live item. */
      itemId:      string;
      /** Tint gradient class for the colour swatch. */
      itemTint:    string;
    };

export type ResolvedOutfit = {
  slots:           ResolvedSlot[];
  /** ISO timestamp of when this snapshot was written. Used for 60-min TTL. */
  resolvedAt:      string;
  /** Local calendar date YYYY-MM-DD for calendar-day staleness check. */
  localDate:       string;
  /** Recommendation headline — for debugging. */
  headline:        string;
  effectiveFeelsC: number;
  /**
   * Firebase Auth UID of the user who created this snapshot.
   * Never an email address. Only the UID, which is opaque.
   */
  ownerUid:        string;
};

// ── Freshness ─────────────────────────────────────────────────────────────

/** Today's date as YYYY-MM-DD in the device's local timezone. */
export function localDateString(now = new Date()): string {
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A snapshot is fresh when:
 *   1. localDate matches today (calendar-day boundary), AND
 *   2. resolvedAt is within RESOLVED_OUTFIT_MAX_AGE_MS of now.
 *
 * Both conditions must hold. A snapshot from this morning is stale after
 * 60 minutes even if it shares today's localDate.
 *
 * @param now Optional override for the current time (for testing).
 */
export function isOutfitFresh(outfit: ResolvedOutfit, now = new Date()): boolean {
  if (outfit.localDate !== localDateString(now)) return false;
  const age = now.getTime() - new Date(outfit.resolvedAt).getTime();
  return age >= 0 && age <= RESOLVED_OUTFIT_MAX_AGE_MS;
}

// ── Structural equality (anti-emit-loop) ──────────────────────────────────

function slotsEqual(a: ResolvedSlot[], b: ResolvedSlot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((sa, i) => {
    const sb = b[i];
    if (sa.matched !== sb.matched || sa.genericText !== sb.genericText) return false;
    if (sa.matched && sb.matched) {
      return sa.itemId === sb.itemId && sa.itemName === sb.itemName;
    }
    return true;
  });
}

function outfitsEqual(a: ResolvedOutfit, b: ResolvedOutfit): boolean {
  return (
    a.ownerUid        === b.ownerUid        &&
    a.localDate       === b.localDate       &&
    a.headline        === b.headline        &&
    a.effectiveFeelsC === b.effectiveFeelsC &&
    slotsEqual(a.slots, b.slots)
  );
}

// ── Validation ────────────────────────────────────────────────────────────

export function isValidOutfit(raw: unknown): raw is ResolvedOutfit {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.resolvedAt      !== "string" ||
    typeof r.localDate       !== "string" ||
    typeof r.headline        !== "string" ||
    typeof r.effectiveFeelsC !== "number" ||
    typeof r.ownerUid        !== "string" ||
    r.ownerUid               === ""       || // reject empty/malformed
    !Array.isArray(r.slots)
  ) return false;

  return (r.slots as unknown[]).every((s) => {
    if (!s || typeof s !== "object") return false;
    const sl = s as Record<string, unknown>;
    if (typeof sl.matched !== "boolean") return false;
    if (typeof sl.genericText !== "string") return false;
    if (sl.matched) {
      return (
        typeof sl.itemName === "string" && sl.itemName !== "" &&
        typeof sl.itemId   === "string" && sl.itemId   !== "" &&
        typeof sl.itemTint === "string"
      );
    }
    return true;
  });
}

// ── Persistence ───────────────────────────────────────────────────────────

function isBrowser() { return typeof window !== "undefined"; }

function storageKey(uid: string) { return `${STORAGE_KEY_PREFIX}${uid}`; }

function saveToStorage(outfit: ResolvedOutfit): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey(outfit.ownerUid), JSON.stringify(outfit));
  } catch { /* QuotaExceededError — in-memory still works for the session */ }
}

function removeFromStorage(uid: string): void {
  if (!isBrowser()) return;
  try { window.localStorage.removeItem(storageKey(uid)); } catch { /* ignore */ }
}

// ── In-memory store ───────────────────────────────────────────────────────

// Starts null — hydration is deferred until Auth UID is known.
// This prevents loading a snapshot before we can verify ownership.
let current: ResolvedOutfit | null = null;
/** The UID of the last hydrated or set snapshot — used for targeted cleanup. */
let currentUid: string | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((cb) => cb()); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() { return current; }

// ── Public API ────────────────────────────────────────────────────────────

/**
 * React hook: subscribe to the current resolved outfit.
 * Returns null on server, before hydration, or when no fresh snapshot exists.
 */
export function useResolvedOutfit(): ResolvedOutfit | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * Load a persisted snapshot for the given UID.
 * Must be called after Auth has resolved — not at module load time.
 * Rejects snapshots that are stale, malformed, or owned by a different UID.
 *
 * @param uid - The current Firebase Auth UID. Pass null to skip (clears instead).
 */
export function hydrateResolvedOutfit(uid: string | null): void {
  if (!uid) { clearResolvedOutfit(null); return; }
  if (!isBrowser()) return;

  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidOutfit(parsed)) { removeFromStorage(uid); return; }
    if (parsed.ownerUid !== uid) { removeFromStorage(uid); return; } // extra guard
    if (!isOutfitFresh(parsed)) { removeFromStorage(uid); return; }  // stale

    current    = parsed;
    currentUid = uid;
    emit();
  } catch {
    // Corrupt JSON — remove and stay null
    removeFromStorage(uid);
  }
}

/**
 * Publish a new resolved outfit snapshot.
 *
 * Only call from useEffect or an event handler — never during render.
 * Skips emit when slots are structurally identical (anti-emit-loop).
 * Writes to the UID-scoped localStorage key.
 */
export function setResolvedOutfit(outfit: ResolvedOutfit): void {
  if (current && outfitsEqual(current, outfit)) return; // no change
  current    = outfit;
  currentUid = outfit.ownerUid;
  saveToStorage(outfit);
  emit();
}

/**
 * Clear the current snapshot from memory and localStorage.
 * Call on sign-out, UID change, or when entitlement.active becomes false.
 *
 * @param uid - UID whose storage key to remove. Pass null to use currentUid.
 */
export function clearResolvedOutfit(uid: string | null = null): void {
  const keyUid = uid ?? currentUid;
  if (keyUid) removeFromStorage(keyUid);
  if (current === null && currentUid === null) return; // already clear
  current    = null;
  currentUid = null;
  emit();
}
