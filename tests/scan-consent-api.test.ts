/**
 * tests/scan-consent-api.test.ts
 *
 * Tests for the exported *With variants in scanConsentApi.ts.
 * Uses injected dependencies so no Firebase or fetch is needed.
 *
 * Run with: npx tsx tests/scan-consent-api.test.ts
 *
 * Test cases:
 *  B21: fetchAckStatusWith — uid matches → fetch called → returns acknowledged:true
 *  B22: fetchAckStatusWith — uid mismatch before token → fetch never called → false
 *  B23: fetchAckStatusWith — uid changes after getIdToken but before fetch → false
 *  B24: checkConsentStatusWith — no local record → returns acknowledged:false without calling fetchAckStatus
 *  B25: checkConsentStatusWith — local record valid, server says true, uid stable → acknowledged:true
 *  B26: checkConsentStatusWith — uid changes after server call → uid:null
 *  B27: checkConsentStatusWith — null uid from getUid → uid:null, acknowledged:false
 *  B28: checkConsentStatusWith — local record valid but fetchAckStatus returns false → acknowledged:false
 *  B29: submitServerAckWith — uid differs before token → token/fetch never called → uid_changed
 *  B30: submitServerAckWith — uid changes during getIdToken → fetch never called → uid_changed
 *  B31: submitServerAckWith — uid changes while fetch pending → response discarded → uid_changed
 *  B32: submitServerAckWith — uid changes while JSON parsing → response discarded → uid_changed
 *  B33: submitServerAckWith — stable uid + accepted server response → ok:true
 *  B34: submitServerAckWith — server returns ok:false → error string, no uid_changed
 *  B35: submitServerAckWith — getAuth throws → error result with stage "get_auth", user-safe message
 *  B36: submitServerAckWith — currentUser is null (not signed in) → uid_changed result, no throw
 *  B37: submitServerAckWith — getIdToken throws → error result with stage "get_token", user-safe message
 *  B38: submitServerAckWith — fetch throws (network error) → error result with stage "fetch", user-safe message
 *  B39: submitServerAckWith — response.json() throws → error result with stage "parse_response", user-safe message
 *  B40: submitServerAckWith — no token or Authorization value appears in logged error metadata
 *  B41: submitServerAckWith — stage label present in returned error string, no UID in error string
 */

import { strict as assert } from "node:assert";

// Polyfill import.meta.env for tsx (Vite env vars not available in Node)
(globalThis as any).import = (globalThis as any).import ?? {};
if (!(globalThis as any).import?.meta?.env) {
  Object.defineProperty(globalThis, "import", {
    value: { meta: { env: {} } },
    writable: true,
    configurable: true,
  });
}

import { fetchAckStatusWith, checkConsentStatusWith, submitServerAckWith } from "../src/lib/scanConsentApi";
import type { ConsentRecord } from "../src/lib/scanConsentStore";
import { CONSENT_SCHEMA_VERSION } from "../src/lib/scanConsentStore";
import { SCANNER_ACK_VERSION } from "../src/lib/wardrobe-types";

// ── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(uid: string, overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    uid,
    ageBand: "18-plus",
    schemaVersion: CONSENT_SCHEMA_VERSION,
    consentedAt: new Date().toISOString(),
    serverAckVersion: SCANNER_ACK_VERSION,
    ...overrides,
  };
}

function makeOkResponse(acknowledged: boolean): Response {
  return {
    ok: true,
    json: async () => ({ acknowledged }),
  } as unknown as Response;
}

// ── fetchAckStatusWith tests ───────────────────────────────────────────────

section("fetchAckStatusWith");

// B21: uid matches → fetch called → returns acknowledged:true
{
  const uid = "uid-b21";
  let fetchCalled = false;
  const result = await fetchAckStatusWith(uid, {
    getAuth: async () => ({
      currentUser: {
        uid,
        getIdToken: async () => "token-b21",
      },
    }),
    fetchFn: async (_url, _opts) => {
      fetchCalled = true;
      return makeOkResponse(true);
    },
  });
  ok("B21. uid matches → fetch called → returns true",
    result === true && fetchCalled === true);
}

