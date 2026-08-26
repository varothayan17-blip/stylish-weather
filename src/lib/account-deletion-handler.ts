/**
 * account-deletion-handler.ts — Server-only account deletion handler.
 *
 * ── DELETION ARCHITECTURE ─────────────────────────────────────────────────
 *
 * TWO MODES:
 *
 * SCHEDULED (active/trialing/past_due subscription, no explicit forfeit):
 *   Step 1.  verifyFreshToken — auth_time ≤ MAX_AUTH_AGE_SECONDS or 403 STALE_AUTH
 *   Step 2.  Idempotency check — return existing job state if already pending
 *   Step 3.  Query Stripe — all subscriptions for this customer
 *   Step 4.  set cancel_at_period_end=true on all renewable subs
 *            → if any update fails: return 503, no data changed
 *   Step 5.  Calculate expectedDeletionAt from latest period_end
 *   Step 6.  Write deletionJobs/{jobId} (Admin-only, outside user tree)
 *   Step 7.  Write users/{uid}/pendingDeletion/request pointing to jobId
 *   Step 8.  Revoke FCM device tokens only (disclosed)
 *   Step 9.  Return {mode:"scheduled", expectedDeletionAt}
 *   ↓ webhook fires → runProfileDeletion(jobId)
 *
 * IMMEDIATE FORFEITURE (explicit forfeitAccess: true):
 *   Step 1.  verifyFreshToken
 *   Step 2.  Idempotency check
 *   Step 3.  Query Stripe
 *   Step 4.  stripe.subscriptions.cancel() each renewable
 *            → if cancel fails: return 503, no data changed (HARD STOP)
 *   Step 5.  Recheck Stripe — confirm no renewable remains
 *            → if recheck shows any: return 503, no data changed (HARD STOP)
 *   Step 6.  Write deletionJobs/{jobId} (Admin-only, outside user tree)
 *   Step 7.  Write users/{uid}/pendingDeletion/request
 *   Step 8.  deleteProfileCollections(uid)
 *            → if ANY collection fails: mark job "partial-failure"
 *               keep Firebase Auth, return 500 with retry instructions
 *               USER CAN STILL SIGN IN to request retry
 *   Step 9.  ONLY if all collections succeeded: getAdminAuth().deleteUser(uid)
 *            → if Auth deletion fails: mark job "auth-pending"
 *               return 500 with manual escalation path
 *  Step 10.  Mark job "completed", delete users/{uid}/pendingDeletion
 *  Step 11.  Return {deleted: true}
 *
 * ── COMPLETING LEASE ──────────────────────────────────────────────────────
 * The "completing" state uses a token + timestamp lease:
 *   - completingToken:     random UUID minted by the winning worker
 *   - completingStartedAt: epoch ms when the lease was acquired
 *   - COMPLETING_LEASE_MS: lease duration (2 minutes)
 *
 * A fresh lease blocks other workers.
 * A stale lease (completingStartedAt + COMPLETING_LEASE_MS < now) is treated
 * as expired — any worker can re-acquire it.
 * Only the token owner can write the final "completed" or "partial-failure" state.
 * Process crashes do not execute catch/finally — the lease TTL provides recovery.
 *
 * ── COLLECTION OUTSIDE USER TREE ──────────────────────────────────────────
 * deletionJobs/{jobId} lives at the root (not under users/{uid}) so:
 *   - it survives deletion of the user document tree
 *   - it is accessible by Admin SDK after Firebase Auth is deleted
 *   - it is protected by Firestore rules: allow read/write: if false
 *
 * ── BLOCKING WHILE DELETION PENDING ──────────────────────────────────────
 * When pendingDeletion exists and status is pending/completing/partial-failure,
 * hasActiveOrPendingSubscription() is called before any new Checkout.
 * Additionally, hasActiveDeletionJob() blocks new Checkout sessions for that uid.
 *
 * ── RETENTION ────────────────────────────────────────────────────────────
 * NOT deleted by this handler:
 *   - users/{uid}/billing/stripe — Stripe customer ID reference
 *   - users/{uid}/consentRecords/{id} — checkout consent records
 * Retention duration: period required by applicable tax, accounting,
 * dispute-resolution and legal obligations.
 * [OWNER ACTION REQUIRED — source only: confirm duration with legal/tax counsel]
 *
 * After the approved retention period, retained records should be deleted
 * or severed from personal identifiers by a separate manual/admin process.
 *
 * ── IMPORTED ONLY FROM src/server.ts ─────────────────────────────────────
 */

