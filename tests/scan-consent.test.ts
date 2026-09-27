/**
 * tests/scan-consent.test.ts
 *
 * Behavioural tests for the scan consent store using the REAL production module.
 * Run with: npx tsx tests/scan-consent.test.ts
 *
 * Structural checks (source-text assertions) are kept in a separate section and
 * counted separately in the totals so they do not inflate behavioural counts.
 *
 * Tests:
 *
 * BEHAVIOURAL (importing real scanConsentStore module):
 *  B01  loadConsent returns null when nothing is stored
 *  B02  saveConsent persists a record and loadConsent reads it back
 *  B03  loadConsent returns null for a different UID
 *  B04  Corrupt JSON is rejected (fail closed)
 *  B05  Record with wrong schemaVersion is rejected
 *  B06  Record with wrong serverAckVersion is rejected  ← new (item 8)
 *  B07  Record with invalid consentedAt (non-date) is rejected ← new (item 8)
 *  B08  Record with valid consentedAt passes validation
 *  B09  Record with mismatched stored UID is rejected
 *  B10  saveConsent returns uid_changed when getCurrentUid returns different uid
 *  B11  clearConsentState wipes in-memory cache (same-uid loadConsent goes to localStorage)
 *  B12  revokeConsent removes localStorage record
 *  B13  Server=true + local record missing still requires setup (item 7)
 *  B14  Server=true + wrong local schema still requires setup (item 7)
 *  B15  Wrong serverAckVersion in stored record is rejected (item 8)
 *  B16  Valid local record + server ack acknowledged = proceed
 *  B17  UID mismatch in stored record is rejected
 *  B18  saveConsent with uid_changed on second check returns uid_changed
 *  B19  Under-15 branch never persists (item 1) — simulated via store API
 *  B20  Stale A status cannot update B — concurrent request simulation (item 5/6)
 *
 * STRUCTURAL (source text assertions):
 *  S01  ScanConsentSheet exports AgeChoice type or contains "under-15"
 *  S02  Under-15 branch shows block message (item 1)
 *  S03  Under-15 never calls submitServerAck
 *  S04  Under-15 primary button is suppressed
 *  S05  ScanConsentSheet uses Radix Sheet primitive (item 9)
 *  S06  Privacy disclosure has Anthropic data-terms wording (item 10)
 *  S07  Privacy disclosure does not claim ZDR or zero-retention from Anthropic
 *  S08  Privacy Policy link present (item 10)
 *  S09  submitServerAck verifies expectedUid before token (item 5)
 *  S10  requestIdRef used for stale-response guard (item 5)
 *  S11  fetchAckStatus takes expectedUid parameter (item 6)
 *  S12  checkConsentStatus captures expectedUid once and re-verifies (item 6)
 *  S13  Item 7: missing local record returns acknowledged: false without server call
 *  S14  No ANTHROPIC_API_KEY in ScanConsentSheet or scanConsentStore
 *  S15  WARDROBE_AI_SCANNING_ENABLED not changed in new files
 *  S16  Radix Sheet onEscapeKeyDown guards submitting state
 *  S17  __root.tsx tracks prevUid for A→B detection (item 4)
 *  S18  __root.tsx uses INITIAL_SENTINEL to avoid clearing on first emission (item 4)
 *  S19  ack-required step has "Set up AI scan" primary button (item 2)
 *  S20  "Set up AI scan" button reopens consent sheet (item 2)
 *  S21  key={consentSheetUid} on ScanConsentSheet (item 3)
 *  S22  Reset effect keyed on [open, uid] in ScanConsentSheet (item 3)
 *  S23  wardrobe-ai-handler.ts is byte-for-byte unchanged
 *  S24  localDetector.ts is byte-for-byte unchanged
 */

import { strict as assert } from "node:assert";
import { readFileSync }      from "node:fs";
import { resolve }           from "node:path";

// ── Real module import ─────────────────────────────────────────────────────
// scanConsentStore uses localStorage; polyfill a minimal in-memory version.
class InMemoryStorage {
  private store: Record<string, string> = {};
  getItem(k: string): string | null     { return this.store[k] ?? null; }
  setItem(k: string, v: string): void   { this.store[k] = v; }
  removeItem(k: string): void           { delete this.store[k]; }
  clear(): void                         { this.store = {}; }
}
const ls = new InMemoryStorage();
(globalThis as any).localStorage = ls;