// B22: uid mismatch before token (currentUser.uid !== expectedUid) → fetch never called → false
{
  const uid = "uid-b22";
  let fetchCalled = false;
  const result = await fetchAckStatusWith(uid, {
    getAuth: async () => ({
      currentUser: {
        uid: "uid-OTHER",
        getIdToken: async () => "token-b22",
      },
    }),
    fetchFn: async () => {
      fetchCalled = true;
      return makeOkResponse(true);
    },
  });
  ok("B22. uid mismatch before token → fetch never called → false",
    result === false && fetchCalled === false);
}

// B23: uid changes after getIdToken but before fetch → false
{
  const uid = "uid-b23";
  let fetchCalled = false;
  // auth.currentUser.uid changes after getIdToken (simulated via mutable ref)
  let currentUidInAuth = uid;
  const result = await fetchAckStatusWith(uid, {
    getAuth: async () => {
      const authObj = {
        get currentUser() {
          return { uid: currentUidInAuth, getIdToken: async () => { currentUidInAuth = "uid-SWITCHED"; return "token-b23"; } };
        },
      };
      return authObj as unknown as { currentUser: { uid: string; getIdToken: () => Promise<string> } | null };
    },
    fetchFn: async () => {
      fetchCalled = true;
      return makeOkResponse(true);
    },
  });
  ok("B23. uid changes after getIdToken but before fetch → false",
    result === false && fetchCalled === false);
}

// ── checkConsentStatusWith tests ───────────────────────────────────────────

section("checkConsentStatusWith");

// B24: no local record → acknowledged:false without calling fetchAckStatus
{
  const uid = "uid-b24";
  let serverCalled = false;
  const result = await checkConsentStatusWith({
    getUid: async () => uid,
    loadConsent: (_uid) => null, // no local record
    fetchAckStatus: async (_uid) => { serverCalled = true; return true; },
  });
  ok("B24. no local record → acknowledged:false without calling fetchAckStatus",
    result.uid === uid && result.acknowledged === false && serverCalled === false);
}

// B25: local record valid, server says true, uid stable → acknowledged:true
{
  const uid = "uid-b25";
  const result = await checkConsentStatusWith({
    getUid: async () => uid,
    loadConsent: (_uid) => makeRecord(uid),
    fetchAckStatus: async (_uid) => true,
  });
  ok("B25. local record valid + server ack → acknowledged:true",
    result.uid === uid && result.acknowledged === true);
}

// B26: uid changes after server call → uid:null
{
  const uid = "uid-b26";
  let callCount = 0;
  const result = await checkConsentStatusWith({
    getUid: async () => {
      callCount++;
      // First call (initial): returns uid
      // Second call (post-server re-check): returns different uid
      return callCount === 1 ? uid : "uid-SWITCHED";
    },
    loadConsent: (_uid) => makeRecord(uid),
    fetchAckStatus: async (_uid) => true,
  });
  ok("B26. uid changes after server call → uid:null, acknowledged:false",
    result.uid === null && result.acknowledged === false);
}

// B27: null uid from getUid → uid:null, acknowledged:false
{
  const result = await checkConsentStatusWith({
    getUid: async () => null,
    loadConsent: (_uid) => makeRecord("uid-b27"),
    fetchAckStatus: async (_uid) => true,
  });
  ok("B27. null uid from getUid → uid:null, acknowledged:false",
    result.uid === null && result.acknowledged === false);
}

// B28: local record valid but fetchAckStatus returns false → acknowledged:false
{
  const uid = "uid-b28";
  const result = await checkConsentStatusWith({
    getUid: async () => uid,
    loadConsent: (_uid) => makeRecord(uid),
    fetchAckStatus: async (_uid) => false,
  });
  ok("B28. local record valid but server ack false → acknowledged:false",
    result.uid === uid && result.acknowledged === false);
}

// ── submitServerAckWith tests ──────────────────────────────────────────────

section("submitServerAckWith");

// Helper: build a mutable auth object whose currentUser.uid can change between awaits
function makeMutableAuth(initialUid: string) {
  let _uid = initialUid;
  return {
    setUid(u: string) { _uid = u; },
    auth: {
      get currentUser() {
        return { uid: _uid, getIdToken: async () => "token-" + _uid };
      },
    },
  };
}

