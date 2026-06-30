import { loadPrefs, savePrefs } from "./preferences";
import { cloudSync } from "./cloudSync";
import { getUid } from "./auth";

/**
 * Same adapter shape as weatherProviders and cloudSync: one interface, a
 * local default that's what actually runs today, and a Stripe-backed
 * implementation that only activates once it's genuinely configured.
 *
 * Real Stripe Checkout needs a server-side secret key to create a Checkout
 * Session — that can never live in client code, since VITE_* vars ship
 * inside the public bundle. `stripeBilling.startCheckout` is written
 * against the shape that requires (a server endpoint that creates the
 * session), but that endpoint doesn't exist yet — calling it today throws
 * a clear, specific error rather than silently doing nothing or, worse,
 * tempting a secret key into client code.
 */
export interface BillingProvider {
  id: string;
  isActive(): boolean;
  startCheckout(): Promise<void>;
  openCustomerPortal(): Promise<void>;
}

export const localOnlyBilling: BillingProvider = {
  id: "local-only",
  isActive: () => true,
  async startCheckout() {
    // Demo path: set premium=true and record a 7-day trial window so the UI
    // can show when the trial expires. Replace this entire block with the
    // Stripe redirect path (stripeBilling) once a real Stripe account exists.
    const prefs = loadPrefs();
    const trialEndsAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now
    const updated = { ...prefs, premium: true, trialEndsAt };
    savePrefs(updated);
    // Push premium status to Firestore immediately so it appears on other
    // devices the next time the same account signs in or the app opens.
    const uid = await getUid();
    if (uid) {
      await cloudSync.syncPrefs(uid, updated).catch(() => {});
    }
  },
  async openCustomerPortal() {
    /* no-op — there's no real subscription to manage yet */
  },
};

function isStripeConfigured(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

export const stripeBilling: BillingProvider = {
  id: "stripe",
  isActive: isStripeConfigured,
  async startCheckout() {
    // This endpoint doesn't exist yet — it needs to be added as a server
    // route in src/server.ts (or a TanStack Start server function) that
    // holds the Stripe secret key and creates a real Checkout Session,
    // returning its hosted `url`. Modern Stripe Checkout is a server-side
    // redirect URL, not a client-side stripe.redirectToCheckout() call.
    const res = await fetch("/api/create-checkout-session", { method: "POST" });
    if (!res.ok) {
      throw new Error(
        "Stripe is configured but /api/create-checkout-session isn't implemented yet — " +
          "this is the server-side piece still needed before real payments can run.",
      );
    }
    const { url } = await res.json();
    window.location.href = url;
  },
  async openCustomerPortal() {
    const res = await fetch("/api/create-portal-session", { method: "POST" });
    if (!res.ok) {
      throw new Error("/api/create-portal-session isn't implemented yet.");
    }
    const { url } = await res.json();
    window.location.href = url;
  },
};

export const billing: BillingProvider = isStripeConfigured() ? stripeBilling : localOnlyBilling;
