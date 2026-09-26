/**
 * Deterministic planOuting() scenario runner.
 * Runs 5 scenarios and prints key fields.
 */
import { planOuting, bandFor } from "@/lib/outingPlanner";
import type { OutingForecastSlice, HourlyOutingSlot } from "@/lib/outingPlanner";
import type { Prefs } from "@/lib/preferences";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSlots(startHour: number, date: string, apparentTemps: number[]): HourlyOutingSlot[] {
  return apparentTemps.map((t, i) => ({
    time:           `${date}T${String(startHour + i).padStart(2,"0")}:00`,
    apparentTempC:  t,
    code:           0,
    precipProb:     0,
    windKph:        5,
  }));
}

function makeSlice(slots: HourlyOutingSlot[]): OutingForecastSlice {
  const temps = slots.map(s => s.apparentTempC);
  return {
    slots,
    rawMinApparentC: Math.min(...temps),
    rawMaxApparentC: Math.max(...temps),
    peakPrecipProb:  0,
    maxWindKph:      5,
    hasRain:         false,
    hasSnow:         false,
    isWindy:         false,
    lat:             43.7,
    lon:             -79.4,
  };
}

const PREFS: Prefs = {
  coldSensitivity: "normal",
  clothingProfile: "mens",
  locationLabel:   "Toronto",
  locationLat:     43.7,
  locationLon:     -79.4,
};

const PREFS_WARM: Prefs = { ...PREFS, coldSensitivity: "hot" }; // "runs warm"

