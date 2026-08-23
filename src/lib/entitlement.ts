/**
 * entitlement.ts — Client-side entitlement reader for Aeruvo Premium.
 *
 * SECURITY MODEL:
 *   entitlements/{entitlementId} documents are written EXCLUSIVELY by the
 *   backend (Admin SDK / Stripe webhook handler). The client may ONLY read
 *   its own entitlement. Firestore rules enforce write=false for clients.
 *
 *   Premium status is determined SOLELY by:
 *     users/{uid}/entitlements/premium.active === true
 *
 *   The following sources are NEVER authoritative for premium:
 *     - localStorage (trivially editable via DevTools)
 *     - prefs.premium (removed from Firestore write path in P1)
 *     - prefs.trialEndsAt (removed in P1)
 *
 * DOCUMENT PATH:
 *   users/{uid}/entitlements/premium
 *
 * P2/P3 NOTE:
 *   When Stripe is integrated, the webhook handler writes this document after
 *   a successful checkout.session.completed event. Until then, no entitlement
 *   document exists for any user → all users are Free tier.
 */

import { getFirestoreDb } from "./firebase";
import { getUid } from "./auth";

// ── Entitlement document shape ────────────────────────────────────────────

/**
 * Shape of users/{uid}/entitlements/premium in Firestore.
 * Written exclusively by the backend. Client reads only.
 */
export type PremiumEntitlement = {
  /** True when the user currently has access to Premium features. */
  active: boolean;
  /** The product plan tier. */
  plan: "trial" | "premium";
  /** How this entitlement was granted. */
  source: "stripe" | "trial" | "admin";
  /**
   * Current status of the Stripe subscription.
   * "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "paused"
   * absent for non-Stripe sources.
   */
  status?: string;
  /** ISO date string of when the trial ends, e.g. "2026-09-01". Set by server. */
  trialEnd?: string;
  /** Unix ms timestamp of the end of the current billing period. */
  currentPeriodEnd?: number;
  /** True if the subscription will not renew at currentPeriodEnd. */
  cancelAtPeriodEnd?: boolean;
  /** Stripe Customer ID — backend only, never shown in UI. */
  stripeCustomerId?: string;
  /** Stripe Subscription ID — backend only, never shown in UI. */
  stripeSubscriptionId?: string;
  /** Server timestamp (ms) of the last write to this document. */
  updatedAt: number;
};

// ── Entitlement result returned to UI ─────────────────────────────────────

export type EntitlementResult =
  | { loading: true }
  | { loading: false; active: false; reason: "signed-out" | "missing" | "inactive" | "error" }
  | { loading: false; active: true; entitlement: PremiumEntitlement };

// ── One-shot reader ────────────────────────────────────────────────────────

/**
 * Fetches the current user's entitlement once from Firestore.
 * Returns Free (active: false) for all error/missing cases.
 * Never throws.
 *
 * Call this in components that need the current premium state.
 * For reactive updates use subscribeToEntitlement().
 */
export async function fetchEntitlement(): Promise<EntitlementResult> {
  const uid = await getUid().catch(() => null);
  if (!uid) return { loading: false, active: false, reason: "signed-out" };

  try {
    const db = await getFirestoreDb();
    if (!db) return { loading: false, active: false, reason: "error" };

    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "users", uid, "entitlements", "premium"));

    if (!snap.exists()) {
      return { loading: false, active: false, reason: "missing" };
    }

    const data = snap.data() as PremiumEntitlement;
    if (!data.active) {
      return { loading: false, active: false, reason: "inactive" };
    }

    return { loading: false, active: true, entitlement: data };
  } catch {
    // Firestore read failure → treat as Free, never optimistically grant Premium
    return { loading: false, active: false, reason: "error" };
  }
}

/**
 * Subscribe to real-time entitlement updates.
 * Returns an unsubscribe function.
 *
 * Use in top-level app context if real-time premium state is needed.
 * For most screens, fetchEntitlement() on mount is sufficient.
 */
export async function subscribeToEntitlement(
  onChange: (result: EntitlementResult) => void,
): Promise<() => void> {
  const uid = await getUid().catch(() => null);
  if (!uid) {
    onChange({ loading: false, active: false, reason: "signed-out" });
    return () => {};
  }

  try {
    const db = await getFirestoreDb();
    if (!db) {
      onChange({ loading: false, active: false, reason: "error" });
      return () => {};
    }

    const { doc, onSnapshot } = await import("firebase/firestore");
    return onSnapshot(
      doc(db, "users", uid, "entitlements", "premium"),
      (snap) => {
        if (!snap.exists()) {
          onChange({ loading: false, active: false, reason: "missing" });
          return;
        }
        const data = snap.data() as PremiumEntitlement;
        if (!data.active) {
          onChange({ loading: false, active: false, reason: "inactive" });
          return;
        }
        onChange({ loading: false, active: true, entitlement: data });
      },
      () => {
        onChange({ loading: false, active: false, reason: "error" });
      },
    );
  } catch {
    onChange({ loading: false, active: false, reason: "error" });
    return () => {};
  }
}

/**
 * Server-side entitlement verification interface.
 *
 * P2/P3: Implement this in a TanStack Start server function or API route.
 * Use Firebase Admin SDK — never the client SDK — to read entitlements.
 * This function is the authoritative gate for all premium AI/server operations.
 *
 * Example usage in a future API route:
 *   const active = await verifyEntitlementServer(uid);
 *   if (!active) return new Response("Payment Required", { status: 402 });
 *
 * NEVER call this from client code — it must run in a server context with
 * Admin SDK credentials. Client-side entitlement is read-only display state.
 */
export type ServerEntitlementVerifier = (uid: string) => Promise<boolean>;

/**
 * Placeholder that documents where the server verifier belongs.
 * Replace this comment block with a real implementation in P2/P3 when
 * TanStack Start server functions or API routes are added.
 *
 * The implementation should:
 *   const snap = await adminDb.doc(`users/${uid}/entitlements/premium`).get();
 *   return snap.exists() && snap.data()?.active === true;
 */
export const SERVER_ENTITLEMENT_NOTE = `
P2/P3: Add verifyEntitlementServer(uid) to src/server.ts or a dedicated
server function. Use firebase-admin to read users/{uid}/entitlements/premium.
Never trust client-provided premium status for server-side AI operations.
`;
