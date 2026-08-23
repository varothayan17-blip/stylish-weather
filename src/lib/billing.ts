/**
 * billing.ts — Billing provider abstraction for Aeruvo.
 *
 * P1 SECURITY: localOnlyBilling no longer grants premium access.
 *   The previous demo path (premium=true in localStorage) has been removed.
 *   Premium entitlement is backend-owned: users/{uid}/entitlements/premium.
 *   Nothing the client can do will create an entitlement document.
 *
 * P2/P3: Implement stripeBilling.startCheckout() with a real server-side
 *   /api/create-checkout-session endpoint. The Stripe secret key must NEVER
 *   appear in client code or VITE_* variables. The webhook handler writes
 *   the entitlement document to Firestore using Admin SDK.
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
    // P1: Secure checkout is not implemented yet.
    // Payments and entitlement creation require a backend Stripe integration
    // (P2/P3). Until that exists, we do nothing rather than grant fake premium
    // access that could be exploited.
    throw new Error(
      "Premium checkout is coming soon. Stay tuned for Wardrobe AI and more!"
    );
  },
  async openCustomerPortal() {
    /* no-op — no subscription to manage yet */
  },
};

function isStripeConfigured(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

export const stripeBilling: BillingProvider = {
  id: "stripe",
  isActive: isStripeConfigured,
  async startCheckout() {
    // P2/P3: This endpoint needs to be implemented in src/server.ts or a
    // TanStack Start server function. It holds the Stripe secret key and
    // creates a real Checkout Session. After the user pays, Stripe sends a
    // webhook to /api/stripe-webhook, which writes users/{uid}/entitlements/premium
    // via Firebase Admin SDK — never via client code.
    const res = await fetch("/api/create-checkout-session", { method: "POST" });
    if (!res.ok) {
      throw new Error(
        "Stripe is configured but /api/create-checkout-session isn't implemented yet."
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

export const billing: BillingProvider = isStripeConfigured()
  ? stripeBilling
  : localOnlyBilling;
