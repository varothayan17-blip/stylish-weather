/**
 * billing.ts — Billing provider abstraction for Aeruvo.
 *
 * SECURITY MODEL:
 *   - Server endpoints verify the Firebase ID token before creating sessions.
 *   - The uid comes from the VERIFIED token, not from any client-supplied param.
 *   - The Stripe secret key lives in server-only env vars (never VITE_*).
 *   - Entitlement is only written by the Stripe webhook handler on the server.
 *   - Returning from Stripe checkout does NOT grant Premium — only the webhook does.
 *
 * Client-visible env var (safe — publishable key only):
 *   VITE_STRIPE_PUBLISHABLE_KEY — used only to detect if Stripe is configured.
 *
 * Server-only env vars (never in VITE_*):
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PREMIUM_PRICE_ID
 *   (see src/lib/stripe-server.ts for full server-only env var list)
 */

import { getFirebaseAuth } from "./firebase";

// ── Get a Firebase ID token to authenticate API requests ──────────────────

async function getIdToken(): Promise<string | null> {
  try {
    const fbAuth = await getFirebaseAuth();
    const user = fbAuth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

// ── Authenticated fetch to a server endpoint ──────────────────────────────

async function authedPost(path: string, body?: Record<string, unknown>): Promise<{ url: string }> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("You must be signed in to access Premium.");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    let message = `Server error: ${res.status}`;
    try { message = (await res.json() as { error?: string }).error ?? message; } catch { /* no body */ }
    throw new Error(message);
  }

  return res.json() as Promise<{ url: string }>;
}

// ── Billing provider interface ─────────────────────────────────────────────

export interface BillingProvider {
  id: string;
  isActive(): boolean;
  startCheckout(userEmail?: string): Promise<void>;
  openCustomerPortal(): Promise<void>;
}

function isStripeConfigured(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

export const stripeBilling: BillingProvider = {
  id: "stripe",
  isActive: isStripeConfigured,

  async startCheckout(userEmail?: string) {
    // Server verifies Firebase Auth token → uid from verified token, not client.
    // email is passed for display in Stripe checkout (not for identity).
    const { url } = await authedPost("/api/create-checkout-session", { email: userEmail ?? "" });
    window.location.href = url;
  },

  async openCustomerPortal() {
    const { url } = await authedPost("/api/create-portal-session");
    window.location.href = url;
  },
};

export const localOnlyBilling: BillingProvider = {
  id: "local-only",
  isActive: () => true,

  async startCheckout() {
    // Stripe is not configured — show a helpful message.
    // Premium checkout requires STRIPE_SECRET_KEY and related server env vars.
    // This path is hit in local development without Stripe configured.
    throw new Error(
      "Premium checkout is not available yet. Add VITE_STRIPE_PUBLISHABLE_KEY to enable Stripe."
    );
  },

  async openCustomerPortal() {
    /* no-op */
  },
};

export const billing: BillingProvider = isStripeConfigured()
  ? stripeBilling
  : localOnlyBilling;
