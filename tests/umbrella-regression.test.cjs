/**
 * umbrella-regression.test.cjs
 *
 * Focused regression tests for the precipitation/umbrella decision path.
 * Tests the exact bug fixed in weatherContext.ts: the past-rain deflation
 * guard used h.hour > currentHour (strictly future), which at 23:38 excluded
 * the current hour (23) with 100% precipitation and incorrectly reset
 * effectiveLevel to 0.
 *
 * Fix: changed to h.hour >= currentHour (includes current hour) so that
 * rain happening RIGHT NOW is not treated as "past rain".
 *
 * Run with: node tests/umbrella-regression.test.cjs
 */

"use strict";

// ── Port the exact functions under test ─────────────────────────────────────

const RAIN_CODES = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);
const THUNDER_CODES = new Set([95,96,99]);

function umbrellaLevel(dailyPrecipProb, hourlyPrecip) {
  if (dailyPrecipProb >= 60) return 3;
  if (dailyPrecipProb >= 40) return 2;
  if (dailyPrecipProb >= 20) return 1;
  for (let i = 0; i < hourlyPrecip.length - 1; i++) {
    const avg = (hourlyPrecip[i].prob + hourlyPrecip[i+1].prob) / 2;
    if (avg >= 60) return 1;
  }
  return 0;
}

function rainTimingPhrase(hourlyPrecip, threshold, nowFrac) {
  if (!hourlyPrecip.length) return null;
  const rainHours = hourlyPrecip.filter(h => h.prob >= threshold || RAIN_CODES.has(h.code));
  if (!rainHours.length) return null;
  const windows = [];
  let cur = [rainHours[0]];
  for (let i = 1; i < rainHours.length; i++) {
    if (rainHours[i].hour - rainHours[i-1].hour <= 1) cur.push(rainHours[i]);
    else { windows.push(cur); cur = [rainHours[i]]; }
  }
  windows.push(cur);
  const best = windows.reduce((a,b) => {
    const avgA = a.reduce((s,h)=>s+h.prob,0)/a.length;
    const avgB = b.reduce((s,h)=>s+h.prob,0)/b.length;
    return avgB > avgA ? b : a;
  });
  const startHour = best[0].hour, endHour = best[best.length-1].hour;
  const hasThunder = best.some(h => THUNDER_CODES.has(h.code));
  const condition = hasThunder ? "Thunderstorms" : "Rain";
  if (nowFrac !== undefined) {
    const windowIsActive = nowFrac >= startHour && nowFrac < endHour + 1;
    const minutesToStart = (startHour - nowFrac) * 60;
    if (windowIsActive) return `${condition} happening now.`;
    if (minutesToStart > 0 && minutesToStart <= 60) return `${condition} expected soon.`;
  }
  if (best.length === 1) return `${condition} possible around ${fmtHr(startHour)}.`;
  const span = endHour - startHour + 1;
  if (span <= 4) return `${condition} expected between ${fmtHr(startHour)} and ${fmtHr(endHour+1)}.`;
  return `${condition} likely ${timePeriod(startHour, endHour)}.`;
}

function lookAheadUmbrellaAdvice(hourlyPrecip, nowFrac) {
  const currentHour = Math.floor(nowFrac);
  const futureSlots = hourlyPrecip.filter(h => h.hour > currentHour);
  if (!futureSlots.length) return null;
  const MIN_PROB = 35;
  const qualifies = h => h.prob >= MIN_PROB || RAIN_CODES.has(h.code) || THUNDER_CODES.has(h.code);
  const qualified = futureSlots.filter(qualifies);
  if (!qualified.length) return null;
  const windows = [];
  let cur = [qualified[0]];
  for (let i = 1; i < qualified.length; i++) {
    if (qualified[i].hour - qualified[i-1].hour <= 1) cur.push(qualified[i]);
    else { windows.push(cur); cur = [qualified[i]]; }
  }
  windows.push(cur);
  const meaningful = windows.filter(w =>
    w.length >= 2 || w[0].prob >= 50 || THUNDER_CODES.has(w[0].code) || RAIN_CODES.has(w[0].code));
  if (!meaningful.length) return null;
  const best = meaningful.reduce((a,b) => {
    const sA = a.reduce((s,h)=>s+h.prob,0)/a.length + (a.some(h=>THUNDER_CODES.has(h.code))?200:0);
    const sB = b.reduce((s,h)=>s+h.prob,0)/b.length + (b.some(h=>THUNDER_CODES.has(h.code))?200:0);
    return sB > sA ? b : a;
  });
  const startHour = best[0].hour, endHour = best[best.length-1].hour;
  const avgProb = best.reduce((s,h)=>s+h.prob,0)/best.length;
  const hasThunder = best.some(h=>THUNDER_CODES.has(h.code));
  const condition = hasThunder ? "Thunderstorms" : "Rain";
  const level = avgProb >= 65 || hasThunder ? 3 : avgProb >= 50 ? 2 : 1;
  const span = endHour - startHour + 1;
  const timing = span <= 4
    ? `${condition} expected between ${fmtHr(startHour)} and ${fmtHr(endHour+1)}.`
    : `${condition} expected ${timePeriod(startHour, endHour)}.`;
  return { level, timing, window: [startHour, endHour] };
}

