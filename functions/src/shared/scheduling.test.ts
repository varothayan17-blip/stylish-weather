/**
 * scheduling.test.ts — Unit tests for DST-safe scheduling helpers.
 * Run with: node --experimental-vm-modules functions/src/shared/scheduling.test.ts
 * (or via ts-node / jest once dependencies are installed)
 *
 * Tests are structured as plain assertions that can run in Node.js after
 * functions/npm install && npx tsc.
 * They mirror the 20-scenario test plan.
 */

import { computeNextCheckAt, todayEventId } from "./scheduling";
import { lookAheadUmbrellaAdvice, notificationEligible } from "./precipDecision";

let pass = 0; let fail = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}${detail ? ": " + detail : ""}`); fail++; }
}
function assertNull(label: string, v: unknown) { assert(label, v === null, `expected null, got ${v}`); }
function assertNotNull(label: string, v: unknown) { assert(label, v !== null, `expected non-null`); }

// ── Test 1: disabled → no nextCheckAt (onNotifPrefsUpdate sets nextCheckAt only when enabled) ──
// (tested indirectly via the function — scheduling.ts is not called when disabled)
assert("T1 computeNextCheckAt returns null for invalid timezone",
  computeNextCheckAt(Date.now(), "Not/ATimezone", 7, 30) === null);

// ── Test 2: correct UTC for America/Toronto 07:30 ──
{
  // Pick a known non-DST date: 2026-01-15 (UTC-5)
  // 07:30 local = 12:30 UTC
  const jan15 = new Date("2026-01-15T00:00:00Z").getTime(); // midnight UTC
  const result = computeNextCheckAt(jan15, "America/Toronto", 7, 30);
  const expected = new Date("2026-01-15T12:30:00Z").getTime();
  assert("T2 07:30 America/Toronto (UTC-5) = 12:30 UTC", result === expected,
    `got ${result ? new Date(result).toISOString() : null}`);
}

// ── Test 3: DST spring forward (2026-03-08 02:00 → 03:00 in America/Toronto) ──
{
  // Day before spring forward: 2026-03-07, 07:30 local = 12:30 UTC (UTC-5)
  const beforeSpring = new Date("2026-03-07T10:00:00Z").getTime(); // 5 AM Toronto
  const result = computeNextCheckAt(beforeSpring, "America/Toronto", 7, 30);
  const expected = new Date("2026-03-07T12:30:00Z").getTime();
  assert("T3a 07:30 day before spring forward = 12:30 UTC", result === expected,
    `got ${result ? new Date(result).toISOString() : null}`);

  // Day after spring forward: 2026-03-08, 07:30 local = 11:30 UTC (UTC-4)
  const afterSpring = new Date("2026-03-08T10:00:00Z").getTime(); // 6 AM Toronto
  const result2 = computeNextCheckAt(afterSpring, "America/Toronto", 7, 30);
  const expected2 = new Date("2026-03-08T11:30:00Z").getTime();
  assert("T3b 07:30 day after spring forward = 11:30 UTC", result2 === expected2,
    `got ${result2 ? new Date(result2).toISOString() : null}`);
}

// ── Test 4: DST fall back (2026-11-01 02:00 → 01:00 in America/Toronto) ──
{
  // Day of fall back: 2026-11-01, 07:30 local = 12:30 UTC (back to UTC-5)
  const fallBack = new Date("2026-11-01T10:00:00Z").getTime();
  const result = computeNextCheckAt(fallBack, "America/Toronto", 7, 30);
  // After fall back, UTC offset is -5 → 07:30 local = 12:30 UTC
  const expected = new Date("2026-11-01T12:30:00Z").getTime();
  assert("T4 07:30 day of fall back = 12:30 UTC (UTC-5 restored)",
    result === expected, `got ${result ? new Date(result).toISOString() : null}`);
}

// ── Test 5: past reminder time → returns TOMORROW ──
{
  // It is 14:00 UTC on Jan 15 (9 AM Toronto). Reminder is 07:30.
  // 07:30 today is in the past → should return Jan 16 07:30 = 12:30 UTC
  const now = new Date("2026-01-15T14:00:00Z").getTime();
  const result = computeNextCheckAt(now, "America/Toronto", 7, 30);
  const expected = new Date("2026-01-16T12:30:00Z").getTime();
  assert("T5 past reminder → returns tomorrow", result === expected,
    `got ${result ? new Date(result).toISOString() : null}`);
}

// ── Test 6: eventId is deterministic and uses local date ──
{
  // At 2026-08-22T14:00:00Z in America/Toronto (UTC-4), local date is Aug 22
  const now = new Date("2026-08-22T14:00:00Z").getTime();
  const id  = todayEventId(now, "America/Toronto");
  assert("T6 todayEventId uses local date", id === "rain-2026-08-22", `got ${id}`);
}

// ── Test 7: 10 AM dry, 7 PM 60% → notification eligible ──
{
  const slots = [
    { hour:10, prob:10, code:2 },
    { hour:11, prob:5,  code:1 },
    { hour:12, prob:5,  code:1 },
    { hour:13, prob:10, code:2 },
    { hour:14, prob:15, code:2 },
    { hour:15, prob:20, code:2 },
    { hour:16, prob:25, code:2 },
    { hour:17, prob:30, code:2 },
    { hour:18, prob:45, code:61 },
    { hour:19, prob:55, code:63 },
    { hour:20, prob:60, code:63 },
  ];
  const advice = lookAheadUmbrellaAdvice(slots, 10.0); // nowFrac = 10:00
  assertNotNull("T7a advice not null", advice);
  assert("T7b level >= 2", (advice?.level ?? 0) >= 2);
  assert("T7c notificationEligible", advice !== null && notificationEligible(advice));
}

// ── Test 8: isolated 20% only → no notification ──
{
  const slots = [
    { hour:10, prob:5,  code:1 },
    { hour:14, prob:20, code:2 }, // isolated, no rain code
    { hour:20, prob:10, code:1 },
  ];
  const advice = lookAheadUmbrellaAdvice(slots, 10.0);
  const eligible = advice !== null && notificationEligible(advice);
  assert("T8 isolated 20% → not eligible", !eligible,
    `level=${advice?.level}`);
}

// ── Test 9: thunderstorm → level 3 ──
{
  const slots = [
    { hour:10, prob:10, code:2 },
    { hour:15, prob:70, code:95 }, // thunderstorm
    { hour:16, prob:65, code:95 },
  ];
  const advice = lookAheadUmbrellaAdvice(slots, 10.0);
  assert("T9a thunder → advice not null", advice !== null);
  assert("T9b thunder → level 3", advice?.level === 3);
  assert("T9c thunder → eligible", advice !== null && notificationEligible(advice));
}

// ── Test 10: rain past reminder hour → "this evening" ──
{
  const slots = [
    { hour:19, prob:55, code:63 },
    { hour:20, prob:60, code:63 },
    { hour:21, prob:50, code:61 },
  ];
  const advice = lookAheadUmbrellaAdvice(slots, 10.0);
  assert("T10a evening rain → advice not null", advice !== null);
  assert("T10b evening rain → timing contains 'evening'",
    advice?.timing.includes("evening") ?? false,
    `timing="${advice?.timing}"`);
}

// ── Test 11: no rain at all ──
{
  const slots = [
    { hour:10, prob:5,  code:1 },
    { hour:15, prob:10, code:2 },
    { hour:20, prob:5,  code:1 },
  ];
  const advice = lookAheadUmbrellaAdvice(slots, 10.0);
  assert("T11 no rain → advice null", advice === null);
}

// ── Test 12: invalid timezone → computeNextCheckAt returns null ──
{
  assertNull("T12 invalid tz → null", computeNextCheckAt(Date.now(), "Mars/Olympus_Mons", 7, 30));
}

// ── Test 17: empty hourlyPrecip → no advice ──
{
  const advice = lookAheadUmbrellaAdvice([], 10.0);
  assertNull("T17 empty slots → null", advice);
}

// ── Summary ──
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
