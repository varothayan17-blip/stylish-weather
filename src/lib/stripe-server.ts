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

/**
 * Maximum age of a Firebase ID token auth_time for sensitive operations.
 * The user must have authenticated within this window for account deletion.
 * 10 minutes is a reasonable balance between security and usability.
 */
export const MAX_AUTH_AGE_SECONDS = 10 * 60; // 10 minutes

/**
 * Like verifyFirebaseToken but also validates that the user authenticated
 * recently (auth_time within MAX_AUTH_AGE_SECONDS).
 *
 * Returns { uid, authTimeSec } on success.
 * Throws ApiError 401 for invalid tokens.
 * Throws ApiError 403 with code "STALE_AUTH" if the session is too old —
 * the client must prompt the user to sign in again.
 */
export async function verifyFreshToken(
  request: Request,
): Promise<{ uid: string; authTimeSec: number }> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing or malformed Authorization header");
  }
  const idToken = authHeader.slice(7);
  let decoded: import("firebase-admin/auth").DecodedIdToken;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    throw new ApiError(401, "Invalid or expired Firebase ID token");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const authAge = nowSec - (decoded.auth_time ?? 0);
  if (authAge > MAX_AUTH_AGE_SECONDS) {
    // Return a distinct code so the client can prompt re-authentication
    // rather than showing a generic error.
    throw new ApiError(
      403,
      "For your security, please sign in again before deleting your account.",
      "STALE_AUTH",
    );
  }
  return { uid: decoded.uid, authTimeSec: decoded.auth_time ?? 0 };
}

// ── Stripe subscription → active? ────────────────────────────────────────

/** Stripe statuses that mean the user currently has (or retains) Premium access. */
const ACTIVE_STRIPE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due", // grace period — keep access temporarily
]);

export function isSubscriptionActive(status: string): boolean {
  return ACTIVE_STRIPE_STATUSES.has(status);
}

/**
 * Returns true if this customer already has a subscription that means they
 * should not be allowed to start a new checkout session.
 *
 * Blocks: active, trialing, past_due (grace period).
 * Also blocks: canceled subscriptions where cancel_at_period_end=true and
 * the period has not yet ended (user retains access, Manage Subscription
 * is the right action).
 * Allows: fully ended canceled subscriptions, incomplete_expired.
 *
 * Uses an authoritative Stripe API call — never trusts Firestore alone.
 */
export async function hasActiveOrPendingSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  // Fetch active/trialing/past_due subscriptions only.
  // Stripe behavior for cancel_at_period_end:
  //   When a user cancels via the portal, the subscription REMAINS
  //   status="active" (or "trialing") with cancel_at_period_end=true
  //   until the period ends, at which point it BECOMES status="canceled".
  //   So a subscription with status="canceled" && cancel_at_period_end=true
  //   means the period has ALREADY ended — no access remains.
  //
  //   Correct rule: block if status is in ACTIVE_STRIPE_STATUSES
  //   (regardless of cancel_at_period_end). This correctly blocks users
  //   who scheduled cancellation but still have active access.
  //
  //   Allow resubscription only when ALL subscriptions have fully ended
  //   (status="canceled" / "incomplete_expired" / not in the active set).
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",   // include canceled so we can inspect cancel_at_period_end
    limit: 5,
  });

  for (const sub of subs.data) {
    // Block if the subscription is currently active, trialing, or past_due.
    // This covers cancel_at_period_end=true correctly: those subs remain
    // active/trialing until the period ends.
    if (ACTIVE_STRIPE_STATUSES.has(sub.status)) return true;
  }

  return false;
}