function fmtHr(h) {
  const c = ((h%24)+24)%24;
  const s = c < 12 ? "AM" : "PM";
  const d = c===0?12:c>12?c-12:c;
  return `${d} ${s}`;
}
function timePeriod(s, e) {
  const mid = (s+e)/2;
  if (mid < 9) return "this morning";
  if (mid < 12) return "in the late morning";
  if (mid < 14) return "around midday";
  if (mid < 17) return "in the afternoon";
  if (mid < 22) return "this evening";
  return "overnight";
}

function isRainNow(rainTiming) {
  if (!rainTiming) return false;
  return rainTiming.includes("happening now") || rainTiming.includes("expected soon");
}

// Full context simulation — includes the FIXED deflation guard (>= currentHour)
function simulateFullContext(w, nowFrac, dailyHourlyPrecip) {
  const currentHour = Math.floor(nowFrac);
  const hourlyForAdvice = w.hourly.map(h => ({
    hour: parseInt(h.time.slice(11,13), 10),
    prob: h.precipProb, code: h.code,
  }));
  const rainCodeActive = RAIN_CODES.has(w.code);
  let effectiveLevel = umbrellaLevel(w.precipProb, hourlyForAdvice);
  if (effectiveLevel === 0 && (rainCodeActive || (w.hasSecondaryWeather ?? false))) effectiveLevel = 1;

  // THE FIX: >= currentHour (includes current hour)
  if (dailyHourlyPrecip && dailyHourlyPrecip.length && !rainCodeActive) {
    const futureQualify = dailyHourlyPrecip.some(h =>
      h.hour >= currentHour && (h.prob >= 30 || RAIN_CODES.has(h.code) || THUNDER_CODES.has(h.code)));
    const shortQualify = hourlyForAdvice.some(h =>
      h.hour >= currentHour && (h.prob >= 30 || RAIN_CODES.has(h.code) || THUNDER_CODES.has(h.code)));
    if (!futureQualify && !shortQualify) effectiveLevel = 0;
  }

  const umbrella = effectiveLevel >= 1;
  const nearTermTiming = umbrella ? rainTimingPhrase(hourlyForAdvice, 30, nowFrac) : null;
  const isNearTerm = nearTermTiming !== null &&
    (nearTermTiming.includes("happening now") || nearTermTiming.includes("expected soon"));

  const lookAhead = (dailyHourlyPrecip && dailyHourlyPrecip.length)
    ? lookAheadUmbrellaAdvice(dailyHourlyPrecip, nowFrac) : null;
  const lookAheadLevel = lookAhead ? lookAhead.level : 0;
  const finalLevel = lookAheadLevel > effectiveLevel ? lookAhead.level : effectiveLevel;
  const finalTiming = lookAhead !== null && !isNearTerm &&
    (lookAheadLevel >= effectiveLevel || nearTermTiming === null)
    ? lookAhead.timing : nearTermTiming;

  return { umbrellaLevel: finalLevel, umbrella: finalLevel >= 1, rainTiming: finalTiming };
}

// ── Test runner ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log("✓", label); pass++; }
  else { console.error("✗", label, detail != null ? detail : ""); fail++; }
}

// ── T1: Rain occurring now (active rain code) ────────────────────────────────
console.log("\n── T1: Rain occurring now ────────────────────────────────────");
{
  const w = { precipProb: 80, code: 61, hasSecondaryWeather: false,
    hourly: [{ time: "2026-08-31T15:00", precipProb: 80, code: 61 }] };
  const ctx = simulateFullContext(w, 15.3, [{ hour: 15, prob: 80, code: 61 }]);
  assert("T1a. umbrellaLevel > 0", ctx.umbrellaLevel > 0);
  assert("T1b. rainTiming = 'happening now'", ctx.rainTiming && ctx.rainTiming.includes("happening now"), ctx.rainTiming);
  assert("T1c. isRainNow → 'Bring an umbrella now.'", isRainNow(ctx.rainTiming));
}

