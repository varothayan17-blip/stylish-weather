/**
 * scanConsentStore.ts
 *
 * Client-side consent state for the AI clothing scan setup.
 *
 * Responsibilities:
 *  - Persist a consent record keyed by UID (never cross-account leakage).
 *  - Carry BOTH a client schema version AND the server ack version so either
 *    a copy-change (schema bump) or a server-side policy change (ack version
 *    bump) triggers a re-prompt.
 *  - Keep in-memory state that is cleared immediately on logout/account change.
 *  - Provide async ownership guards so a stale request from user A cannot
 *    update user B's record.
 *  - Store only an age band — never full date of birth.
 *  - Fail closed: corrupt/missing/wrong-version data is treated as not consented.
 *
 * What this does NOT do:
 *  - Replace server-side acknowledgement enforcement (wardrobe-ai-handler.ts).
 *  - Expose the Anthropic API key.
 *  - Make decisions about whether scanning is enabled (WARDROBE_AI_SCANNING_ENABLED).
 *
 * Re-prompt policy (item 7):
 *  A user may skip setup ONLY when BOTH of the following are true:
 *    1. A valid local consent record exists for the current CONSENT_SCHEMA_VERSION
 *       AND the current SCANNER_ACK_VERSION.
 *    2. The server reports acknowledgement for the same UID.
 *  A server "acknowledged = true" response alone does NOT bypass the client
 *  disclosure — the server ack does not prove the user saw the current text.
 */

import type { ScannerAgeBand } from "@/lib/wardrobe-types";
import { SCANNER_ACK_VERSION } from "@/lib/wardrobe-types";

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Version of the client-side consent schema.
 * Separate from SCANNER_ACK_VERSION (server-side policy version).
 * Increment when the setup sheet copy changes materially so users re-read it.
 */
export const CONSENT_SCHEMA_VERSION = "1" as const;
export type ConsentSchemaVersion = typeof CONSENT_SCHEMA_VERSION;

/** Shape stored in localStorage. Never includes DOB. */
export type ConsentRecord = {
  uid:           string;
  ageBand:       ScannerAgeBand;
  schemaVersion: ConsentSchemaVersion;
  /** ISO 8601 timestamp when consent was first given */
  consentedAt:   string;
  /** Matches SCANNER_ACK_VERSION at time of consent */
  serverAckVersion: string;
};

// ── Storage key (per UID) ─────────────────────────────────────────────────────

function storageKey(uid: string): string {
  return `aeruvo:scanConsent:v1:${uid}`;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

/**
 * In-memory state is keyed by UID.
 * Cleared immediately on logout / account change via `clearConsentState()`.
 */
let _cachedUid: string | null      = null;
let _cachedRecord: ConsentRecord | null = null;

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns the record if it is valid for the given UID and BOTH current version
 * constants, or null if it is corrupt, missing, wrong-version, or belongs to
 * another UID. Fails closed on any parse error.
 *
 * Strict requirements (item 8):
 *  - r.schemaVersion === CONSENT_SCHEMA_VERSION
 *  - r.serverAckVersion === SCANNER_ACK_VERSION
 *  - r.uid === uid
 *  - r.ageBand ∈ { "15-17", "18-plus" }
 *  - r.consentedAt is a valid parseable ISO timestamp (not merely a string)
 */
function parseAndValidate(raw: unknown, uid: string): ConsentRecord | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.uid              !== "string" ||
      typeof r.ageBand          !== "string" ||
      typeof r.schemaVersion    !== "string" ||
      typeof r.consentedAt      !== "string" ||
      typeof r.serverAckVersion !== "string"
    ) return null;
    if (r.uid !== uid)                                return null; // wrong owner
    if (r.schemaVersion !== CONSENT_SCHEMA_VERSION)   return null; // schema mismatch → re-prompt
    if (r.serverAckVersion !== SCANNER_ACK_VERSION)   return null; // ack version mismatch → re-prompt
    if (r.ageBand !== "15-17" && r.ageBand !== "18-plus") return null; // invalid band
    // Strict ISO validation: must round-trip through Date.toISOString()
    // This rejects "January 1, 2026", "2026-02-30T...", and any non-UTC string.
    try {
      const rebuilt = new Date(r.consentedAt as string).toISOString();
      if (rebuilt !== r.consentedAt) return null;
    } catch {
      return null;
    }
    return r as unknown as ConsentRecord;
  } catch {
    return null; // any parse error → fail closed
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load stored consent for a UID.
 * Checks in-memory cache first; falls through to localStorage; validates.
 * Returns null if not consented, version-mismatched, or corrupt.
 *
 * A server "acknowledged = true" does NOT make this return non-null —
 * the caller must check both this AND the server status (item 7).
 */
export function loadConsent(uid: string): ConsentRecord | null {
  // In-memory cache hit (same UID + same schema version + same ack version)
  if (_cachedUid === uid && _cachedRecord !== null) {
    if (
      _cachedRecord.schemaVersion    === CONSENT_SCHEMA_VERSION &&
      _cachedRecord.serverAckVersion === SCANNER_ACK_VERSION
    ) return _cachedRecord;
    // Version changed mid-session — clear cache
    _cachedUid    = null;
    _cachedRecord = null;
  }

  // localStorage
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const record = parseAndValidate(parsed, uid);
    if (record) {
      _cachedUid    = uid;
      _cachedRecord = record;
    }
    return record;
  } catch {
    return null; // localStorage unavailable or corrupt JSON → fail closed
  }
}