import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { randomUUID }              from "crypto";
import Stripe                      from "stripe";
import {
  verifyFreshToken,
  getAdminDb,
  getStripe,
  ApiError,
  apiErrorResponse,
} from "./stripe-server";

// ── Constants ─────────────────────────────────────────────────────────────

const RENEWABLE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * How long a "completing" lease is valid before it is considered stale and
 * can be re-acquired by a new worker. 2 minutes is generous for profile deletion.
 */
const COMPLETING_LEASE_MS = 2 * 60 * 1_000;

/**
 * Subcollections of users/{uid} that contain ordinary personal data.
 * Deleted as part of account deletion.
 * Does NOT include: billing, consentRecords (legal retention — explicitly excluded).
 */
const PROFILE_SUBCOLLECTIONS = [
  "favorites",
  "devices",
  "notificationEvents",
  "quotas",
  "entitlements",
  "checkout",
  "pendingDeletion", // clean up the pending-deletion marker itself
] as const;

// ── Path helpers ──────────────────────────────────────────────────────────

/** Admin-only deletion job record OUTSIDE the user document tree. */
function jobPath(jobId: string)  { return `deletionJobs/${jobId}`; }
/** Points from user tree → deletion job. */
function pendingPath(uid: string){ return `users/${uid}/pendingDeletion/request`; }

// ── Types ─────────────────────────────────────────────────────────────────

type JobStatus =
  | "pending"           // waiting for subscription period to end
  | "processing"        // profile deletion in progress (immediate mode)
  | "completing"        // webhook/reconcile acquired the completing lease
  | "partial-failure"   // some collections failed; Auth NOT deleted; retry possible
  | "auth-pending"      // all data deleted but Auth deletion failed; escalate
  | "completed";        // everything done; job retained briefly then deleted

interface DeletionJob {
  jobId:                string;
  uid:                  string;
  mode:                 "scheduled" | "immediate";
  requestedAt:          number;   // ms epoch
  expectedDeletionAt:   number;   // ms epoch
  stripeCustomerId:     string | null;
  stripeSubIds:         string[];
  status:               JobStatus;
  // Completing-lease fields (set when status="completing")
  completingToken?:     string;   // UUID owned by the worker holding the lease
  completingStartedAt?: number;   // ms epoch when lease was acquired
  // Failure details
  failedCollections?:   string[]; // which collections failed during partial-failure
  lastErrorMessage?:    string;
  completedAt?:         number;   // ms epoch when full deletion succeeded
}

interface PendingPointer {
  jobId: string;
  uid:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isRenewable(sub: Stripe.Subscription) {
  return RENEWABLE_STATUSES.has(sub.status);
}

/**
 * Attempt to acquire the completing lease.
 * Returns { acquired: true, token } if successful.
 * Returns { acquired: false } if another worker holds a FRESH lease.
 * A stale lease (age > COMPLETING_LEASE_MS) is overwritten.
 *
 * Uses a Firestore transaction so two concurrent workers cannot both succeed.
 * No external network calls inside the transaction callback.
 */
async function acquireCompletingLease(
  jobId: string,
): Promise<{ acquired: boolean; token: string }> {
  const db     = getAdminDb();
  const ref    = db.doc(jobPath(jobId));
  const token  = randomUUID();
  const now    = Date.now();
  let acquired = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) { acquired = false; return; }

    const job = snap.data() as DeletionJob;

    // If already completed, nothing to do
    if (job.status === "completed") { acquired = false; return; }

