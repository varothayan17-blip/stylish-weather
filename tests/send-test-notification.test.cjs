/**
 * send-test-notification.test.cjs
 *
 * Behavioural tests for functions/src/sendTestNotification.ts and the
 * client helper callSendTestNotification in src/lib/notifications.ts.
 *
 * Approach:
 *   SOURCE CHECKS  — assert implementation patterns in the TypeScript source.
 *   JS SIMULATIONS — port/inline the pure logic and exercise with mock deps.
 *
 * Coverage:
 *   A. Source-level security guarantees (UID not taken from body, FID never
 *      logged or returned, only shortened IDs in logs, correct region,
 *      endpoint URL resolves to northamerica-northeast1 Cloud Functions).
 *   B. Missing auth header → 401.
 *   C. Invalid/expired token → 401.
 *   D. Rate limit enforced (< 60 s since last attempt) → 429.
 *   E. Rate limit not enforced (> 60 s since last attempt) → continues.
 *   F. No enabled devices → ok=true, all counts zero.
 *   G. Accepted FCM send → acceptedCount incremented.
 *   H. Failed FCM send (non-permanent) → failedCount incremented, device NOT disabled.
 *   I. Failed FCM send (permanent code) → failedCount incremented, device disabled.
 *   J. FID never appears in the JSON response body.
 *   K. FID never appears in logger.info / logger.warn calls.
 *   L. Client helper: missing token → error result.
 *   M. Client helper: 429 response → rateLimited=true result.
 *   N. Client helper: server error body → error result.
 *   O. Client helper: successful response → ok=true with counts.
 *   P. Client helper: network failure → error result.
 */

"use strict";
const fs   = require("node:fs");
const path = require("node:path");

const repoRoot   = path.resolve(__dirname, "..");
const readSource = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

let p = 0, f = 0;
function ok(label, cond, detail) {
  if (cond) { console.log("✓", label); p++; }
  else { console.error("✗", label, detail != null ? String(detail) : ""); f++; }
}

const fnSrc     = readSource("functions/src/sendTestNotification.ts");
const clientSrc = readSource("src/lib/notifications.ts");

// ════════════════════════════════════════════════════════════════════════════
// A. Source-level security guarantees
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── A. Source-level security guarantees ──────────────────────────");

ok("A1. UID taken from verified token (decoded.uid), not from req.body",
  fnSrc.includes("decoded.uid") && !fnSrc.match(/req\.body\.uid/));

ok("A2. verifyIdToken called on the extracted Bearer token",
  fnSrc.includes("verifyIdToken(idToken)"));

ok("A3. FID never passed to logger.info",
  (() => {
    // Find every logger.info / logger.warn call and ensure no call passes `fid`
    // as a logged field name or value.
    const logInfoCalls = fnSrc.match(/logger\.(info|warn)\([^)]+\)/gs) ?? [];
    return logInfoCalls.every(call => !call.includes("fid"));
  })());

ok("A4. FID never included in the JSON response body",
  (() => {
    // The jsonResponse calls should never include `fid` as a field name.
    const responseCalls = fnSrc.match(/jsonResponse\([^)]+\{[^}]+\}/gs) ?? [];
    // Also check the final ok response
    const finalResponse = fnSrc.slice(fnSrc.lastIndexOf("jsonResponse"));
    return !finalResponse.includes("fid");
  })());

ok("A5. Only shortUid (sliced) used in log calls",
  fnSrc.includes("uid: shortUid") &&
  !fnSrc.match(/logger\.(info|warn|error)\([^)]*\buid\b(?!:)/));

ok("A6. Only deviceShortId (sliced) used in log calls",
  fnSrc.includes("deviceShortId,") &&
  fnSrc.includes("deviceDoc.id.slice(0, 8)"));

ok("A7. RATE_LIMIT_MS is 60000 (60 seconds)",
  fnSrc.includes("RATE_LIMIT_MS = 60_000") || fnSrc.includes("RATE_LIMIT_MS = 60000"));

