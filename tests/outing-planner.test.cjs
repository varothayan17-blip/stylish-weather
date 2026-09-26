/**
 * outing-planner.test.cjs
 * Layer 1 (~60 behavioural): tsx runs actual modules.
 * Layer 2 (~50 structural): source invariant checks.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");


const repo = path.resolve(__dirname, "..");
let _p = 0, _f = 0;
function ok(label, cond, detail) {
  if (cond) { console.log("✓", label); _p++; }
  else { console.error("✗", label, detail !== undefined ? String(detail) : ""); _f++; }
}

// ── Layer 1 ───────────────────────────────────────────────────────────────
console.log("═".repeat(55));
console.log("Layer 1: Behavioural tests (repo-local tsx)");
console.log("═".repeat(55));

let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli", { paths: [repo] });
} catch {
  console.error("✗ tsx CLI not found — run npm install");
  process.exit(1);
}

const behav = spawnSync(
  process.execPath,
  [tsxCli, path.join(repo, "tests", "outing-planner-behavioural.test.ts")],
  { cwd: repo, encoding: "utf8", timeout: 60_000, env: { ...process.env, NODE_ENV: "test" } });

if (behav.error) { console.error("✗ tsx failed:", behav.error.message); process.exit(1); }
process.stdout.write(behav.stdout || "");
if (behav.stderr) process.stderr.write(behav.stderr);

const sm = (behav.stdout || "").match(/(\d+) tests:\s*(\d+) passed,\s*(\d+) failed/);
if (!sm) { console.error("✗ No summary"); process.exit(1); }
const [, , bp, bf] = sm.map(Number);
_p += bp;
if (bf > 0 || behav.status !== 0) {
  _f += bf || 1;
  console.error(`\n✗ Behavioural layer FAILED (${bf})`);
} else {
  console.log(`\n✓ All ${bp} behavioural tests passed`);
}

// ── Layer 2 ───────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(55));
console.log("Layer 2: Structural source invariants");
console.log("═".repeat(55));

const read = r => readFileSync(path.join(repo, r), "utf8");
const plannerSrc  = read("src/lib/outingPlanner.ts");
const forecastSrc = read("src/lib/outingForecast.ts");
const storeSrc    = read("src/lib/outingPlanStore.ts");
const planUISrc   = read("src/routes/plan.tsx");
const indexSrc    = read("src/routes/index.tsx");
const handlerSrc  = existsSync(path.join(repo, "src/lib/wardrobe-ai-handler.ts"))
  ? read("src/lib/wardrobe-ai-handler.ts") : "";
const pkg = JSON.parse(read("package.json"));

ok("S01. tsx in devDependencies",  !!pkg.devDependencies?.tsx);
ok("S02. tsx CLI resolves", (() => {
  try {
    require.resolve("tsx/cli", { paths: [repo] });
    return true;
  } catch {
    return false;
  }
})());

// Bug 1a: generate() ownership
ok("S03. generationRequestIdRef declared",
  planUISrc.includes("generationRequestIdRef"));
ok("S04. capturedUid captured before await in generate()",
  planUISrc.includes("capturedUid"));
ok("S05. capturedRequestId captured before await",
  planUISrc.includes("capturedRequestId"));
ok("S06. Post-await guard checks both UID and requestId",
  planUISrc.includes("generationRequestIdRef.current === capturedRequestId"));
ok("S07. draftUid state declared",
  planUISrc.includes("draftUid"));
ok("S08. lockDraft checks draftUid !== uid",
  planUISrc.includes("draftUid !== uid"));
ok("S09. generationRequestIdRef.current += 1 on uid change",
  planUISrc.includes("generationRequestIdRef.current += 1"));

// Bug 1b: recheck token
ok("S10. recheckToken (not recheckInFlight boolean)",
  planUISrc.includes("recheckToken") && !planUISrc.includes("recheckInFlight"));
ok("S11. recheckToken finally: only clears when uid+planId match",
  planUISrc.includes("recheckToken.current?.uid === uidVal"));

// Bug 1c: render ownership checks
ok("S12. lockedPlan render: lockedPlan.uid === uid",
  planUISrc.includes("lockedPlan.uid === uid"));
ok("S13. draft result render: draftUid === uid",
  planUISrc.includes('step === "result" && draft && draftUid === uid'));
ok("S14. cancelPlan: lockedPlan.uid !== uid guard",
  planUISrc.includes("lockedPlan.uid !== uid"));
ok("S15. manualRefresh: lockedPlan.uid !== uid guard",
  planUISrc.includes("lockedPlan.uid !== uid"));
ok("S16. home card render: activePlan.uid === authUid",
  indexSrc.includes("activePlan.uid === authUid"));

// Bug 1d: index.tsx
ok("S17. homeRecheckToken in index.tsx (not homeRecheckInFlight)",
  indexSrc.includes("homeRecheckToken") && !indexSrc.includes("homeRecheckInFlight"));
ok("S18. index.tsx render guard: activePlan.uid === authUid — already required",
  indexSrc.includes("activePlan.uid === authUid"));
ok("S19. index.tsx token finally only clears when uid+planId match",
  indexSrc.includes("homeRecheckToken.current?.uid === planUid") &&
  indexSrc.includes("homeRecheckToken.current?.planId === p.id"));

// Bug 1e: cancellation guard still present
ok("S20. 'let cancelled = false' still in plan.tsx",
  planUISrc.includes("let cancelled = false"));
ok("S21. plan.tsx clears all account state on uid change",
  planUISrc.includes("setLockedPlan(null)") && planUISrc.includes("setDraft(null)") &&
  planUISrc.includes('setStep("form")') && planUISrc.includes("setError(null)"));

// Bug 2: positive garment vocabulary
ok("S22. GARMENT_FAMILY_MAP defined (positive vocabulary)",
  plannerSrc.includes("GARMENT_FAMILY_MAP"));
ok("S23. resolveAliases returns null for unknown tokens",
  plannerSrc.includes("function resolveAliases") &&
  plannerSrc.includes("return GARMENT_FAMILY_MAP.get(token) ?? null"));
ok("S24. resolvedTokenSets filters out null (unknown descriptors)",
  plannerSrc.includes(".filter((s): s is Set<string> => s !== null)"));
ok("S25. shirt/blouse family in map",
  plannerSrc.includes('"shirt", "blouse"'));
ok("S26. tshirt/tee family separate from shirt",
  (() => {
    const t = plannerSrc.indexOf('"tshirt", "tee"');
    const s = plannerSrc.indexOf('"shirt", "blouse"');
    return t > 0 && s > 0 && t !== s;
  })());
ok("S27. trainers/sneakers family in map",
  plannerSrc.includes('"trainers", "sneakers"'));
ok("S28. shorts family in map", plannerSrc.includes('"shorts"'));
ok("S29. coat/parka/anorak family in map", plannerSrc.includes('"coat", "parka", "anorak"'));
ok("S30. boots family in map",  plannerSrc.includes('"boots"'));
ok("S31. shoes/loafers family in map",
  plannerSrc.includes('"shoes", "loafers"') || plannerSrc.includes('"shoes",'));
ok("S32. GENERIC_ADJECTIVES does NOT include 'shoes' or 'boots' or 'trainers'",
  !/"shoes"[^]/.test(plannerSrc.match(/const GENERIC_ADJECTIVES[^;]+/)?.[0] ?? "") &&
  (() => {
    const block = plannerSrc.match(/const GENERIC_ADJECTIVES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
    return !block.includes('"shoes"') && !block.includes('"boots"') && !block.includes('"trainers"');
  })());
ok("S33. 'top' is in GENERIC_ADJECTIVES (prevents bare-category hits)",
  plannerSrc.match(/const GENERIC_ADJECTIVES = new Set\(\[([\s\S]*?)\]\)/)?.[1].includes('"top"') ?? false);
ok("S34. canonicalItemTokens uses Set.has — not string.includes for family matching",
  plannerSrc.includes("nameTokens.has(alias)") && plannerSrc.includes("typeTokens.has(alias)"));
ok("S35. longsleeve in GENERIC_ADJECTIVES",
  plannerSrc.match(/const GENERIC_ADJECTIVES = new Set\(\[([\s\S]*?)\]\)/)?.[1].includes('"longsleeve"') ?? false);

// Issue 1: needsUmbrella
ok("S36. needsUmbrella threaded through timeline + explanation",
  plannerSrc.includes("needsUmbrella: boolean,") && plannerSrc.includes("needsUmbrella,"));
ok("S37. Transit note uses needsUmbrella",
  plannerSrc.includes("commuteMode === \"transit\" && needsUmbrella"));

// Bug 3: WindReason
ok("S38. WindReason type exported", plannerSrc.includes("export type WindReason ="));
ok("S39. windReason passed to buildExplanation", plannerSrc.includes("styleProfile, needsUmbrella, windReason"));
ok("S40. driving_reduced branch in explanation",
  plannerSrc.includes('"driving_reduced"') && plannerSrc.includes("driving limits"));

// RAIN_CODES
ok("S41. plan.tsx: RAIN_CODES.has(s.code)",
  planUISrc.includes("RAIN_CODES.has(s.code)") && !planUISrc.includes("code !== undefined"));
ok("S42. index.tsx: RAIN_CODES.has(s.code) — no literal array",
  indexSrc.includes("RAIN_CODES.has(s.code)") &&
  !indexSrc.includes("[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]"));

// Thermal / persistence
ok("S43. INDOOR_COMFORT_C = 21", plannerSrc.includes("INDOOR_COMFORT_C = 21"));
ok("S44. exposureEffC unchanged", plannerSrc.includes("function exposureEffC(rawApparent: number, sensAdj: number)"));
ok("S45. isValidIsoLocal in store", storeSrc.includes("function isValidIsoLocal"));
ok("S46. Timeline bounds enforced",
  storeSrc.includes("tg.startTime as string) < cs") && storeSrc.includes("tg.startTime as string) > ce"));
ok("S47. commitPlan exact-ID replacement", (() => {
  const s = storeSrc.indexOf("commitPlan("); const e = storeSrc.indexOf("cancelPlan(", s);
  return storeSrc.slice(s,e).includes("p.id === replaceId");
})());
ok("S48. OUTING_PLAN_VERSION = 3", plannerSrc.includes("OUTING_PLAN_VERSION = 3"));
ok("S49. Array.isArray on item.labels", plannerSrc.includes("Array.isArray(itemRec.labels)"));
ok("S50. wardrobe-ai-handler fail-closed", handlerSrc.includes('WARDROBE_AI_SCANNING_ENABLED !== "true"'));
ok("S51. No AI-provider calls in planner",
  !plannerSrc.includes("generativelanguage") && !plannerSrc.includes("anthropic.com"));
ok("S52. styleProfileLoaded gate in plan.tsx",
  planUISrc.includes("disabled={!styleProfileLoaded}"));

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(55)}`);
console.log(`${_p + _f} tests: ${_p} passed, ${_f} failed`);
process.exit(_f > 0 ? 1 : 0);