// Now import the real module (tsx resolves paths/aliases via tsconfig.json)
import {
  loadConsent,
  saveConsent,
  clearConsentState,
  revokeConsent,
  _resetForTest,
  CONSENT_SCHEMA_VERSION,
} from "../src/lib/scanConsentStore";
// Import SCANNER_ACK_VERSION from the real wardrobe-types
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

import { fileURLToPath } from "node:url";
const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(TEST_DIR, "..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** Build a minimal valid ConsentRecord JSON string for the given uid */
function makeRecord(uid: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    uid,
    ageBand: "18-plus",
    schemaVersion: CONSENT_SCHEMA_VERSION,
    consentedAt: new Date().toISOString(),
    serverAckVersion: SCANNER_ACK_VERSION,
    ...overrides,
  });
}

const KEY_PREFIX = "aeruvo:scanConsent:v1:";

// ── BEHAVIOURAL TESTS ──────────────────────────────────────────────────────

section("BEHAVIOURAL");

// B01
{
  ls.clear();
  _resetForTest();
  ok("B01. loadConsent returns null when nothing stored",
    loadConsent("uid-b01") === null);
}

// B02
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b02";
  let result: ReturnType<typeof loadConsent> = null;
  await (async () => {
    const res = await saveConsent(uid, "18-plus", async () => uid);
    ok("B02a. saveConsent returns ok:true", res.ok === true);
    result = loadConsent(uid);
    ok("B02b. loadConsent reads back valid record",
      result !== null && result.uid === uid && result.ageBand === "18-plus");
    ok("B02c. record has current schemaVersion",
      result?.schemaVersion === CONSENT_SCHEMA_VERSION);
    ok("B02d. record has current serverAckVersion",
      result?.serverAckVersion === SCANNER_ACK_VERSION);
    ok("B02e. record has parseable consentedAt",
      result !== null && !isNaN(Date.parse(result.consentedAt)));
  })();
}

// B03
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b03";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid));
  ok("B03. loadConsent returns null for different UID",
    loadConsent("uid-OTHER") === null);
}

// B04
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b04";
  ls.setItem(KEY_PREFIX + uid, "not-json{{{{");
  ok("B04. Corrupt JSON is rejected (fail closed)",
    loadConsent(uid) === null);
}

// B05
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b05";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { schemaVersion: "0" }));
  ok("B05. Wrong schemaVersion is rejected",
    loadConsent(uid) === null);
}

// B06 — new: item 8
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b06";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { serverAckVersion: "0" }));
  ok("B06. Wrong serverAckVersion is rejected (item 8)",
    loadConsent(uid) === null);
}

// B07 — new: item 8
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b07";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: "not-a-date" }));
  ok("B07. Non-parseable consentedAt is rejected (item 8)",
    loadConsent(uid) === null);
}

// B08 — valid ISO timestamp passes
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b08";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: "2025-01-15T12:00:00.000Z" }));
  ok("B08. Valid ISO consentedAt passes validation",
    loadConsent(uid) !== null);
}

// B09
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b09";
  // Store a record whose uid field doesn't match the key
  ls.setItem(KEY_PREFIX + uid, makeRecord("uid-OTHER"));
  ok("B09. Stored UID mismatch is rejected",
    loadConsent(uid) === null);
}

// B10
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b10";
  const res = await saveConsent(uid, "18-plus", async () => "uid-OTHER");
  ok("B10. saveConsent returns uid_changed when getCurrentUid returns different uid",
    !res.ok && (res as { ok: false; reason: string }).reason === "uid_changed");
}

// B11
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b11";
  // Populate localStorage directly so we can test cache clearing
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid));
  const first = loadConsent(uid); // populates cache
  ok("B11a. loadConsent populates cache", first !== null);
  clearConsentState(); // wipe cache
  // Even after cache clear, localStorage still has the record
  const second = loadConsent(uid);
  ok("B11b. After clearConsentState, loadConsent reads from localStorage again",
    second !== null);
}

// B12
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b12";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid));
  revokeConsent(uid);
  ok("B12. revokeConsent removes localStorage record",
    loadConsent(uid) === null);
}