// B29: uid differs before token (pre-token check) → token/fetch never called
{
  const expectedUid = "uid-b29";
  let tokenCalled = false;
  let fetchCalled = false;
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: {
        uid: "uid-OTHER",
        getIdToken: async () => { tokenCalled = true; return "token-b29"; },
      },
    }),
    fetchFn: async () => { fetchCalled = true; return { ok: true, json: async () => ({ ok: true }) } as unknown as Response; },
  });
  ok("B29. uid differs before token → token/fetch never called → uid_changed",
    !result.ok && (result as { ok: false; reason?: string }).reason === "uid_changed"
    && tokenCalled === false && fetchCalled === false);
}

// B30: uid changes during getIdToken (post-token check) → fetch never called
{
  const expectedUid = "uid-b30";
  let fetchCalled = false;
  const { auth, setUid } = makeMutableAuth(expectedUid);
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      ...auth,
      get currentUser() {
        // Switch UID AFTER getIdToken is called
        return {
          uid: auth.currentUser.uid,
          getIdToken: async () => { setUid("uid-SWITCHED-b30"); return "token-b30"; },
        };
      },
    }),
    fetchFn: async () => { fetchCalled = true; return { ok: true, json: async () => ({ ok: true }) } as unknown as Response; },
  });
  ok("B30. uid changes during getIdToken → fetch never called → uid_changed",
    !result.ok && (result as { ok: false; reason?: string }).reason === "uid_changed"
    && fetchCalled === false);
}

// B31: uid changes while fetch is pending (post-fetch check) → response discarded
{
  const expectedUid = "uid-b31";
  let jsonCalled = false;
  const { auth, setUid } = makeMutableAuth(expectedUid);
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => auth as unknown as { currentUser: { uid: string; getIdToken: () => Promise<string> } | null },
    fetchFn: async () => {
      // Switch UID while fetch is "in flight"
      setUid("uid-SWITCHED-b31");
      return {
        ok: true,
        json: async () => { jsonCalled = true; return { ok: true }; },
      } as unknown as Response;
    },
  });
  ok("B31. uid changes while fetch pending → response discarded → uid_changed",
    !result.ok && (result as { ok: false; reason?: string }).reason === "uid_changed"
    && jsonCalled === false);
}

// B32: uid changes while JSON parsing is pending (post-JSON check) → response discarded
{
  const expectedUid = "uid-b32";
  const { auth, setUid } = makeMutableAuth(expectedUid);
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => auth as unknown as { currentUser: { uid: string; getIdToken: () => Promise<string> } | null },
    fetchFn: async () => ({
      ok: true,
      json: async () => {
        // Switch UID while JSON is being "parsed"
        setUid("uid-SWITCHED-b32");
        return { ok: true };
      },
    } as unknown as Response),
  });
  ok("B32. uid changes while JSON parsing → response discarded → uid_changed",
    !result.ok && (result as { ok: false; reason?: string }).reason === "uid_changed");
}

// B33: stable uid + accepted server response → ok:true
{
  const expectedUid = "uid-b33";
  const result = await submitServerAckWith(expectedUid, "15-17", true, {
    getAuth: async () => ({
      currentUser: {
        uid: expectedUid,
        getIdToken: async () => "token-b33",
      },
    }),
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    } as unknown as Response),
  });
  ok("B33. stable uid + accepted server response → ok:true",
    result.ok === true);
}

// B34: server returns ok:false → error message returned, not uid_changed
{
  const expectedUid = "uid-b34";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: {
        uid: expectedUid,
        getIdToken: async () => "token-b34",
      },
    }),
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "Age not permitted" }),
    } as unknown as Response),
  });
  ok("B34. server returns ok:false → error string, not uid_changed",
    !result.ok
    && (result as { ok: false; reason?: string; error?: string }).reason !== "uid_changed"
    && (result as { ok: false; reason?: string; error?: string }).error === "Age not permitted");
}