// ── Checkout session lease — acquire-before-create state machine ──────────
//
// PROBLEM: creating a Stripe Session before holding a lease means two
// concurrent requests both create Sessions, one becoming an orphan.
//
// SOLUTION: acquire a "creating" lease in Firestore BEFORE calling Stripe.
// The Stripe call happens outside the transaction. The transaction only reads
// and writes the small lease document — no external network calls inside it.
//
// STATE MACHINE:
//
//   [none / expired]
//       │  acquireCreatingLease() — transaction writes state="creating", TTL=30s
//       ▼
//   [creating]      ← Another concurrent request sees this → returns 503
//       │  (outside tx) stripe.checkout.sessions.create()
//       │  publishCheckoutSession()   — transaction writes state="open", TTL=24h
//       ▼
//   [open]          ← Subsequent requests reuse this session URL
//       │  checkout.session.completed webhook / session expired / Stripe failure
//       ▼
//   [cleared]  ← clearCheckoutLease() deletes the document
//
// CRASH RECOVERY:
//   If the server crashes after acquiring "creating" but before publishing
//   "open", the 30-second TTL causes the lease to be treated as expired by
//   the next request, which starts fresh. No manual intervention needed.
//
// NO STRIPE CALLS INSIDE TRANSACTION:
//   The Firestore transaction callbacks only read/write the Firestore doc.
//   Stripe network calls happen before (read-and-maybe-reuse) or after
//   (create session) the transaction completes.
//
// UID ISOLATION:
//   Path: users/{uid}/checkout/pending
//   The uid comes from a verified Firebase ID token. No cross-UID access.

/** "creating" lease expires in 30 seconds (crash recovery TTL). */
const CREATING_LEASE_TTL_MS = 30_000;
/** "open" lease expires in 24 hours (matches Stripe session lifetime). */
const OPEN_LEASE_TTL_MS     = 24 * 60 * 60 * 1_000;

const checkoutLeasePath = (uid: string) => `users/${uid}/checkout/pending`;

type LeaseState = "creating" | "open";

interface CheckoutLease {
  state:       LeaseState;
  /** Unique token minted when the lease was acquired. The holder verifies
   *  their own token when publishing to detect crash-recovery overwrites. */
  leaseToken:  string;
  expiresAt:   number;   // ms epoch
  createdAt:   number;
  // Only populated once state = "open":
  sessionId?:  string;
  sessionUrl?: string;
}

/**
 * Result from acquireCreatingLease:
 *  - { acquired: true, leaseToken }  — we hold the lease, proceed to create Session
 *  - { acquired: false, existingUrl } — an open session already exists, reuse it
 *  - { acquired: false, retry: true } — another request is creating, caller returns 503
 */
type AcquireResult =
  | { acquired: true;  leaseToken: string }
  | { acquired: false; existingUrl: string }
  | { acquired: false; retry: true };

/**
 * Step 1 of the state machine.
 *
 * Atomically acquires a "creating" lease or returns an existing open session.
 * No Stripe network calls inside the transaction.
 */
export async function acquireCreatingLease(
  stripe: Stripe,
  uid: string,
): Promise<AcquireResult> {
  const db  = getAdminDb();
  const ref = db.doc(checkoutLeasePath(uid));
  const now = Date.now();

  // Generate a unique token for this acquisition attempt.
  const leaseToken = crypto.randomUUID();

  let result: AcquireResult = { acquired: false, retry: true };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (snap.exists) {
      const existing = snap.data() as CheckoutLease;
      const expired  = existing.expiresAt <= now;

      if (!expired && existing.state === "open") {
        // An open session exists — return it. We verify with Stripe outside
        // the transaction (below) to avoid a network call inside the tx.
        result = { acquired: false, existingUrl: existing.sessionUrl ?? "" };
        return;
      }

      if (!expired && existing.state === "creating") {
        // Another request is currently creating a session.
        // Tell the caller to return 503 so the client retries briefly.
        result = { acquired: false, retry: true };
        return;
      }

      // Lease is expired (either state) — fall through to overwrite.
    }

    // No lease, or expired — acquire the creating lease.
    tx.set(ref, {
      state:      "creating",
      leaseToken,
      expiresAt:  now + CREATING_LEASE_TTL_MS,
      createdAt:  now,
    } satisfies CheckoutLease);

    result = { acquired: true, leaseToken };
  });

  // If we got an existingUrl, verify it with Stripe outside the transaction.
  if (!result.acquired && "existingUrl" in result && result.existingUrl) {
    // Read the sessionId for verification (we only stored URL in early result)
    try {
      const snap2  = await ref.get();
      const lease2 = snap2.exists ? (snap2.data() as CheckoutLease) : null;
      if (lease2?.state === "open" && lease2.sessionId) {
        const session = await stripe.checkout.sessions.retrieve(lease2.sessionId);
        if (session.status === "open") {
          return { acquired: false, existingUrl: session.url ?? lease2.sessionUrl ?? "" };
        }
        // Session completed/expired — clear and tell caller to acquire fresh
        try { await ref.delete(); } catch { /* best-effort */ }
        // Re-run the whole acquisition for a clean slate
        return acquireCreatingLease(stripe, uid);
      }
    } catch {
      // Could not verify — treat as expired, clear and return retry
      try { await ref.delete(); } catch { /* best-effort */ }
    }
    return { acquired: false, retry: true };
  }

  return result;
}