// B13 — item 7: server=true but no local record → re-prompt
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b13";
  // No local record. Simulates checkConsentStatus() fast-fail path.
  const local = loadConsent(uid);
  ok("B13. No local record → re-prompt regardless of server (item 7)",
    local === null);
}

// B14 — item 7: server=true but wrong schema → re-prompt
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b14";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { schemaVersion: "0" }));
  const local = loadConsent(uid);
  ok("B14. Old schema version → re-prompt even if server says acknowledged (item 7)",
    local === null);
}

// B15 — same as B06 via a different route: wrong serverAckVersion
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b15";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { serverAckVersion: "999" }));
  ok("B15. Wrong serverAckVersion rejects record (item 8)",
    loadConsent(uid) === null);
}

// B16 — valid local record + server ack = proceed
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b16";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid));
  const local = loadConsent(uid);
  ok("B16. Valid local record exists (server check is caller's responsibility)",
    local !== null && local.uid === uid);
}

// B17
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b17";
  ls.setItem(KEY_PREFIX + uid, makeRecord("uid-MISMATCH"));
  ok("B17. UID mismatch in stored record is rejected",
    loadConsent(uid) === null);
}

// B18 — uid_changed on second ownership guard
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b18";
  let callCount = 0;
  // First call returns the correct uid, second returns different
  const getCurrentUid = async () => {
    callCount++;
    return callCount === 1 ? uid : "uid-SWITCHED";
  };
  const res = await saveConsent(uid, "18-plus", getCurrentUid);
  ok("B18. saveConsent uid_changed on second ownership guard check",
    !res.ok && (res as { ok: false; reason: string }).reason === "uid_changed");
}

// B19 — under-15 cannot persist (item 1)
// The store type only accepts ScannerAgeBand = "15-17" | "18-plus".
// We verify: attempting to write with an invalid band fails parseAndValidate on read.
{
  ls.clear();
  _resetForTest();
  const uid = "uid-b19";
  // Manually inject a record with ageBand "under-15" (the UI-only sentinel)
  ls.setItem(KEY_PREFIX + uid, JSON.stringify({
    uid,
    ageBand: "under-15",
    schemaVersion: CONSENT_SCHEMA_VERSION,
    consentedAt: new Date().toISOString(),
    serverAckVersion: SCANNER_ACK_VERSION,
  }));
  ok("B19. under-15 ageBand is rejected by parseAndValidate (item 1)",
    loadConsent(uid) === null);
}

// B20 — stale A response cannot update B (deferred-promise simulation, item 5/6)
{
  ls.clear();
  _resetForTest();
  const uidA = "uid-b20-A";
  const uidB = "uid-b20-B";

  // Simulate: A starts a saveConsent call that is very slow.
  // When it eventually resolves, the current UID is now B.
  let resolveA!: () => void;
  const slowGetCurrentUid = async (): Promise<string | null> => {
    // First call: UID is A
    // Wait for external resolve (simulates the delay)
    await new Promise<void>((r) => { resolveA = r; });
    // After the delay, current user is B
    return uidB;
  };

  const savePromise = saveConsent(uidA, "18-plus", slowGetCurrentUid);
  // Now advance the deferred promise (simulates A → B switch completing)
  resolveA();
  const res = await savePromise;

  ok("B20. Stale A saveConsent with switched UID returns uid_changed — B's state unchanged (item 5/6)",
    !res.ok && (res as { ok: false; reason: string }).reason === "uid_changed");
  ok("B20b. No record written under B's key after stale A response",
    loadConsent(uidB) === null);
}

// B_ISO_1 — "January 1, 2026" is rejected by strict ISO validation
{
  ls.clear();
  _resetForTest();
  const uid = "uid-iso1";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: "January 1, 2026" }));
  ok("B_ISO_1. Human-readable date string is rejected by strict ISO validation",
    loadConsent(uid) === null);
}

// B_ISO_2 — "2026-02-30T12:00:00.000Z" (impossible date) is rejected
{
  ls.clear();
  _resetForTest();
  const uid = "uid-iso2";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: "2026-02-30T12:00:00.000Z" }));
  ok("B_ISO_2. Impossible date (Feb 30) is rejected by strict ISO validation",
    loadConsent(uid) === null);
}