// ── Stage-aware error / safe-logging tests (B35–B41) ──────────────────────

section("submitServerAckWith — stage-aware error handling");

// B35: getAuth throws → stage "get_auth", error result with user-safe message
{
  const expectedUid = "uid-b35";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => { throw new Error("Firebase not initialised"); },
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) } as unknown as Response),
  });
  const r = result as { ok: false; reason?: string; error?: string };
  ok("B35. getAuth throws → ok:false with stage get_auth in message",
    !result.ok && r.reason !== "uid_changed" &&
    typeof r.error === "string" && r.error.includes("get_auth"));
}

// B36: currentUser is null (not signed in) → uid_changed, no throw
{
  const expectedUid = "uid-b36";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({ currentUser: null }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) } as unknown as Response),
  });
  const r = result as { ok: false; reason?: string };
  ok("B36. currentUser null → uid_changed, no throw",
    !result.ok && r.reason === "uid_changed");
}

// B37: getIdToken throws → stage "get_token", error result with user-safe message
{
  const expectedUid = "uid-b37";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: {
        uid: expectedUid,
        getIdToken: async () => { throw new Error("auth/network-request-failed"); },
      },
    }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) } as unknown as Response),
  });
  const r = result as { ok: false; reason?: string; error?: string };
  ok("B37. getIdToken throws → ok:false with stage get_token in message",
    !result.ok && r.reason !== "uid_changed" &&
    typeof r.error === "string" && r.error.includes("get_token"));
}

// B38: fetch throws (network error) → stage "fetch", error result with user-safe message
{
  const expectedUid = "uid-b38";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: { uid: expectedUid, getIdToken: async () => "token-b38" },
    }),
    fetchFn: async () => { throw new TypeError("Failed to fetch"); },
  });
  const r = result as { ok: false; reason?: string; error?: string };
  ok("B38. fetch throws → ok:false with stage fetch in message",
    !result.ok && r.reason !== "uid_changed" &&
    typeof r.error === "string" && r.error.includes("fetch"));
}

// B39: response.json() throws → stage "parse_response", user-safe message
{
  const expectedUid = "uid-b39";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: { uid: expectedUid, getIdToken: async () => "token-b39" },
    }),
    fetchFn: async () => ({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    } as unknown as Response),
  });
  const r = result as { ok: false; reason?: string; error?: string };
  ok("B39. response.json() throws → ok:false with stage parse_response in message",
    !result.ok && r.reason !== "uid_changed" &&
    typeof r.error === "string" && r.error.includes("parse_response"));
}

// B40: logged error metadata contains no token or Authorization value
{
  const expectedUid = "uid-b40";
  const loggedArgs: unknown[][] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { loggedArgs.push(args); };

  await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: {
        uid: expectedUid,
        getIdToken: async () => { throw new Error("token-request-failed"); },
      },
    }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) } as unknown as Response),
  });

  console.error = origError;

  const logStr = JSON.stringify(loggedArgs);
  // Must not log any token-shaped strings or Authorization header values
  const noTokenInLog =
    !logStr.includes("Bearer ") &&
    !logStr.includes("Authorization") &&
    !logStr.includes("token-b40") &&
    !logStr.includes(expectedUid);  // UID must not appear either

  ok("B40. logged error metadata contains no token, Authorization header, or UID",
    loggedArgs.length > 0 && noTokenInLog);
}

// B41: stage label in error string; UID not in error string
{
  const expectedUid = "uid-b41-very-specific";
  const result = await submitServerAckWith(expectedUid, "18-plus", false, {
    getAuth: async () => ({
      currentUser: {
        uid: expectedUid,
        getIdToken: async () => { throw new Error("network failure"); },
      },
    }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) } as unknown as Response),
  });
  const r = result as { ok: false; error?: string };
  ok("B41. error string contains stage label and does not expose UID",
    typeof r.error === "string" &&
    r.error.includes("get_token") &&
    !r.error.includes(expectedUid));
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`
═══════════════════════════════════════════
  Total passed: ${passed}
  Total failed: ${failed}
═══════════════════════════════════════════`);

if (failed > 0) {
  process.exit(1);
}