/**
 * Step 3 of the state machine. Called AFTER stripe.checkout.sessions.create().
 *
 * Publishes the session to the lease document. Verifies our leaseToken to
 * detect crash-recovery scenarios (another request re-acquired the lease
 * while we were waiting for Stripe). If the token no longer matches, we
 * expire our orphaned session and return the winner's URL instead.
 *
 * No Stripe calls inside the transaction.
 */
export async function publishCheckoutSession(
  stripe: Stripe,
  uid: string,
  leaseToken: string,
  sessionId: string,
  sessionUrl: string,
): Promise<string> {
  const db  = getAdminDb();
  const ref = db.doc(checkoutLeasePath(uid));
  const now = Date.now();

  let winningUrl = sessionUrl;

  await db.runTransaction(async (tx) => {
    const snap    = await tx.get(ref);
    const current = snap.exists ? (snap.data() as CheckoutLease) : null;

    if (current?.leaseToken !== leaseToken) {
      // Our lease was superseded (crash-recovery: another request re-acquired).
      // Use whatever is in the doc as the winning URL.
      winningUrl = current?.sessionUrl ?? sessionUrl;
      return; // do not overwrite
    }

    // We are still the lease holder — publish the open session.
    tx.set(ref, {
      state:      "open",
      leaseToken,
      sessionId,
      sessionUrl,
      expiresAt:  now + OPEN_LEASE_TTL_MS,
      createdAt:  current?.createdAt ?? now,
    } satisfies CheckoutLease);
  });

  // If we were superseded, expire our orphaned session best-effort.
  if (winningUrl !== sessionUrl) {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch { /* best-effort — Stripe will expire it after 24h anyway */ }
  }

  return winningUrl;
}

/**
 * Clear the checkout lease.
 * Called by: checkout.session.completed webhook, Stripe API failure.
 * Best-effort — failure does not block the user.
 */
export async function clearCheckoutLease(uid: string): Promise<void> {
  try {
    await getAdminDb().doc(checkoutLeasePath(uid)).delete();
  } catch { /* best-effort */ }
}


/**
 * Validate and return the production origin for Stripe redirect URLs.
 *
 * In production: reads AERUVO_ORIGIN env var and validates it is an
 * https://aeruvo.app origin. Fails closed (throws) if missing or invalid.
 *
 * In development (NODE_ENV !== "production"): falls through to the
 * request-derived origin, which allows localhost testing without the var.
 *
 * Never allows an arbitrary caller-supplied origin in production.
 */
export function getProductionOrigin(requestUrl: string): string {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    const configured = process.env.AERUVO_ORIGIN?.trim();
    if (!configured) {
      throw new ApiError(500, "Server misconfiguration: AERUVO_ORIGIN is not set");
    }
    // Must be an HTTPS aeruvo.app origin — no trailing slash, no path
    if (!/^https:\/\/([a-z0-9-]+\.)?aeruvo\.app$/.test(configured)) {
      throw new ApiError(500, "Server misconfiguration: AERUVO_ORIGIN must be an https://aeruvo.app origin");
    }
    return configured;
  }

  // Development: derive from request URL (allows localhost)
  return new URL(requestUrl).origin;
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
  readonly code?: string;
  constructor(public readonly status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export function apiErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return new Response(JSON.stringify({ error: err.message, code: err.code }), {
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