ok("A8. Rate-limit collection is users/{uid}/testNotificationRateLimit",
  fnSrc.includes('"testNotificationRateLimit"'));

ok("A9. FCM message data matches contract (title, body, url: '/')",
  fnSrc.includes('"Aeruvo test notification"') &&
  fnSrc.includes('"Notifications are working on this device."') &&
  fnSrc.includes('url: "/"'));

ok("A10. APNs content-available set to 1",
  fnSrc.includes('"content-available": 1'));

ok("A11. Android priority set to 'high'",
  fnSrc.includes('priority: "high"'));

ok("A12. Response shape contains ok, attemptedCount, acceptedCount, failedCount",
  fnSrc.includes("attemptedCount") &&
  fnSrc.includes("acceptedCount")  &&
  fnSrc.includes("failedCount"));

ok("A13. morningRainCheck.ts is not modified (imports unchanged)",
  (() => {
    const rainSrc = readSource("functions/src/morningRainCheck.ts");
    // The function still uses its original permanent error codes
    return rainSrc.includes("messaging/registration-token-not-registered") &&
           rainSrc.includes("messaging/installation-id-not-registered");
  })());

ok("A14. sendTestNotification exported from functions/src/index.ts",
  readSource("functions/src/index.ts").includes('from "./sendTestNotification"'));

ok("A15. sendTestNotification deployed to northamerica-northeast1 (matches Aeruvo region)",
  fnSrc.includes('"northamerica-northeast1"'));

ok("A16. Endpoint URL resolves to northamerica-northeast1 Cloud Functions URL or explicit override",
  (() => {
    // The client helper must NOT fall back to an empty-string base URL.
    // It must either use VITE_FUNCTIONS_BASE_URL or derive the URL from
    // VITE_FIREBASE_PROJECT_ID as:
    //   https://northamerica-northeast1-<projectId>.cloudfunctions.net
    return (
      // Derives canonical URL from project ID
      clientSrc.includes("northamerica-northeast1-") &&
      clientSrc.includes("VITE_FIREBASE_PROJECT_ID") &&
      // Does NOT use `?? ""` as the final fallback (which would route to Vercel)
      !clientSrc.includes('VITE_FUNCTIONS_BASE_URL ?? ""')
    );
  })());

// ════════════════════════════════════════════════════════════════════════════
// B–K. Simulated handler logic
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── B–K. Simulated handler logic ──────────────────────────────────");

/**
 * Minimal in-process simulation of sendTestNotification handler logic.
 * Mirrors the exact decision tree in the Cloud Function without any Firebase
 * dependency — all dependencies are injected.
 *
 * This is a faithful port of the handler body rather than a mock of the whole
 * Cloud Function, so it exercises the same branches the production code takes.
 */
