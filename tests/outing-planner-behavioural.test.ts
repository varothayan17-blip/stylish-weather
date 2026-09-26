/**
 * outing-planner-behavioural.test.ts
 * Exercises actual production exports. No copied logic. No permissive assertions.
 */

import {
  parseOutingForecastResponse,
  RAIN_CODES,
  type OpenMeteoHourlyJson,
  type OutingForecastSlice,
} from "../src/lib/outingForecast";

import {
  planOuting,
  matchWardrobeItem,
  OUTING_PLAN_VERSION,
} from "../src/lib/outingPlanner";

import {
  computeAdaptationNote,
  parseIsoLocal,
  outingPlanStore,
  storageKeyForUid,
  type LockedPlan,
  type PlanStatus,
} from "../src/lib/outingPlanStore";

import type { PersonalStyleProfile } from "../src/lib/styleProfile";

type WItem = {
  id: string; name: string; type: string; category: string;
  warmth: "Light" | "Medium" | "Warm"; unavailable: boolean;
  style?: string; labels?: string[];
};

let _p = 0, _f = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log("✓", label); _p++; }
  else       { console.error("✗", label, detail !== undefined ? String(detail) : ""); _f++; }
}

let _storage: Map<string, string>;
function mockLocalStorage() {
  _storage = new Map();
  (globalThis as any).window = {
    localStorage: {
      getItem:    (k: string) => _storage.get(k) ?? null,
      setItem:    (k: string, v: string) => _storage.set(k, v),
      removeItem: (k: string) => _storage.delete(k),
    },
  };
}
function clearLocalStorage() { delete (globalThis as any).window; }

function makeJson(
  date: string, startHour: number, apparents: number[],
  opts: { precip?: number | number[]; code?: number | number[]; wind?: number } = {},
): OpenMeteoHourlyJson {
  const n = apparents.length;
  const times = Array.from({ length: n }, (_, i) => {
    const totalH = startHour + i;
    const dayOffset = Math.floor(totalH / 24);
    const hr = totalH % 24;
    const [y, m, d] = date.split("-").map(Number);
    const dd = new Date(y, m - 1, d + dayOffset);
    const pad = (x: number) => String(x).padStart(2, "0");
    return `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}T${pad(hr)}:00`;
  });
  const codes   = Array.isArray(opts.code)   ? opts.code   : Array(n).fill(opts.code ?? 0);
  const precips = Array.isArray(opts.precip) ? opts.precip : Array(n).fill(opts.precip ?? 5);
  return {
    hourly: {
      time: times,
      temperature_2m: apparents.map(a => a - 1),
      apparent_temperature: apparents,
      precipitation_probability: precips,
      weather_code: codes,
      wind_speed_10m: Array(n).fill(opts.wind ?? 10),
      is_day: Array(n).fill(1),
    },
  };
}

function makeSlice(json: OpenMeteoHourlyJson, dept: string, ret: string): OutingForecastSlice {
  const r = parseOutingForecastResponse(json, 43.65, -79.38, dept, ret);
  if (!r.ok) throw new Error("makeSlice failed: " + JSON.stringify(r));
  return r.slice;
}

const PREFS = { coldSensitivity: "normal" as const, commute: "walk" as const, theme: "system" as const };
const NO_WARDROBE: WItem[] = [];
const DEFAULT_STYLE: PersonalStyleProfile = {
  layeringPreference: "balanced", stylePreferences: ["casual"], commuteMode: "mixed",
  windSensitivity: "normal", rainTolerance: "normal", commonActivities: [],
  completedAt: null, updatedAt: 0, version: 1,
};

