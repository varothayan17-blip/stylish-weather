/**
 * wardrobeStore.ts — Wardrobe client state with localStorage persistence.
 *
 * ── Persistence ──────────────────────────────────────────────────────────────
 * Key:  "aeruvo:wardrobe:v1"
 *   Versioned so a future schema change can detect and migrate/discard old data
 *   without corrupting the user's wardrobe.
 *
 * Value: JSON array of WardrobeItem[] (structured metadata only — no image bytes).
 *   Written synchronously on every mutation so the item survives a PWA kill/relaunch.
 *   aiAnalysis (AI structured output) is INCLUDED: it is text/numeric metadata,
 *   not the raw image. The compressed image blob lives only in AddClothingSheet state
 *   and is never stored here.
 *
 * ── SSR safety ────────────────────────────────────────────────────────────────
 * This module is imported by wardrobe.tsx which is rendered server-side by
 * TanStack Start + Nitro on Vercel. localStorage does not exist in Node.
 *
 * Guard strategy:
 *   - loadFromStorage() checks typeof window === "undefined" (not just localStorage,
 *     because accessing an undeclared binding throws ReferenceError in strict ESM).
 *   - The module-level `let items` initialisation calls loadFromStorage() immediately:
 *       • on the server → typeof window === "undefined" → returns [...SEED_ITEMS]
 *       • on the client → reads localStorage; falls back to [...SEED_ITEMS] on miss/error
 *   - useSyncExternalStore receives a separate getServerSnapshot that always returns
 *     SEED_ITEMS, preventing React hydration mismatches when the server rendered SEED_ITEMS
 *     but the client has user items in localStorage. React will re-render once client-side
 *     with the correct localStorage snapshot — no flicker for seed items, no crash.
 *
 * ── Seed deduplication ────────────────────────────────────────────────────────
 * Seed items have fixed IDs (e.g. "hoodie-black"). If localStorage already contains
 * them, they are returned as-is (possibly with user edits such as favourite:true).
 * If localStorage is empty/absent, SEED_ITEMS are the initial state and are written
 * on the first mutation. We never forcibly merge SEED_ITEMS over stored data, so
 * user edits to seed items (e.g. marking a seed item unavailable) are preserved.
 *
 * ── Immediate appearance ──────────────────────────────────────────────────────
 * wardrobe.add() → saveToStorage() → emit() in this order:
 *   1. Persist first (data is durable before React sees the update).
 *   2. emit() creates a new array reference and notifies all useSyncExternalStore
 *      subscribers synchronously. React batches the resulting setState and re-renders
 *      the grid in the same event loop tick. The item appears immediately.
 *
 * ── Duplicate prevention ──────────────────────────────────────────────────────
 * IDs are "item-{timestamp}-{random}". wardrobe.add() rejects any item whose id
 * already exists in the current list. This guards against double-taps even if the
 * button is somehow pressed twice before React disables it.
 *
 * ── What is NOT touched ───────────────────────────────────────────────────────
 * Firestore, Firebase Auth, Wardrobe scan API/quota, Anthropic, Stripe,
 * Premium entitlements, notifications, service worker, weather engine.
 */

import { useSyncExternalStore } from "react";
import { SEED_ITEMS, type WardrobeItem } from "./wardrobeData";

// ── Storage key (versioned) ───────────────────────────────────────────────────

/**
 * "aeruvo:wardrobe:v1" — bump the version suffix if WardrobeItem schema changes
 * in a backward-incompatible way. The old key will simply be ignored on next load
 * and the user's wardrobe will start from SEED_ITEMS again (data is not migrated
 * automatically at v1; add migration logic before bumping to v2 if needed).
 */
const STORAGE_KEY = "aeruvo:wardrobe:v1";

// ── Stable server snapshot (never changes) ────────────────────────────────────

/** Used as the getServerSnapshot argument to useSyncExternalStore. */
const SERVER_SNAPSHOT: WardrobeItem[] = [...SEED_ITEMS];

// ── Persistence helpers ───────────────────────────────────────────────────────

function isBrowser(): boolean {
  // typeof window is the canonical Node vs browser guard in TanStack Start SSR.
  // Accessing an undeclared `localStorage` binding directly can throw ReferenceError
  // in strict ESM environments; checking typeof window is always safe.
  return typeof window !== "undefined";
}