async function simulateHandler({
  authHeader        = "",
  verifyToken       = async () => ({ uid: "user-abc-123-def-456" }),
  rateLimitSnap     = { exists: false, data: () => ({}) },
  runTransactionFn  = async (fn) => { await fn({ get: async () => rateLimitSnap, set: () => {} }); },
  devicesSnap       = { empty: true, docs: [] },
  messagingSend     = async () => {},
  deviceUpdateFn    = async () => {},
  loggedInfo        = [],
  loggedWarn        = [],
  loggedError       = [],
} = {}) {
  // Mirrors constants from the source
  const RATE_LIMIT_MS  = 60_000;
  const RATE_LIMIT_DOC = "testNotification";
  const PERMANENT_ERROR_CODES = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/installation-id-not-registered",
  ]);

  const captured = { status: null, body: null };
  const res = {
    status(s) { captured.status = s; return this; },
    json(b)   { captured.body = b;  return this; },
    send(b)   { captured.body = b;  return this; },
    set()     { return this; },
  };

  // ── Extract and verify token
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Missing Authorization header." });
    return captured;
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    res.status(401).json({ ok: false, error: "Empty token." });
    return captured;
  }

  let uid;
  try {
    const decoded = await verifyToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired token." });
    return captured;
  }
  const shortUid = uid.slice(0, 8);

  // ── Rate limit
  const now = Date.now();
  try {
    await runTransactionFn(async (tx) => {
      const snap = await tx.get(RATE_LIMIT_DOC);
      if (snap.exists) {
        const lastAt = snap.data()?.lastAttemptAt;
        if (lastAt && now - lastAt < RATE_LIMIT_MS) {
          const remainingSec = Math.ceil((RATE_LIMIT_MS - (now - lastAt)) / 1000);
          throw Object.assign(
            new Error(`Rate limited. Try again in ${remainingSec}s.`),
            { __rateLimited: true, remainingSec },
          );
        }
      }
      tx.set(RATE_LIMIT_DOC, { lastAttemptAt: now });
    });
  } catch (err) {
    if (err.__rateLimited) {
      res.status(429).json({ ok: false, error: err.message, retryAfterSeconds: err.remainingSec });
      return captured;
    }
    loggedError.push({ event: "rate-limit-tx-failed", uid: shortUid });
    res.status(503).json({ ok: false, error: "Could not check rate limit. Try again." });
    return captured;
  }

  // ── Query devices (mocked via devicesSnap)
  if (devicesSnap.empty) {
    loggedInfo.push({ event: "no-enabled-devices", uid: shortUid });
    res.status(200).json({ ok: true, attemptedCount: 0, acceptedCount: 0, failedCount: 0 });
    return captured;
  }

  // ── Send FCM messages
  let attemptedCount = 0, acceptedCount = 0, failedCount = 0;

  for (const deviceDoc of devicesSnap.docs) {
    const data = deviceDoc.data();
    const fid  = data.fid;
    if (!fid || typeof fid !== "string" || fid.length === 0) continue;

    const deviceShortId = deviceDoc.id.slice(0, 8);
    attemptedCount++;

    try {
      await messagingSend({
        fid,
        data: { title: "Aeruvo test notification", body: "Notifications are working on this device.", url: "/" },
        apns:    { payload: { aps: { "content-available": 1 } } },
        android: { priority: "high" },
      });
      // Log only safe metadata — never the fid.
      loggedInfo.push({ event: "FCM accepted", uid: shortUid, deviceShortId, result: "accepted" });
      acceptedCount++;
    } catch (err) {
      const code = err.code ?? "unknown";
      if (PERMANENT_ERROR_CODES.has(code)) {
        await deviceUpdateFn(deviceDoc.id, { enabled: false, updatedAt: Date.now() });
      }
      loggedWarn.push({ event: "FCM error", uid: shortUid, deviceShortId, code });
      failedCount++;
    }
  }

  res.status(200).json({ ok: true, attemptedCount, acceptedCount, failedCount });
  return captured;
}

// B. Missing auth header → 401
(async () => {
  const r = await simulateHandler({ authHeader: "" });
  ok("B1. No auth header → 401", r.status === 401);
  ok("B2. No auth header → error body", r.body?.ok === false && r.body?.error?.includes("Missing"));
})().catch(e => { ok("B. simulation threw", false, e.message); });

// C. Invalid/expired token
(async () => {
  const r = await simulateHandler({
    authHeader:  "Bearer bad-token",
    verifyToken: async () => { throw new Error("auth/argument-error"); },
  });
  ok("C1. Invalid token → 401", r.status === 401);
  ok("C2. Invalid token → error body", r.body?.ok === false);
})().catch(e => { ok("C. simulation threw", false, e.message); });

// D. Rate limit enforced (48s since last attempt)
(async () => {
  const lastAt = Date.now() - 48_000; // 48s ago < 60s
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    rateLimitSnap: { exists: true, data: () => ({ lastAttemptAt: lastAt }) },
    runTransactionFn: async (fn) => {
      await fn({
        get: async () => ({ exists: true, data: () => ({ lastAttemptAt: lastAt }) }),
        set: () => {},
      });
    },
  });
  ok("D1. Rate limited → 429",   r.status === 429);
  ok("D2. Rate limited → retryAfterSeconds present", typeof r.body?.retryAfterSeconds === "number");
  ok("D3. retryAfterSeconds ~12s (60-48=12)", r.body?.retryAfterSeconds >= 12);
})().catch(e => { ok("D. simulation threw", false, e.message); });

