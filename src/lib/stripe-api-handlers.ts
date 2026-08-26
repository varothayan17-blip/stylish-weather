/**
 * stripe-api-handlers.ts — Server-side API route handlers for Stripe.
 *
 * IMPORTED ONLY FROM src/server.ts.
 * Must never be imported from any client-side file.
 *
 * Routes implemented:
 *   POST /api/create-checkout-session
 *   POST /api/create-portal-session
 *   POST /api/stripe-webhook
 */

import Stripe from "stripe";
import {
  getStripe,
  getPriceId,
  getWebhookSecret,
  getProductionOrigin,
  getAdminDb,
  verifyFirebaseToken,
  getOrCreateStripeCustomer,
  hasActiveOrPendingSubscription,
  acquireCreatingLease,
  publishCheckoutSession,
  clearCheckoutLease,
  extractUidFromStripeObject,
  isSubscriptionActive,
  writeEntitlement,
  revokeEntitlement,
  ApiError,
  apiErrorResponse,
} from "./stripe-server";
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  SUBSCRIPTION_DISCLOSURE,
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_TRIAL_DAYS,
} from "./policyVersions";

// ── POST /api/create-checkout-session ─────────────────────────────────────

// ── POST /api/create-checkout-session ─────────────────────────────────────
//
// Flow:
//  1. Verify Firebase ID token → uid (server-authoritative)
//  2. Validate client-submitted policy-version acceptance against server constants
//  3. Check for existing active subscription → 409
//  4. Acquire "creating" lease (state machine) → may return 503 or reuse open session
//  5. Create Stripe Checkout Session (outside Firestore transaction)
//  6. Publish session to lease document; record consent linked to session
//  7. Return redirect URL