function printPlan(label: string, plan: ReturnType<typeof planOuting>) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`SCENARIO ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log("baseItems:", plan.baseItems.map(i => i.name).join(", "));
  console.log("departureLayers:", plan.departureLayers.map(i => i.name).join(", ") || "(none)");
  console.log("carryLayers:", plan.carryLayers.map(i => i.name).join(", ") || "(none)");
  console.log("removableLayers:", plan.removableLayers.map(i => i.name).join(", ") || "(none)");
  console.log("adaptationHint:", plan.adaptationHint ?? "(none)");
  console.log("weatherSummary.effectiveMinC:", plan.weatherSummary.effectiveMinC);
  console.log("weatherSummary.effectiveMaxC:", plan.weatherSummary.effectiveMaxC);
  console.log("weatherSummary.rawMinApparentTempC:", plan.weatherSummary.rawMinApparentTempC);
  console.log("weatherSummary.rawMaxApparentTempC:", plan.weatherSummary.rawMaxApparentTempC);
  console.log("timelineGuidance:");
  for (const g of plan.timelineGuidance) {
    console.log(`  [${g.startTime}] ${g.instruction} | ${g.reason}`);
  }
}

// ── Scenario A: 13→12°C, casual, mixed, runs-warm, 23:00→01:00 ────────────
{
  // 23:00 13°C, 00:00 12°C, 01:00 12°C
  const slots = makeSlots(23, "2026-09-26", [13, 12, 12]);
  const slice = makeSlice(slots);
  const plan = planOuting(
    { occasion: "casual", departureTime: "2026-09-26T23:00", returnTime: "2026-09-27T01:00",
      activity: "moderate", context: "mixed", locationLabel: "Toronto" },
    slice, [], PREFS_WARM, "2026-09-27T01:00", { layeringPreference: "minimal", commuteMode: "walk",
      windSensitivity: "normal", rainTolerance: "normal", stylePreferences: [] }
  );
  printPlan("A — 13→12°C casual mixed runs-warm 23:00→01:00", plan);
  // Assertions
  const noShorts  = !plan.baseItems.some(i => /short/i.test(i.name));
  const hasBottom = plan.baseItems.some(i => /jean|trouser|chino|pant/i.test(i.name));
  const layerInDept = plan.departureLayers.length > 0;
  const carryEmpty  = plan.carryLayers.length === 0;
  const deptMention = plan.timelineGuidance.some(g => /wear/i.test(g.instruction));
  console.log(`\n✓ no shorts: ${noShorts}`);
  console.log(`✓ full-length bottom: ${hasBottom}`);
  console.log(`✓ layer in departureLayers: ${layerInDept}`);
  console.log(`✓ carryLayers empty: ${carryEmpty}`);
  console.log(`✓ timeline wears layer at departure: ${deptMention}`);
}

// ── Scenario B: Same 13→12°C, mostly outdoors ─────────────────────────────
{
  const slots = makeSlots(23, "2026-09-26", [13, 12, 12]);
  const slice = makeSlice(slots);
  const plan = planOuting(
    { occasion: "casual", departureTime: "2026-09-26T23:00", returnTime: "2026-09-27T01:00",
      activity: "moderate", context: "outdoors", locationLabel: "Toronto" },
    slice, [], PREFS_WARM, "2026-09-27T01:00", { layeringPreference: "minimal", commuteMode: "walk",
      windSensitivity: "normal", rainTolerance: "normal", stylePreferences: [] }
  );
  printPlan("B — 13→12°C casual mostly-outdoors runs-warm", plan);
  const noShorts    = !plan.baseItems.some(i => /short/i.test(i.name));
  const layerInDept = plan.departureLayers.length > 0;
  console.log(`\n✓ no shorts: ${noShorts}`);
  console.log(`✓ layer in departureLayers: ${layerInDept}`);
}

// ── Scenario C: Indoor gym at -2°C ────────────────────────────────────────
{
  const slots = makeSlots(8, "2026-09-26", Array(9).fill(-2));
  const slice = makeSlice(slots);
  const plan = planOuting(
    { occasion: "gym", departureTime: "2026-09-26T08:00", returnTime: "2026-09-26T16:00",
      activity: "active", context: "indoors", locationLabel: "Toronto" },
    slice, [], PREFS, "2026-09-26T16:00", null
  );
  printPlan("C — Indoor gym -2°C", plan);
  const gymBase    = !plan.baseItems.some(i => /coat|jacket/i.test(i.name));
  const coatInDept = plan.departureLayers.some(l => /coat|winter|heavy/i.test(l.name));
  const noShortsInDept = !plan.departureLayers.some(l => /short/i.test(l.name));
  console.log(`\n✓ gym outfit in base (no coat/jacket in base): ${gymBase}`);
  console.log(`✓ winter coat in departureLayers: ${coatInDept}`);
  console.log(`✓ no shorts in departureLayers: ${noShortsInDept}`);
}

// ── Scenario D: Indoor work at -2°C ───────────────────────────────────────
{
  const slots = makeSlots(8, "2026-09-26", Array(9).fill(-2));
  const slice = makeSlice(slots);
  const plan = planOuting(
    { occasion: "work", departureTime: "2026-09-26T08:00", returnTime: "2026-09-26T17:00",
      activity: "low", context: "indoors", locationLabel: "Toronto" },
    slice, [], PREFS, "2026-09-26T17:00", null
  );
  printPlan("D — Indoor work -2°C", plan);
  const noShorts   = !plan.baseItems.some(i => /short/i.test(i.name));
  const fullBottom = plan.baseItems.some(i => /trouser|pant|chino|jean/i.test(i.name));
  const hasProtection = plan.departureLayers.length > 0;
  console.log(`\n✓ no shorts in base: ${noShorts}`);
  console.log(`✓ full-length bottom: ${fullBottom}`);
  console.log(`✓ outdoor protection in departureLayers: ${hasProtection}`);
}

// ── Scenario E: 23–25°C warm outdoor ─────────────────────────────────────
{
  const slots = makeSlots(12, "2026-09-26", [23, 24, 25, 25, 23]);
  const slice = makeSlice(slots);
  const plan = planOuting(
    { occasion: "casual", departureTime: "2026-09-26T12:00", returnTime: "2026-09-26T17:00",
      activity: "low", context: "outdoors", locationLabel: "Toronto" },
    slice, [], PREFS, "2026-09-26T17:00", null
  );
  printPlan("E — 23–25°C warm outdoor casual", plan);
  const hasShorts  = plan.baseItems.some(i => /short/i.test(i.name));
  const noJacket   = plan.departureLayers.length === 0 && plan.carryLayers.length === 0;
  console.log(`\n✓ shorts in base: ${hasShorts}`);
  console.log(`✓ no jacket (departureLayers+carryLayers empty): ${noJacket}`);
}