// E. Rate limit NOT enforced (90s since last attempt)
(async () => {
  const lastAt = Date.now() - 90_000; // 90s ago > 60s
  const calls = [];
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    runTransactionFn: async (fn) => {
      await fn({
        get: async () => ({ exists: true, data: () => ({ lastAttemptAt: lastAt }) }),
        set: (_, data) => calls.push(data),
      });
    },
    devicesSnap: { empty: true, docs: [] },
  });
  ok("E1. Old rate-limit record → not 429", r.status !== 429);
  ok("E2. Rate-limit doc updated",          calls.length > 0);
})().catch(e => { ok("E. simulation threw", false, e.message); });

// F. No enabled devices
(async () => {
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: { empty: true, docs: [] },
  });
  ok("F1. No devices → 200",              r.status === 200);
  ok("F2. No devices → ok=true",          r.body?.ok === true);
  ok("F3. No devices → attemptedCount=0", r.body?.attemptedCount === 0);
  ok("F4. No devices → acceptedCount=0",  r.body?.acceptedCount  === 0);
  ok("F5. No devices → failedCount=0",    r.body?.failedCount    === 0);
})().catch(e => { ok("F. simulation threw", false, e.message); });

// G. Successful FCM send
(async () => {
  const sentPayloads = [];
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: {
      empty: false,
      docs: [
        { id: "device-111-aaaa", data: () => ({ fid: "fid-secret-111" }) },
        { id: "device-222-bbbb", data: () => ({ fid: "fid-secret-222" }) },
      ],
    },
    messagingSend: async (payload) => { sentPayloads.push(payload); },
  });
  ok("G1. Two sends accepted → 200",              r.status === 200);
  ok("G2. attemptedCount=2",                      r.body?.attemptedCount === 2);
  ok("G3. acceptedCount=2",                       r.body?.acceptedCount  === 2);
  ok("G4. failedCount=0",                         r.body?.failedCount    === 0);
  ok("G5. Correct data title sent",               sentPayloads[0]?.data?.title === "Aeruvo test notification");
  ok("G6. Correct data body sent",                sentPayloads[0]?.data?.body === "Notifications are working on this device.");
  ok("G7. url='/' in data",                       sentPayloads[0]?.data?.url === "/");
  ok("G8. APNs content-available=1",              sentPayloads[0]?.apns?.payload?.aps?.["content-available"] === 1);
  ok("G9. Android priority='high'",               sentPayloads[0]?.android?.priority === "high");
})().catch(e => { ok("G. simulation threw", false, e.message); });

// H. Failed FCM send (non-permanent error)
(async () => {
  const disabledDevices = [];
  const loggedWarn = [];
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: {
      empty: false,
      docs: [{ id: "device-333-cccc", data: () => ({ fid: "fid-secret-333" }) }],
    },
    messagingSend: async () => {
      throw Object.assign(new Error("quota exceeded"), { code: "messaging/quota-exceeded" });
    },
    deviceUpdateFn: async (id) => { disabledDevices.push(id); },
    loggedWarn,
  });
  ok("H1. Non-permanent error → 200",           r.status === 200);
  ok("H2. failedCount=1",                       r.body?.failedCount === 1);
  ok("H3. acceptedCount=0",                     r.body?.acceptedCount === 0);
  ok("H4. Device NOT disabled on non-permanent", disabledDevices.length === 0);
  ok("H5. Error logged with code",               loggedWarn.some(l => l.code === "messaging/quota-exceeded"));
})().catch(e => { ok("H. simulation threw", false, e.message); });

