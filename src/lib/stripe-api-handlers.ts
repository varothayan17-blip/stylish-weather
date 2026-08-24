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
  verifyFirebaseToken,
  getOrCreateStripeCustomer,
  extractUidFromStripeObject,
  isSubscriptionActive,
  writeEntitlement,
  revokeEntitlement,
  ApiError,
  apiErrorResponse,
} from "./stripe-server";

// ── POST /api/create-checkout-session ─────────────────────────────────────

export async function handleCreateCheckoutSession(request: Request): Promise<Response> {
  try {
    // Verify Firebase Auth — uid comes from the verified token, not from
    // the request body. Client cannot forge a uid.
    const uid = await verifyFirebaseToken(request);

    // Get the user's email from the request body (display only — never trusted
    // as the identity, which comes from the verified token above).
    let email = "";
    try {
      const body = await request.json() as { email?: string };
      email = body.email ?? "";
    } catch { /* no body is fine */ }

    const stripe = getStripe();
    const priceId = getPriceId();

    // Find or create a Stripe customer tied to this Firebase uid.
    const customerId = await getOrCreateStripeCustomer(uid, email);

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // uid in subscription metadata for webhook recovery if customer lookup fails
      subscription_data: {
        metadata: { firebaseUid: uid },
      },
      // success_url does NOT grant Premium — only the webhook does.
      // The session_id param lets us show a "thank you" page if desired.
      success_url: `${origin}/premium?checkout=success`,
      cancel_url:  `${origin}/premium?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return apiErrorResponse(err);
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

    const origin = new URL(request.url).origin;
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
    // Invalid signature — reject immediately
    console.warn("[webhook] Invalid signature:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await dispatchWebhookEvent(stripe, event);
  } catch (err) {
    // Log but return 200 to prevent Stripe from retrying indefinitely
    // on permanent failures (e.g. uid not found in metadata).
    console.error("[webhook] Handler error:", err);
  }

  // Always return 200 after signature verification so Stripe marks it delivered
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
      // Use unknown cast to access subscription field safely across Stripe SDK versions
      const inv_paid = event.data.object as unknown as { subscription?: string | { id: string } | null };
      const subId_paid = typeof inv_paid.subscription === 'string'
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
      const subId_fail = typeof inv_fail.subscription === 'string'
        ? inv_fail.subscription
        : (inv_fail.subscription as { id: string } | null)?.id ?? null;
      if (subId_fail) {
        const sub = await stripe.subscriptions.retrieve(subId_fail);
        await handleSubscriptionUpsert(stripe, sub, event.created, event.id);
      }
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
  const customerId = session.customer as string;
  const subId      = session.subscription as string;

  // Retrieve the full subscription to get current status and period end
  const sub = await stripe.subscriptions.retrieve(subId);
  // Use session.created as the event timestamp for ordering guard
  // session.id used as eventId for tie-breaking; session.created as the Stripe event timestamp
  await handleSubscriptionUpsert(stripe, sub, session.created, session.id);
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
    return;
  }

  const active = isSubscriptionActive(sub.status);
  // In Stripe 22.x, current_period_end is on the SubscriptionItem, not Subscription.
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ?? 0;

  await writeEntitlement(uid, {
    active,
    plan: "premium",
    source: "stripe",
    status: sub.status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd * 1000, // Stripe uses seconds, we store ms
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: Date.now(),
  }, eventCreatedSec, eventId, sub.id);

  console.info("[webhook] Entitlement updated:", {
    uid: uid.slice(0, 4) + "***",
    active,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    priceId: item?.price?.id ?? "unknown",
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
}
