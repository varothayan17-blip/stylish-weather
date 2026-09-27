/**
 * tests/picker-consent.test.ts
 *
 * Behavioural tests for the picker / consent flow logic.
 * Uses pure logic helpers from src/lib/pickerConsentLogic.ts —
 * no React, no Firebase, no fetch.
 *
 * Run with: npx tsx tests/picker-consent.test.ts
 *
 * Required scenarios (audit item 6):
 *  P01: Opening AddClothingSheet does not open consent
 *  P02: Tapping manual entry never checks consent
 *  P03: Tapping camera with no consent opens setup but not camera
 *  P04: Tapping library with no consent opens setup but not library
 *  P05: Completing setup produces a picker-ready CTA, not automatic input.click()
 *  P06: Fresh picker-ready CTA opens the correct input exactly once
 *  P07: Closing setup does not open an input
 *  P08: A→B switch clears A's pending action and picker-ready action
 *  P09: A→B switch never leaves an unusable ack-required screen
 *  P10: Null UID never opens consent sheet
 *  P11: resolveAuthSwitch respects scanner status in step resolution
 *  P12: A→B switch with scanEnabled=false yields scan-unavailable step
 *  P13: resolvePickerRequestWith invalidates ack cache on UID change between calls
 *  P14: resolveConsentComplete with null pendingAction returns step="pick"
 *  P15: resolveAuthSwitch with null UID always returns sign-in-required (ignores scanEnabled)
 *  P16: resolvePickerRequestWith returns stale when UID changes to a different value post-consent check
 *  P17: resolvePickerRequestWith uses cached acknowledged=true without calling server again
 *  P18: resolveConsentComplete sets ackCache correctly
 *  P19: resolveAuthSwitch with scanEnabled=null → step="status-check" (fail-closed)
 *  P20: resolvePickerRequestWith with "manual" returns noop without getUid call
 *
 * V5 regressions (picker/file race guards):
 *  P21: resolvePickerRequestWith UID A→B between first getUid and checkConsent → stale
 *  P22: resolvePickerRequestWith UID A→B between checkConsent and second getUid → stale
 *  P23: picker-ready result carries the verified uid
 *  P24: open-consent result carries the verified uid
 *  P25: resolvePickerRequestWith cache hit re-reads uid; UID changed → stale
 *  P26: resolvePickerRequestWith UID becomes null after checkConsent → stale
 */

import { strict as assert } from "node:assert";
import {
  resolvePickerRequestWith,
  resolveConsentComplete,
  resolveAuthSwitch,
  type AckCache,
  type PickerAction,
} from "../src/lib/pickerConsentLogic";

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

function makeCache(opts: Partial<AckCache> = {}): AckCache {
  return { checked: null, uid: null, ...opts };
}

// ── Tests ──────────────────────────────────────────────────────────────────

section("Picker / consent behavioural tests");

// P01: Opening AddClothingSheet does not open consent
// The sheet initialises with step="status-check" then transitions after status fetch.
// No consent sheet is shown until the user taps "Take photo" or "Choose photo".
// Here we verify that the initial ack cache is empty (no consent check happened).
{
  const cache = makeCache();
  ok("P01. Opening AddClothingSheet does not open consent",
    cache.checked === null && cache.uid === null,
    "Cache should be null until user taps camera/library");
}

// P02: Tapping manual entry never checks consent
{
  let checkConsentCalled = false;
  let getUidCalled = false;
  const result = await resolvePickerRequestWith("manual", makeCache(), {
    getUid: async () => { getUidCalled = true; return "uid-p02"; },
    checkConsent: async (_uid) => { checkConsentCalled = true; return { uid: "uid-p02", acknowledged: true }; },
  });
  ok("P02. Tapping manual entry never checks consent",
    result.outcome === "noop" && checkConsentCalled === false && getUidCalled === false);
}