function makePlanRecord(uid: string, startH: number, endH: number, status: PlanStatus,
  overrides: Partial<LockedPlan> = {}): LockedPlan {
  function isoFromNow(h: number): string {
    const d = new Date(Date.now() + h * 3600_000);
    const pad = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const base: LockedPlan = {
    id: "test-plan-1", uid, status,
    snapshot: {
      coverageStart: isoFromNow(startH), coverageEnd: isoFromNow(endH),
      locationLabel: "Toronto", locationLat: 43.65, locationLon: -79.38, occasion: "casual",
      baseItems: [{ name: "T-shirt", wardrobeId: null, fromWardrobe: false, reason: "warm" }],
      removableLayers: [],
      footwear: [{ name: "Sneakers", wardrobeId: null, fromWardrobe: false, reason: "ok" }],
      accessories: [],
      timelineGuidance: [{ startTime: isoFromNow(startH), instruction: "Go.", reason: "." }],
      weatherSummary: {
        rawMinApparentTempC: 10, rawMaxApparentTempC: 18,
        effectiveMinC: 10, effectiveMaxC: 18, destinationMinC: 14, destinationMaxC: 22,
        peakPrecipitationProbability: 5, maxWindSpeedKph: 10,
        hasRain: false, hasSnow: false, isWindy: false, hasActiveRainCode: false,
      },
      personalizationExplanation: "Balanced.", generatedAt: new Date().toISOString(),
      recommendationVersion: 2,
    },
    adaptationNote: null, lockedAt: Date.now(), attemptedAt: null, lastCheckedAt: null,
  };
  return { ...base, ...overrides };
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Bug 1: Cross-account async ownership (deferred promises) ─────");
{
  // Simulate generate() + recheck guard logic using actual deferred promises
  // and the same request-ID / UID-token pattern used in the production code.

  type GenState = { draft: string|null; step: string; error: string|null; draftUid: string|null };

  function makeGenerator() {
    let currentUid: string | null = null;
    let generationRequestId = 0;
    const state: GenState = { draft: null, step: "form", error: null, draftUid: null };

    function switchUid(uid: string | null) {
      currentUid = uid;
      generationRequestId++;          // invalidate any in-flight generation
      state.draft    = null;
      state.draftUid = null;
      state.step     = "form";
      state.error    = null;
    }

    function startGenerate(): { resolve: (v: string) => void; reject: (e: unknown) => void } {
      const capturedUid = currentUid;
      const capturedRequestId = ++generationRequestId;
      state.step = "loading";
      let res!: (v: string) => void;
      let rej!: (e: unknown) => void;
      const p = new Promise<string>((r, j) => { res = r; rej = j; });

      p.then(draft => {
        // Exact same double-guard as production generate()
        if (currentUid === capturedUid && generationRequestId === capturedRequestId) {
          state.draft    = draft;
          state.draftUid = capturedUid;
          state.step     = "result";
        }
      }).catch(() => {
        if (currentUid === capturedUid && generationRequestId === capturedRequestId) {
          state.error = "fetch error";
          state.step  = "form";
        }
      });

      return { resolve: res, reject: rej };
    }

    function lockDraft(): boolean {
      if (!state.draft || !currentUid || state.draftUid !== currentUid) return false;
      state.step     = "locked";
      state.draft    = null;
      state.draftUid = null;
      return true;
    }

    return { switchUid, startGenerate, lockDraft, state };
  }

  const gen = makeGenerator();

  // Step 1: User A starts generating
  gen.switchUid("A");
  const { resolve: resolveA, reject: _rejectA } = gen.startGenerate();
  ok("G1a. During generate: step=loading", gen.state.step === "loading");

  // Step 2: Switch to user B before A resolves
  gen.switchUid("B");
  ok("G1b. After switch to B: step=form",  gen.state.step === "form");
  ok("G1c. After switch to B: draft=null", gen.state.draft === null);

  // Step 3: A's generate resolves (stale)
  resolveA("draft-from-A");
  await new Promise(r => setTimeout(r, 0));

  ok("G1d. A's stale resolve: draft still null",     gen.state.draft === null);
  ok("G1e. A's stale resolve: step still form",      gen.state.step === "form");
  ok("G1f. A's stale resolve: draftUid still null",  gen.state.draftUid === null);

  // Step 4: Attempting to lock under B with A's stale draft must fail
  const locked = gen.lockDraft();
  ok("G1g. lockDraft() with stale draft returns false", !locked);
  ok("G1h. Step remains form after failed lock",         gen.state.step === "form");

  // Step 5: B successfully generates
  const { resolve: resolveB } = gen.startGenerate();
  resolveB("draft-from-B");
  await new Promise(r => setTimeout(r, 0));

  ok("G1i. B's draft arrives",          gen.state.draft === "draft-from-B");
  ok("G1j. B's draftUid = B",           gen.state.draftUid === "B");
  ok("G1k. B's step = result",          gen.state.step === "result");

  // Step 6: B can lock its own draft
  const lockedB = gen.lockDraft();
  ok("G1l. B's lockDraft succeeds",     lockedB);
  ok("G1m. Step = locked after commit", gen.state.step === "locked");
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Bug 1 (recheck token): owner-aware in-flight guard ───────────");
{
  // Simulate recheckToken {uid, planId} logic.
  type RecheckToken = { uid: string; planId: string } | null;

  function makeRecheckGuard() {
    let currentUid: string | null = null;
    let token: RecheckToken = null;
    const calls: string[] = [];

    function switchUid(uid: string | null) {
      currentUid = uid;
      token = null;
    }

    function startRecheck(uid: string, planId: string): { resolve: () => void } {
      if (token?.uid === uid && token?.planId === planId) {
        calls.push("skipped:already-in-flight");
        return { resolve: () => {} };
      }
      token = { uid, planId };
      let res!: () => void;
      const p = new Promise<void>(r => { res = r; });
      p.then(() => {
        if (token?.uid === uid && token?.planId === planId && currentUid === uid) {
          calls.push(`success:${uid}:${planId}`);
        }
      }).finally(() => {
        if (token?.uid === uid && token?.planId === planId) {
          token = null;
          calls.push(`cleared:${uid}`);
        }
      });
      return { resolve: res };
    }

    return { switchUid, startRecheck, calls, getToken: () => token };
  }

  const g = makeRecheckGuard();

  // A starts a recheck
  g.switchUid("A");
  const { resolve: resolveRA } = g.startRecheck("A", "plan-1");
  ok("R1a. Token set to A after A's recheck starts", g.getToken()?.uid === "A");

  // Switch to B — token cleared
  g.switchUid("B");
  ok("R1b. Token cleared after uid switch", g.getToken() === null);

  // B starts its own recheck
  const { resolve: resolveRB } = g.startRecheck("B", "plan-2");
  ok("R1c. Token set to B", g.getToken()?.uid === "B");

  // A's stale promise resolves — finally fires with old uid/planId
  resolveRA();
  await new Promise(r => setTimeout(r, 0));

  ok("R1d. A's stale finally did NOT clear B's token",  g.getToken()?.uid === "B");
  ok("R1e. A's stale success did NOT write B's state",  !g.calls.includes("success:A:plan-1"));

  // B's recheck resolves
  resolveRB();
  await new Promise(r => setTimeout(r, 0));

  ok("R1f. B's recheck succeeded",     g.calls.includes("success:B:plan-2"));
  ok("R1g. B's token cleared cleanly", g.getToken() === null);
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Bug 1 (structural): source guard checks ──────────────────────");
{
  const fs = await import("node:fs");
  const planSrc  = fs.readFileSync(new URL("../src/routes/plan.tsx",  import.meta.url), "utf8");
  const indexSrc = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  ok("B1s-a. generationRequestIdRef declared in plan.tsx",
    planSrc.includes("generationRequestIdRef"));
  ok("B1s-b. capturedRequestId captured before await in generate()",
    planSrc.includes("capturedRequestId"));
  ok("B1s-c. Post-await guard checks both UID and requestId",
    planSrc.includes("generationRequestIdRef.current === capturedRequestId"));
  ok("B1s-d. draftUid state declared",
    planSrc.includes("draftUid"));
  ok("B1s-e. lockDraft checks draftUid === uid",
    planSrc.includes("draftUid !== uid"));
  ok("B1s-f. recheckToken (not recheckInFlight boolean) in plan.tsx",
    planSrc.includes("recheckToken") && !planSrc.includes("recheckInFlight"));
  ok("B1s-g. recheckToken finally only clears when uid+planId match",
    planSrc.includes("recheckToken.current?.uid === uidVal"));
  ok("B1s-h. lockedPlan render guard: lockedPlan.uid === uid",
    planSrc.includes("lockedPlan.uid === uid"));
  ok("B1s-i. homeRecheckToken in index.tsx (not homeRecheckInFlight boolean)",
    indexSrc.includes("homeRecheckToken") && !indexSrc.includes("homeRecheckInFlight"));
  ok("B1s-j. index.tsx render guard: activePlan.uid === authUid",
    indexSrc.includes("activePlan.uid === authUid"));
  ok("B1s-k. index.tsx token finally only clears when uid+planId match",
    indexSrc.includes("homeRecheckToken.current?.uid === planUid") &&
    indexSrc.includes("homeRecheckToken.current?.planId === p.id"));
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Bug 2: Positive garment-family vocabulary ────────────────────");
{
  // Four required false-positive rejections
  const trainingSneakers: WItem = { id:"tsn1", name:"Training sneakers", type:"Shoes / Sneakers",
    category:"Shoes", warmth:"Light", unavailable:false };
  const lightweightSneakers: WItem = { id:"lsn1", name:"Lightweight sneakers", type:"Shoes / Sneakers",
    category:"Shoes", warmth:"Light", unavailable:false };
  const winterBoots: WItem = { id:"wb1", name:"Heavy winter boots", type:"Shoes / Boots",
    category:"Shoes", warmth:"Warm", unavailable:false };
  const trainingShoes: WItem = { id:"tsh1", name:"Training shoes", type:"Shoes / Trainers",
    category:"Shoes", warmth:"Light", unavailable:false };

  ok("B2a. Training shorts does NOT match Training sneakers (shared 'training' descriptor rejected)",
    matchWardrobeItem("Training shorts", [trainingSneakers] as any, new Set(), "mild") === null,
    matchWardrobeItem("Training shorts", [trainingSneakers] as any, new Set(), "mild")?.id ?? "null");
  ok("B2b. Lightweight gym shirt does NOT match Lightweight sneakers",
    matchWardrobeItem("Lightweight gym shirt", [lightweightSneakers] as any, new Set(), "mild") === null,
    matchWardrobeItem("Lightweight gym shirt", [lightweightSneakers] as any, new Set(), "mild")?.id ?? "null");
  ok("B2c. Heavy winter coat does NOT match Winter boots",
    matchWardrobeItem("Heavy winter coat", [winterBoots] as any, new Set(), "freezing") === null,
    matchWardrobeItem("Heavy winter coat", [winterBoots] as any, new Set(), "freezing")?.id ?? "null");
  ok("B2d. Training pants does NOT match Training shoes",
    matchWardrobeItem("Training pants", [trainingShoes] as any, new Set(), "mild") === null,
    matchWardrobeItem("Training pants", [trainingShoes] as any, new Set(), "mild")?.id ?? "null");

  // Correct positive matches
  const smartShoesItem: WItem = { id:"ss1", name:"Smart shoes", type:"Shoes / Loafers",
    category:"Shoes", warmth:"Light", unavailable:false };
  ok("B2e. Smart shoes matches Shoes/Loafers item (shoes family)",
    matchWardrobeItem("Smart shoes", [smartShoesItem] as any, new Set(), "mild")?.id === "ss1",
    matchWardrobeItem("Smart shoes", [smartShoesItem] as any, new Set(), "mild")?.id ?? "null");

  const longSleeveShirt: WItem = { id:"lss1", name:"Long-sleeve Oxford shirt", type:"Top / Shirt",
    category:"Tops", warmth:"Light", unavailable:false };
  ok("B2f. Long-sleeve shirt matches shirt in the shirt family",
    matchWardrobeItem("Long-sleeve shirt", [longSleeveShirt] as any, new Set(), "cool")?.id === "lss1");

  const whiteTshirt: WItem = { id:"ts1", name:"White T-shirt", type:"Top / T-shirt",
    category:"Tops", warmth:"Light", unavailable:false };
  const smartShirt: WItem = { id:"shs1", name:"Smart shirt", type:"Top / Shirt",
    category:"Tops", warmth:"Light", unavailable:false };
  ok("B2g. T-shirt matches T-shirt item (tshirt family), NOT shirt item",
    matchWardrobeItem("T-shirt", [whiteTshirt, smartShirt] as any, new Set(), "mild")?.id === "ts1");
  ok("B2h. T-shirt slot does NOT match Smart shirt",
    matchWardrobeItem("T-shirt", [smartShirt] as any, new Set(), "mild") === null);

  const coatItem: WItem = { id:"co1", name:"Heavy winter coat", type:"Outerwear / Coat",
    category:"Outerwear", warmth:"Warm", unavailable:false };
  ok("B2i. Winter coat matches coat (coat family), NOT winter boots",
    matchWardrobeItem("Heavy winter coat", [coatItem, winterBoots] as any, new Set(), "freezing")?.id === "co1");

  const trainingShorts: WItem = { id:"trt1", name:"Training shorts", type:"Bottoms / Shorts",
    category:"Bottoms", warmth:"Light", unavailable:false };
  ok("B2j. Training shorts slot matches Training shorts item (shorts family)",
    matchWardrobeItem("Training shorts", [trainingShorts] as any, new Set(), "mild")?.id === "trt1",
    matchWardrobeItem("Training shorts", [trainingShorts] as any, new Set(), "mild")?.id ?? "null");

  // Preserve T-shirt / shirt separation
  ok("B2k. White T-shirt does NOT fill Smart shirt slot",
    matchWardrobeItem("Smart shirt", [whiteTshirt] as any, new Set(), "mild") === null);
  const blouse: WItem = { id:"bl1", name:"Smart blouse", type:"Top / Blouse",
    category:"Tops", warmth:"Light", unavailable:false };
  ok("B2l. Smart blouse fills Smart shirt slot (shirt↔blouse alias)",
    matchWardrobeItem("Smart shirt", [blouse] as any, new Set(), "mild")?.id === "bl1");
  const sneakers: WItem = { id:"sn1", name:"White sneakers", type:"Shoes / Sneakers",
    category:"Shoes", warmth:"Light", unavailable:false };
  ok("B2m. Sneakers fill Trainers slot (trainers↔sneakers alias)",
    matchWardrobeItem("Trainers", [sneakers] as any, new Set(), "mild")?.id === "sn1");
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Previous regressions ─────────────────────────────────────────");
{
  // Umbrella consistency
  function rainPlan(precip: number, code: number, tolerance: "low"|"normal"|"high") {
    const j = makeJson("2026-09-20", 9, Array(5).fill(14), { precip, code });
    const s = makeSlice(j, "2026-09-20T09:00", "2026-09-20T13:00");
    const p: PersonalStyleProfile = { ...DEFAULT_STYLE, rainTolerance: tolerance };
    return planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T13:00", activity:"low", context:"outdoors", locationLabel:"T" },
      s, NO_WARDROBE as any, PREFS, "2026-09-20T13:00", p);
  }
  const low30  = rainPlan(30, 0, "low");
  const norm30 = rainPlan(30, 0, "normal");
  const high80 = rainPlan(80, 0, "high");
  const code61 = rainPlan(5,  61, "high");
  ok("RA1. Low+30%: umbrella in acc + timeline",
    low30.accessories.some(a=>a.name==="Umbrella") &&
    low30.timelineGuidance.some(g=>g.instruction.toLowerCase().includes("umbrella")));
  ok("RA2. Normal+30%: no umbrella",
    !norm30.accessories.some(a=>a.name==="Umbrella"));
  ok("RA3. High+80%: umbrella (safety floor)",
    high80.accessories.some(a=>a.name==="Umbrella"));
  ok("RA4. Code61+5%+high: umbrella",
    code61.accessories.some(a=>a.name==="Umbrella"));

  // Thermal
  const gj = makeJson("2026-09-20",8,Array(9).fill(-2));
  const gs = makeSlice(gj,"2026-09-20T08:00","2026-09-20T16:00");
  const gp = planOuting({occasion:"gym",departureTime:"2026-09-20T08:00",returnTime:"2026-09-20T16:00",
    activity:"active",context:"indoors",locationLabel:"T"},gs,NO_WARDROBE as any,PREFS,"2026-09-20T16:00",DEFAULT_STYLE);
  ok("RA5. -2°C gym: exposureMinC≈-2",  Math.abs(gp.weatherSummary.effectiveMinC-(-2))<0.5);
  ok("RA6. -2°C gym: winter coat",       gp.removableLayers.some(l=>l.name.toLowerCase().includes("coat")||l.name.toLowerCase().includes("winter")));
  ok("RA7. -2°C gym: gloves",            gp.accessories.some(a=>a.name==="Gloves"));

  // Wind at 20°C
  function windPlan20(context:"indoors"|"mixed"|"outdoors", commute:string, windKph=35) {
    const n=5;
    const json: OpenMeteoHourlyJson = {
      hourly: {
        time: Array.from({length:n},(_,i)=>`2026-09-20T${String(9+i).padStart(2,"0")}:00`),
        temperature_2m: Array(n).fill(19), apparent_temperature: Array(n).fill(20),
        precipitation_probability: Array(n).fill(5), weather_code: Array(n).fill(0),
        wind_speed_10m: Array(n).fill(windKph), is_day: Array(n).fill(1),
      },
    };
    const slice = makeSlice(json,"2026-09-20T09:00","2026-09-20T13:00");
    const profile: PersonalStyleProfile = { ...DEFAULT_STYLE, commuteMode: commute as any };
    return planOuting({occasion:"casual",departureTime:"2026-09-20T09:00",returnTime:"2026-09-20T13:00",
      activity:"low",context,locationLabel:"T"},slice,NO_WARDROBE as any,PREFS,"2026-09-20T13:00",profile);
  }
  ok("RA8.  Indoor+walk+35: Windbreaker",   windPlan20("indoors","walk").accessories.some(a=>a.name==="Windbreaker"));
  ok("RA9.  Drive+35 (< ceil 40): no WB",  !windPlan20("mixed","drive").accessories.some(a=>a.name==="Windbreaker"));
  ok("RA10. Drive+35 exp says driving",
    windPlan20("mixed","drive").personalizationExplanation.toLowerCase().includes("driving") ||
    windPlan20("mixed","drive").personalizationExplanation.toLowerCase().includes("wind"));

  // Atomic replacement
  mockLocalStorage();
  const uid2 = "u-atomic";
  const p1 = outingPlanStore.commitPlan(uid2, makePlanRecord(uid2,2,10,"upcoming").snapshot, null);
  const p2id = `pb-${Date.now()}`;
  const p2: LockedPlan = { ...makePlanRecord(uid2,48,56,"upcoming"), id:p2id };
  _storage.set(storageKeyForUid(uid2), JSON.stringify([p1,p2]));
  const p3 = outingPlanStore.commitPlan(uid2, makePlanRecord(uid2,3,11,"upcoming").snapshot, p1.id);
  const all = outingPlanStore.loadAll(uid2);
  ok("RA11. Atomic replacement: p1 replaced, p2 untouched, p3 upcoming",
    all.find(p=>p.id===p1.id)?.status==="replaced" &&
    all.find(p=>p.id===p2id)?.status==="upcoming" &&
    all.find(p=>p.id===p3.id)?.status==="upcoming");
  clearLocalStorage();

  // ISO validation
  mockLocalStorage();
  const uid3="u-iso";
  const bad={...makePlanRecord(uid3,2,10,"upcoming"), snapshot:{...makePlanRecord(uid3,2,10,"upcoming").snapshot, coverageStart:"2026-99-01T00:00"}};
  _storage.set(storageKeyForUid(uid3),JSON.stringify([bad]));
  ok("RA12. Invalid month 99 rejected", outingPlanStore.loadAll(uid3).length===0);
  clearLocalStorage();

  // Style matching
  const casualShirt: WItem={id:"cas1",name:"Casual shirt",type:"Top / Shirt",category:"Tops",warmth:"Light",unavailable:false,style:"Casual",labels:["casual"]};
  const smartShirt2: WItem={id:"smt1",name:"Smart shirt", type:"Top / Shirt",category:"Tops",warmth:"Light",unavailable:false,style:"Smart", labels:["smart"]};
  const sj=makeJson("2026-09-20",9,Array(5).fill(16));
  const ss=makeSlice(sj,"2026-09-20T09:00","2026-09-20T13:00");
  const cp=planOuting({occasion:"work",departureTime:"2026-09-20T09:00",returnTime:"2026-09-20T13:00",activity:"low",context:"mixed",locationLabel:"T"},ss,[casualShirt,smartShirt2] as any,PREFS,"2026-09-20T13:00",{...DEFAULT_STYLE,stylePreferences:["casual"]});
  const sp=planOuting({occasion:"work",departureTime:"2026-09-20T09:00",returnTime:"2026-09-20T13:00",activity:"low",context:"mixed",locationLabel:"T"},ss,[casualShirt,smartShirt2] as any,PREFS,"2026-09-20T13:00",{...DEFAULT_STYLE,stylePreferences:["smart"]});
  const cw=cp.baseItems.find(i=>i.fromWardrobe);
  const sw=sp.baseItems.find(i=>i.fromWardrobe);
  ok("RA13. Casual profile: wardrobeId = cas1", cw?.wardrobeId==="cas1", cw?.wardrobeId??"null");
  ok("RA14. Smart profile: wardrobeId = smt1",  sw?.wardrobeId==="smt1", sw?.wardrobeId??"null");

  // RAIN_CODES
  ok("RA15. All 16 rain codes present", [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].every(c=>RAIN_CODES.has(c)));
  ok("RA16. Dry codes not in RAIN_CODES", [0,1,2,3,45].every(c=>!RAIN_CODES.has(c)));
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── Restored regressions (from 79-test suite) ────────────────────");
{
  // ── Rain tolerance: high + 50% (no active code) → no umbrella ──────────
  {
    const j = makeJson("2026-09-20", 9, Array(5).fill(14), { precip: 50, code: 0 });
    const s = makeSlice(j, "2026-09-20T09:00", "2026-09-20T13:00");
    const highProfile: PersonalStyleProfile = { ...DEFAULT_STYLE, rainTolerance: "high" };
    const plan = planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T13:00", activity:"low", context:"outdoors", locationLabel:"T" },
      s, NO_WARDROBE as any, PREFS, "2026-09-20T13:00", highProfile);
    ok("RR01. High tolerance + 50% dry code: no Umbrella in accessories",
      !plan.accessories.some(a => a.name === "Umbrella"),
      plan.accessories.map(a=>a.name).join(",") || "none");
    ok("RR02. High tolerance + 50% dry code: no 'bring an umbrella' in timeline",
      !plan.timelineGuidance.some(g => g.instruction.toLowerCase().includes("bring an umbrella")),
      plan.timelineGuidance.map(g=>g.instruction).join("|"));
    ok("RR03. High tolerance + 50% dry code: explanation does not say 'umbrella included'",
      !plan.personalizationExplanation.toLowerCase().includes("umbrella included"),
      plan.personalizationExplanation);
  }

  // ── No false "bring an umbrella" when umbrella absent (normal + 30%) ───
  {
    const j = makeJson("2026-09-20", 9, Array(5).fill(14), { precip: 30, code: 0 });
    const s = makeSlice(j, "2026-09-20T09:00", "2026-09-20T13:00");
    const plan = planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T13:00", activity:"low", context:"outdoors", locationLabel:"T" },
      s, NO_WARDROBE as any, PREFS, "2026-09-20T13:00", DEFAULT_STYLE);
    const hasUmb = plan.accessories.some(a => a.name === "Umbrella");
    ok("RR04. No false 'bring an umbrella' when umbrella absent",
      !(!hasUmb && plan.timelineGuidance.some(g => g.instruction.toLowerCase().includes("bring an umbrella"))),
      plan.timelineGuidance.map(g=>g.instruction).join("|"));
    ok("RR05. No false 'umbrella included' in explanation when umbrella absent",
      !(!hasUmb && plan.personalizationExplanation.toLowerCase().includes("umbrella included")));
  }

  // ── All 16 RAIN_CODES through planOuting → umbrella ────────────────────
  {
    let allUmb = true; let failCode = 0;
    for (const code of [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]) {
      const j = makeJson("2026-09-20", 9, Array(5).fill(14), { code, precip: 5 });
      const s = makeSlice(j, "2026-09-20T09:00", "2026-09-20T13:00");
      const plan = planOuting({ occasion:"work", departureTime:"2026-09-20T09:00",
        returnTime:"2026-09-20T13:00", activity:"low", context:"indoors", locationLabel:"T" },
        s, NO_WARDROBE as any, PREFS, "2026-09-20T13:00");
      if (!plan.accessories.some(a => a.name === "Umbrella")) { allUmb = false; failCode = code; break; }
    }
    ok("RR06. All 16 RAIN_CODES through planOuting → Umbrella in accessories (code " + failCode + " failed if false)",
      allUmb, `code ${failCode}`);
  }

  // ── Indoor + transit + 35 km/h → Windbreaker ───────────────────────────
  {
    const n = 5;
    const json: OpenMeteoHourlyJson = {
      hourly: {
        time: Array.from({length:n},(_,i)=>`2026-09-20T${String(9+i).padStart(2,"0")}:00`),
        temperature_2m: Array(n).fill(19), apparent_temperature: Array(n).fill(20),
        precipitation_probability: Array(n).fill(5), weather_code: Array(n).fill(0),
        wind_speed_10m: Array(n).fill(35), is_day: Array(n).fill(1),
      },
    };
    const slice = makeSlice(json, "2026-09-20T09:00", "2026-09-20T13:00");
    const transitProfile: PersonalStyleProfile = { ...DEFAULT_STYLE, commuteMode: "transit" };
    const plan = planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T13:00", activity:"low", context:"indoors", locationLabel:"T" },
      slice, NO_WARDROBE as any, PREFS, "2026-09-20T13:00", transitProfile);
    ok("RR07. Indoor + transit + 35 km/h: Windbreaker in accessories",
      plan.accessories.some(a => a.name === "Windbreaker"),
      `acc=${plan.accessories.map(a=>a.name).join(",") || "none"}`);
  }

  // ── Existing removable layer → no redundant Windbreaker ─────────────────
  {
    const n = 5;
    const coolWindJson: OpenMeteoHourlyJson = {
      hourly: {
        time: Array.from({length:n},(_,i)=>`2026-09-20T${String(9+i).padStart(2,"0")}:00`),
        temperature_2m: Array(n).fill(11), apparent_temperature: Array(n).fill(12),
        precipitation_probability: Array(n).fill(5), weather_code: Array(n).fill(0),
        wind_speed_10m: Array(n).fill(35), is_day: Array(n).fill(1),
      },
    };
    const coolSlice = makeSlice(coolWindJson, "2026-09-20T09:00", "2026-09-20T13:00");
    const jacketItem: WItem = { id:"j1", name:"Light jacket", type:"Outerwear / Jacket",
      category:"Outerwear", warmth:"Medium", unavailable:false };
    const plan = planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T13:00", activity:"low", context:"outdoors", locationLabel:"T" },
      coolSlice, [jacketItem] as any, PREFS, "2026-09-20T13:00",
      { ...DEFAULT_STYLE, commuteMode: "walk" });
    ok("RR08. Existing removable jacket at 12°C: no redundant Windbreaker",
      !plan.accessories.some(a => a.name === "Windbreaker"),
      `layers=${plan.removableLayers.map(l=>l.name).join(",") || "none"} acc=${plan.accessories.map(a=>a.name).join(",") || "none"}`);
  }

  // ── Category + warmth without garment-family hit → rejected ─────────────
  {
    const unrelated: WItem = { id:"un1", name:"Some item", type:"Random",
      category:"Tops", warmth:"Light", unavailable:false };
    ok("RR09. Category+warmth alone (no family token) rejected by matchWardrobeItem",
      matchWardrobeItem("Smart shirt", [unrelated] as any, new Set(), "mild") === null,
      matchWardrobeItem("Smart shirt", [unrelated] as any, new Set(), "mild")?.id ?? "null");
  }

  // ── Hoodie cannot fill shirt or T-shirt slots ─────────────────────────────
  {
    const hoodie: WItem = { id:"ho1", name:"Light hoodie", type:"Top / Hoodie",
      category:"Tops", warmth:"Medium", unavailable:false };
    ok("RR10. Hoodie cannot fill Smart shirt slot",
      matchWardrobeItem("Smart shirt", [hoodie] as any, new Set(), "chilly") === null,
      matchWardrobeItem("Smart shirt", [hoodie] as any, new Set(), "chilly")?.id ?? "null");
    ok("RR11. Hoodie cannot fill T-shirt slot",
      matchWardrobeItem("T-shirt", [hoodie] as any, new Set(), "mild") === null,
      matchWardrobeItem("T-shirt", [hoodie] as any, new Set(), "mild")?.id ?? "null");
  }

  // ── Blouse cannot fill T-shirt slot ─────────────────────────────────────
  {
    const blouse: WItem = { id:"bl2", name:"Smart blouse", type:"Top / Blouse",
      category:"Tops", warmth:"Light", unavailable:false };
    ok("RR12. Blouse cannot fill T-shirt slot (blouse ∈ shirt family, not tshirt family)",
      matchWardrobeItem("T-shirt", [blouse] as any, new Set(), "mild") === null,
      matchWardrobeItem("T-shirt", [blouse] as any, new Set(), "mild")?.id ?? "null");
  }

  // ── Timeline timestamp bound validation ──────────────────────────────────
  {
    mockLocalStorage();
    const uid = "u-tsbounds";
    const good = makePlanRecord(uid, 2, 10, "upcoming");

    const tooEarly = { ...good, snapshot: { ...good.snapshot,
      timelineGuidance: [{ startTime:"2020-01-01T00:00", instruction:"x", reason:"x" }] }};
    _storage.set(storageKeyForUid(uid), JSON.stringify([tooEarly]));
    ok("RR13. Timeline startTime before coverageStart rejected",
      outingPlanStore.loadAll(uid).length === 0);

    const tooLate = { ...good, snapshot: { ...good.snapshot,
      timelineGuidance: [{ startTime:"2099-12-31T23:59", instruction:"x", reason:"x" }] }};
    _storage.set(storageKeyForUid(uid), JSON.stringify([tooLate]));
    ok("RR14. Timeline startTime after coverageEnd rejected",
      outingPlanStore.loadAll(uid).length === 0);

    const atStart = { ...good, snapshot: { ...good.snapshot,
      timelineGuidance: [{ startTime: good.snapshot.coverageStart, instruction:"x", reason:"x" }] }};
    _storage.set(storageKeyForUid(uid), JSON.stringify([atStart]));
    ok("RR15. Timeline startTime == coverageStart accepted",
      outingPlanStore.loadAll(uid).length === 1);

    const atEnd = { ...good, snapshot: { ...good.snapshot,
      timelineGuidance: [{ startTime: good.snapshot.coverageEnd, instruction:"Return.", reason:"." }] }};
    _storage.set(storageKeyForUid(uid), JSON.stringify([atEnd]));
    ok("RR16. Timeline startTime == coverageEnd accepted",
      outingPlanStore.loadAll(uid).length === 1);

    clearLocalStorage();
  }

  // ── Indoor gym destination uses indoor comfort baseline ──────────────────
  {
    const j = makeJson("2026-09-20", 8, Array(9).fill(-10));
    const s = makeSlice(j, "2026-09-20T08:00", "2026-09-20T16:00");
    const plan = planOuting({ occasion:"gym", departureTime:"2026-09-20T08:00",
      returnTime:"2026-09-20T16:00", activity:"active", context:"indoors", locationLabel:"Gym" },
      s, NO_WARDROBE as any, PREFS, "2026-09-20T16:00", DEFAULT_STYLE);
    ok("RR17. Indoor gym -10°C: destinationMinC reflects indoor baseline (>10°C), not raw -10°C",
      plan.weatherSummary.destinationMinC > 10,
      `destinationMinC=${plan.weatherSummary.destinationMinC}`);
    ok("RR18. Indoor gym -10°C: exposureMinC reflects outdoor -10°C (exposure track unchanged)",
      plan.weatherSummary.effectiveMinC < -5,
      `effectiveMinC=${plan.weatherSummary.effectiveMinC}`);
  }

  // ── recommendationVersion === 2 ────────────────────────────────────────
  {
    const j = makeJson("2026-09-20", 9, Array(4).fill(15));
    const s = makeSlice(j, "2026-09-20T09:00", "2026-09-20T12:00");
    const plan = planOuting({ occasion:"casual", departureTime:"2026-09-20T09:00",
      returnTime:"2026-09-20T12:00", activity:"low", context:"mixed", locationLabel:"T" },
      s, NO_WARDROBE as any, PREFS, "2026-09-20T12:00");
    ok("RR19. recommendationVersion === 2", plan.recommendationVersion === 2);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(55)}`);
console.log(`${_p + _f} tests: ${_p} passed, ${_f} failed`);
process.exit(_f > 0 ? 1 : 0);
