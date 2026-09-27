/**
 * scanConsentApi.ts
 *
 * Extracted, separately testable API logic for the AI scan consent flow.
 *
 * Exports:
 *  - fetchAckStatus         — ownership-guarded server ack check
 *  - fetchAckStatusWith     — testable version with injected deps
 *  - checkConsentStatus     — full consent check (local + server)
 *  - checkConsentStatusWith — testable version with injected deps
 *  - submitServerAck        — submit server-side acknowledgement
 *  - submitServerAckWith    — testable version with injected deps
 *  - ConsentStatusResult    — return type of checkConsentStatus
 *  - ServerAckResult        — return type of submitServerAck
 */

import type { ConsentRecord } from "@/lib/scanConsentStore";
import type { ScannerAgeBand } from "@/lib/wardrobe-types";

// ── Public result types ───────────────────────────────────────────────────────

export type ConsentStatusResult =
  | { uid: string; acknowledged: boolean }
  | { uid: null; acknowledged: false };

/**
 * Result of submitServerAck / submitServerAckWith.
 *
 * ok: true  — server accepted the acknowledgement.
 * ok: false, reason: "uid_changed" — UID changed during the request; caller
 *   must NOT update UI or save consent (the component will be reset by the parent).
 * ok: false, error: string — server or network error; caller should show the message.
 */
export type ServerAckResult =
  | { ok: true }
  | { ok: false; reason: "uid_changed" }
  | { ok: false; reason?: never; error: string };

// ── Testable implementations (injected deps) ──────────────────────────────────

/**
 * Testable version of fetchAckStatus with injected dependencies.
 * Ownership-guarded: verifies uid pre/post token fetch.
 */