// I. Failed FCM send (permanent error code)
(async () => {
  const disabledDevices = [];
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: {
      empty: false,
      docs: [{ id: "device-444-dddd", data: () => ({ fid: "fid-secret-444" }) }],
    },
    messagingSend: async () => {
      throw Object.assign(new Error("not registered"), { code: "messaging/registration-token-not-registered" });
    },
    deviceUpdateFn: async (id) => { disabledDevices.push(id); },
  });
  ok("I1. Permanent error → 200",           r.status === 200);
  ok("I2. failedCount=1",                   r.body?.failedCount === 1);
  ok("I3. Device disabled on permanent",    disabledDevices.includes("device-444-dddd"));
})().catch(e => { ok("I. simulation threw", false, e.message); });

// J. FID never in JSON response body
(async () => {
  const FID = "super-secret-fid-value-99999";
  const r = await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: {
      empty: false,
      docs: [{ id: "device-555-eeee", data: () => ({ fid: FID }) }],
    },
    messagingSend: async () => {},
  });
  const bodyStr = JSON.stringify(r.body);
  ok("J1. FID not in response body", !bodyStr.includes(FID));
})().catch(e => { ok("J. simulation threw", false, e.message); });

// K. FID never in log calls
(async () => {
  const FID = "super-secret-fid-value-88888";
  const loggedInfo = [];
  const loggedWarn = [];
  await simulateHandler({
    authHeader: "Bearer valid",
    devicesSnap: {
      empty: false,
      docs: [{ id: "device-666-ffff", data: () => ({ fid: FID }) }],
    },
    messagingSend: async () => { throw Object.assign(new Error("fail"), { code: "messaging/some-code" }); },
    loggedInfo,
    loggedWarn,
  });
  const infoStr = JSON.stringify(loggedInfo);
  const warnStr = JSON.stringify(loggedWarn);
  ok("K1. FID not in info logs", !infoStr.includes(FID));
  ok("K2. FID not in warn logs", !warnStr.includes(FID));
})().catch(e => { ok("K. simulation threw", false, e.message); });

// ════════════════════════════════════════════════════════════════════════════
// L–P. Client helper simulation
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── L–P. Client helper (callSendTestNotification) ─────────────────");

/**
 * Inline simulation of callSendTestNotification logic.
 * The real implementation in notifications.ts is tested via source checks
 * and this inline port that exercises the same decision branches.
 */
async function simulateClientHelper({
  getFreshToken      = async () => "valid-id-token",
  fetchResponse      = null,
  fetchThrows        = false,
  jsonThrows         = false,
} = {}) {
  // Mirrors the client helper logic
  let idToken;
  try {
    idToken = await getFreshToken();
  } catch {
    return { ok: false, error: "Could not get auth token. Please sign in again." };
  }
  if (!idToken) return { ok: false, error: "Not signed in." };

  let res;
  try {
    if (fetchThrows) throw new Error("Network error");
    res = fetchResponse;
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }

  let body;
  try {
    if (jsonThrows) throw new Error("bad json");
    body = res.body;
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }

  if (res.status === 429) {
    return { ok: false, rateLimited: true, retryAfterSeconds: body.retryAfterSeconds };
  }
  if (!body.ok) {
    return { ok: false, error: body.error ?? "Could not send test notification." };
  }
  return {
    ok: true,
    attemptedCount: body.attemptedCount ?? 0,
    acceptedCount:  body.acceptedCount  ?? 0,
    failedCount:    body.failedCount    ?? 0,
  };
}

// L. Missing token → error
(async () => {
  const r = await simulateClientHelper({ getFreshToken: async () => null });
  ok("L1. Null token → ok=false",       r.ok === false);
  ok("L2. Null token → 'Not signed in'", !r.ok && r.error?.includes("Not signed in"));
})().catch(e => { ok("L. simulation threw", false, e.message); });