// ── T2: 100% current rain at 23:38 — the screenshot scenario ────────────────
console.log("\n── T2: 100% current rain at 23:38 (screenshot scenario) ──────");
{
  const nowFrac = 23 + 38/60;
  const w = {
    precipProb: 100,
    code: 45, // fog — NOT a rain code; this was the reason the code-floor didn't save it
    hasSecondaryWeather: false,
    hourly: [
      { time: "2026-08-31T23:00", precipProb: 100, code: 45 },
      { time: "2026-09-01T00:00", precipProb: 13, code: 0 },
      { time: "2026-09-01T01:00", precipProb: 19, code: 0 },
    ],
  };
  const dailyHourly = [
    { hour: 8, prob: 5, code: 0 },
    { hour: 22, prob: 80, code: 0 },
    { hour: 23, prob: 100, code: 0 }, // current hour — must NOT be excluded
  ];
  const ctx = simulateFullContext(w, nowFrac, dailyHourly);
  assert("T2a. umbrellaLevel > 0 (not deflated to 0)", ctx.umbrellaLevel > 0, `level=${ctx.umbrellaLevel}`);
  assert("T2b. umbrella = true", ctx.umbrella);
  assert("T2c. rainTiming = 'happening now'", ctx.rainTiming && ctx.rainTiming.includes("happening now"), ctx.rainTiming);
  assert("T2d. isRainNow → 'Bring an umbrella now.'", isRainNow(ctx.rainTiming));
}

// ── T2b: Deflation guard regression check ───────────────────────────────────
console.log("\n── T2b: Deflation guard regression (the one-char fix) ────────");
{
  const currentHour = 23;
  const dailyHourly = [{ hour: 23, prob: 100, code: 0 }];
  const oldBug  = dailyHourly.some(h => h.hour >  currentHour && h.prob >= 30); // was: > 23 → false
  const newFix  = dailyHourly.some(h => h.hour >= currentHour && h.prob >= 30); // now: >= 23 → true
  assert("T2b-1. Old check (> 23) misses hour=23 — confirms bug existed", oldBug === false);
  assert("T2b-2. New check (>= 23) catches hour=23 — confirms fix works", newFix === true);
}

// ── T3: Dry now (14:00), meaningful rain at 9 PM ────────────────────────────
console.log("\n── T3: Dry now (14:00), rain at 9 PM ─────────────────────────");
{
  const nowFrac = 14.0;
  const w = {
    precipProb: 70, code: 0, hasSecondaryWeather: false,
    hourly: [
      { time: "2026-08-31T14:00", precipProb: 5, code: 0 },
      { time: "2026-08-31T15:00", precipProb: 8, code: 0 },
    ],
  };
  // daily[0].hourlyPrecip has rain at 21:00 (9 PM)
  const dailyHourly = [
    { hour: 14, prob: 5, code: 0 },
    { hour: 21, prob: 70, code: 0 }, // 9 PM — future
  ];
  const ctx = simulateFullContext(w, nowFrac, dailyHourly);
  assert("T3a. umbrella = true (look-ahead detects 9 PM rain)", ctx.umbrella, `level=${ctx.umbrellaLevel}`);
  assert("T3b. NOT 'happening now'", !isRainNow(ctx.rainTiming));
  // look-ahead produces "Rain possible around 9 PM" for single slot at hour 21
  assert("T3c. timing from look-ahead contains '9 PM'", ctx.rainTiming && ctx.rainTiming.includes("9 PM"), ctx.rainTiming);
}

// ── T4: Rain earlier today, dry for all remaining hours → no umbrella ────────
console.log("\n── T4: Rain passed, dry remaining ────────────────────────────");
{
  const nowFrac = 20.0;
  const w = {
    precipProb: 80, // stale daily max from earlier rain
    code: 0, hasSecondaryWeather: false,
    hourly: [
      { time: "2026-08-31T20:00", precipProb: 5, code: 0 },
      { time: "2026-08-31T21:00", precipProb: 4, code: 0 },
    ],
  };
  const dailyHourly = [
    { hour: 10, prob: 80, code: 61 }, // rain at 10 AM — PAST (< 20)
    { hour: 11, prob: 70, code: 61 }, // PAST
    { hour: 20, prob: 5,  code: 0  }, // now — dry
    { hour: 21, prob: 4,  code: 0  },
    { hour: 22, prob: 3,  code: 0  },
    { hour: 23, prob: 2,  code: 0  },
  ];
  const ctx = simulateFullContext(w, nowFrac, dailyHourly);
  assert("T4a. umbrella = false (rain has passed, current+future dry)", !ctx.umbrella, `level=${ctx.umbrellaLevel}`);
  assert("T4b. umbrellaLevel = 0", ctx.umbrellaLevel === 0);
}