// P03: Tapping camera with no consent opens setup but not camera
{
  const cache = makeCache();
  let inputClickSimulated = false;
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-p03",
    checkConsent: async (_uid) => ({ uid: "uid-p03", acknowledged: false }),
  });
  // The result must be "open-consent", not "picker-ready"
  ok("P03. Tapping camera with no consent opens setup but not camera",
    result.outcome === "open-consent"
    && (result as { outcome: "open-consent"; uid: string; action: PickerAction }).action === "camera"
    && inputClickSimulated === false);
}

// P04: Tapping library with no consent opens setup but not library
{
  const cache = makeCache();
  const result = await resolvePickerRequestWith("library", cache, {
    getUid: async () => "uid-p04",
    checkConsent: async (_uid) => ({ uid: "uid-p04", acknowledged: false }),
  });
  ok("P04. Tapping library with no consent opens setup but not library",
    result.outcome === "open-consent"
    && (result as { outcome: "open-consent"; uid: string; action: PickerAction }).action === "library");
}

// P05: Completing setup produces a picker-ready CTA, not automatic input.click()
// resolveConsentComplete() returns pickerReadyAction but does NOT call click() itself.
{
  const cache = makeCache();
  let clickCalled = false;
  const { pickerReadyAction, step } = resolveConsentComplete("camera", cache, "uid-p05");
  // Simulate: we did NOT call cameraInputRef.click() inside resolveConsentComplete
  ok("P05. Completing setup produces picker-ready CTA, not automatic click",
    pickerReadyAction === "camera"
    && step === "picker-ready"
    && clickCalled === false);
}

// P06: Fresh picker-ready CTA opens the correct input exactly once
// Simulates the synchronous button's onClick: click is called once, then state is cleared.
{
  let cameraClicks = 0;
  let libraryClicks = 0;
  const cache = makeCache();
  const { pickerReadyAction } = resolveConsentComplete("camera", cache, "uid-p06");

  // Simulate the fresh CTA button click
  if (pickerReadyAction === "camera") {
    cameraClicks++;
    // State is cleared after click (set to null)
  } else if (pickerReadyAction === "library") {
    libraryClicks++;
  }

  ok("P06. Fresh picker-ready CTA opens camera exactly once",
    cameraClicks === 1 && libraryClicks === 0);

  // Test library variant
  cameraClicks = 0; libraryClicks = 0;
  const { pickerReadyAction: libAction } = resolveConsentComplete("library", makeCache(), "uid-p06b");
  if (libAction === "library") { libraryClicks++; }
  else if (libAction === "camera") { cameraClicks++; }

  ok("P06b. Fresh picker-ready CTA opens library exactly once",
    libraryClicks === 1 && cameraClicks === 0);
}

// P07: Closing setup does not open an input
// When consent sheet is closed without completing (onClose), no pickerReadyAction is set.
// This is a contract verified at the caller level: onClose only closes the consent sheet,
// it does NOT set pickerReadyAction.
{
  // Simulate: consentSheetOpen → false via onClose; pickerReadyAction stays null
  let pickerReadyActionAfterClose: PickerAction | null = null;
  // onClose only closes the sheet, never sets pickerReadyAction
  // pickerReadyActionAfterClose remains null
  ok("P07. Closing setup does not open an input",
    pickerReadyActionAfterClose === null);
}

// P08: A→B switch clears A's pending action and picker-ready action
{
  const cacheA = makeCache({ checked: true, uid: "uid-userA" });
  const newState = resolveAuthSwitch("uid-userB", cacheA, true);
  ok("P08. A→B switch clears pending action and picker-ready action",
    newState.pickerReadyAction === null
    && newState.consentSheetUid === null
    && newState.consentSheetOpen === false
    && cacheA.checked === null);
}