/**
 * Save a consent record for a UID.
 * Async ownership guard: the caller must supply the UID they intend to write for.
 * If at the moment of save the authenticated UID has changed (e.g. a stale
 * async callback from user A fires after user B signed in), the write is dropped.
 *
 * @param uid            The UID this consent belongs to (captured at request start)
 * @param ageBand        The age band the user selected ("15-17" | "18-plus")
 * @param getCurrentUid  Async function that resolves to the current UID —
 *                       checked twice (before and after network calls) to
 *                       guard against ownership races.
 */
export async function saveConsent(
  uid: string,
  ageBand: ScannerAgeBand,
  getCurrentUid: () => Promise<string | null>,
): Promise<{ ok: true } | { ok: false; reason: "uid_changed" | "storage_error" }> {
  // First ownership guard
  const currentUid = await getCurrentUid();
  if (currentUid !== uid) {
    return { ok: false, reason: "uid_changed" };
  }

  const record: ConsentRecord = {
    uid,
    ageBand,
    schemaVersion:    CONSENT_SCHEMA_VERSION,
    consentedAt:      new Date().toISOString(),
    serverAckVersion: SCANNER_ACK_VERSION,
  };

  // Second ownership guard immediately before write (minimise race window)
  const currentUid2 = await getCurrentUid();
  if (currentUid2 !== uid) {
    return { ok: false, reason: "uid_changed" };
  }

  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(record));
  } catch {
    return { ok: false, reason: "storage_error" };
  }

  // Update in-memory cache
  _cachedUid    = uid;
  _cachedRecord = record;

  return { ok: true };
}

/**
 * Clear all in-memory consent state immediately.
 * Must be called on logout or account change (A → null or A → B).
 * Does NOT remove localStorage records (those remain keyed by UID
 * and are harmless; they are validated on load and won't match a different UID).
 */
export function clearConsentState(): void {
  _cachedUid    = null;
  _cachedRecord = null;
}

/**
 * Revoke consent for a UID.
 * Clears localStorage record and in-memory cache.
 */
export function revokeConsent(uid: string): void {
  try {
    localStorage.removeItem(storageKey(uid));
  } catch { /* ignore */ }
  if (_cachedUid === uid) {
    _cachedUid    = null;
    _cachedRecord = null;
  }
}

/**
 * Exported for testing only.
 * Resets in-memory state to allow isolated test cases.
 */
export function _resetForTest(): void {
  _cachedUid    = null;
  _cachedRecord = null;
}
