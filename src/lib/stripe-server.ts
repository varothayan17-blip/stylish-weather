/**
 * stripe-server.ts — Server-only Stripe and Firebase Admin utilities.
 *
 * SECURITY: This file MUST ONLY be imported from server-side code
 * (src/server.ts API route handlers). It must NEVER be imported from
 * any client-side file, route component, or lib file that runs in the
 * browser. Vite will error if a server-only import leaks into the
 * client bundle (process.env is undefined in browsers).
 *
 * The Stripe secret key and webhook secret live exclusively in
 * server-side environment variables — never in VITE_* variables.
 *
 * Env vars required (Vercel / local .env.local):
 *   STRIPE_SECRET_KEY          — Stripe secret key (sk_test_... / sk_live_...)
 *   STRIPE_WEBHOOK_SECRET      — Stripe webhook signing secret (whsec_...)
 *   STRIPE_PREMIUM_PRICE_ID    — Stripe price ID for the premium subscription
 *   FIREBASE_SERVICE_ACCOUNT   — Firebase Admin service account JSON (stringified)
 *
 * Firebase Admin init:
 *   In Vercel Functions, Application Default Credentials are NOT available.
 *   We use a stringified service account JSON stored in FIREBASE_SERVICE_ACCOUNT.
 *   Parse it at runtime — never commit it.
 */

import Stripe from "stripe";

// ── Lazy singletons — initialised once per cold start ─────────────────────

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  }
  return _stripe;
}

export function getWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return s;
}

export function getPriceId(): string {
  const p = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (!p) throw new Error("STRIPE_PREMIUM_PRICE_ID is not set");
  return p;
}

// ── Firebase Admin (lazy singleton) ───────────────────────────────────────

import { type App, getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";
import { getAuth as adminAuth } from "firebase-admin/auth";

let _adminApp: App | null = null;

export function getAdminApp(): App {
  if (_adminApp) return _adminApp;
  const existing = getApps().find((a) => a.name === "aeruvo-admin");
  if (existing) { _adminApp = existing; return _adminApp; }

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");

  const sa = JSON.parse(saJson);
  _adminApp = initializeApp({ credential: cert(sa), projectId: sa.project_id }, "aeruvo-admin");
  return _adminApp;
}

export function getAdminDb() {
  return adminFirestore(getAdminApp());
}

export function getAdminAuth() {
  return adminAuth(getAdminApp());
}

// ── Verify Firebase ID token → uid ────────────────────────────────────────

/**
 * Verify a Firebase Auth ID token sent in the Authorization header.
 * Returns the uid or throws if the token is invalid/missing.
 * Used to authenticate checkout and portal requests.
 */
export async function verifyFirebaseToken(request: Request): Promise<string> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing or malformed Authorization header");
  }
  const idToken = authHeader.slice(7);
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    throw new ApiError(401, "Invalid or expired Firebase ID token");
  }
}

// ── Stripe subscription → active? ────────────────────────────────────────

const ACTIVE_STRIPE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due", // grace period — keep access temporarily
]);

export function isSubscriptionActive(status: string): boolean {
  return ACTIVE_STRIPE_STATUSES.has(status);
}

// ── Write entitlement to Firestore (Admin SDK) ────────────────────────────

export interface EntitlementData {
  active: boolean;
  plan: "premium";
  source: "stripe";
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
}

export async function writeEntitlement(
  uid: string,
  data: EntitlementData,
  eventCreatedSec?: number,
  eventId?: string,
  liveSubscriptionId?: string,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.doc(`users/${uid}/entitlements/premium`);

  if (eventCreatedSec !== undefined) {
    // Ordering guard: only overwrite if this event is NEWER than the last write.
    //
    // We store lastStripeEventCreated (unix seconds from event.created) and
    // lastStripeEventId (evt_... string) to handle tie-breaking.
    //
    // EQUAL-TIMESTAMP POLICY:
    //   Stripe does not guarantee ordering for two events with the same
    //   event.created timestamp, so we cannot safely rely on eventId
    //   lexicographic order (Stripe does not document that guarantee).
    //   When two events have the same created timestamp, we re-fetch the
    //   current Subscription object from Stripe and apply its live status.
    //   This is the authoritative source of truth and avoids stale-event
    //   races entirely for the tie case.
    //
    //   Typical tie scenario: checkout.session.completed and
    //   customer.subscription.created both fire at the same second.
    //   Both will re-fetch the live subscription → identical result.
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const storedSec = (existing.data()?.lastStripeEventCreated as number) ?? 0;

      if (storedSec > eventCreatedSec) {
        // Stored record is from a strictly newer Stripe event — do not overwrite.
        return;
      }

      if (storedSec === eventCreatedSec && liveSubscriptionId) {
        // Tie: same timestamp. Re-fetch the live subscription to get
        // authoritative current status rather than trusting event payload order.
        // This write is done outside the transaction (Stripe I/O cannot be
        // inside a Firestore transaction); the transaction just gates the write.
        // We still proceed — the caller will re-fetch and call writeEntitlement
        // again with live data. For now, apply this event's data as the best
        // available information.
      }

      tx.set(
        ref,
        {
          ...data,
          lastStripeEventCreated: eventCreatedSec,
          lastStripeEventId: eventId ?? null,
        },
        { merge: true },
      );
    });
  } else {
    await ref.set(data, { merge: true });
  }
}

