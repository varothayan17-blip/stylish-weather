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

/**
 * Thrown by authedPost when the server returns 409 Conflict.
 * Indicates the user already has an active subscription.
 * The UI handles this specifically — not as a generic error.
 */
export class AlreadySubscribedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadySubscribedError";
  }
}

/**
 * Thrown when the server returns 403 with code="STALE_AUTH".
 * The user must re-authenticate before the operation can proceed.
 */
export class StaleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleAuthError";
  }
}

/** Maximum 503-retry attempts before surfacing an error to the user. */
const MAX_503_RETRIES = 2;

async function authedPost(
  path: string,
  body?: Record<string, unknown>,
  _retryCount = 0,
): Promise<{ url: string }> {
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
    let code: string | undefined;
    try {
      const json = await res.json() as { error?: string; code?: string };
      message = json.error ?? message;
      code    = json.code;
    } catch { /* no body */ }

    // 409 = duplicate subscription — show "Manage subscription" instead of generic error
    if (res.status === 409) throw new AlreadySubscribedError(message);

    // 403 + STALE_AUTH = session too old — prompt re-authentication
    if (res.status === 403 && code === "STALE_AUTH") throw new StaleAuthError(message);

    // 503 = checkout session creation in progress (concurrent request).
    // Retry up to MAX_503_RETRIES times, honouring the Retry-After header.
    if (res.status === 503 && _retryCount < MAX_503_RETRIES) {
      const retryAfterSec = parseInt(res.headers.get("Retry-After") ?? "3", 10);
      const delayMs = Math.min(retryAfterSec * 1000, 10_000); // cap at 10s
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return authedPost(path, body, _retryCount + 1);
    }

    // 503 after exhausting retries — friendly message
    if (res.status === 503) {
      throw new Error("Checkout is temporarily busy. Please try again in a moment.");
    }

    throw new Error(message);
  }

  return res.json() as Promise<{ url: string }>;
}

// ── Billing provider interface ─────────────────────────────────────────────

export interface BillingProvider {
  id: string;
  isActive(): boolean;
  startCheckout(userEmail?: string, termsVersion?: string, privacyVersion?: string): Promise<void>;
  deleteAccount(forfeitAccess?: boolean): Promise<{ mode: string; message?: string; alreadyScheduled?: boolean }>;
  openCustomerPortal(): Promise<void>;
}

function isStripeConfigured(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

export const stripeBilling: BillingProvider = {
  id: "stripe",
  isActive: isStripeConfigured,

  async startCheckout(userEmail?: string, termsVersion?: string, privacyVersion?: string) {
    // Server verifies Firebase Auth token → uid from verified token, not client.
    // termsVersion and privacyVersion are sent so the server can validate them
    // against its own constants. The server constructs the authoritative
    // disclosure text — these are identifiers only, not policy content.
    const { url } = await authedPost("/api/create-checkout-session", {
      email:          userEmail   ?? "",
      termsVersion:   termsVersion  ?? "",
      privacyVersion: privacyVersion ?? "",
    });
    window.location.href = url;
  },

  async deleteAccount(forfeitAccess = false) {
    const res = await authedPost("/api/delete-account", { forfeitAccess });
    return res as unknown as { mode: string; message?: string; alreadyScheduled?: boolean };
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

  async deleteAccount() {
    throw new Error("Account deletion requires an active session.");
  },

  async openCustomerPortal() {
    /* no-op */
  },
};

export const billing: BillingProvider = isStripeConfigured()
  ? stripeBilling
  : localOnlyBilling;
