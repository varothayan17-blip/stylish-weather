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

import { useState, useEffect } from "react";
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

// ── useEntitlement hook ───────────────────────────────────────────────────

/**
 * React hook: subscribes to the current user's entitlement.
 *
 * Waits for Firebase Auth to resolve before querying Firestore.
 * Never hangs forever — resolves to Free on auth timeout (5 s).
 *
 * Rules:
 *   - Initialises as { loading: true }
 *   - Resolves to { active: false, reason: "signed-out" } when no user
 *   - Resolves to { active: false, reason: "missing" } when no entitlement doc
 *   - Resolves to { active: true, entitlement } when backend grants Premium
 *   - Resolves to { active: false, reason: "error" } on Firestore failure
 *   - Re-fetches when auth state changes (sign-in / sign-out)
 *   - Re-fetches on tab focus (user may have completed checkout in another tab)
 *   - localStorage and prefs.premium are NEVER consulted
 *
 * Use this hook instead of calling fetchEntitlement() directly in useEffect.
 */
export function useEntitlement(): EntitlementResult {
  const [result, setResult] = useState<EntitlementResult>({ loading: true });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Wait for Firebase Auth to initialise — currentUser is null until
      // the SDK has rehydrated the persisted session. We wait up to 5 s.
      // If auth doesn't resolve in time, treat as signed-out (Free).
      let uid: string | null = null;
      try {
        const { getFirebaseAuth } = await import("./firebase");
        const fbAuth = await getFirebaseAuth();

        if (fbAuth) {
          // currentUser may already be populated (fast path)
          if (fbAuth.currentUser) {
            uid = fbAuth.currentUser.uid;
          } else {
            // Wait for the auth state to settle with a 5-second timeout.
            // Hoist the firebase/auth import before the Promise executor
            // (Promise callbacks are not async — await is not available inside them).
            const { onAuthStateChanged } = await import("firebase/auth");
            uid = await new Promise<string | null>((resolve) => {
              const timer = setTimeout(() => {
                unsubscribe();
                resolve(null); // timeout → treat as signed-out
              }, 5_000);

              const unsubscribe = onAuthStateChanged(fbAuth, (user) => {
                clearTimeout(timer);
                unsubscribe();
                resolve(user?.uid ?? null);
              });
            });
          }
        }
      } catch {
        uid = null;
      }

      if (cancelled) return;

      if (!uid) {
        setResult({ loading: false, active: false, reason: "signed-out" });
        return;
      }

      // Now fetch the entitlement document
      const entResult = await fetchEntitlementForUid(uid);
      if (!cancelled) setResult(entResult);
    }

    load();

    // Re-fetch on tab focus: user may have completed Stripe checkout
    // in another tab and the entitlement doc was just created.
    const onFocus = () => { if (!cancelled) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

/**
 * Internal: fetch entitlement for a known uid.
 * Separated from fetchEntitlement() so useEntitlement can pass the
 * auth-resolved uid directly without calling getUid() again.
 */
async function fetchEntitlementForUid(uid: string): Promise<EntitlementResult> {
  try {
    const { getFirestoreDb } = await import("./firebase");
    const db = await getFirestoreDb();
    if (!db) return { loading: false, active: false, reason: "error" };

    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "users", uid, "entitlements", "premium"));

    if (!snap.exists()) return { loading: false, active: false, reason: "missing" };
    const data = snap.data() as PremiumEntitlement;
    if (!data.active) return { loading: false, active: false, reason: "inactive" };
    return { loading: false, active: true, entitlement: data };
  } catch {
    return { loading: false, active: false, reason: "error" };
  }
}