export async function handleCreateCheckoutSession(request: Request): Promise<Response> {
  try {
    const uid = await verifyFirebaseToken(request);

    // ── Parse request body ────────────────────────────────────────────────
    let email        = "";
    let termsVersion = "";
    let privacyVersion = "";
    try {
      const body = await request.json() as {
        email?: string;
        termsVersion?: string;
        privacyVersion?: string;
      };
      email          = body.email          ?? "";
      termsVersion   = body.termsVersion   ?? "";
      privacyVersion = body.privacyVersion ?? "";
    } catch { /* missing body is treated as missing consent */ }

    // ── Consent version validation ─────────────────────────────────────────
    // The client sends the version identifiers it displayed to the user.
    // The server validates them against its own constants. The server
    // never trusts client-supplied disclosure text, price, or trial duration.
    if (termsVersion !== CURRENT_TERMS_VERSION) {
      throw new ApiError(
        400,
        "Please review and accept the current Terms of Service before subscribing.",
      );
    }
    if (privacyVersion !== CURRENT_PRIVACY_VERSION) {
      throw new ApiError(
        400,
        "Please review and accept the current Privacy Policy before subscribing.",
      );
    }

    const stripe  = getStripe();
    const priceId = getPriceId();

    // ── Get/create Stripe customer ─────────────────────────────────────────
    const customerId = await getOrCreateStripeCustomer(uid, email);

    // ── Duplicate subscription guard ──────────────────────────────────────
    const alreadySubscribed = await hasActiveOrPendingSubscription(stripe, customerId);
    if (alreadySubscribed) {
      throw new ApiError(
        409,
        "You already have an active subscription. Use Manage Subscription to make changes.",
      );
    }

    // ── Block Checkout while account deletion is pending ──────────────────
    // Prevents a new subscription from being created while the account is
    // being deleted (or has a partial-failure deletion job outstanding).
    const { hasActiveDeletionJob } = await import("./account-deletion-handler");
    if (await hasActiveDeletionJob(uid)) {
      throw new ApiError(
        409,
        "Your account has a pending deletion request. " +
        "New subscriptions cannot be created while deletion is in progress. " +
        "Contact supportaeruvo@gmail.com if you would like to cancel the deletion.",
      );
    }

    const origin = getProductionOrigin(request.url);

    // ── Checkout session lease — acquire-before-create ─────────────────────
    const acquired = await acquireCreatingLease(stripe, uid);

    if (!acquired.acquired && "existingUrl" in acquired) {
      // An open session already exists — reuse it without creating a new one.
      // Consent for the reused session was recorded when it was first created.
      return new Response(JSON.stringify({ url: acquired.existingUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!acquired.acquired && "retry" in acquired) {
      // Another server request is concurrently creating a session.
      // Return 503 so the client can retry briefly.
      return new Response(
        JSON.stringify({ error: "Checkout in progress — please wait a moment and try again." }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "3",
          },
        },
      );
    }

    // We hold the "creating" lease. Create the Stripe session outside Firestore tx.
    const { leaseToken } = acquired;

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "subscription",
        // "auto" lets Stripe collect only what is required for the
        // selected payment method and tax/fraud compliance.
        // No custom address form; no shipping address; no phone number.
        billing_address_collection: "auto",
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: SUBSCRIPTION_TRIAL_DAYS,
          metadata: { firebaseUid: uid },
        },
        // success_url does NOT grant Premium — only the webhook does.
        success_url: `${origin}/premium?checkout=success`,
        cancel_url:  `${origin}/premium?checkout=cancelled`,
        allow_promotion_codes: true,
      });
    } catch (stripeErr) {
      // Stripe API failure — clear the "creating" lease so the next attempt starts fresh.
      await clearCheckoutLease(uid);
      throw stripeErr;
    }

    // ── Publish session and record consent ─────────────────────────────────
    // publishCheckoutSession also handles the case where the lease was superseded
    // during the Stripe call (crash recovery) — expiring our orphaned session.
    const url = await publishCheckoutSession(
      stripe, uid, leaseToken, session.id, session.url ?? "",
    );

    // Write the consent record linked to this Checkout Session ID.
    // Written via Admin SDK — client cannot create or modify this document.
    // Idempotent: if the same session ID already has a record, skip.
    await recordCheckoutConsent(uid, session.id, {
      termsVersion,
      privacyVersion,
      priceId,
      currency:      SUBSCRIPTION_CURRENCY,
      trialDays:     SUBSCRIPTION_TRIAL_DAYS,
      disclosureText: SUBSCRIPTION_DISCLOSURE,
    });

    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// ── Consent record ─────────────────────────────────────────────────────────

interface ConsentRecord {
  uid:             string;
  sessionId:       string;   // Stripe Checkout Session ID
  termsVersion:    string;
  privacyVersion:  string;
  priceId:         string;
  currency:        string;
  trialDays:       number;
  disclosureText:  string;   // server-constructed — never client-supplied
  recordedAt:      number;   // ms epoch — server time, never client time
  recordedBy:      "aeruvo-server";
  version:         1;
}

/**
 * Write a consent record to users/{uid}/consentRecords/{sessionId}.
 *
 * IDEMPOTENT: if a record for this sessionId already exists (retry or
 * reused session), we skip the write to avoid duplicate records.
 *
 * RETENTION: consent records are retained for the duration of the
 * subscription plus 7 years (tax/legal hold). They are not deleted by
 * the normal account-deletion flow. After the hold period the record
 * is severed from the user profile (uid field zeroed) rather than
 * deleted, preserving the legal evidence without personal linkage.
 *
 * PROTECTION: users/{uid}/consentRecords/{id} has allow read/write: if false
 * in Firestore rules — Admin SDK only.
 */