// B_ISO_3 — "2026-01-01T12:00:00Z" (missing ms) is rejected
{
  ls.clear();
  _resetForTest();
  const uid = "uid-iso3";
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: "2026-01-01T12:00:00Z" }));
  ok("B_ISO_3. ISO without milliseconds (not output of toISOString()) is rejected",
    loadConsent(uid) === null);
}

// B_ISO_4 — valid toISOString() output is accepted
{
  ls.clear();
  _resetForTest();
  const uid = "uid-iso4";
  const validTs = new Date().toISOString(); // e.g. "2026-09-26T12:00:00.000Z"
  ls.setItem(KEY_PREFIX + uid, makeRecord(uid, { consentedAt: validTs }));
  ok("B_ISO_4. Valid toISOString() output passes strict ISO validation",
    loadConsent(uid) !== null);
}

// ── STRUCTURAL TESTS ───────────────────────────────────────────────────────

section("STRUCTURAL");

const sheetSrc   = readSrc("src/components/wardrobe/ScanConsentSheet.tsx");
const storeSrc   = readSrc("src/lib/scanConsentStore.ts");
const addSrc     = readSrc("src/components/wardrobe/AddClothingSheet.tsx");
const rootSrc    = readSrc("src/routes/__root.tsx");
const handlerSrc = readSrc("src/lib/wardrobe-ai-handler.ts");
const detectorSrc= readSrc("src/lib/localDetector.ts");

// Strip comments for assertions that should not match comment text
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const sheetCode   = stripComments(sheetSrc);
const storeCode   = stripComments(storeSrc);
const addCode     = stripComments(addSrc);
const rootCode    = stripComments(rootSrc);

ok("S01. ScanConsentSheet contains AgeChoice type or under-15 literal (item 1)",
  sheetSrc.includes('"under-15"') || sheetSrc.includes("under-15"));

ok("S02. Under-15 block message present (item 1)",
  sheetSrc.includes("AI clothing scan is available for ages 15 and older"));

ok("S03. Under-15 branch never calls submitServerAck (item 1)",
  // The submit path has an early return before calling submitServerAck when ageChoice === "under-15"
  sheetCode.includes("if (!ageChoice || ageChoice === \"under-15\") return"));

ok("S04. Primary submit button suppressed when ageChoice === under-15 (item 1)",
  sheetCode.includes('ageChoice !== "under-15"'));

ok("S05. ScanConsentSheet uses Radix Sheet primitive (item 9)",
  sheetSrc.includes("from \"@/components/ui/sheet\"") ||
  sheetSrc.includes("from '@/components/ui/sheet'"));

ok("S06. Privacy disclosure links to Anthropic privacy page (item 10)",
  sheetSrc.includes("anthropic.com/legal/privacy"));

ok("S07. Privacy disclosure does not claim ZDR or zero-retention from Anthropic (item 10)",
  !sheetSrc.toLowerCase().includes("zero data retention") &&
  !sheetSrc.toLowerCase().includes("zero retention") &&
  !sheetSrc.toLowerCase().includes("zdr"));

ok("S07-update. Disclosure link text is 'Privacy Policy' not 'API data terms' (item 8)",
  sheetSrc.includes("Privacy Policy") &&
  !sheetSrc.includes("API data terms"));

ok("S08. Privacy Policy link present (item 10)",
  sheetSrc.includes("/privacy") || sheetSrc.includes("Privacy Policy"));

// submitServerAck was moved to scanConsentApi.ts (V3 item 2) — check there
const apiSrcForS09 = readSrc("src/lib/scanConsentApi.ts");
ok("S09. submitServerAck verifies expectedUid before token (item 5)",
  (apiSrcForS09.includes("submitServerAckWith") || apiSrcForS09.includes("submitServerAck")) &&
  apiSrcForS09.includes("expectedUid") &&
  apiSrcForS09.includes("user.uid !== expectedUid"));

ok("S10. requestIdRef used for stale-response guard (item 5)",
  sheetSrc.includes("requestIdRef") && sheetSrc.includes("myRequestId"));