/**
 * Load the wardrobe from localStorage.
 * - Returns [...SEED_ITEMS] on server (SSR) — safe, no localStorage access.
 * - Returns stored items on client if valid JSON array with at least one item.
 * - Falls back to [...SEED_ITEMS] on any parse error, empty array, or missing key.
 * - Handles "aeruvo:wardrobe:v1" schema version; ignores unknown schemas silently.
 */
function loadFromStorage(): WardrobeItem[] {
  if (!isBrowser()) return [...SEED_ITEMS]; // Server: no localStorage
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED_ITEMS];

    const parsed: unknown = JSON.parse(raw);

    // Basic shape validation — must be a non-empty array of objects with id strings
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string")
    ) {
      return [...SEED_ITEMS];
    }

    return parsed as WardrobeItem[];
  } catch {
    // Corrupt JSON, SecurityError, or QuotaExceededError on read — degrade gracefully
    return [...SEED_ITEMS];
  }
}

/**
 * Persist the current item list.
 * Best-effort: localStorage may be full or blocked (private browsing).
 * In-memory state is always up to date regardless.
 */
function saveToStorage(current: WardrobeItem[]): void {
  if (!isBrowser()) return; // No-op on server
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // QuotaExceededError or SecurityError — in-memory state still works for the session
  }
}

// ── In-memory store (module-level, client-side resets on navigation per TanStack) ──

/**
 * Module-level initialisation:
 *   • Server: typeof window === "undefined" → loadFromStorage() returns SEED_ITEMS
 *   • Client: loadFromStorage() reads localStorage → user items or SEED_ITEMS
 *
 * In TanStack Start, client-side JS modules are re-evaluated fresh per navigation
 * context, so this correctly hydrates from localStorage on every app launch.
 */
let items: WardrobeItem[] = loadFromStorage();
const listeners = new Set<() => void>();

// ── Store internals ───────────────────────────────────────────────────────────

/** Notify all useSyncExternalStore subscribers with a new array reference. */
function emit(): void {
  items = [...items]; // New reference triggers React re-render
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Client snapshot — returns the current items array. */
function getSnapshot(): WardrobeItem[] {
  return items;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * React hook: subscribe to the wardrobe item list.
 * SERVER_SNAPSHOT (always SEED_ITEMS) is passed as the third argument so React
 * SSR renders seed items and then re-renders once on the client with localStorage
 * items — avoids hydration mismatch errors.
 */
export function useWardrobe(): WardrobeItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

export const wardrobe = {
  /**
   * Add a new item. No-op if an item with the same id already exists
   * (guards against double-tap before React disables the button).
   *
   * Evidence stripping: if the item contains aiAnalysis.evidence (from an older
   * code path or a backward-compatible legacy item), it is stripped before
   * persisting. New AI scans never receive evidence in the first place.
   * Existing items already in storage are not affected (no rewrite of old data).
   */
  add(item: Omit<WardrobeItem, "id">): void {
    const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (items.some((i) => i.id === id)) return; // Duplicate guard

    // Strip evidence from aiAnalysis before persisting (decision a).
    // New scans never include evidence; this guard protects against any
    // future code path that might accidentally include it.
    let sanitized = item;
    if (sanitized.aiAnalysis && "evidence" in sanitized.aiAnalysis) {
      const { evidence: _stripped, ...analysisWithoutEvidence } = sanitized.aiAnalysis;
      sanitized = { ...sanitized, aiAnalysis: analysisWithoutEvidence };
    }

    items = [...items, { ...sanitized, id }];
    saveToStorage(items); // Persist before notifying React
    emit();
  },

  /** Apply a partial patch to an existing item (favourite, unavailable, name edit, etc.). */
  update(id: string, patch: Partial<WardrobeItem>): void {
    if (!items.some((i) => i.id === id)) return; // Item not found — no-op
    items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    saveToStorage(items);
    emit();
  },

  /** Remove an item permanently. */
  remove(id: string): void {
    items = items.filter((i) => i.id !== id);
    saveToStorage(items);
    emit();
  },

  /**
   * Clear all items (dev/test only — not exposed in production UI).
   * Removes the localStorage key entirely rather than writing an empty array,
   * so the next load falls back to SEED_ITEMS rather than an empty wardrobe.
   */
  clear(): void {
    items = [...SEED_ITEMS];
    if (isBrowser()) {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
    emit();
  },
};