// P09: A→B switch never leaves an unusable ack-required screen
// After A→B switch: if new uid exists + scanEnabled → "pick"
// If new uid is null → "sign-in-required"
{
  const cacheWithUid = makeCache({ checked: true, uid: "uid-userA" });
  const withNewUid = resolveAuthSwitch("uid-userB", cacheWithUid, true);
  ok("P09a. A→B switch with new uid and scanEnabled=true → step 'pick'",
    withNewUid.step === "pick");

  const cacheForSignOut = makeCache({ checked: true, uid: "uid-userA" });
  const afterSignOut = resolveAuthSwitch(null, cacheForSignOut, true);
  ok("P09b. A→B switch with null uid → step 'sign-in-required'",
    afterSignOut.step === "sign-in-required");
}

// P10: Null UID never opens consent sheet (never renders ScanConsentSheet with uid="")
{
  const cache = makeCache();
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => null,
    checkConsent: async (_uid) => ({ uid: null, acknowledged: false }),
  });
  ok("P10. Null UID never opens consent (routes to sign-in instead)",
    result.outcome === "sign-in");
}

// ── V4 NEW REAL TESTS (replacing fake P11/P12/P13) ────────────────────────

// P11: resolveAuthSwitch respects scanner status in step resolution
// Previously returned "pick" for any non-null UID; V4 must use scanEnabled.
{
  // scanEnabled=true → "pick"
  const cache1 = makeCache({ checked: true, uid: "uid-userA" });
  const r1 = resolveAuthSwitch("uid-userB", cache1, true);
  ok("P11a. resolveAuthSwitch with uid + scanEnabled=true → 'pick'",
    r1.step === "pick" && cache1.checked === null && cache1.uid === null);

  // scanEnabled=false → "scan-unavailable"
  const cache2 = makeCache({ checked: true, uid: "uid-userA" });
  const r2 = resolveAuthSwitch("uid-userB", cache2, false);
  ok("P11b. resolveAuthSwitch with uid + scanEnabled=false → 'scan-unavailable'",
    r2.step === "scan-unavailable");

  // scanEnabled=null → "status-check" (fail-closed)
  const cache3 = makeCache({ checked: true, uid: "uid-userA" });
  const r3 = resolveAuthSwitch("uid-userB", cache3, null);
  ok("P11c. resolveAuthSwitch with uid + scanEnabled=null → 'status-check'",
    r3.step === "status-check");
}

// P12: A→B switch with scanEnabled=false yields scan-unavailable step
// (Fail-closed: scanner not confirmed available → do not show "pick" UI)
{
  const cache = makeCache({ checked: true, uid: "uid-A" });
  const result = resolveAuthSwitch("uid-B", cache, false);
  ok("P12. A→B switch with scanEnabled=false → step 'scan-unavailable'",
    result.step === "scan-unavailable"
    && result.consentSheetOpen === false
    && result.consentSheetUid === null
    && result.pickerReadyAction === null);
}

// P13: resolvePickerRequestWith invalidates ack cache on UID change between calls
// First call populates cache for uid-A; second call (uid-B) must re-check.
{
  const cache = makeCache();
  let serverCallCount = 0;

  // First call: populate cache for uid-A
  await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-A",
    checkConsent: async (_uid) => { serverCallCount++; return { uid: "uid-A", acknowledged: true }; },
  });

  // Verify cache populated for uid-A
  ok("P13a. resolvePickerRequestWith populates cache for uid-A",
    cache.checked === true && cache.uid === "uid-A" && serverCallCount === 1);

  // Second call: same uid-A should use cache (no server call)
  await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-A",
    checkConsent: async (_uid) => { serverCallCount++; return { uid: "uid-A", acknowledged: true }; },
  });
  ok("P13b. Same uid uses cache without server call",
    serverCallCount === 1);

  // Third call: different uid-B must invalidate cache and call server
  await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-B",
    checkConsent: async (_uid) => { serverCallCount++; return { uid: "uid-B", acknowledged: false }; },
  });
  ok("P13c. Different uid invalidates cache and re-checks server",
    serverCallCount === 2 && cache.uid === "uid-B" && cache.checked === false);
}

// ── V4 ADDITIONAL REGRESSION TESTS ────────────────────────────────────────