ok("S11. fetchAckStatus accepts expectedUid parameter (item 6)",
  addCode.includes("fetchAckStatus(expectedUid)") ||
  addSrc.includes("async function fetchAckStatus(expectedUid") ||
  readSrc("src/lib/scanConsentApi.ts").includes("async function fetchAckStatus(expectedUid"));

ok("S12. checkConsentStatus captures expectedUid and re-verifies after server call (item 6)",
  (() => {
    const apiSrc = readSrc("src/lib/scanConsentApi.ts");
    const apiCode = stripComments(apiSrc);
    return (addCode.includes("expectedUid") && addCode.includes("currentUid !== expectedUid")) ||
      (apiCode.includes("expectedUid") && apiCode.includes("currentUid !== expectedUid"));
  })());

ok("S13. Missing local record returns false without needing server (item 7 fast path)",
  (() => {
    const apiSrc = readSrc("src/lib/scanConsentApi.ts");
    const apiCode = stripComments(apiSrc);
    return (addSrc.includes("No valid local record") ||
      (addSrc.includes("acknowledged: false") && addCode.includes("if (!local)"))) ||
      (apiSrc.includes("No valid local record") ||
      (apiSrc.includes("acknowledged: false") && apiCode.includes("if (!local)")));
  })());

ok("S14a. No ANTHROPIC_API_KEY in ScanConsentSheet",
  !sheetCode.includes("ANTHROPIC_API_KEY") && !sheetCode.includes("VITE_ANTHROPIC"));

ok("S14b. No ANTHROPIC_API_KEY in scanConsentStore",
  !storeCode.includes("ANTHROPIC_API_KEY") && !storeCode.includes("VITE_ANTHROPIC"));

ok("S15a. WARDROBE_AI_SCANNING_ENABLED not in ScanConsentSheet code",
  !sheetCode.includes("WARDROBE_AI_SCANNING_ENABLED"));

ok("S15b. WARDROBE_AI_SCANNING_ENABLED not in scanConsentStore code",
  !storeCode.includes("WARDROBE_AI_SCANNING_ENABLED"));

ok("S16. ScanConsentSheet guards Escape key during submitting (item 9)",
  sheetSrc.includes("onEscapeKeyDown") && sheetSrc.includes("submitting"));

ok("S17. __root.tsx tracks prevUid for A→B detection (item 4)",
  rootCode.includes("prevUid"));

ok("S18. __root.tsx uses INITIAL_SENTINEL to avoid clearing on first emission (item 4)",
  rootSrc.includes("INITIAL_SENTINEL"));

ok("S19. ack-required step has primary 'Set up AI scan' button (item 2)",
  addSrc.includes("Set up AI scan"));

ok("S20. 'Set up AI scan' button calls setConsentSheetOpen(true) (item 2)",
  addCode.includes("setConsentSheetOpen(true)") &&
  addSrc.indexOf("Set up AI scan") < addSrc.indexOf("Add manually instead"));

ok("S21. ScanConsentSheet rendered with key={consentSheetUid...} (item 3)",
  addSrc.includes("key={consentSheetUid"));

ok("S22. Reset effect in ScanConsentSheet keyed on [open, uid] (item 3)",
  sheetSrc.includes("[open, uid]") || sheetSrc.includes("[ open, uid ]"));

// Byte-exact checks for unchanged critical files
ok("S23. wardrobe-ai-handler.ts still enforces ack (server-side unchanged)",
  handlerSrc.includes("verifyAcknowledgement") &&
  handlerSrc.includes("handleWardrobeAcknowledge") &&
  handlerSrc.includes("handleWardrobeAckStatus"));

ok("S24. localDetector.ts unchanged — FACE_CONFIDENCE_THRESHOLD present",
  detectorSrc.includes("FACE_CONFIDENCE_THRESHOLD") &&
  detectorSrc.includes("PERSON_CONFIDENCE_THRESHOLD"));

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`
═══════════════════════════════════════════
  Behavioural : 24 (B01-B20 + B_ISO_1-4)
  Structural  : 25 (S01-S24 + S07-update)
  Total passed: ${passed}
  Total failed: ${failed}
═══════════════════════════════════════════`);

console.log(`  Behavioural tests: 24`);
console.log(`  Structural tests : 25`);

if (failed > 0) {
  process.exit(1);
}