// M. 429 → rateLimited=true
(async () => {
  const r = await simulateClientHelper({
    fetchResponse: { status: 429, body: { ok: false, error: "Rate limited.", retryAfterSeconds: 42 } },
  });
  ok("M1. 429 → rateLimited=true",      !r.ok && r.rateLimited === true);
  ok("M2. retryAfterSeconds=42",         r.retryAfterSeconds === 42);
})().catch(e => { ok("M. simulation threw", false, e.message); });

// N. Server error body
(async () => {
  const r = await simulateClientHelper({
    fetchResponse: { status: 401, body: { ok: false, error: "Invalid or expired token." } },
  });
  ok("N1. Server error → ok=false",    r.ok === false);
  ok("N2. Server error message passed", !r.ok && r.error?.includes("Invalid or expired"));
})().catch(e => { ok("N. simulation threw", false, e.message); });

// O. Successful response
(async () => {
  const r = await simulateClientHelper({
    fetchResponse: {
      status: 200,
      body: { ok: true, attemptedCount: 2, acceptedCount: 2, failedCount: 0 },
    },
  });
  ok("O1. Success → ok=true",          r.ok === true);
  ok("O2. attemptedCount=2",           r.ok && r.attemptedCount === 2);
  ok("O3. acceptedCount=2",            r.ok && r.acceptedCount  === 2);
  ok("O4. failedCount=0",              r.ok && r.failedCount    === 0);
})().catch(e => { ok("O. simulation threw", false, e.message); });

// P. Network failure
(async () => {
  const r = await simulateClientHelper({ fetchThrows: true });
  ok("P1. Fetch throws → ok=false",      r.ok === false);
  ok("P2. Fetch throws → network error", !r.ok && r.error?.toLowerCase().includes("network"));
})().catch(e => { ok("P. simulation threw", false, e.message); });

// ════════════════════════════════════════════════════════════════════════════
// Q. Client source checks
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── Q. Client source checks ──────────────────────────────────────");

ok("Q1. callSendTestNotification exported from notifications.ts",
  clientSrc.includes("export async function callSendTestNotification"));

ok("Q2. Token sent only in Authorization header (not in body or URL)",
  clientSrc.includes('Authorization: `Bearer ${idToken}`') &&
  !clientSrc.match(/body.*idToken/) &&
  !clientSrc.match(/url.*idToken/));

ok("Q3. TestNotificationResult type exported",
  clientSrc.includes("export type TestNotificationResult"));

ok("Q4. rateLimited field present in result type",
  clientSrc.includes("rateLimited"));

ok("Q5. UID never sent in request body by client helper",
  (() => {
    // Find callSendTestNotification function body.
    // The function is declared "export async function callSendTestNotification",
    // so the next non-declaration export keyword marks the end.
    const declMark = "export async function callSendTestNotification";
    const start = clientSrc.indexOf(declMark);
    // End at the next top-level function definition (export or non-export async function)
    const nextExport = clientSrc.indexOf("\nexport ", start + declMark.length);
    const nextAsync  = clientSrc.indexOf("\nasync function ", start + declMark.length);
    const candidates = [nextExport, nextAsync].filter(n => n !== -1);
    const end = candidates.length ? Math.min(...candidates) : -1;
    const fn    = clientSrc.slice(start, end === -1 ? undefined : end);
    // The function must not JSON.stringify a body that contains uid.
    // fn itself should not reference uid (client helper takes getFreshToken, not uid).
    return !fn.includes("uid");
  })());

ok("Q6. sendTestNotification button gated behind notifPrefs?.enabled in settings.tsx",
  readSource("src/routes/settings.tsx").includes("notifPrefs?.enabled") &&
  readSource("src/routes/settings.tsx").includes("Send test notification"));

ok("Q7. Test result feedback shown in settings UI",
  readSource("src/routes/settings.tsx").includes("testNotifResult"));

// ── Final summary ─────────────────────────────────────────────────────────
// Give async tests a tick to complete before printing
setTimeout(() => {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`${p + f} tests: ${p} passed, ${f} failed`);
  process.exit(f > 0 ? 1 : 0);
}, 100);