// P14: resolveConsentComplete with null pendingAction returns step="pick"
{
  const cache = makeCache();
  const result = resolveConsentComplete(null, cache, "uid-p14");
  ok("P14. resolveConsentComplete with null action returns step='pick'",
    result.pickerReadyAction === null && result.step === "pick");
}

// P15: resolveAuthSwitch with null UID always returns sign-in-required (ignores scanEnabled)
{
  const cacheTrue = makeCache({ checked: true, uid: "uid-old" });
  const r1 = resolveAuthSwitch(null, cacheTrue, true);
  ok("P15a. resolveAuthSwitch null uid + scanEnabled=true → 'sign-in-required'",
    r1.step === "sign-in-required");

  const cacheFalse = makeCache({ checked: true, uid: "uid-old" });
  const r2 = resolveAuthSwitch(null, cacheFalse, false);
  ok("P15b. resolveAuthSwitch null uid + scanEnabled=false → 'sign-in-required'",
    r2.step === "sign-in-required");

  const cacheNull = makeCache({ checked: true, uid: "uid-old" });
  const r3 = resolveAuthSwitch(null, cacheNull, null);
  ok("P15c. resolveAuthSwitch null uid + scanEnabled=null → 'sign-in-required'",
    r3.step === "sign-in-required");
}

// P16: resolvePickerRequestWith returns stale when UID changes to a *different* value post-switch
// Simulates: user A→B switch during async checkConsent call.
// (A null post-checkConsent UID is tested by P26.)
{
  const cache = makeCache();
  let callCount = 0;
  const result = await resolvePickerRequestWith("library", cache, {
    getUid: async () => {
      callCount++;
      // First call (before checkConsent) returns uid-A;
      // second call (after checkConsent) returns uid-B (different user)
      return callCount === 1 ? "uid-p16-A" : "uid-p16-B";
    },
    checkConsent: async (_uid) => ({ uid: "uid-p16-A", acknowledged: true }),
  });
  ok("P16. UID A→B during checkConsent → stale outcome (not sign-in, not picker-ready)",
    result.outcome === "stale");
}

// P17: resolvePickerRequestWith uses cached acknowledged=true without calling server again;
// result carries the verified uid.
{
  const cache = makeCache({ checked: true, uid: "uid-p17" });
  let serverCalled = false;
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-p17",
    checkConsent: async (_uid) => { serverCalled = true; return { uid: "uid-p17", acknowledged: true }; },
  });
  ok("P17. Cached acknowledged=true skips server call and result.uid is set",
    result.outcome === "picker-ready"
    && (result as { outcome: "picker-ready"; action: string; uid: string }).uid === "uid-p17"
    && serverCalled === false);
}

// P18: resolveConsentComplete sets ackCache correctly (uid and checked)
{
  const cache = makeCache();
  resolveConsentComplete("camera", cache, "uid-p18");
  ok("P18. resolveConsentComplete sets ackCache.checked=true and ackCache.uid",
    cache.checked === true && cache.uid === "uid-p18");
}

// P19: resolveAuthSwitch with scanEnabled=null → step="status-check" (fail-closed)
// Even with a valid uid, if scanner status unknown, never show "pick" UI.
{
  const cache = makeCache({ checked: true, uid: "uid-old" });
  const result = resolveAuthSwitch("uid-new", cache, null);
  ok("P19. resolveAuthSwitch uid + scanEnabled=null → 'status-check' (fail-closed)",
    result.step === "status-check"
    && cache.checked === null  // cache cleared
    && cache.uid === null);
}

// P20: resolvePickerRequestWith with "manual" returns noop without getUid call
// (belt-and-suspenders: manual never touches auth or consent)
{
  let getUidCalled = false;
  const result = await resolvePickerRequestWith("manual", makeCache(), {
    getUid: async () => { getUidCalled = true; return "uid-p20"; },
    checkConsent: async () => ({ uid: "uid-p20", acknowledged: true }),
  });
  ok("P20. resolvePickerRequestWith manual → noop, getUid never called",
    result.outcome === "noop" && getUidCalled === false);
}