async function recordCheckoutConsent(
  uid: string,
  sessionId: string,
  details: Omit<ConsentRecord, "uid"|"sessionId"|"recordedAt"|"recordedBy"|"version">,
): Promise<void> {
  try {
    const db  = getAdminDb();
    const ref = db.doc(`users/${uid}/consentRecords/${sessionId}`);
    const snap = await ref.get();
    if (snap.exists) return; // already recorded — idempotent
    await ref.set({
      uid,
      sessionId,
      ...details,
      recordedAt: Date.now(),
      recordedBy: "aeruvo-server",
      version:    1,
    } satisfies ConsentRecord);
  } catch (e) {
    // Consent record failure must not block the checkout redirect.
    // Log for manual investigation but do not surface to the user.
    const safe = e instanceof Error ? { name: e.name, message: e.message } : { message: String(e) };
    console.error("[checkout] Failed to write consent record:", safe);
  }
}


// ── POST /api/create-portal-session ───────────────────────────────────────

export async function handleCreatePortalSession(request: Request): Promise<Response> {
  try {
    const uid = await verifyFirebaseToken(request);
    const stripe = getStripe();

    // Find the customer tied to this uid
    const existing = await stripe.customers.search({
      query: `metadata['firebaseUid']:'${uid}'`,
      limit: 1,
    });

    if (existing.data.length === 0) {
      throw new ApiError(404, "No Stripe customer found for this account");
    }

    const origin = getProductionOrigin(request.url);
    const session = await stripe.billingPortal.sessions.create({
      customer: existing.data[0].id,
      return_url: `${origin}/premium`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// ── POST /api/stripe-webhook ───────────────────────────────────────────────

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const stripe = getStripe();
  const secret = getWebhookSecret();

  // Read raw body for signature verification — must not call .json() first
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response("Cannot read body", { status: 400 });
  }

  const sig = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    // Invalid signature — reject immediately. 400 tells Stripe not to retry.
    console.warn("[webhook] Invalid signature:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await dispatchWebhookEvent(stripe, event);
  } catch (err) {
    // Distinguish transient (retryable) errors from permanent ones.
    // Permanent: uid not found, already processed — return 200 so Stripe stops.
    // Transient: Firebase unavailable, network timeout — return 500 so Stripe retries.
    if (isTransientError(err)) {
      // Sanitized log — never log raw Stripe objects, bodies, or PII
      const safe = err instanceof Error
        ? { name: err.name, message: err.message }
        : { message: String(err) };
      console.error("[webhook] Transient error (will retry):", safe);
      return new Response("Temporary error", { status: 500 });
    }
    // Permanent failure — log and ack so Stripe does not retry forever
    const safe = err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) };
    console.error("[webhook] Permanent handler error (acknowledged):", safe);
  }

  // 200 = delivered. Stripe will not retry.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Returns true for errors that are transient and should be retried by Stripe.
 * Firebase UNAVAILABLE, network timeouts, and unknown errors are transient.
 * "uid not found", "already processed" are permanent.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return true; // unknown — retry to be safe
  // Firebase Admin error codes for transient failures
  const msg = err.message.toLowerCase();
  if (msg.includes("unavailable") || msg.includes("deadline") || msg.includes("timeout")) {
    return true;
  }
  // Stripe network errors
  if (err.name === "StripeConnectionError" || err.name === "StripeAPIError") {
    return true;
  }
  // Permanent: uid not found, document already in expected state
  return false;
}

// ── Webhook event dispatcher ───────────────────────────────────────────────