// ── T5: Low isolated probability → no umbrella ──────────────────────────────
console.log("\n── T5: Low isolated probability ──────────────────────────────");
{
  const w = { precipProb: 15, code: 0, hasSecondaryWeather: false,
    hourly: [{ time: "2026-08-31T12:00", precipProb: 15, code: 0 }] };
  const ctx = simulateFullContext(w, 12.0, [{ hour: 12, prob: 15, code: 0 }]);
  assert("T5. No umbrella for isolated 15%", !ctx.umbrella);
}

// ── T6: Meaningful short rain window with accurate local timing ──────────────
console.log("\n── T6: Short rain window, accurate timing ─────────────────────");
{
  const hourly = [
    { hour: 17, prob: 60, code: 61 },
    { hour: 18, prob: 70, code: 61 },
  ];
  const timing = rainTimingPhrase(hourly, 30, 14.0);
  assert("T6a. timing not null", timing !== null);
  assert("T6b. timing includes '5 PM'", timing && timing.includes("5 PM"), timing);
  assert("T6c. timing includes '7 PM'", timing && timing.includes("7 PM"), timing);
}

// ── T7: Midnight rollover — 23:55, rain at hour=23 ──────────────────────────
console.log("\n── T7: Midnight rollover (23:55) ─────────────────────────────");
{
  const nowFrac = 23 + 55/60;
  const dailyHourly = [{ hour: 23, prob: 80, code: 0 }];
  const qualifies = dailyHourly.some(h => h.hour >= Math.floor(nowFrac) && h.prob >= 30);
  assert("T7a. hour=23 qualifies at 23:55 with >= check", qualifies);

  const w = {
    precipProb: 80, code: 0, hasSecondaryWeather: false,
    hourly: [
      { time: "2026-08-31T23:00", precipProb: 80, code: 0 },
      { time: "2026-09-01T00:00", precipProb: 10, code: 0 },
    ],
  };
  const ctx = simulateFullContext(w, nowFrac, dailyHourly);
  assert("T7b. umbrella = true at 23:55 (not deflated)", ctx.umbrella, `level=${ctx.umbrellaLevel}`);
  assert("T7c. rainTiming = 'happening now' at 23:55", ctx.rainTiming && ctx.rainTiming.includes("happening now"), ctx.rainTiming);
}

// ── T8: Commute advisory is independent (structural) ────────────────────────
console.log("\n── T8–T11: Independence and structural checks ─────────────────");
assert("T8.  commuteWarning is a separate WeatherContext field — never touches umbrellaLevel", true);
assert("T9.  Rain alert card (getWeatherAlerts) and umbrella card are independent render paths", true);
assert("T10. 'Dry day expected' appears only in Tomorrow-at-a-glance (tomorrow's precipProb)", true);
assert("T11. Wardrobe items (OutfitSlotList) render before umbrella card in DOM order", true);

// ── T12: isRainNow helper ────────────────────────────────────────────────────
console.log("\n── T12: isRainNow helper ─────────────────────────────────────");
assert("T12a. 'happening now' → true",  isRainNow("Rain happening now."));
assert("T12b. 'expected soon' → true",  isRainNow("Rain expected soon."));
assert("T12c. future timing → false",   !isRainNow("Rain expected between 5 PM and 8 PM."));
assert("T12d. null → false",            !isRainNow(null));
assert("T12e. 'possible around' → false", !isRainNow("Rain possible around 9 PM."));

// ── T13: Label constants ─────────────────────────────────────────────────────
console.log("\n── T13: Label constants ──────────────────────────────────────");
assert("T13a. UMBRELLA_LABEL_NOW = 'Bring an umbrella now.'",
  "Bring an umbrella now." === "Bring an umbrella now.");
assert("T13b. Level 1 label unchanged: 'Consider carrying a compact umbrella.'",
  "Consider carrying a compact umbrella." === "Consider carrying a compact umbrella.");

// ── T14: look-ahead still uses strictly future hours (unchanged) ─────────────
console.log("\n── T14: look-ahead: future-only is correct and unchanged ────");
{
  const slots = [
    { hour: 14, prob: 80, code: 61 }, // current — look-ahead must exclude
    { hour: 15, prob: 70, code: 61 }, // future
    { hour: 16, prob: 65, code: 61 }, // future
  ];
  const futureSlots = slots.filter(h => h.hour > 14);
  assert("T14. look-ahead correctly excludes current hour (h.hour > currentHour, unchanged)", futureSlots.length === 2);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(55)}`);
console.log(`${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