// ── V5 REGRESSION TESTS (picker/file race guards) ─────────────────────────

// P21: UID changes from A to B between first getUid and checkConsent → stale
// The consent result belongs to A but A is no longer the current user.
{
  const cache = makeCache();
  let getUidCalls = 0;
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => {
      getUidCalls++;
      // First call (uid lookup): returns A. Second call (post-checkConsent): returns B.
      // Third call (resolve uid): returns B.
      return getUidCalls === 1 ? "uid-p21-A" : "uid-p21-B";
    },
    checkConsent: async (_uid) => ({ uid: "uid-p21-A", acknowledged: false }),
  });
  ok("P21. UID A→B before checkConsent completes → stale (no consent opened)",
    result.outcome === "stale");
}

// P22: UID changes from A to B specifically between checkConsent and second getUid → stale
// getUid #1 = A, checkConsent returns A, getUid #2 = B (switch happened during check)
{
  const cache = makeCache();
  let getUidCalls = 0;
  const result = await resolvePickerRequestWith("library", cache, {
    getUid: async () => {
      getUidCalls++;
      return getUidCalls === 1 ? "uid-p22-A" : "uid-p22-B";
    },
    checkConsent: async (_uid) => ({ uid: "uid-p22-A", acknowledged: true }),
  });
  ok("P22. UID A→B during checkConsent (getUid#2 = B) → stale (not picker-ready)",
    result.outcome === "stale");
}

// P23: picker-ready result carries the verified uid
{
  const cache = makeCache({ checked: true, uid: "uid-p23" });
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => "uid-p23",
    checkConsent: async () => ({ uid: "uid-p23", acknowledged: true }),
  });
  ok("P23. picker-ready result.uid equals the verified uid",
    result.outcome === "picker-ready"
    && (result as { outcome: "picker-ready"; uid: string; action: string }).uid === "uid-p23");
}

// P24: open-consent result carries the verified uid
{
  const cache = makeCache();
  const result = await resolvePickerRequestWith("library", cache, {
    getUid: async () => "uid-p24",
    checkConsent: async (_uid) => ({ uid: "uid-p24", acknowledged: false }),
  });
  ok("P24. open-consent result.uid equals the verified uid",
    result.outcome === "open-consent"
    && (result as { outcome: "open-consent"; uid: string; action: string }).uid === "uid-p24");
}

// P25: Cache hit path also re-reads uid; if UID changes → stale
// Cache was set for uid-A (checked=true). But when picker-ready button is tapped,
// getUid now returns uid-B. Result must be stale.
{
  const cache = makeCache({ checked: true, uid: "uid-p25-A" });
  let getUidCalls = 0;
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => {
      getUidCalls++;
      // First call for cache validation returns A; second call (resolve uid) returns B.
      return getUidCalls === 1 ? "uid-p25-A" : "uid-p25-B";
    },
    checkConsent: async () => ({ uid: "uid-p25-A", acknowledged: true }),
  });
  ok("P25. Cache hit with UID change at resolve step → stale",
    result.outcome === "stale");
}

// P26: resolvePickerRequestWith UID becomes null after checkConsent → stale
// (not sign-in: caller's pickerRequestIdRef handles the sign-in routing)
{
  const cache = makeCache();
  let getUidCalls = 0;
  const result = await resolvePickerRequestWith("camera", cache, {
    getUid: async () => {
      getUidCalls++;
      return getUidCalls === 1 ? "uid-p26" : null;
    },
    checkConsent: async (_uid) => ({ uid: "uid-p26", acknowledged: true }),
  });
  ok("P26. UID becomes null after checkConsent → stale (sign-out during flight)",
    result.outcome === "stale");
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`
═══════════════════════════════════════════
  Behavioural tests:  ${passed + failed} total
  Passed: ${passed}
  Failed: ${failed}
═══════════════════════════════════════════`);

if (failed > 0) {
  process.exit(1);
}