async function dispatchWebhookEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      await handleCheckoutCompleted(stripe, session);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpsert(stripe, sub, event.created, event.id);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(stripe, sub);
      break;
    }

    case "invoice.paid": {
      // Renewal confirmed — ensure access is active
      const inv_paid = event.data.object as unknown as { subscription?: string | { id: string } | null };
      const subId_paid = typeof inv_paid.subscription === "string"
        ? inv_paid.subscription
        : (inv_paid.subscription as { id: string } | null)?.id ?? null;
      if (subId_paid) {
        const sub = await stripe.subscriptions.retrieve(subId_paid);
        await handleSubscriptionUpsert(stripe, sub, event.created, event.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      // Payment failed — update status but do NOT immediately revoke
      // (Stripe will retry; status moves to past_due first, then canceled)
      const inv_fail = event.data.object as unknown as { subscription?: string | { id: string } | null };
      const subId_fail = typeof inv_fail.subscription === "string"
        ? inv_fail.subscription
        : (inv_fail.subscription as { id: string } | null)?.id ?? null;
      if (subId_fail) {
        const sub = await stripe.subscriptions.retrieve(subId_fail);
        await handleSubscriptionUpsert(stripe, sub, event.created, event.id);
      }
      break;
    }

    case "customer.subscription.trial_will_end": {
      // Stripe fires this 3 days before trial ends.
      // We do not have a battle-tested email or push system in place yet.
      // Dashboard action: enable Stripe's built-in trial reminder emails in
      // Stripe Dashboard → Settings → Billing → Subscription lifecycle.
      // That is a zero-code option that is safer than building a new comms
      // pipeline before Live launch.
      // Log for visibility only.
      const sub = event.data.object as Stripe.Subscription;
      console.info("[webhook] trial_will_end:", {
        subId: sub.id.slice(0, 8) + "***",
        trialEnd: sub.trial_end,
      });
      break;
    }

    default:
      // Unhandled event type — no-op, return 200
      break;
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const subId = session.subscription as string;
  // Retrieve the full subscription to get current status and period end
  const sub = await stripe.subscriptions.retrieve(subId);
  await handleSubscriptionUpsert(stripe, sub, session.created, session.id);

  // Clear the checkout lease for this uid so a future legitimate checkout
  // (after the subscription ends) starts with a fresh session.
  const uid = sub.metadata?.firebaseUid ??
    (await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer).metadata?.firebaseUid;
  if (uid) await clearCheckoutLease(uid);
}

async function handleSubscriptionUpsert(
  stripe: Stripe,
  sub: Stripe.Subscription,
  eventCreatedSec?: number,
  eventId?: string,
): Promise<void> {
  const customerId = sub.customer as string;
  const uid = await extractUidFromStripeObject(
    stripe, customerId, sub.metadata as Record<string, string>,
  );

  if (!uid) {
    console.warn("[webhook] Cannot determine uid for customer:", customerId.slice(0, 8) + "***");
    // This is a permanent failure — no uid, no way to update entitlement.
    // Return normally (will be ack'd as 200). Do not retry.
    return;
  }

  const active = isSubscriptionActive(sub.status);
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ?? 0;

  await writeEntitlement(uid, {
    active,
    plan: "premium",
    source: "stripe",
    status: sub.status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd * 1000,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: Date.now(),
  }, eventCreatedSec, eventId, sub.id);

  // Sanitized log — uid truncated, no customer data, no subscription details beyond status
  console.info("[webhook] Entitlement updated:", {
    uid: uid.slice(0, 4) + "***",
    active,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

async function handleSubscriptionDeleted(
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId = sub.customer as string;
  const uid = await extractUidFromStripeObject(
    stripe, customerId, sub.metadata as Record<string, string>,
  );

  if (!uid) {
    console.warn("[webhook] Cannot determine uid for deleted subscription");
    return;
  }

  await revokeEntitlement(uid, sub.status);
  console.info("[webhook] Entitlement revoked:", { uid: uid.slice(0, 4) + "***" });

  // Check if a scheduled account deletion is pending for this uid.
  // If so, re-query Stripe and finalise if no renewable subscription remains.
  try {
    const { completeDeletionFromWebhook } = await import("./account-deletion-handler");
    await completeDeletionFromWebhook(stripe, uid, customerId);
  } catch (e) {
    const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
    console.error("[webhook] Scheduled account deletion completion failed:", safe);
    // Do not re-throw — the webhook already processed the subscription deletion.
    // The scheduled deletion will retry on the next webhook attempt or reconciliation.
  }
}