    const freshLease =
      job.status === "completing" &&
      job.completingToken &&
      job.completingStartedAt !== undefined &&
      now - job.completingStartedAt < COMPLETING_LEASE_MS;

    if (freshLease) {
      // Another worker holds a fresh lease — do not overwrite
      acquired = false;
      return;
    }

    // Either not completing, or lease is stale — acquire it
    tx.update(ref, {
      status:              "completing",
      completingToken:      token,
      completingStartedAt:  now,
    });
    acquired = true;
  });

  return { acquired, token };
}

/**
 * Returns true if the completing lease stored in the job still belongs to
 * `token` (i.e., no other worker has re-acquired it).
 */
async function isLeaseHolder(jobId: string, token: string): Promise<boolean> {
  const snap = await getAdminDb().doc(jobPath(jobId)).get();
  if (!snap.exists) return false;
  const job = snap.data() as DeletionJob;
  return job.completingToken === token;
}

/** Returns the DeletionJob for this uid, or null if none. */
export async function findDeletionJob(uid: string): Promise<DeletionJob | null> {
  const db   = getAdminDb();
  const ptr  = await db.doc(pendingPath(uid)).get();
  if (!ptr.exists) return null;
  const { jobId } = ptr.data() as PendingPointer;
  const snap = await db.doc(jobPath(jobId)).get();
  return snap.exists ? (snap.data() as DeletionJob) : null;
}

/** Returns true if the uid has an active, non-completed deletion job. Blocks new Checkout. */
export async function hasActiveDeletionJob(uid: string): Promise<boolean> {
  const job = await findDeletionJob(uid);
  return job !== null && job.status !== "completed";
}

// ── Main deletion handler ─────────────────────────────────────────────────