export async function fetchAckStatusWith(
  expectedUid: string,
  deps: {
    getAuth: () => Promise<{ currentUser: { uid: string; getIdToken: () => Promise<string> } | null } | null>;
    fetchFn: typeof fetch;
  },
): Promise<boolean> {
  try {
    const auth = await deps.getAuth();
    const user = auth?.currentUser;
    // Ownership check before token fetch
    if (!user || user.uid !== expectedUid) return false;
    const idToken = await user.getIdToken();
    // Re-check after async token fetch
    if (auth.currentUser?.uid !== expectedUid) return false;
    const res = await deps.fetchFn("/api/wardrobe/ack-status", {
      headers: { "Authorization": `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { acknowledged?: boolean };
    return data.acknowledged === true;
  } catch {
    return false;
  }
}

/**
 * Testable version of checkConsentStatus with injected dependencies.
 *
 * Item 7 — re-prompt policy:
 *  A user may skip setup ONLY when BOTH conditions are true:
 *    1. A valid local consent record exists for the current schema and ack versions.
 *    2. The server reports acknowledgement for that same UID.
 *  A server "acknowledged=true" alone does NOT bypass setup.
 *
 * Item 6 — ownership:
 *  - Captures expectedUid once at the start.
 *  - Passes expectedUid into fetchAckStatus (which verifies uid pre/post-token).
 *  - Re-verifies current UID after every async boundary.
 *  - Returns { uid: null, acknowledged: false } on any ownership mismatch.
 */
export async function checkConsentStatusWith(
  deps: {
    getUid: () => Promise<string | null>;
    loadConsent: (uid: string) => ConsentRecord | null;
    fetchAckStatus: (uid: string) => Promise<boolean>;
  },
): Promise<ConsentStatusResult> {
  try {
    const expectedUid = await deps.getUid();
    if (!expectedUid) return { uid: null, acknowledged: false };

    // 1. Must have a valid local consent record for both current schema and ack version.
    //    If local record is missing, corrupt, or old-versioned → re-prompt regardless
    //    of what the server says (item 7: server ack does not prove disclosure was seen).
    const local = deps.loadConsent(expectedUid);
    if (!local) {
      // No valid local record → show setup. No need to call server.
      return { uid: expectedUid, acknowledged: false };
    }

    // 2. Local record exists and passed version checks — verify with server.
    const serverOk = await deps.fetchAckStatus(expectedUid);

    // Ownership re-check after server response
    const currentUid = await deps.getUid();
    if (currentUid !== expectedUid) {
      return { uid: null, acknowledged: false };
    }

    return { uid: expectedUid, acknowledged: serverOk };
  } catch {
    return { uid: null, acknowledged: false };
  }
}

// ── submitServerAck ───────────────────────────────────────────────────────────

/**
 * Testable version of submitServerAck with injected dependencies.
 *
 * Ownership is verified at four points:
 *  1. Before obtaining an ID token (pre-token check).
 *  2. After obtaining an ID token (post-token check).
 *  3. After the fetch resolves (post-fetch check).
 *  4. After response JSON resolves (post-JSON check).
 *
 * Returns { ok: false; reason: "uid_changed" } at any mismatch WITHOUT
 * touching any UI state — the caller is responsible for ignoring the response.
 */
export async function submitServerAckWith(
  expectedUid: string,
  ageBand: ScannerAgeBand,
  guardianPermissionConfirmed: boolean,
  deps: {
    getAuth: () => Promise<{
      currentUser: { uid: string; getIdToken: () => Promise<string> } | null;
    } | null>;
    fetchFn: typeof fetch;
  },
): Promise<ServerAckResult> {
  try {
    // 1. Pre-token ownership check
    const auth = await deps.getAuth();
    const user = auth?.currentUser;
    if (!user || user.uid !== expectedUid) {
      return { ok: false, reason: "uid_changed" };
    }

    // Fetch token
    const idToken = await user.getIdToken();

    // 2. Post-token ownership check
    if (auth.currentUser?.uid !== expectedUid) {
      return { ok: false, reason: "uid_changed" };
    }

    // Make the request
    const res = await deps.fetchFn("/api/wardrobe/acknowledge", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ageBand, guardianPermissionConfirmed }),
    });

    // 3. Post-fetch ownership check
    if (auth.currentUser?.uid !== expectedUid) {
      return { ok: false, reason: "uid_changed" };
    }

    // Parse response
    const data = await res.json() as { ok: boolean; error?: string };

    // 4. Post-JSON ownership check
    if (auth.currentUser?.uid !== expectedUid) {
      return { ok: false, reason: "uid_changed" };
    }

    if (!data.ok) {
      return { ok: false, error: data.error ?? "Could not save. Please try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save. Please try again." };
  }
}

/**
 * Submit the server-side acknowledgement for the current authenticated user.
 * Uses real Firebase auth and fetch.
 *
 * Returns { ok: false; reason: "uid_changed" } if the account changed during
 * the request — caller must not update UI in that case.
 */
export async function submitServerAck(
  expectedUid: string,
  ageBand: ScannerAgeBand,
  guardianPermissionConfirmed: boolean,
): Promise<ServerAckResult> {
  const { getFirebaseAuth } = await import("@/lib/firebase");
  return submitServerAckWith(expectedUid, ageBand, guardianPermissionConfirmed, {
    getAuth: getFirebaseAuth,
    fetchFn: fetch,
  });
}

// ── Public API (real deps) ────────────────────────────────────────────────────

/**
 * Check whether the given UID has completed the scanner acknowledgement.
 *
 * Requires expectedUid so the caller can detect account changes and avoid
 * associating one user's server status with another user (item 6).
 * Returns false on any error (fail-closed).
 */
export async function fetchAckStatus(expectedUid: string): Promise<boolean> {
  const { getFirebaseAuth } = await import("@/lib/firebase");
  return fetchAckStatusWith(expectedUid, {
    getAuth: getFirebaseAuth,
    fetchFn: fetch,
  });
}

/**
 * Check whether the current authenticated user has completed scan consent.
 *
 * Returns fast if no local record (no server call needed).
 */
export async function checkConsentStatus(): Promise<ConsentStatusResult> {
  const { getUid } = await import("@/lib/auth");
  const { loadConsent } = await import("@/lib/scanConsentStore");
  return checkConsentStatusWith({
    getUid,
    loadConsent,
    fetchAckStatus,
  });
}