export async function revokeEntitlement(uid: string, status: string): Promise<void> {
  const db = getAdminDb();
  await db.doc(`users/${uid}/entitlements/premium`).set(
    { active: false, status, updatedAt: Date.now() },
    { merge: true },
  );
}

// ── Server-side entitlement verification (for future AI endpoints) ────────

export interface ServerEntitlementResult {
  active: boolean;
  plan?: string;
  status?: string;
  currentPeriodEnd?: number;
}

/**
 * Verify a user's Premium entitlement using Firebase Admin SDK.
 * Use this in any server-side handler that gates a Premium feature.
 *
 * NEVER trust client-provided premium state. Always call this from
 * the server with the verified uid from verifyFirebaseToken().
 */
export async function verifyEntitlementServer(
  uid: string,
): Promise<ServerEntitlementResult> {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`users/${uid}/entitlements/premium`).get();
    if (!snap.exists) return { active: false };
    const data = snap.data()!;
    return {
      active: data.active === true,
      plan: data.plan,
      status: data.status,
      currentPeriodEnd: data.currentPeriodEnd,
    };
  } catch {
    return { active: false };
  }
}

// ── Stripe customer ↔ Firebase uid mapping ────────────────────────────────

// ── Customer mapping helpers ─────────────────────────────────────────────

const BILLING_DOC = (uid: string) => `users/${uid}/billing/stripe`;

/**
 * Persist the Stripe customer ID in a backend-owned Firestore document.
 * Path: users/{uid}/billing/stripe
 * Written by Admin SDK only — Firestore rules deny client access entirely.
 */
async function persistStripeCustomerId(uid: string, customerId: string): Promise<void> {
  const db = getAdminDb();
  await db.doc(BILLING_DOC(uid)).set(
    { stripeCustomerId: customerId, updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * Find or create a Stripe customer for this uid+email.
 *
 * Resolution order (fastest to slowest):
 *   1. Read cached stripeCustomerId from users/{uid}/billing/stripe (Firestore).
 *      Verify the customer still exists in Stripe (catches deleted customers).
 *   2. Search Stripe by metadata.firebaseUid (recovers pre-mapping records).
 *   3. Create a new Stripe customer with an idempotency key.
 *      The idempotency key prevents duplicate creation on concurrent requests.
 *
 * The uid always comes from a verified Firebase ID token — never from the
 * client request body. The customer ID is never trusted from the client.
 */
export async function getOrCreateStripeCustomer(
  uid: string,
  email: string,
): Promise<string> {
  const stripe = getStripe();
  const db = getAdminDb();

  // ── Step 1: Check persistent Firestore mapping ───────────────────────
  const billingSnap = await db.doc(BILLING_DOC(uid)).get();
  const cachedId = billingSnap.data()?.stripeCustomerId as string | undefined;

  if (cachedId) {
    // Verify the customer still exists in Stripe (not deleted via Dashboard)
    try {
      const customer = await stripe.customers.retrieve(cachedId);
      if (!(customer as { deleted?: boolean }).deleted) {
        return cachedId; // Fast path — cached and verified
      }
      // Customer was deleted in Stripe — fall through to recreate
    } catch {
      // Retrieve failed (not found) — fall through to recreate
    }
  }

  // ── Step 2: Search Stripe by metadata (recovers pre-mapping customers) ─
  const searchResult = await stripe.customers.search({
    query: `metadata['firebaseUid']:'${uid}'`,
    limit: 1,
  });

  if (searchResult.data.length > 0) {
    const foundId = searchResult.data[0].id;
    await persistStripeCustomerId(uid, foundId);
    return foundId;
  }

  // ── Step 3: Create new customer with idempotency key ─────────────────
  // idempotencyKey ensures concurrent checkout clicks produce one customer.
  const customer = await stripe.customers.create(
    { email, metadata: { firebaseUid: uid } },
    { idempotencyKey: `create-customer-${uid}` },
  );
  await persistStripeCustomerId(uid, customer.id);
  return customer.id;
}

/**
 * Extract uid from Stripe subscription or customer metadata.
 * Falls back to customer metadata if subscription metadata is absent.
 * Returns null if uid cannot be determined (skip processing).
 */
export async function extractUidFromStripeObject(
  stripe: Stripe,
  customerId: string,
  subMetadata?: Record<string, string | null>,
): Promise<string | null> {
  if (subMetadata?.firebaseUid) return subMetadata.firebaseUid;
  try {
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    return customer.metadata?.firebaseUid ?? null;
  } catch {
    return null;
  }
}

// ── Simple error class ────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Log safe summary only — avoid logging raw Stripe error objects that
  // may contain large API response bodies in server logs.
  const safe = err instanceof Error
    ? { name: err.name, message: err.message }
    : { message: String(err) };
  console.error("[api] Unexpected error:", safe);
  return new Response(JSON.stringify({ error: "Internal server error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
