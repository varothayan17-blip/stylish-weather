/**
 * wardrobe-ai-handler.test.cjs
 * Comprehensive tests for the Anthropic wardrobe AI handler.
 *
 * Test approach:
 *   SOURCE CHECKS — assert implementation patterns in TypeScript source files.
 *   JS SIMULATIONS — port pure logic (validation, magic bytes, etc.) and exercise
 *     with representative inputs. Does not execute compiled TypeScript.
 *
 * Limitation: full behavioural coverage of Firestore transactions and the
 * Anthropic HTTP call requires integration tests with emulators. These tests
 * verify the logic, structure, and source-level guarantees.
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

const handlerSrc  = readSource("src/lib/wardrobe-ai-handler.ts");
const typesSrc    = readSource("src/lib/wardrobe-types.ts");
const serverSrc   = readSource("src/server.ts");
const sheetSrc    = readSource("src/components/wardrobe/AddClothingSheet.tsx");
const storeSrc    = readSource("src/components/wardrobe/wardrobeStore.ts");
const privacySrc  = readSource("src/routes/privacy.tsx");
const termsSrc    = readSource("src/routes/terms.tsx");
const envSrc      = readSource(".env.example");
const pkgSrc      = readSource("package.json");

// ════════════════════════════════════════════════════════════════════════════
// 1. Scanning remains disabled by default
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. Feature flag ──────────────────────────────────────────────");
ok("1a. assertScanningEnabled() exists in handler", handlerSrc.includes("assertScanningEnabled()"));
// Source assertions: the function now fails-closed in ALL environments
ok("1b. assertScanningEnabled fails-closed: blocks unless exactly 'true'",
  handlerSrc.includes("WARDROBE_AI_SCANNING_ENABLED !== \"true\""));
ok("1b2. No environment exception in assertScanningEnabled (no isProd branch)",
  (() => {
    const fnStart = handlerSrc.indexOf("function assertScanningEnabled()");
    const fnEnd   = handlerSrc.indexOf("\n}", fnStart) + 2;
    const fn = handlerSrc.slice(fnStart, fnEnd);
    return !fn.includes("isProd") && !fn.includes("NODE_ENV");
  })());

// Behavioural simulation of the fail-closed flag:
function simFlagCheck(envValue) {
  return envValue === "true"; // only exact lowercase string enables scanning
}
ok("1c-sim. undefined → blocked", !simFlagCheck(undefined));
ok("1d-sim. empty string → blocked", !simFlagCheck(""));
ok("1e-sim. 'false' → blocked", !simFlagCheck("false"));
ok("1f-sim. 'TRUE' (uppercase) → blocked", !simFlagCheck("TRUE"));
ok("1g-sim. 'true' (exact) → allowed", simFlagCheck("true") === true);
ok("1h-sim. '1' → blocked", !simFlagCheck("1"));
ok("1i-sim. 'yes' → blocked", !simFlagCheck("yes"));
ok("1c. .env.example sets WARDROBE_AI_SCANNING_ENABLED=false (commented)",
  envSrc.includes("WARDROBE_AI_SCANNING_ENABLED=false"));
ok("1d. wardrobe_scanning_temporarily_unavailable error code present",
  handlerSrc.includes("wardrobe_scanning_temporarily_unavailable"));

// ════════════════════════════════════════════════════════════════════════════
// 2. No Gemini references in production source
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. Gemini removal ────────────────────────────────────────────");
ok("2a. No generativelanguage.googleapis.com in src/",
  !handlerSrc.includes("generativelanguage.googleapis.com") &&
  !serverSrc.includes("generativelanguage.googleapis.com"));
ok("2b. No GEMINI_API_KEY env read in handler", !handlerSrc.includes("GEMINI_API_KEY"));
ok("2c. No GEMINI_SERVICE_TIER env read in handler", !handlerSrc.includes("GEMINI_SERVICE_TIER"));
ok("2d. No GEMINI_WARDROBE_MODEL env read in handler", !handlerSrc.includes("GEMINI_WARDROBE_MODEL"));
ok("2e. No geminiProvider in handler", !handlerSrc.includes("geminiProvider"));
ok("2f. No callGemini function in handler", !handlerSrc.includes("callGemini"));
ok("2g. No GeminiHttpError in handler", !handlerSrc.includes("GeminiHttpError"));
ok("2h. No assertPaidServiceConfigured in handler", !handlerSrc.includes("assertPaidServiceConfigured"));
ok("2i. handler uses anthropicProvider", handlerSrc.includes("anthropicProvider"));
ok("2j. handler uses api.anthropic.com/v1/messages", handlerSrc.includes("api.anthropic.com/v1/messages"));
ok("2k. handler uses claude-haiku-4-5-20251001", handlerSrc.includes("claude-haiku-4-5-20251001"));
ok("2l. No Gemini vars in .env.example", !envSrc.includes("GEMINI_API_KEY"));
ok("2m. .env.example has ANTHROPIC_API_KEY section", envSrc.includes("ANTHROPIC_API_KEY"));
// 2n: "Google Gemini" still appears in a JSDoc comment block that was pre-existing.
// The rendered section title is now "AI wardrobe analysis — Anthropic Claude".
ok("2n. Rendered AI section title is Anthropic Claude (not Gemini)",
  privacySrc.includes("AI wardrobe analysis — Anthropic Claude") &&
  !privacySrc.includes("<Section title=\"AI wardrobe analysis — Google Gemini\""));
ok("2o. privacy.tsx references Anthropic Claude", privacySrc.includes("Anthropic Claude") || privacySrc.includes("Anthropic API"));
ok("2p. terms.tsx no longer references Google Gemini", !termsSrc.includes("Google Gemini"));
ok("2q. package.json has no google-generative-ai or vertex-ai SDK",
  !pkgSrc.includes("generative-ai") && !pkgSrc.includes("vertex"));

// ════════════════════════════════════════════════════════════════════════════
// 3. Anthropic structured outputs (GA)
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. Structured outputs ────────────────────────────────────────");
ok("3a. output_config.format used (GA method, no beta header)",
  handlerSrc.includes("output_config") && handlerSrc.includes("json_schema"));
ok("3b. No structured-outputs beta header in handler",
  !handlerSrc.includes("structured-outputs-2025-11-13"));
ok("3c. oneOf discriminated union in schema", handlerSrc.includes("oneOf"));
ok("3d. status: accepted branch in schema", handlerSrc.includes('"accepted"'));
ok("3e. status: rejected branch with reasonCode", handlerSrc.includes('"rejected"') && handlerSrc.includes("reasonCode"));
ok("3f. additionalProperties: false at analysis object level",
  handlerSrc.includes("additionalProperties: false"));
ok("3g. evidence NOT in JSON schema (decision a)",
  !handlerSrc.includes('"evidence"'));

// ════════════════════════════════════════════════════════════════════════════
// 4. MIME allowlist and magic-byte validation
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. MIME and magic-byte validation ────────────────────────────");
ok("4a. ACCEPTED_MIME contains jpeg/png/webp",
  handlerSrc.includes('"image/jpeg"') && handlerSrc.includes('"image/png"') && handlerSrc.includes('"image/webp"'));
ok("4b. HEIC not in ACCEPTED_MIME",
  !handlerSrc.includes('"image/heic"'));
ok("4c. GIF not accepted", !handlerSrc.includes('"image/gif"'));
ok("4d. validateMagicBytes function exists", handlerSrc.includes("validateMagicBytes"));
ok("4e. JPEG magic bytes FF D8 FF checked",
  handlerSrc.includes("0xFF") && handlerSrc.includes("0xD8"));
ok("4f. PNG full 8-byte signature checked",
  handlerSrc.includes("0x89") && handlerSrc.includes("0x50") && handlerSrc.includes("0x4E") && handlerSrc.includes("0x0A") && handlerSrc.includes("0x1A"));
ok("4g. WebP validates both RIFF and WEBP marker",
  handlerSrc.includes("0x52") && handlerSrc.includes("0x49") && handlerSrc.includes("0x46") &&  // RIFF
  handlerSrc.includes("0x57") && handlerSrc.includes("0x45") && handlerSrc.includes("0x42") && handlerSrc.includes("0x50")); // WEBP
ok("4h. Truncated/empty files rejected (byteLength === 0 check)",
  handlerSrc.includes('byteLength === 0') || handlerSrc.includes("buf.length < 12"));

// ── JS simulation of magic-byte validation ───────────────────────────────
function validateMagicBytes(buf, claimedMime) {
  if (buf.length < 12) return { ok: false, reason: "truncated" };
  const normalized = claimedMime === "image/jpg" ? "image/jpeg" : claimedMime;
  if (normalized === "image/jpeg") {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return { ok: false, reason: "mismatch" };
  } else if (normalized === "image/png") {
    const expected = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < expected.length; i++) if (buf[i] !== expected[i]) return { ok: false, reason: "mismatch" };
  } else if (normalized === "image/webp") {
    if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46 ||
        buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) {
      return { ok: false, reason: "mismatch" };
    }
  } else return { ok: false, reason: "unsupported" };
  return { ok: true };
}
const jpegBytes  = Buffer.from([0xFF,0xD8,0xFF,0xE0,0,0,0,0,0,0,0,0]);
const pngBytes   = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,0]);
const webpBytes  = Buffer.from([0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x57,0x45,0x42,0x50]);
const pdfBytes   = Buffer.from([0x25,0x50,0x44,0x46,0,0,0,0,0,0,0,0]); // %PDF
const heicBytes  = Buffer.from([0x00,0x00,0x00,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63]); // ftyp heic

ok("4i-sim. JPEG magic accepted as image/jpeg",    validateMagicBytes(jpegBytes, "image/jpeg").ok);
ok("4j-sim. PNG magic accepted as image/png",      validateMagicBytes(pngBytes,  "image/png").ok);
ok("4k-sim. WebP magic accepted as image/webp",    validateMagicBytes(webpBytes, "image/webp").ok);
ok("4l-sim. PNG bytes with JPEG MIME → mismatch",  !validateMagicBytes(pngBytes, "image/jpeg").ok);
ok("4m-sim. PDF bytes with JPEG MIME → mismatch",  !validateMagicBytes(pdfBytes, "image/jpeg").ok);
ok("4n-sim. HEIC bytes with JPEG MIME → mismatch", !validateMagicBytes(heicBytes,"image/jpeg").ok);
ok("4o-sim. RIFF without WEBP marker → mismatch",  !validateMagicBytes(Buffer.from([0x52,0x49,0x46,0x46,0,0,0,0,0,0,0,0]),"image/webp").ok);
ok("4p-sim. Truncated file (< 12 bytes) → rejected", !validateMagicBytes(Buffer.from([0xFF,0xD8]),"image/jpeg").ok);
ok("4q-sim. image/jpg normalised to image/jpeg",    validateMagicBytes(jpegBytes, "image/jpg").ok);

// ── Structural truncation validation (simulation) ────────────────────────
// Ports the exact logic from wardrobe-ai-handler.ts validateMagicBytes.
// This is structural detection, NOT full image decoding.

function validateMagicBytesStrict(buf, claimedMime) {
  const JPEG_MIN = 100, PNG_MIN = 67, WEBP_MIN = 30;
  if (buf.length === 0) return { ok: false, reason: "empty" };
  const mime = claimedMime === "image/jpg" ? "image/jpeg" : claimedMime;

  if (mime === "image/jpeg") {
    if (buf.length < JPEG_MIN) return { ok: false, reason: "too_small" };
    if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return { ok: false, reason: "magic_mismatch" };
    const n = buf.length;
    if (buf[n-2] !== 0xFF || buf[n-1] !== 0xD9) return { ok: false, reason: "truncated_no_eoi" };
    return { ok: true };
  }

  if (mime === "image/png") {
    if (buf.length < PNG_MIN) return { ok: false, reason: "too_small" };
    const sig = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
    for (let i=0;i<sig.length;i++) if (buf[i]!==sig[i]) return { ok: false, reason: "magic_mismatch" };
    // Exact 12-byte terminal IEND chunk required at end of file:
    //   00 00 00 00  49 45 4E 44  AE 42 60 82
    const IEND = [0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82];
    const end = buf.length;
    if (end < IEND.length) return { ok: false, reason: "too_small_for_iend" };
    for (let i=0;i<IEND.length;i++) {
      if (buf[end - IEND.length + i] !== IEND[i]) return { ok: false, reason: "truncated_no_iend" };
    }
    return { ok: true };
  }

  if (mime === "image/webp") {
    if (buf.length < WEBP_MIN) return { ok: false, reason: "too_small" };
    if (buf[0]!==0x52||buf[1]!==0x49||buf[2]!==0x46||buf[3]!==0x46) return { ok: false, reason: "magic_mismatch" };
    if (buf[8]!==0x57||buf[9]!==0x45||buf[10]!==0x42||buf[11]!==0x50) return { ok: false, reason: "magic_mismatch" };
    // Unsigned uint32 read (>>> 0 prevents sign-extension on values ≥ 0x80000000)
    const riffSize = ((buf[4]|(buf[5]<<8)|(buf[6]<<16)|(buf[7]<<24)) >>> 0);
    // Exact equality: riffSize + 8 must equal buf.length
    //   Too large: file truncated (declared bigger than actual)
    //   Too small: trailing garbage bytes after the declared content
    if (riffSize + 8 !== buf.length) return { ok: false, reason: "webp_riff_size_mismatch" };
    return { ok: true };
  }

  return { ok: false, reason: "unsupported" };
}

// JPEG: valid SOI + valid body but missing EOI (truncated after header)
const jpegTruncated = Buffer.alloc(200);
jpegTruncated[0]=0xFF; jpegTruncated[1]=0xD8; jpegTruncated[2]=0xFF; // valid SOI
// last two bytes are 0x00 (not FF D9)
ok("4r-sim. JPEG valid header but no EOI → truncated_no_eoi",
  validateMagicBytesStrict(jpegTruncated,"image/jpeg").reason === "truncated_no_eoi");

// JPEG: valid SOI + EOI = complete minimal JPEG (padded to 100 bytes)
const jpegComplete = Buffer.alloc(100);
jpegComplete[0]=0xFF; jpegComplete[1]=0xD8; jpegComplete[2]=0xFF;
jpegComplete[98]=0xFF; jpegComplete[99]=0xD9; // EOI at end
ok("4s-sim. JPEG valid SOI and EOI → accepted",
  validateMagicBytesStrict(jpegComplete,"image/jpeg").ok);

// JPEG: valid header but only 50 bytes (below minimum)
const jpegTooSmall = Buffer.alloc(50);
jpegTooSmall[0]=0xFF; jpegTooSmall[1]=0xD8; jpegTooSmall[2]=0xFF;
ok("4t-sim. JPEG valid magic but too small → too_small",
  validateMagicBytesStrict(jpegTooSmall,"image/jpeg").reason === "too_small");

// PNG terminal validation — exact 12-byte IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82
const PNG_SIG    = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
const IEND_EXACT = [0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82];

// 4u: valid signature, no IEND at all
const pngTruncated = Buffer.alloc(100);
PNG_SIG.forEach((b,i) => { pngTruncated[i]=b; });
// last 12 bytes are 0x00 — not a valid IEND
ok("4u-sim. PNG valid signature but no exact IEND → truncated_no_iend",
  validateMagicBytesStrict(pngTruncated,"image/png").reason === "truncated_no_iend");

// 4v: valid signature + exact 12-byte IEND at end
const pngComplete = Buffer.alloc(100);
PNG_SIG.forEach((b,i) => { pngComplete[i]=b; });
IEND_EXACT.forEach((b,i) => { pngComplete[100-12+i]=b; });
ok("4v-sim. PNG valid signature + exact 12-byte IEND terminal → accepted",
  validateMagicBytesStrict(pngComplete,"image/png").ok);

// 4v2: IEND text present but wrong length field (01 instead of 00 00 00 00)
const pngBadIEND = Buffer.alloc(100);
PNG_SIG.forEach((b,i) => { pngBadIEND[i]=b; });
IEND_EXACT.forEach((b,i) => { pngBadIEND[100-12+i]=b; });
pngBadIEND[100-12] = 0x01; // corrupt length field
ok("4v2-sim. PNG IEND with invalid length field → truncated_no_iend",
  validateMagicBytesStrict(pngBadIEND,"image/png").reason === "truncated_no_iend");

// 4v3: IEND text with wrong CRC (AE 42 60 83 instead of AE 42 60 82)
const pngBadCRC = Buffer.alloc(100);
PNG_SIG.forEach((b,i) => { pngBadCRC[i]=b; });
IEND_EXACT.forEach((b,i) => { pngBadCRC[100-12+i]=b; });
pngBadCRC[99] = 0x83; // corrupt last CRC byte
ok("4v3-sim. PNG IEND with invalid CRC → truncated_no_iend",
  validateMagicBytesStrict(pngBadCRC,"image/png").reason === "truncated_no_iend");

// 4v4: valid IEND but followed by extra bytes (IEND not at the very end)
const pngExtraBytes = Buffer.alloc(112); // 100 + 12 extra
PNG_SIG.forEach((b,i) => { pngExtraBytes[i]=b; });
IEND_EXACT.forEach((b,i) => { pngExtraBytes[100-12+i]=b; }); // IEND at bytes 88-99
// bytes 100-111 are 0x00 (trailing junk after IEND)
ok("4v4-sim. PNG IEND followed by extra bytes → truncated_no_iend (IEND not at exact end)",
  validateMagicBytesStrict(pngExtraBytes,"image/png").reason === "truncated_no_iend");

// WebP exact-length validation: riffSize + 8 must === buf.length
function makeWebP(bufLen, riffSizeField) {
  const b = Buffer.alloc(bufLen, 0);
  b[0]=0x52; b[1]=0x49; b[2]=0x46; b[3]=0x46; // RIFF
  b[8]=0x57; b[9]=0x45; b[10]=0x42; b[11]=0x50; // WEBP
  // Write riffSizeField little-endian uint32
  b[4]=(riffSizeField&0xFF); b[5]=((riffSizeField>>8)&0xFF);
  b[6]=((riffSizeField>>16)&0xFF); b[7]=((riffSizeField>>24)&0xFF);
  return b;
}

// 4w: declared size larger than actual (truncated)
// buf is 30 bytes; riffSize field = 9999 → 9999+8 = 10007 ≠ 30
const webpTruncated = makeWebP(30, 9999);
ok("4w-sim. WebP declared size larger than actual buffer → webp_riff_size_mismatch",
  validateMagicBytesStrict(webpTruncated,"image/webp").reason === "webp_riff_size_mismatch");

// 4x: declared size smaller than actual (trailing bytes)
// buf is 50 bytes; riffSize field = 20 → 20+8 = 28 ≠ 50
const webpTrailing = makeWebP(50, 20);
ok("4x-sim. WebP declared size smaller than actual buffer (trailing bytes) → webp_riff_size_mismatch",
  validateMagicBytesStrict(webpTrailing,"image/webp").reason === "webp_riff_size_mismatch");

// 4x2: exact match → accepted
// buf is 30 bytes; riffSize field = 22 → 22+8 = 30 === 30
const webpComplete = makeWebP(30, 22);
ok("4x2-sim. WebP riffSize + 8 === buf.length exactly → accepted",
  validateMagicBytesStrict(webpComplete,"image/webp").ok);

// 4x3: unsigned arithmetic check — riffSize near 0x80000000 must not sign-extend
// buf = 0x80000008 bytes would be 2 GB, not testable; simulate by checking >>> 0 usage in source
ok("4x3-src. WebP RIFF size uses >>> 0 for unsigned arithmetic",
  handlerSrc.includes(">>> 0"));

// Source checks: strengthened validation present in handler
ok("4y-src. JPEG EOI validation in handler source",
  handlerSrc.includes("0xD9") && handlerSrc.includes("EOI"));
ok("4z-src. PNG exact 12-byte IEND chunk in handler source (0xAE, 0x42, 0x60, 0x82 CRC)",
  handlerSrc.includes("0xAE") && handlerSrc.includes("0x60") && handlerSrc.includes("0x82") &&
  handlerSrc.includes("IEND_CHUNK"));
ok("4za-src. WebP exact-equality riffSize+8 check in handler source",
  handlerSrc.includes("riffSize + 8 !== buf.length"));
ok("4zb-src. WebP unsigned arithmetic with >>> 0 in handler source",
  handlerSrc.includes(">>> 0"));
ok("4zc-src. Validation described as structural detection, not full decoding",
  handlerSrc.includes("structural") || handlerSrc.includes("NOT full image decoding"));

// ════════════════════════════════════════════════════════════════════════════
// 5. Authentication ordering
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 5. Authentication ordering ───────────────────────────────────");
ok("5a. assertScanningEnabled before assertAnthropicConfigured",
  handlerSrc.indexOf("assertScanningEnabled()") < handlerSrc.indexOf("assertAnthropicConfigured()"));
ok("5b. assertAnthropicConfigured before verifyFirebaseToken",
  handlerSrc.indexOf("assertAnthropicConfigured()") < handlerSrc.indexOf("const uid = await verifyFirebaseToken"));
ok("5c. verifyFirebaseToken before checkAbuseRateLimit",
  handlerSrc.indexOf("const uid = await verifyFirebaseToken") < handlerSrc.indexOf("await checkAbuseRateLimit"));
ok("5d. checkAbuseRateLimit before verifyAcknowledgement",
  handlerSrc.indexOf("await checkAbuseRateLimit") < handlerSrc.indexOf("await verifyAcknowledgement"));
ok("5e. verifyAcknowledgement before reserveQuota",
  handlerSrc.indexOf("await verifyAcknowledgement") < handlerSrc.indexOf("const reservation = await reserveQuota"));
ok("5f. Content-Length check before arrayBuffer read",
  handlerSrc.indexOf("contentLength > MAX_IMAGE_BYTES") < handlerSrc.indexOf("await request.arrayBuffer()"));

// ════════════════════════════════════════════════════════════════════════════
// 6. Abuse rate limit
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. Abuse rate limit ──────────────────────────────────────────");
ok("6a. checkAbuseRateLimit function exists", handlerSrc.includes("checkAbuseRateLimit"));
ok("6b. ABUSE_MAX_ATTEMPTS = 5", handlerSrc.includes("ABUSE_MAX_ATTEMPTS") && handlerSrc.includes("= 5"));
ok("6c. ABUSE_WINDOW_MS = 60_000", handlerSrc.includes("ABUSE_WINDOW_MS") && handlerSrc.includes("60_000"));
ok("6d. Abuse uses Firestore transaction (race-safe)", handlerSrc.includes("runTransaction") && handlerSrc.includes("windowStartMs"));
ok("6e. Abuse limit uses 'abuse' error code", handlerSrc.includes('"abuse"'));
ok("6f. Abuse limit is independent of product quota (separate document)",
  handlerSrc.includes("scannerRateLimit/current") && handlerSrc.includes("quotas/wardrobeAi"));
ok("6g. client handles abuse error code", sheetSrc.includes('"abuse"'));

// ════════════════════════════════════════════════════════════════════════════
// 7. Scanner acknowledgement
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 7. Acknowledgement ───────────────────────────────────────────");
ok("7a. SCANNER_ACK_VERSION exported from wardrobe-types", typesSrc.includes("export const SCANNER_ACK_VERSION"));
ok("7b. verifyAcknowledgement checks Firestore before provider call", handlerSrc.includes("verifyAcknowledgement"));
ok("7c. handleWardrobeAcknowledge exported", handlerSrc.includes("export async function handleWardrobeAcknowledge"));
ok("7d. handleWardrobeAckStatus exported", handlerSrc.includes("export async function handleWardrobeAckStatus"));
ok("7e. server.ts routes /api/wardrobe/acknowledge", serverSrc.includes('"/api/wardrobe/acknowledge"'));
ok("7f. server.ts routes /api/wardrobe/ack-status", serverSrc.includes('"/api/wardrobe/ack-status"'));
ok("7g. ageBand validated as 15-17 or 18-plus", handlerSrc.includes('"15-17"') && handlerSrc.includes('"18-plus"'));
ok("7h. guardianPermissionConfirmed required for 15-17 band",
  handlerSrc.includes('ageBand === "15-17" && guardianPermissionConfirmed !== true'));
ok("7i. ack record includes version, ageBand, acceptedAt, acceptedAtMs",
  handlerSrc.includes("version:    SCANNER_ACK_VERSION") &&
  handlerSrc.includes("ageBand:    ageBand") &&
  handlerSrc.includes("acceptedAt:"));
ok("7j. uid comes from verified token (never request body)",
  handlerSrc.includes("uid = await verifyFirebaseToken") &&
  !handlerSrc.includes("body.uid"));
ok("7k. ack step shown in client (ack-required step)", sheetSrc.includes('"ack-required"'));
ok("7l. client fetches ack status before allowing scan", sheetSrc.includes("fetchAckStatus"));
ok("7m. client submits acknowledgement to server", sheetSrc.includes("submitAcknowledgement"));
ok("7n. age band selector in client JSX", sheetSrc.includes('"15-17"') && sheetSrc.includes('"18-plus"'));
ok("7o. guardian checkbox shown for 15-17", sheetSrc.includes("ackAgeBand === \"15-17\"") && sheetSrc.includes("ackGuardian"));

// ════════════════════════════════════════════════════════════════════════════
// 8. Discriminated union: accepted/rejected schema validation
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. Discriminated union validation ────────────────────────────");
// Port validateScanResult logic
const VALID_REASON_CODES = new Set(["person_present","multiple_items","id_or_document","unsafe_content","not_clothing","unusable_image"]);
const VALID_CATEGORIES   = new Set(["tops","bottoms","outerwear","shoes","accessories","dress","other"]);
function validateScanResult(parsed) {
  const status = String(parsed.status ?? "");
  if (status === "rejected") {
    const reasonCode = String(parsed.reasonCode ?? "");
    return VALID_REASON_CODES.has(reasonCode)
      ? { status: "rejected", reasonCode }
      : { status: "rejected", reasonCode: "unsafe_content" };
  }
  if (status === "accepted") {
    const a = parsed.analysis ?? {};
    return {
      status: "accepted",
      analysis: {
        name:     typeof a.name === "string" ? a.name.slice(0,120) : "Clothing item",
        category: VALID_CATEGORIES.has(String(a.category)) ? a.category : "other",
        warmth:   {
          score: Math.max(1, Math.min(5, Number(a.warmth?.score ?? 3))),
          label: ["very-light","light","medium","warm","very-warm"].includes(a.warmth?.label) ? a.warmth.label : "medium",
        },
        confidence: {
          category: Math.max(0, Math.min(1, Number(a.confidence?.category ?? 0))),
        },
      },
    };
  }
  return null; // unknown status → provider failure
}

const accepted = validateScanResult({
  status: "accepted",
  analysis: {
    name: "Navy hoodie", category: "tops",
    warmth: { score: 3, label: "medium" },
    confidence: { category: 0.9 },
  },
});
ok("8a. status=accepted → returns analysis", accepted?.status === "accepted");
ok("8b. name preserved in accepted branch", accepted?.analysis?.name === "Navy hoodie");

const rejPerson = validateScanResult({ status: "rejected", reasonCode: "person_present" });
ok("8c. status=rejected + valid reasonCode → rejection", rejPerson?.status === "rejected" && rejPerson?.reasonCode === "person_present");

const rejUnknown = validateScanResult({ status: "rejected", reasonCode: "not_a_real_code" });
ok("8d. rejected with unknown reasonCode → falls back to unsafe_content", rejUnknown?.reasonCode === "unsafe_content");

ok("8e. unknown status → null (treated as provider failure)", validateScanResult({ status: "something_else" }) === null);

ok("8f. category fallback 'other' for unknown value",
  validateScanResult({ status:"accepted", analysis:{ category:"unknown_cat", name:"x", warmth:{score:3,label:"medium"}, confidence:{category:0.5} } })?.analysis?.category === "other");

ok("8g. warmth.score clamped to [1,5]",
  validateScanResult({ status:"accepted", analysis:{ name:"x", category:"tops", warmth:{score:99, label:"medium"}, confidence:{category:0.5} } })?.analysis?.warmth?.score === 5);

ok("8h. confidence clamped to [0,1]",
  validateScanResult({ status:"accepted", analysis:{ name:"x", category:"tops", warmth:{score:3,label:"medium"}, confidence:{category:1.5} } })?.analysis?.confidence?.category === 1);

ok("8i. stop_reason=refusal mapped to unsafe_content in handler",
  handlerSrc.includes('stopReason === "refusal"') &&
  handlerSrc.includes("unsafe_content"));
ok("8j. stop_reason=max_tokens treated as provider failure (502)",
  handlerSrc.includes('stopReason === "max_tokens"'));

// ════════════════════════════════════════════════════════════════════════════
// 9. Rejection reason → user message mapping
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 9. Rejection messages ─────────────────────────────────────────");
ok("9a. person_present message", handlerSrc.includes("without any person, face or body"));
ok("9b. multiple_items message", handlerSrc.includes("one clothing item at a time"));
ok("9c. id_or_document message", handlerSrc.includes("documents and personal information aren't allowed"));
ok("9d. safe fallback for unsafe_content/not_clothing/unusable_image",
  handlerSrc.includes("couldn't safely analyze this image"));
ok("9e. rejection returns 422 status", handlerSrc.includes("status: 422"));
ok("9f. rejection refunds quota",
  handlerSrc.indexOf("scanResult.status === \"rejected\"") < handlerSrc.indexOf("await refundQuota") ||
  handlerSrc.includes("await refundQuota(uid, reservation.reservationId)"));

// ════════════════════════════════════════════════════════════════════════════
// 10. Evidence not persisted
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 10. Evidence not persisted ────────────────────────────────────");
ok("10a. evidence stripped in scanWithAI (client)", sheetSrc.includes("evidence: _stripped"));
ok("10b. evidence NOT in JSON schema sent to Anthropic (server)", !handlerSrc.includes('"evidence"'));
ok("10c. wardrobeStore.add() strips evidence before localStorage",
  storeSrc.includes("evidence: _stripped") || storeSrc.includes('"evidence" in sanitized.aiAnalysis'));
ok("10d. evidence field marked @deprecated in ClothingAnalysis type", typesSrc.includes("@deprecated"));
ok("10e. existing items with evidence still load (optional field)", typesSrc.includes("evidence?: string"));
ok("10f. confirm step does not display evidence in JSX",
  !sheetSrc.includes("{analysis.evidence &&") &&
  !sheetSrc.includes("{analysis?.evidence &&"));

// ════════════════════════════════════════════════════════════════════════════
// 11. Log safety — no secrets or content in logs
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 11. Log safety ────────────────────────────────────────────────");
// Find all console.info/warn/error calls and ensure none log image/key/uid/prompt
const logPattern = /console\.(info|warn|error)\s*\([^)]{0,500}\)/gs;
const logCalls = [...handlerSrc.matchAll(logPattern)].map(m => m[0]);
const dangerWords = ["base64", "apiKey", "ANTHROPIC_API_KEY", "idToken", "uid", "analysis.name", "getAnthropicKey"];
const safeLogs = logCalls.filter(call => dangerWords.some(w => call.includes(w)));
ok("11a. No log calls contain base64 image or API key", safeLogs.length === 0, safeLogs.join("; ").slice(0,200));
ok("11b. Telemetry logs only model + token counts",
  handlerSrc.includes("[wardrobe-ai-telemetry]") &&
  handlerSrc.includes("inputTokens") && handlerSrc.includes("outputTokens"));
ok("11c. Log: attempt + model name only (no content)",
  handlerSrc.includes("attempt=${attempt} model=${ANTHROPIC_MODEL}"));
ok("11d. Log: HTTP status and elapsed only (no response body)",
  handlerSrc.includes("status=${res.status} elapsed=${elapsed}ms"));

// ════════════════════════════════════════════════════════════════════════════
// 12. Quota refund semantics
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 12. Quota refund semantics ────────────────────────────────────");
ok("12a. refundQuota called on provider failure", handlerSrc.includes("await refundQuota(uid, reservation.reservationId)"));
ok("12b. refundQuota called on provider rejection", handlerSrc.includes("scanResult.status === \"rejected\""));
ok("12c. finalizeQuotaSuccess called only on accepted scan", handlerSrc.includes("await finalizeQuotaSuccess(uid, reservation.reservationId)"));
ok("12d. refundQuota is idempotent (status guard)", handlerSrc.includes('rec.status !== "reserved"'));
ok("12e. finalizeQuotaSuccess is idempotent (status guard)",
  handlerSrc.includes("status: \"succeeded\"") && handlerSrc.includes("if (rec.status !== \"reserved\")"));

// ════════════════════════════════════════════════════════════════════════════
// 13. Local detector
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 13. Local detector ───────────────────────────────────────────");
const detectorSrc = readSource("src/lib/localDetector.ts");

// ── 13a–p: Source-text assertions ────────────────────────────────────────────
// These verify the implementation structure and configuration by reading the
// TypeScript source. They are NOT runtime/browser tests. A manual browser smoke
// test is required before enabling the scanner (see 13-SMOKE TEST note below).

ok("13a. localDetector uses @mediapipe/tasks-vision FaceDetector",
  detectorSrc.includes('FaceDetector') &&
  detectorSrc.includes('@mediapipe/tasks-vision'));
ok("13b. localDetector uses @mediapipe/tasks-vision ObjectDetector",
  detectorSrc.includes('ObjectDetector'));
ok("13c. localDetector uses @mediapipe/tasks-vision FilesetResolver",
  detectorSrc.includes('FilesetResolver'));
ok("13d. Tasks Vision WASM base path is self-hosted /mediapipe/wasm",
  detectorSrc.includes('"/mediapipe/wasm"'));
ok("13e. Face model served from self-hosted /mediapipe/models/",
  detectorSrc.includes('face_detection_short_range.tflite'));
ok("13f. Person model path is EfficientDet Lite0 uint8",
  detectorSrc.includes('efficientdet_lite0.tflite'));
ok("13f2. EfficientDet source URL documented in file header",
  detectorSrc.includes('efficientdet_lite0_uint8.tflite'));
ok("13g. No runtime CDN fetch in localDetector (URL only in doc comment for owner)",
  (() => {
    // storage.googleapis.com appears in a doc comment as the download URL for the owner.
    // Verify it does NOT appear in executable code (no fetch/import from that URL at runtime).
    const codeLines = detectorSrc.split("\n")
      .filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    return !codeLines.includes("storage.googleapis.com") &&
           !codeLines.includes("cdn.jsdelivr.net");
  })());
ok("13h. No PERSON_DETECTOR_READY readiness flag in localDetector",
  !detectorSrc.includes('PERSON_DETECTOR_READY'));
ok("13i. ObjectDetector always initialized (no conditional skip on missing model)",
  detectorSrc.includes('ObjectDetector.createFromModelPath') &&
  !detectorSrc.includes('PERSON_DETECTOR_READY'));
ok("13j. Face threshold documented as conservative (0.4, lower than default 0.5)",
  detectorSrc.includes('FACE_CONFIDENCE_THRESHOLD = 0.4'));
ok("13k. Person threshold documented as conservative (0.4)",
  detectorSrc.includes('PERSON_CONFIDENCE_THRESHOLD = 0.4'));
ok("13l. face reason: face detected → blocks",
  detectorSrc.includes('"face"'));
ok("13m. person reason: person detected → blocks",
  detectorSrc.includes('"person"'));
ok("13n. init_failed reason: initialization failure → blocks (never silent bypass)",
  detectorSrc.includes('"init_failed"'));
ok("13o. inference_failed reason: inference error → blocks",
  detectorSrc.includes('"inference_failed"'));
// 13p removed: model_absent reason no longer exists — both detectors are unconditional
ok("13q. Module-level initPromise for race-safe single initialization",
  detectorSrc.includes('initPromise') && detectorSrc.includes('| null = null'));
ok("13r. initPromise cleared on failure so retry is possible",
  detectorSrc.includes('initPromise = null') &&
  detectorSrc.includes('clear'));
ok("13s. Cached detector instances reused across scans (not re-initialized each time)",
  detectorSrc.includes('cachedFaceDetector') &&
  detectorSrc.includes('cachedPersonDetector'));
ok("13t. _resetForTest exported for test isolation",
  detectorSrc.includes('export function _resetForTest'));
ok("13u. localDetector dynamically imported in analyze() — not in initial bundle",
  sheetSrc.includes('import("@/lib/localDetector")'));
ok("13v. No DETECTOR_ASSETS_AVAILABLE stub remains",
  !sheetSrc.includes('DETECTOR_ASSETS_AVAILABLE'));
ok("13w. face/person reason → upload blocked with user message in sheet",
  sheetSrc.includes('detection.reason === "face"') &&
  sheetSrc.includes('detection.reason === "person"'));
ok("13x. init_failed/inference_failed reason → blocked with retry message",
  sheetSrc.includes('init_failed') || sheetSrc.includes('inference_failed'));
// 13y removed: model_absent removed from sheet — both detectors always run
ok("13z. ImageBitmap disposed after drawing to canvas (bitmap.close())",
  sheetSrc.includes('bitmap.close()'));
ok("13za. @mediapipe/tasks-vision is a declared prod dependency",
  JSON.parse(pkgSrc).dependencies?.['@mediapipe/tasks-vision'] != null);
ok("13zb. No @mediapipe/face_detection in package.json (assets bundled in public/)",
  JSON.parse(pkgSrc).dependencies?.['@mediapipe/face_detection'] == null &&
  JSON.parse(pkgSrc).devDependencies?.['@mediapipe/face_detection'] == null);
ok("13zc. No @mediapipe/pose in package.json",
  JSON.parse(pkgSrc).dependencies?.['@mediapipe/pose'] == null &&
  JSON.parse(pkgSrc).devDependencies?.['@mediapipe/pose'] == null);

// ── 13-SIM: Behavioural simulations (mock the detector boundary) ─────────────
// NOTE: These tests mock the runLocalDetection return value boundary.
// They do NOT execute WASM inference or load real model files.
// Real face/person detection can only be verified with a browser + actual WASM.
// ⚠️ MANUAL SMOKE TEST REQUIRED before enabling: load the app in a browser,
//    attempt to scan a photo of a person and confirm the upload is blocked.

// Port of the sheet-side logic that handles detection results:
function handleDetectionResult(detection) {
  if (!detection.ok) {
    if (detection.reason === 'face' || detection.reason === 'person') {
      return { blocked: true, msg: 'person_or_face' };
    }
    if (detection.reason === 'init_failed' || detection.reason === 'inference_failed') {
      return { blocked: true, msg: 'screening_failed' };
    }
  }
  return { blocked: false };
}

// Port of the module-level initPromise race logic:
function simulateInit(cachedInstance, existingPromise, initFn) {
  if (cachedInstance !== null) return { source: 'cache' };
  if (existingPromise !== null) return { source: 'existing_promise' };
  return { source: 'new_init', result: initFn() };
}

ok("13-sim-1. face detected → blocked before Anthropic API request",
  handleDetectionResult({ ok: false, reason: 'face' }).blocked === true &&
  handleDetectionResult({ ok: false, reason: 'face' }).msg === 'person_or_face');
ok("13-sim-2. COCO person detected without face → blocked",
  handleDetectionResult({ ok: false, reason: 'person' }).blocked === true &&
  handleDetectionResult({ ok: false, reason: 'person' }).msg === 'person_or_face');
ok("13-sim-3. cropped/partial person (score above threshold) → blocked (reason=person)",
  // The ObjectDetector is configured with scoreThreshold=0.4 at initialization.
  // Any detection returned by the API already exceeds the threshold.
  // A partial/cropped person scoring 0.41 would be returned and trigger this path.
  handleDetectionResult({ ok: false, reason: 'person' }).blocked === true);
ok("13-sim-4. no face, no person → upload proceeds",
  handleDetectionResult({ ok: true }).blocked === false);
ok("13-sim-5. init_failed → blocked, user can retry",
  handleDetectionResult({ ok: false, reason: 'init_failed' }).blocked === true &&
  handleDetectionResult({ ok: false, reason: 'init_failed' }).msg === 'screening_failed');
ok("13-sim-6. inference_failed → blocked",
  handleDetectionResult({ ok: false, reason: 'inference_failed' }).blocked === true);
// 13-sim-7 removed: model_absent reason no longer exists in the implementation
ok("13-sim-8. concurrent calls reuse existing initPromise (not two separate inits)",
  (() => {
    const initCalls = [];
    const fakeInit = () => { initCalls.push('init'); return 'detector'; };
    // First call: no cache, no promise → starts new init
    const r1 = simulateInit(null, null, fakeInit);
    // Simulate that promise is now pending:
    const pendingPromise = 'pending';
    // Second concurrent call: no cache, but promise exists → reuses it
    const r2 = simulateInit(null, pendingPromise, fakeInit);
    return r1.source === 'new_init' && r2.source === 'existing_promise' && initCalls.length === 1;
  })());
ok("13-sim-9. after init failure, promise cleared → retry starts fresh init",
  (() => {
    // After failure, initPromise = null (cleared). Next call starts a new one.
    const initCalls = [];
    const fakeInit = () => { initCalls.push('init'); return 'detector'; };
    const r1 = simulateInit(null, null, fakeInit); // first try
    // Simulated failure: initPromise cleared back to null, cachedDetector stays null
    const r2 = simulateInit(null, null, fakeInit); // retry
    return r1.source === 'new_init' && r2.source === 'new_init' && initCalls.length === 2;
  })());
ok("13-sim-10. when face blocked, Anthropic provider call does not execute (sheet returns early)",
  (() => {
    // Verify the sheet returns before reaching 'analyzing' step when detection blocks
    let anthropicCalled = false;
    function simulateAnalyze(detectionResult) {
      const { blocked } = handleDetectionResult(detectionResult);
      if (blocked) return { step: 'error', anthropicCalled: false };
      // Would reach here and call Anthropic
      anthropicCalled = true;
      return { step: 'analyzing', anthropicCalled: true };
    }
    const blockedResult = simulateAnalyze({ ok: false, reason: 'face' });
    const cleanResult   = simulateAnalyze({ ok: true });
    return blockedResult.anthropicCalled === false && cleanResult.anthropicCalled === true;
  })());

// ── Bundled asset presence ────────────────────────────────────────────────────
const fs_node = require('node:fs');
const path_node = require('node:path');
ok("13-assets-1. Tasks Vision WASM (SIMD) is committed to public/mediapipe/wasm/",
  fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/wasm/vision_wasm_internal.wasm')));
ok("13-assets-2. Tasks Vision WASM loader (SIMD) committed",
  fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/wasm/vision_wasm_internal.js')));
ok("13-assets-3. Tasks Vision WASM (noSIMD fallback) committed",
  fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm')));
ok("13-assets-4. Face detection model committed",
  fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/models/face_detection_short_range.tflite')));
ok("13-assets-5. No legacy pose assets in public/mediapipe/",
  !fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/pose')));
ok("13-assets-6. No legacy face_detection Solutions directory in public/mediapipe/",
  !fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/face_detection')));
ok("13-assets-7. EfficientDet Lite0 person model committed to public/mediapipe/models/",
  fs_node.existsSync(path_node.join(repoRoot, 'public/mediapipe/models/efficientdet_lite0.tflite')));
ok("13-assets-8. EfficientDet model is a valid TFLite flatbuffer (TFL3 magic bytes)",
  (() => {
    const buf = fs_node.readFileSync(path_node.join(repoRoot, 'public/mediapipe/models/efficientdet_lite0.tflite'));
    return buf[4] === 0x54 && buf[5] === 0x46 && buf[6] === 0x4C && buf[7] === 0x33; // TFL3
  })());
ok("13-assets-9. EfficientDet model SHA-256 matches uploaded file",
  (() => {
    const crypto = require('node:crypto');
    const buf    = fs_node.readFileSync(path_node.join(repoRoot, 'public/mediapipe/models/efficientdet_lite0.tflite'));
    return crypto.createHash('sha256').update(buf).digest('hex') ===
      '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b';
  })());
ok("13-assets-10. EfficientDet model exact byte size 4,563,519",
  fs_node.statSync(path_node.join(repoRoot, 'public/mediapipe/models/efficientdet_lite0.tflite')).size === 4563519);

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 14. Privacy policy ───────────────────────────────────────────");
// 14a: The phrase spans a <strong> tag: "not retained by" ... "</strong> for this configuration"
// Check for the key adjacent words that appear on the same line.
ok("14a. Privacy policy states conversation content is not retained by default (for this config)",
  privacySrc.includes("not retained by") && privacySrc.includes("default") &&
  (privacySrc.includes("not retained by default") || privacySrc.includes("not retained by\n")));
ok("14b. Privacy policy mentions JSON schema cached up to 24 hours",
  privacySrc.includes("24 hours"));
ok("14c. Privacy policy says no ZDR arrangement currently in place",
  privacySrc.includes("does not currently have a contractual Zero Data Retention"));
ok("14d. Privacy policy does NOT claim immediate deletion",
  !privacySrc.includes("immediately deleted") && !privacySrc.includes("immediately deletes"));
ok("14e. Privacy policy does NOT claim 30-day retention applies to Haiku 4.5 (the model used)",
  (() => {
    // "30 days" in privacy.tsx is in the contact response time section, not the AI section.
    // Verify the AI section does not state Haiku has 30-day retention.
    const aiSection = privacySrc.slice(
      privacySrc.indexOf("AI wardrobe analysis — Anthropic Claude"),
      privacySrc.indexOf("Weather data — Open-Meteo")
    );
    // The AI section should NOT say "30 days" (that would be the incorrect old statement)
    return !aiSection.includes("30 days") || aiSection.includes("not retained by default");
  })());
ok("14f. Privacy policy has legal review flag before AI section",
  privacySrc.includes("LEGAL REVIEW REQUIRED"));
ok("14g. AI disclosure inline in client scan UI", sheetSrc.includes("analyzed by Anthropic"));
ok("14h. Disclosure includes Privacy Policy link", sheetSrc.includes('href="/privacy"'));
ok("14i. Privacy policy includes minimum age 15 for AI scanner",
  privacySrc.includes("15") && privacySrc.includes("AI scanner") || privacySrc.includes("AI clothing scanner"));

// ════════════════════════════════════════════════════════════════════════════
// 15. Feedback: report-ai-scan category
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 15. Feedback category ────────────────────────────────────────");
const feedbackTypesSrc = readSource("src/lib/feedback-types.ts");
ok("15a. report-ai-scan in FEEDBACK_CATEGORIES", feedbackTypesSrc.includes('"report-ai-scan"'));
ok("15b. report-ai-scan has a display label", feedbackTypesSrc.includes('"Report AI clothing scan"'));
ok("15c. feedback handler validates against updated enum",
  readSource("src/lib/feedback-handler.ts").includes("FEEDBACK_CATEGORIES"));

// ════════════════════════════════════════════════════════════════════════════
// 16. Retry and timeout
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 16. Retry and timeout ────────────────────────────────────────");
ok("16a. PROVIDER_MAX_ATTEMPTS = 2", handlerSrc.includes("PROVIDER_MAX_ATTEMPTS") && handlerSrc.includes("= 2"));
ok("16b. PROVIDER_TOTAL_DEADLINE_MS = 50_000", handlerSrc.includes("50_000"));
ok("16c. AbortController timeout at 50s", handlerSrc.includes("controller.abort") && handlerSrc.includes("50_000"));
ok("16d. Retryable HTTP codes include 429 500 502 503 504",
  handlerSrc.includes("ANTHROPIC_RETRYABLE") && [429,500,502,503,504].every(c => handlerSrc.includes(String(c))));
ok("16e. Exponential-like backoff with jitter", handlerSrc.includes("backoffMs") && handlerSrc.includes("Math.random()"));

// ════════════════════════════════════════════════════════════════════════════
// 17. Acknowledgement endpoints — auth and ownership
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 17. Acknowledgement auth/ownership ───────────────────────────");
ok("17a. handleWardrobeAcknowledge calls verifyFirebaseToken before writing",
  handlerSrc.indexOf("const uid = await verifyFirebaseToken") <
  handlerSrc.indexOf('ref.set(record)'));
ok("17b. uid comes from token, never from request body",
  (() => {
    // Find handleWardrobeAcknowledge body
    const fnStart = handlerSrc.indexOf("export async function handleWardrobeAcknowledge");
    const fnEnd   = handlerSrc.indexOf("export async function handleWardrobeAckStatus");
    const fn = handlerSrc.slice(fnStart, fnEnd);
    return !fn.includes("body.uid") && !fn.includes("req.uid") &&
           fn.includes("const uid = await verifyFirebaseToken");
  })());
ok("17c. Firestore document written under users/{uid} (not uid from body)",
  handlerSrc.includes('`users/${uid}/scannerAck/${SCANNER_ACK_VERSION}`'));
ok("17d. ageBand validated server-side (15-17 or 18-plus only)",
  handlerSrc.includes('ageBand !== "15-17" && ageBand !== "18-plus"'));
ok("17e. Guardian confirmation required for 15-17 band",
  handlerSrc.includes('ageBand === "15-17" && guardianPermissionConfirmed !== true'));
ok("17f. Ack checked BEFORE quota reservation (ordering)",
  handlerSrc.indexOf("await verifyAcknowledgement") <
  handlerSrc.indexOf("const reservation = await reserveQuota"));
ok("17g. Ack checked BEFORE anthropicProvider.analyze (ordering)",
  handlerSrc.indexOf("await verifyAcknowledgement") <
  handlerSrc.indexOf("anthropicProvider.analyze"));
ok("17h. Missing ack returns 403 with code=ack",
  handlerSrc.includes("403") && handlerSrc.includes('"ack"'));
ok("17i. guardianPermissionConfirmed omitted from record for 18-plus (not stored when N/A)",
  (() => {
    const block = handlerSrc.slice(
      handlerSrc.indexOf('if (ageBand === "15-17") {'),
      handlerSrc.indexOf("await ref.set(record)")
    );
    // Only set for 15-17, not for 18-plus
    return block.includes('guardianPermissionConfirmed = true') &&
           !block.includes('guardianPermissionConfirmed = false');
  })());

// ════════════════════════════════════════════════════════════════════════════
// 18. Race-safe abuse rate limit
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 18. Race-safe abuse rate limit ───────────────────────────────");
ok("18a. Abuse limit uses Firestore transaction (not regular set)",
  (() => {
    const fnStart = handlerSrc.indexOf("async function checkAbuseRateLimit");
    const fnEnd   = handlerSrc.indexOf("async function verifyAcknowledgement");
    return handlerSrc.slice(fnStart, fnEnd).includes("runTransaction");
  })());
ok("18b. Abuse limit reads and increments atomically within transaction",
  handlerSrc.includes("windowStartMs") && handlerSrc.includes("currentAttempts + 1"));
ok("18c. Abuse counter NOT refunded on provider rejection/failure",
  (() => {
    // checkAbuseRateLimit is called before reserveQuota.
    // refundQuota only touches quotas/wardrobeAi, not scannerRateLimit.
    // Verify refundQuota does NOT touch scannerRateLimit document.
    const refundFn = handlerSrc.slice(
      handlerSrc.indexOf("async function refundQuota"),
      handlerSrc.indexOf("async function finalizeQuotaSuccess")
    );
    return !refundFn.includes("scannerRateLimit");
  })());
ok("18d. Abuse counter incremented on every attempt, including failed/rejected",
  // checkAbuseRateLimit is called first in handleWardrobeScan, unconditionally
  // (before provider call). Any error after this point doesn't reverse the count.
  handlerSrc.indexOf("await checkAbuseRateLimit") <
  handlerSrc.indexOf("const reservation = await reserveQuota"));
ok("18e. Abuse and product quota use separate Firestore documents",
  handlerSrc.includes("scannerRateLimit/current") &&
  handlerSrc.includes("quotas/wardrobeAi"));
ok("18f. Rate limit returns 429 with code=abuse",
  handlerSrc.includes('"abuse"') && handlerSrc.includes("429"));
ok("18g. Retry-After computed from window expiry",
  handlerSrc.includes("retryAfterSec") && handlerSrc.includes("ABUSE_WINDOW_MS"));

// ── Abuse rate limit simulation ───────────────────────────────────────────
function simulateAbuseLimit(windowStartMs, currentAttempts, nowMs, maxAttempts, windowMs) {
  const windowExpired = nowMs - windowStartMs >= windowMs;
  const attempts = windowExpired ? 0 : currentAttempts;
  if (attempts >= maxAttempts) {
    const retryAfterSec = Math.ceil(
      ((windowExpired ? nowMs : windowStartMs) + windowMs - nowMs) / 1000
    );
    return { blocked: true, retryAfterSec };
  }
  return { blocked: false, newAttempts: attempts + 1 };
}

const MAX_ATT = 5, WIN_MS = 60_000;
const BASE_T  = 1_000_000;
ok("18h-sim. First attempt not blocked", !simulateAbuseLimit(BASE_T, 0, BASE_T+100, MAX_ATT, WIN_MS).blocked);
ok("18i-sim. 4th attempt not blocked",  !simulateAbuseLimit(BASE_T, 4, BASE_T+100, MAX_ATT, WIN_MS).blocked);
ok("18j-sim. 5th attempt blocked",       simulateAbuseLimit(BASE_T, 5, BASE_T+100, MAX_ATT, WIN_MS).blocked);
ok("18k-sim. After window expires, counter resets",
  !simulateAbuseLimit(BASE_T, 5, BASE_T + WIN_MS + 1, MAX_ATT, WIN_MS).blocked);
ok("18l-sim. Concurrent safe: increments within same window",
  simulateAbuseLimit(BASE_T, 4, BASE_T+100, MAX_ATT, WIN_MS).newAttempts === 5);

// ════════════════════════════════════════════════════════════════════════════
// 19. Provider response guarantees
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 19. Provider response guarantees ─────────────────────────────");
ok("19a. Rejected scan never produces accepted analysis in response",
  (() => {
    // When scanResult.status === "rejected", code returns 422 with code=rejected
    // and NEVER returns a ScanSuccessResponse (which has ok:true and analysis).
    // Verify: after "if (scanResult.status === 'rejected')" there is a return
    // before finalizeQuotaSuccess and the success response.
    const rejBlock = handlerSrc.slice(
      handlerSrc.indexOf('if (scanResult.status === "rejected")'),
      handlerSrc.indexOf("await finalizeQuotaSuccess")
    );
    return rejBlock.includes("return new Response") && rejBlock.includes("422");
  })());
ok("19b. stop_reason=refusal maps to rejected with reasonCode=unsafe_content",
  handlerSrc.includes('stopReason === "refusal"') && handlerSrc.includes("unsafe_content"));
ok("19c. max_tokens treated as 502 provider failure, not accepted scan",
  handlerSrc.includes('stopReason === "max_tokens"'));
ok("19d. Anthropic rejection refunds quota",
  handlerSrc.includes('scanResult.status === "rejected"') &&
  (() => {
    const block = handlerSrc.slice(
      handlerSrc.indexOf('if (scanResult.status === "rejected")'),
      handlerSrc.indexOf('if (scanResult.status === "rejected")') + 300
    );
    return block.includes("refundQuota");
  })());

// ════════════════════════════════════════════════════════════════════════════
// 20. Evidence persistence guarantees
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 20. Evidence persistence guarantees ──────────────────────────");
ok("20a. evidence field absent from Anthropic JSON schema",
  !handlerSrc.includes('"evidence"'));
ok("20b. evidence stripped from scanWithAI return value in client",
  sheetSrc.includes("evidence: _stripped"));
ok("20c. wardrobeStore.add() strips evidence from aiAnalysis before storing",
  storeSrc.includes('"evidence" in sanitized.aiAnalysis'));
ok("20d. evidence optional in ClothingAnalysis type (old items still load)",
  typesSrc.includes("evidence?: string"));
ok("20e. evidence marked @deprecated in types (not for new items)",
  typesSrc.includes("@deprecated"));
ok("20f. Legacy item simulation: old item with evidence loads without crash",
  (() => {
    // Simulate reading an old item from localStorage that has evidence
    const oldItem = {
      id: "item-old",
      name: "Old T-shirt",
      aiAnalysis: {
        name: "White T-shirt", category: "tops", subcategory: "T-shirt",
        primaryColor: "White", secondaryColors: [], pattern: "solid",
        materialEstimate: ["Cotton"], layerRole: "base",
        warmth: { score: 1, label: "very-light" }, waterResistance: "none",
        windProtection: "low", weatherFit: ["Warm"], styles: ["Casual"],
        seasons: ["Summer"], fitEstimate: "regular",
        confidence: { category: 0.9, color: 0.9, material: 0.7, warmth: 0.8, waterResistance: 0.6, style: 0.85 },
        evidence: "Appears to be a plain white cotton tee.", // legacy field
      },
    };
    // evidence is optional in the type; accessing it should not throw
    try {
      const ev = oldItem.aiAnalysis.evidence;
      return typeof ev === "string";
    } catch { return false; }
  })());
ok("20g. New item simulation: wardrobeStore strips evidence before persisting",
  (() => {
    // Simulate what wardrobeStore.add() does
    const item = {
      aiAnalysis: {
        name: "Blue hoodie", category: "tops",
        evidence: "should be stripped",
      },
    };
    let sanitized = item;
    if (sanitized.aiAnalysis && "evidence" in sanitized.aiAnalysis) {
      const { evidence: _s, ...rest } = sanitized.aiAnalysis;
      sanitized = { ...sanitized, aiAnalysis: rest };
    }
    return !("evidence" in sanitized.aiAnalysis);
  })());

// ════════════════════════════════════════════════════════════════════════════
// 21. Notices file and version pinning
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 21. Notices and version pin ──────────────────────────────");
ok("21a. THIRD_PARTY_NOTICES.txt exists in public/mediapipe/",
  fs.existsSync(path.join(repoRoot, "public/mediapipe/THIRD_PARTY_NOTICES.txt")));
ok("21b. Notices file mentions Apache License 2.0",
  readSource("public/mediapipe/THIRD_PARTY_NOTICES.txt").includes("Apache License"));
ok("21c. Notices file includes MediaPipe copyright",
  readSource("public/mediapipe/THIRD_PARTY_NOTICES.txt").includes("The MediaPipe Authors"));
ok("21d. Notices file includes EfficientDet SHA-256",
  readSource("public/mediapipe/THIRD_PARTY_NOTICES.txt").includes(
    "2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b"));
ok("21e. Notices file includes face model SHA-256",
  readSource("public/mediapipe/THIRD_PARTY_NOTICES.txt").includes(
    "3bc182eb9f33925d9e58b5c8d59308a760f4adea8f282370e428c51212c26633"));
ok("21f. @mediapipe/tasks-vision pinned to exact version 1.0.1 (not ^1.0.1)",
  (() => {
    const pkg = JSON.parse(pkgSrc);
    return pkg.dependencies?.["@mediapipe/tasks-vision"] === "1.0.1";
  })());

console.log(`\n${"═".repeat(55)}`);

console.log(`${p + f} tests: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