export async function handleDeleteAccount(request: Request): Promise<Response> {
  try {
    // Step 1. Fresh authentication required
    const { uid } = await verifyFreshToken(request);

    let forfeitAccess = false;
    try {
      const body = await request.json() as { forfeitAccess?: boolean };
      forfeitAccess = body.forfeitAccess === true;
    } catch { /* no body → scheduled mode */ }

    const db  = getAdminDb();
    const now = Date.now();

    // Step 2. Idempotency — return existing job if already in progress
    const existingJob = await findDeletionJob(uid);
    if (existingJob && existingJob.status !== "completed") {
      return jobStateResponse(existingJob);
    }

    // Step 3. Query Stripe
    let customerId    = "";
    let renewableSubs: Stripe.Subscription[] = [];
    let latestEndMs   = now;

    const stripe = getStripe();
    try {
      const found = await stripe.customers.search({
        query: `metadata['firebaseUid']:'${uid}'`,
        limit: 1,
      });
      if (found.data.length > 0) {
        customerId = found.data[0].id;
        const all  = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
        renewableSubs = all.data.filter(isRenewable);
        for (const sub of renewableSubs) {
          const end = (sub.items.data[0]?.current_period_end ?? 0) * 1000;
          if (end > latestEndMs) latestEndMs = end;
        }
      }
    } catch (e) {
      const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
      console.warn("[delete-account] Stripe lookup failed:", safe);
      throw new ApiError(503, "Could not verify your subscription status. Please try again shortly.");
    }

    const hasRenewable = renewableSubs.length > 0;
    const mode: "scheduled" | "immediate" =
      hasRenewable && !forfeitAccess ? "scheduled" : "immediate";

    // Step 4. Cancel subscriptions
    if (mode === "immediate" && hasRenewable) {
      for (const sub of renewableSubs) {
        try {
          await stripe.subscriptions.cancel(sub.id);
        } catch (e) {
          const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
          console.error("[delete-account] Stripe cancel failed:", safe);
          throw new ApiError(503,
            "Could not cancel your subscription. Please try again or contact " +
            "supportaeruvo@gmail.com. No account data has been deleted.");
        }
      }
      if (customerId) {
        const recheck = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
        if (recheck.data.filter(isRenewable).length > 0) {
          throw new ApiError(503,
            "Subscription cancellation could not be confirmed. " +
            "Please contact supportaeruvo@gmail.com. No data has been deleted.");
        }
      }
    } else if (mode === "scheduled" && hasRenewable) {
      const failed: string[] = [];
      for (const sub of renewableSubs) {
        try {
          await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
        } catch (e) {
          const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
          console.error("[delete-account] Scheduled cancel failed:", safe);
          failed.push(sub.id);
        }
      }
      if (failed.length > 0) {
        throw new ApiError(503,
          "Could not schedule subscription cancellation. Please try again or contact " +
          "supportaeruvo@gmail.com. No account data has been changed.");
      }
    }

    // Step 5 & 6. Create deletion job (outside user tree)
    const jobId = randomUUID();
    const job: DeletionJob = {
      jobId,
      uid,
      mode,
      requestedAt:        now,
      expectedDeletionAt: latestEndMs,
      stripeCustomerId:   customerId || null,
      stripeSubIds:       renewableSubs.map((s) => s.id),
      status:             mode === "immediate" ? "processing" : "pending",
    };
    await db.doc(jobPath(jobId)).set(job);

    // Step 7. Write pointer from user tree → job
    await db.doc(pendingPath(uid)).set({ jobId, uid } satisfies PendingPointer);

    // ── SCHEDULED: revoke tokens only, preserve everything else ───────────
    if (mode === "scheduled") {
      await revokeDeviceTokens(uid); // FCM tokens only — disclosed to user
      return jobStateResponse(job);
    }

    // ── IMMEDIATE: delete profile data — Auth only after full success ──────
    // Step 8. Delete profile collections
    const failedCols = await deleteProfileCollections(uid);

    if (failedCols.length > 0) {
      // Partial failure — Auth NOT deleted. User can still sign in, retry, or escalate.
      await db.doc(jobPath(jobId)).update({
        status:            "partial-failure",
        failedCollections:  failedCols,
        lastErrorMessage:   `${failedCols.length} collection(s) could not be deleted: ${failedCols.join(", ")}`,
      });
      console.error("[delete-account] Partial failure — Auth NOT deleted. Collections failed:", failedCols);
      throw new ApiError(500,
        "Some account data could not be deleted. Your account remains active so you can " +
        "request retry. Please contact aeruvoprivacy@gmail.com with reference: " + jobId);
    }

    // Step 9. ALL collections succeeded — NOW delete Firebase Auth
    try {
      await getAdminAuth().deleteUser(uid);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/user-not-found") {
        const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
        console.error("[delete-account] Auth deletion failed:", safe);
        await db.doc(jobPath(jobId)).update({
          status:          "auth-pending",
          lastErrorMessage: "Firebase Auth deletion failed — manual escalation required",
        });
        throw new ApiError(500,
          "Your account data was cleared but authentication record deletion failed. " +
          "Contact aeruvoprivacy@gmail.com (reference: " + jobId + ") to complete removal.");
      }
    }

    // Step 10. All done — mark job completed, clean up pointer
    await db.doc(jobPath(jobId)).update({ status: "completed", completedAt: Date.now() });
    await db.doc(pendingPath(uid)).delete().catch(() => {});

    console.info("[delete-account] Immediate deletion complete:", {
      uid: uid.slice(0, 4) + "***", jobId,
    });

    return new Response(JSON.stringify({ deleted: true, mode: "immediate" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return apiErrorResponse(err);
  }
}

// ── Webhook finalisation ──────────────────────────────────────────────────

/**
 * Called by stripe-api-handlers when customer.subscription.deleted fires.
 *
 * Safety checks before finalising:
 *   1. Load pendingDeletion pointer → deletionJob
 *   2. Confirm job is pending (not completed or already claimed by fresh lease)
 *   3. Verify customer ID matches (anti-spoofing)
 *   4. Re-query Stripe — ALL subscriptions must be non-renewable
 *   5. Acquire completing lease (token + timestamp)
 *      → concurrent workers get { acquired: false } and return
 *      → stale leases are overwritten
 *   6. deleteProfileCollections then getAdminAuth().deleteUser
 *      → on failure: release lease so next webhook can retry
 *   7. Mark job completed; delete pointer
 */
export async function completeDeletionFromWebhook(
  stripe:     Stripe,
  uid:        string,
  customerId: string,
): Promise<void> {
  const db  = getAdminDb();
  const ptr = await db.doc(pendingPath(uid)).get();
  if (!ptr.exists) return;

  const { jobId } = ptr.data() as PendingPointer;
  const jobSnap   = await db.doc(jobPath(jobId)).get();
  if (!jobSnap.exists) return;

  const job = jobSnap.data() as DeletionJob;
  if (job.status === "completed") return;

  // Anti-spoofing: verify customer matches
  if (job.stripeCustomerId && job.stripeCustomerId !== customerId) {
    console.warn("[delete-webhook] Customer ID mismatch — ignoring");
    return;
  }

  // Re-query Stripe — no renewable subscription must remain
  const allSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const stillRenewable = allSubs.data.filter(isRenewable);
  if (stillRenewable.length > 0) {
    console.info("[delete-webhook] Skipping — active subscriptions remain:", {
      uid: uid.slice(0, 4) + "***", count: stillRenewable.length,
    });
    return;
  }

  // Acquire completing lease — no network calls inside this transaction
  const { acquired, token } = await acquireCompletingLease(jobId);
  if (!acquired) {
    // Another worker holds a fresh lease — let them finish
    return;
  }

  // We hold the lease. Delete profile collections, then Auth.
  try {
    const failedCols = await deleteProfileCollections(uid);
    if (failedCols.length > 0) {
      // Verify we still own the lease before writing failure status
      if (await isLeaseHolder(jobId, token)) {
        await db.doc(jobPath(jobId)).update({
          status:            "partial-failure",
          completingToken:    token,
          failedCollections:  failedCols,
          lastErrorMessage:   `Collections failed: ${failedCols.join(", ")}`,
        });
      }
      console.error("[delete-webhook] Partial failure — Auth NOT deleted:", failedCols);
      // Do NOT delete Auth — user can still authenticate to request retry
      return;
    }

    // All collections succeeded — delete Auth
    try {
      await getAdminAuth().deleteUser(uid);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/user-not-found") {
        if (await isLeaseHolder(jobId, token)) {
          await db.doc(jobPath(jobId)).update({ status: "auth-pending", completingToken: token });
        }
        throw e;
      }
    }

    // Mark completed and clean up
    if (await isLeaseHolder(jobId, token)) {
      await db.doc(jobPath(jobId)).update({ status: "completed", completedAt: Date.now() });
    }
    await db.doc(pendingPath(uid)).delete().catch(() => {});
    console.info("[delete-webhook] Scheduled deletion complete:", uid.slice(0, 4) + "***");

  } catch (e) {
    // Release lease so next webhook or reconciliation can retry
    const safe = e instanceof Error ? { name: e.name, message: e.message } : {};
    console.error("[delete-webhook] Completion failed:", safe);
    if (await isLeaseHolder(jobId, token)) {
      await db.doc(jobPath(jobId)).update({
        status:           "pending",
        completingToken:   null,
        completingStartedAt: null,
      }).catch(() => {});
    }
    throw e;
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────

/**
 * Called by the client when expectedDeletionAt has passed and no webhook arrived.
 * Re-queries Stripe and finalises if safe.
 * Also recovers stale completing leases.
 */
export async function handleReconcileDeletion(request: Request): Promise<Response> {
  try {
    const { uid } = await verifyFreshToken(request);
    const db      = getAdminDb();
    const ptr     = await db.doc(pendingPath(uid)).get();

    if (!ptr.exists) {
      return jsonResponse({ status: "no-pending-deletion" });
    }
    const { jobId } = ptr.data() as PendingPointer;
    const jobSnap   = await db.doc(jobPath(jobId)).get();
    if (!jobSnap.exists) {
      return jsonResponse({ status: "no-deletion-job" });
    }
    const job = jobSnap.data() as DeletionJob;
    if (job.status === "completed") {
      return jsonResponse({ status: "already-completed" });
    }
    if (!job.stripeCustomerId) {
      return jsonResponse({ status: "no-stripe-customer" });
    }

    // Check for stale completing lease — recover it
    const now = Date.now();
    if (
      job.status === "completing" &&
      job.completingStartedAt !== undefined &&
      now - job.completingStartedAt >= COMPLETING_LEASE_MS
    ) {
      // Lease is stale — reset to pending so reconciliation can re-acquire
      await db.doc(jobPath(jobId)).update({
        status:              "pending",
        completingToken:      null,
        completingStartedAt:  null,
      });
      console.info("[reconcile] Recovered stale completing lease for job:", jobId);
    }

    const stripe  = getStripe();
    const allSubs = await stripe.subscriptions.list({ customer: job.stripeCustomerId, status: "all", limit: 10 });
    if (allSubs.data.filter(isRenewable).length > 0) {
      return jsonResponse({ status: "subscription-still-active" });
    }

    await completeDeletionFromWebhook(stripe, uid, job.stripeCustomerId);
    return jsonResponse({ status: "reconciled-and-deleted" });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Revoke FCM push-notification tokens immediately on scheduling. */
async function revokeDeviceTokens(uid: string): Promise<void> {
  try {
    const db    = getAdminDb();
    const snaps = await db.doc(`users/${uid}`).collection("devices").limit(100).get();
    if (!snaps.empty) {
      const batch = db.batch();
      snaps.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn("[delete-account] Error revoking device tokens:", e instanceof Error ? e.message : e);
  }
}

/**
 * Delete all ordinary personal-data subcollections for this uid.
 * Does NOT delete billing or consentRecords (legal retention).
 * Returns a list of collection names that failed to delete.
 * Never throws — callers check the returned list.
 */
async function deleteProfileCollections(uid: string): Promise<string[]> {
  const db      = getAdminDb();
  const userRef = db.doc(`users/${uid}`);
  const failed: string[] = [];

  for (const sub of PROFILE_SUBCOLLECTIONS) {
    try {
      for (let pass = 0; pass < 2; pass++) {
        const snaps = await userRef.collection(sub).limit(500).get();
        if (snaps.empty) break;
        const batch = db.batch();
        snaps.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snaps.size < 500) break;
      }
    } catch (e) {
      console.warn(`[delete-account] Failed to delete subcollection ${sub}:`, e instanceof Error ? e.message : e);
      failed.push(sub);
    }
  }

  // Delete the top-level user document (prefs, name, email, city)
  try { await userRef.delete(); } catch (e) {
    console.warn("[delete-account] Failed to delete user doc:", e instanceof Error ? e.message : e);
    failed.push("users/{uid}");
  }

  return failed;
}

/** Build a Response for the current job state. */
function jobStateResponse(job: DeletionJob): Response {
  const body: Record<string, unknown> = {
    mode:               job.mode,
    status:             job.status,
    expectedDeletionAt: job.expectedDeletionAt,
    jobId:              job.jobId,
  };
  if (job.status === "pending" || job.status === "completing") {
    body.alreadyScheduled = true;
    body.message =
      job.mode === "scheduled"
        ? "Your account is scheduled for deletion when your subscription period ends. No further charges will be made."
        : "Your account deletion is in progress.";
  } else if (job.status === "partial-failure") {
    body.message =
      "Account deletion could not be fully completed. Your account remains active. " +
      "Contact aeruvoprivacy@gmail.com (reference: " + job.jobId + ") to resolve.";
  } else if (job.status === "auth-pending") {
    body.message =
      "Account data was cleared but the authentication record could not be removed. " +
      "Contact aeruvoprivacy@gmail.com (reference: " + job.jobId + ").";
  }
  return jsonResponse(body);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
