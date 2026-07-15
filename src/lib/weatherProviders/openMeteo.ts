import type { DailyForecast, Weather, WeatherProvider } from "./types";

const codeMap: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Thunderstorm w/ hail",
  // Custom codes assigned by Aeruvo Guard D (not WMO):
  709: "Hazy",
  710: "Smoke haze",
};

// ── Weather code families ───────────────────────────────────────────────────
// Used to group hourly codes into severity buckets so we can count how many
// daytime hours belong to each category. Lower bucket index = less severe.
const THUNDER_CODES = new Set([95, 96, 99]);
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const CLOUD_CODES = new Set([2, 3, 45, 48]);
const CLEAR_CODES = new Set([0, 1]);

/** Return the severity bucket for a WMO code. Higher = more severe. */
function codeBucket(code: number): number {
  if (THUNDER_CODES.has(code)) return 5;
  if (RAIN_CODES.has(code)) return 4;
  if (SNOW_CODES.has(code)) return 3;
  if (CLOUD_CODES.has(code)) return 2;
  if (CLEAR_CODES.has(code)) return 1;
  return 0; // unknown
}

/**
 * getRepresentativeDayCondition
 *
 * Choose the most honest single condition for a forecast day card, the same
 * way a human meteorologist would describe the day: by what dominates the
 * hours people are awake and outside (08:00–19:59 local), not by the single
 * worst hour or a model code that contradicts measured precipitation.
 *
 * Two-layer filter:
 *
 * Layer 1 — Precipitation evidence gate (new):
 *   Open-Meteo sometimes sets all hourly codes to 95 (Thunderstorm) even
 *   when daily precipitation probability is very low (< 10%) and the measured
 *   precipitation amount is 0.00 mm — a known model artifact for summer
 *   convective activity in Canada. Trust a thunderstorm code only when at
 *   least one of the following is true:
 *     • precipProbMax  >= 30%  (meaningful probability)
 *     • precipAmountMm > 0.2   (measurable precipitation actually recorded)
 *   If neither is true, thunder is demoted to a secondary warning and the
 *   remaining hourly codes determine the primary condition.
 *
 * Layer 2 — Daytime frequency vote (existing):
 *   After applying the evidence gate, count how many daytime hours fall into
 *   each severity bucket. The bucket with the most hours wins. If a more-
 *   severe bucket is present but did not win, a stormWarning is produced.
 *
 * @param date            ISO date string, e.g. "2026-06-24"
 * @param hourlyTimes     Full hourly.time array from the API response
 * @param hourlyCodesAll  Full hourly.weather_code array (aligned with hourlyTimes)
 * @param precipProbMax   precipitation_probability_max for the window (0–100)
 * @param precipAmountMm  precipitation amount in mm (daily sum or current reading)
 * @param rawFallbackCode daily.weather_code or c.weather_code — last-resort fallback
 */
function getRepresentativeDayCondition(
  date: string,
  hourlyTimes: string[],
  hourlyCodesAll: number[],
  precipProbMax: number,
  precipAmountMm: number,
  rawFallbackCode: number,
): { code: number; condition: string; stormWarning?: string } {
  // ── 1. Precipitation evidence gate ──────────────────────────────────────
  // Thunder WMO codes are only trusted as PRIMARY condition when supporting
  // precipitation evidence exists. Without this gate, Open-Meteo's model
  // artifacts (code 95 on a 0mm, 5% probability day) propagate directly
  // into the displayed condition.
  const thunderEvidencePresent = precipProbMax >= 30 || precipAmountMm > 0.2;

  // ── 2. Extract daytime hourly codes (08:00–19:59 local) ─────────────────
  const daytimeCodes: number[] = [];
  for (let i = 0; i < hourlyTimes.length; i++) {
    const t = hourlyTimes[i];
    if (!t.startsWith(date)) continue;
    const hour = parseInt(t.slice(11, 13), 10);
    if (hour >= 8 && hour <= 19) {
      const code = hourlyCodesAll[i];
      if (typeof code === "number") daytimeCodes.push(code);
    }
  }
  // Fallback: last day of 7-day window may have fewer than 12 hours covered
  if (daytimeCodes.length === 0) {
    for (let i = 0; i < hourlyTimes.length; i++) {
      if (hourlyTimes[i].startsWith(date)) {
        const code = hourlyCodesAll[i];
        if (typeof code === "number") daytimeCodes.push(code);
      }
    }
  }

  if (daytimeCodes.length === 0) {
    // No hourly data at all — use raw fallback
    return { code: rawFallbackCode, condition: codeMap[rawFallbackCode] ?? "—" };
  }

  // ── 3. Apply evidence gate: filter thunder codes when not evidenced ──────
  // Replace untrustworthy thunder codes with the next-most-severe hourly
  // code if available, or "Partly cloudy" (code 2) as a reasonable baseline
  // for a day that had convective activity without measurable rain.
  const filteredCodes = daytimeCodes.map((code) => {
    if (THUNDER_CODES.has(code) && !thunderEvidencePresent) {
      // Find non-thunder daytime codes from the same day
      const nonThunder = daytimeCodes.filter((c) => !THUNDER_CODES.has(c));
      if (nonThunder.length > 0) {
        // Use the most severe non-thunder code present as a representative
        // for that hour (e.g. "Rain showers" if those exist, else "Partly cloudy")
        const maxNonThunder = nonThunder.reduce((best, c) =>
          codeBucket(c) > codeBucket(best) ? c : best,
        );
        return maxNonThunder;
      }
      // No non-thunder codes at all — use partly cloudy as baseline
      return 2;
    }
    return code;
  });

  // ── 4. Frequency vote over filtered daytime codes ───────────────────────
  const bucketHours = new Map<number, number>();
  const bucketCodes = new Map<number, Map<number, number>>();

  for (const code of filteredCodes) {
    const bucket = codeBucket(code);
    bucketHours.set(bucket, (bucketHours.get(bucket) ?? 0) + 1);
    if (!bucketCodes.has(bucket)) bucketCodes.set(bucket, new Map());
    const cmap = bucketCodes.get(bucket)!;
    cmap.set(code, (cmap.get(code) ?? 0) + 1);
  }

  const total = filteredCodes.length;
  const sortedBuckets = [...bucketHours.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0] - b[0],
  );

  const dominantBucket = sortedBuckets[0][0];
  const dominantFraction = sortedBuckets[0][1] / total;

  // ── 5. Pick most frequent code within the dominant bucket ────────────────
  const dominantCodeMap = bucketCodes.get(dominantBucket)!;
  let primaryCode = rawFallbackCode;
  let primaryCount = 0;
  for (const [code, count] of dominantCodeMap) {
    if (count > primaryCount || (count === primaryCount && code < primaryCode)) {
      primaryCode = code;
      primaryCount = count;
    }
  }
  const primaryCondition = codeMap[primaryCode] ?? "—";

  // ── 6. Secondary warning ─────────────────────────────────────────────────
  // Produce a user-friendly secondary line when severe weather is present but
  // is not the primary condition. Timing is derived from the average hour of
  // severe codes so the wording reflects when it actually occurs.
  let stormWarning: string | undefined;

  const originalHadThunder = daytimeCodes.some((c) => THUNDER_CODES.has(c));
  const maxOriginalBucket = daytimeCodes.length > 0 ? Math.max(...daytimeCodes.map(codeBucket)) : 0;

  // Shared helper: average hour of codes matching targetBucket for this date.
  function severeTimingFor(targetBucket: number): string {
    const hours: number[] = [];
    for (let i = 0; i < hourlyTimes.length; i++) {
      if (!hourlyTimes[i].startsWith(date)) continue;
      const code = hourlyCodesAll[i];
      const hr = parseInt(hourlyTimes[i].slice(11, 13), 10);
      if (typeof code === "number" && codeBucket(code) === targetBucket) hours.push(hr);
    }
    if (hours.length === 0) return "later";
    const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
    if (avg < 12) return "in the morning";
    if (avg < 17) return "in the afternoon";
    if (avg < 21) return "in the evening";
    return "overnight";
  }

  if (originalHadThunder && !THUNDER_CODES.has(primaryCode)) {
    // Thunder was present but is not the primary — either demoted by the
    // evidence gate or lost the frequency vote. Either way the user should
    // know, but in natural language, not technical jargon.
    const timing = severeTimingFor(5);
    if (timing === "in the morning") {
      stormWarning = "A thunderstorm is possible this morning — keep an eye on the sky.";
    } else if (timing === "in the afternoon") {
      stormWarning = "Thunderstorms possible this afternoon.";
    } else if (timing === "in the evening") {
      stormWarning = "A brief thunderstorm may arrive this evening.";
    } else if (timing === "overnight") {
      stormWarning = "Thunderstorms possible overnight.";
    } else {
      stormWarning = "A brief thunderstorm is possible later today.";
    }
  } else if (!originalHadThunder && maxOriginalBucket > dominantBucket) {
    // Non-thunder severe weather (rain or snow) present but not dominant.
    const severeCodeMap = new Map<number, number>();
    for (const code of daytimeCodes) {
      if (codeBucket(code) === maxOriginalBucket) {
        severeCodeMap.set(code, (severeCodeMap.get(code) ?? 0) + 1);
      }
    }
    let severeCode = 0,
      severeCount = 0;
    for (const [code, count] of severeCodeMap) {
      if (count > severeCount) {
        severeCode = code;
        severeCount = count;
      }
    }
    const timing = severeTimingFor(maxOriginalBucket);
    if (RAIN_CODES.has(severeCode)) {
      const intensity = [65, 82].includes(severeCode) ? "Heavy rain" : "Rain";
      stormWarning = `${intensity} possible ${timing}.`;
    } else if (SNOW_CODES.has(severeCode)) {
      stormWarning = `Snow possible ${timing}.`;
    }
  }

  // ── 7. Debug log (development only) ─────────────────────────────────────
  if (import.meta.env.DEV) {
    console.debug("[aeruvo:weather] condition resolved", {
      date,
      rawFallbackCode,
      rawCondition: codeMap[rawFallbackCode] ?? "—",
      precipProbMax,
      precipAmountMm,
      thunderEvidencePresent,
      daytimeCodesCount: daytimeCodes.length,
      totalFiltered: total,
      dominantBucket,
      dominantFraction: Math.round(dominantFraction * 100) + "%",
      primaryCode,
      primaryCondition,
      stormWarning,
    });
  }

  return { code: primaryCode, condition: primaryCondition, stormWarning };
}

// ── Open-Meteo Air Quality API — haze / smoke detection ─────────────────────
//
// Open-Meteo's standard weather API does not provide any smoke, aerosol, or
// particulate-matter fields. During wildfire smoke events the NWP model
// correctly reports code 0 (Clear sky) because the sky is technically
// cloud-free, but the atmosphere carries enough aerosol to reduce visibility,
// scatter sunlight orange, and produce unhealthy air quality. This secondary
// fetch detects that condition.
//
// The AQI endpoint is the same provider (open-meteo.com), no extra API key.
// It runs concurrently with fetchWeather via Promise.allSettled so a failure
// never blocks the main weather response.

// All fields are optional because:
//   1. The CAMS European domain (11 km, hourly) only covers Europe.
//      Outside Europe, data comes from CAMS Global (45 km, 3-hourly).
//   2. At model-update boundaries or domain edges, individual fields
//      can be null/undefined even when others are available.
//   3. Future API changes should degrade gracefully, not crash.
// All thresholds in classifyAtmosphere use optional-chaining / nullish
// coalescing so missing fields safely evaluate to 0 (below threshold).
type AqiSnapshot = {
  pm2_5?: number;  // μg/m³ — Particulate Matter < 2.5 µm
  pm10?:  number;  // μg/m³ — Particulate Matter < 10 µm
  aod?:   number;  // aerosol_optical_depth at 550 nm (dimensionless)
                   // Direct measure of total column aerosol loading.
                   // AOD 0.1 = very clean; 0.5 = moderately hazy;
                   // 1.0+ = heavily hazy / severe smoke.
  dust?:  number;  // μg/m³ — Saharan dust particles at 10 m
  co?:    number;  // μg/m³ — Carbon monoxide, wildfire smoke tracer
                   // Note: API returns μg/m³, not ppm.
                   // 1 ppm CO ≈ 1162 μg/m³ at STP.
                   // Wildfire plume: typically > 1000 μg/m³.
};

/**
 * Fetch a single-hour snapshot of air-quality / aerosol data from the
 * Open-Meteo Air Quality API for the given location.
 * Returns null on network error, non-OK response, or missing data.
 */
async function fetchAirQuality(lat: number, lon: number): Promise<AqiSnapshot | null> {
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5,pm10,aerosol_optical_depth,dust,carbon_monoxide` +
      `&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const c = j?.current;
    if (!c) return null;
    // Use undefined (not 0) for missing fields so classifyAtmosphere
    // knows the difference between "measured at 0" and "not available".
    const snap: AqiSnapshot = {
      pm2_5: c.pm2_5                 !== null ? (c.pm2_5                 as number) : undefined,
      pm10:  c.pm10                  !== null ? (c.pm10                  as number) : undefined,
      aod:   c.aerosol_optical_depth !== null ? (c.aerosol_optical_depth as number) : undefined,
      dust:  c.dust                  !== null ? (c.dust                  as number) : undefined,
      co:    c.carbon_monoxide       !== null ? (c.carbon_monoxide       as number) : undefined,
    };
    if (import.meta.env.DEV) {
      console.debug("[aeruvo:aqi] raw current block", c);
      console.debug("[aeruvo:aqi] snapshot", snap);
    }
    return snap;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[aeruvo:aqi] fetch failed", err);
    return null;
  }
}

/**
 * Guard D — Atmospheric haze / smoke classification.
 *
 * Only fires when the resolved current code after Guards A/B/C is 0 or 1
 * (clear or mainly clear). Rain, snow, fog, thunder, and cloud codes are
 * never overridden here — they are more perceptually immediate than aerosols.
 *
 * Two-tier classification using multi-signal consensus:
 *
 * "Smoke haze" (code 710): strong aerosol loading, visibly orange sky,
 *   potential health risk. Requires TWO or more signals at the strong threshold,
 *   OR one signal vastly exceeding it.
 *
 * "Hazy" (code 709): moderate aerosol loading, reduced but not severely impaired
 *   visibility. Safer default when evidence is present but not overwhelming.
 *   Requires ONE or more signals at the moderate threshold.
 *
 * Thresholds are intentionally conservative to minimise false positives.
 * All values are hourly instantaneous from the AQI current block.
 *
 * Signal              | Hazy            | Smoke haze
 * ─────────────────── | ─────────────── | ──────────────
 * AOD at 550 nm       | ≥ 0.5 (primary) | ≥ 1.0
 * PM2.5 (μg/m³)       | ≥ 55 (secondary)| ≥ 75 + support
 * PM10  (μg/m³)       | ≥ 100 (secondary)| ≥ 150
 * Dust  (μg/m³)       | ≥ 100 (secondary)| ≥ 200
 * CO    (μg/m³)       | n/a             | ≥ 500 (tracer)
 *
 * AOD is the primary signal because it directly measures total-column
 * aerosol loading regardless of aerosol type. PM2.5 and PM10 can be
 * elevated from routine traffic and industrial sources without producing
 * visible haze, so they require AOD or multi-signal corroboration.
 */
function classifyAtmosphere(
  resolvedCode: number,
  aqi: AqiSnapshot | null,
): { code: number; condition: string; alert: string | null } | null {
  // Only override clear-sky codes; all others remain unchanged.
  if (resolvedCode !== 0 && resolvedCode !== 1) return null;
  if (!aqi) return null;

  // Use 0 as safe default so missing fields do not trigger thresholds.
  const pm25 = aqi.pm2_5 ?? 0;
  const pm10 = aqi.pm10  ?? 0;
  const aod  = aqi.aod   ?? 0;
  const dust = aqi.dust  ?? 0;
  // CO in μg/m³; 1 ppm ≈ 1162 μg/m³. Wildfire plumes typically reach
  // > 1000–5000 μg/m³ vs background < 200 μg/m³.
  const co   = aqi.co    ?? 0;

  // ── Smoke haze (code 710) ─────────────────────────────────────────
  // Requires strongly elevated PM2.5 AND at least one corroborating signal,
  // OR clearly elevated AOD with any supporting particulate reading.
  // CO threshold is 1000 μg/m³ (~0.86 ppm) — indicative of wildfire plume.
  const smokeHaze =
    (pm25 >= 75 && (aod >= 0.8 || pm10 >= 150 || dust >= 200 || co >= 1000)) ||
    (aod >= 1.0 && (pm25 >= 55 || pm10 >= 100 || dust >= 100));

  // ── Hazy (code 709) ───────────────────────────────────────────────
  // AOD ≥ 0.5 is the primary trigger (direct total-column aerosol measure).
  // PM-only triggers require multi-signal corroboration.
  const hazy =
    !smokeHaze && (
      aod >= 0.5 ||
      (pm25 >= 55 && (pm10 >= 100 || dust >= 100 || aod >= 0.3)) ||
      (dust >= 100 && aod >= 0.3)
    );

  // ── Advisory only ─────────────────────────────────────────────────
  // Single moderate PM2.5 (≥ 35 μg/m³, WHO "Moderate" tier): preserve
  // the weather condition but surface an air-quality note.
  const advisoryOnly = !smokeHaze && !hazy && pm25 >= 35;

  // ── Development logging: classification reasoning ─────────────────
  if (import.meta.env.DEV) {
    console.debug("[aeruvo:aqi] classification", {
      inputs: { pm25, pm10, aod, dust, co },
      available: {
        pm2_5: aqi.pm2_5 !== undefined,
        pm10:  aqi.pm10  !== undefined,
        aod:   aqi.aod   !== undefined,
        dust:  aqi.dust  !== undefined,
        co:    aqi.co    !== undefined,
      },
      smokeHaze,
      hazy,
      advisoryOnly,
      reason:
        smokeHaze
          ? pm25 >= 75
            ? `PM2.5=${pm25} + corroborating signal`
            : `AOD=${aod} + particulate support`
          : hazy
            ? aod >= 0.5
              ? `AOD=${aod} (primary trigger)`
              : `multi-signal: PM2.5=${pm25}, AOD=${aod}, dust=${dust}`
            : advisoryOnly
              ? `PM2.5=${pm25} only (advisory)`
              : "clean — no override",
      finalCondition: smokeHaze ? "Smoke haze (710)" : hazy ? "Hazy (709)" : advisoryOnly ? `${codeMap[resolvedCode]} + advisory` : "unchanged",
    });
  }

  if (smokeHaze) {
    return {
      code: 710,
      condition: "Smoke haze",
      alert: "Smoke haze detected — air quality may be unhealthy. Consider limiting time outdoors.",
    };
  }
  if (hazy) {
    return {
      code: 709,
      condition: "Hazy",
      alert: "Reduced visibility — air may feel hazy or smoky.",
    };
  }
  if (advisoryOnly) {
    return {
      code: resolvedCode,
      condition: codeMap[resolvedCode] ?? "—",
      alert: "Air quality is slightly elevated. Sensitive groups may wish to limit extended outdoor activity.",
    };
  }
  return null;
}

async function fetchWeather(lat: number, lon: number, city = "Your location"): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,uv_index,is_day,cloud_cover` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,snowfall,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,weather_code,snowfall_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset` +
    `&timezone=auto&forecast_days=7`;

  // Run AQI and weather fetches concurrently — no added latency.
  const [res, aqiResult] = await Promise.all([
    fetch(url),
    fetchAirQuality(lat, lon),
  ]);
  if (!res.ok) throw new Error("Weather request failed");
  const j = await res.json();
  const c = j.current;
  const h = j.hourly;
  const d = j.daily;
  const aqiSnapshot: AqiSnapshot | null = aqiResult;

  // ── Locate current hour in the hourly array ──────────────────────────────
  const utcOffsetSec: number = j.utc_offset_seconds ?? 0;
  const nowAtLocation = new Date(Date.now() + utcOffsetSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowKey =
    `${nowAtLocation.getUTCFullYear()}-${pad(nowAtLocation.getUTCMonth() + 1)}-` +
    `${pad(nowAtLocation.getUTCDate())}T${pad(nowAtLocation.getUTCHours())}:00`;
  const hourlyTimes = h.time as string[];
  let startIdx = hourlyTimes.findIndex((t) => t >= nowKey);
  if (startIdx === -1) startIdx = 0;

  const currentTime: string = c.time ?? nowKey;
  const currentTimeStaleMinutes = (() => {
    const parse = (key: string) => {
      const [datePart, timePart] = key.split("T");
      const [y, mo, da] = datePart.split("-").map(Number);
      const [hh, mi] = timePart.split(":").map(Number);
      return Date.UTC(y, mo - 1, da, hh, mi);
    };
    return Math.round((parse(nowKey) - parse(currentTime)) / 60000);
  })();

  // ── Precipitation & snow ─────────────────────────────────────────────────
  const snowMax = Math.max(0, ...(h.snowfall ?? []).slice(startIdx, startIdx + 12));
  const hourlyProb = h.precipitation_probability as number[];
  const next4hMax = Math.max(
    0,
    hourlyProb[startIdx] ?? 0,
    hourlyProb[startIdx + 1] ?? 0,
    hourlyProb[startIdx + 2] ?? 0,
    hourlyProb[startIdx + 3] ?? 0,
  );
  const currentPrecipMm: number = c.precipitation ?? 0;
  // Treat the live WMO code as authoritative rain evidence.
  // c.precipitation (15-min accumulation) can be 0.00 mm during light rain
  // because the measurement window does not always capture ongoing rainfall.
  // A rain or thunder WMO code is a direct observation and must also force
  // precipProb to 100 so umbrella logic fires correctly.
  const currentCodeIsRain =
    RAIN_CODES.has(c.weather_code) || THUNDER_CODES.has(c.weather_code);
  const precipProb = currentPrecipMm > 0.01 || currentCodeIsRain ? 100 : next4hMax;
  const snowExpected = snowMax >= 0.05;

  // ── Current condition — use live WMO code directly ──────────────────
  //
  // getRepresentativeDayCondition() is designed for *forecast* days where a
  // frequency vote over 12 daytime hours produces a representative daily
  // summary. It must NOT be used for the live current reading because:
  //
  //   c.weather_code is the most accurate, most recent observation available.
  //   Passing next6hCodes through a majority vote lets 6 future clear-sky
  //   codes outvote the current code — so "it is raining right now" becomes
  //   "Clear sky" because the rain is just ending.
  //
  // Two targeted guards are applied instead of the full frequency-vote:
  //
  //   Guard A — Thunder-spike demotion (existing rationale):
  //     Open-Meteo sometimes returns code 95 (Thunderstorm) as an
  //     instantaneous radar blip on a 0 mm / 5% probability day. Trust
  //     thunder only when precipProb >= 30% or measured precip > 0.2 mm.
  //     If not evidenced, demote to the best non-thunder next-hour code.
  //
  //   Guard B — Clear-but-raining override (new):
  //     Open-Meteo’s synoptic weather_code and precipitation accumulation
  //     fields are updated on different cycles and can describe different
  //     moments. When the model reports a fair/clear code (0 or 1) but
  //     c.precipitation > 0.1 mm, the measurement is more trustworthy than
  //     the synoptic code. Override to code 51 (Light drizzle) — the most
  //     conservative honest rain code. This only applies to the current
  //     condition; daily forecast smoothing is unaffected.

  const thunderEvidencePresent = next4hMax >= 30 || currentPrecipMm > 0.2;
  const rawCurrentCode: number = c.weather_code;

  const resolvedCurrentCode: number = (() => {
    // Guard A: thunder without evidence — demote to best non-thunder next-hour code.
    if (THUNDER_CODES.has(rawCurrentCode) && !thunderEvidencePresent) {
      const next6hCodes = (h.weather_code as number[]).slice(startIdx, startIdx + 6);
      const nonThunder = next6hCodes.filter((code) => !THUNDER_CODES.has(code));
      if (nonThunder.length === 0) return 2; // Partly cloudy as safe fallback
      return nonThunder.reduce((best, code) =>
        codeBucket(code) > codeBucket(best) ? code : best,
      );
    }
    // Guard B: clear/fair code but measurable precipitation recorded.
    // Use 0.1 mm threshold (not 0.01) to avoid triggering on measurement noise.
    if (CLEAR_CODES.has(rawCurrentCode) && currentPrecipMm > 0.1) {
      return 51; // Light drizzle — most conservative honest rain code
    }
    // Guard C: fair-weather code (0 or 1) but cloud_cover measurement
    // contradicts it. Open-Meteo’s synoptic weather_code is derived from
    // the NWP model grid; current.cloud_cover is the total-column cloud
    // fraction from the same model. The two can diverge because cloud_cover
    // includes ALL layers (high cirrus, mid-level altocumulus, low stratus)
    // while the synoptic WMO code is anchored to the dominant layer visible
    // from the ground. High thin cirrus regularly produces 60–80% total
    // cloud_cover while the sky looks clear or lightly veiled.
    //
    // Conservative design principles:
    //   1. The raw WMO code is the primary signal. Guard C only corrects
    //      obviously lagged conditions, not marginal disagreements.
    //   2. From code 0/1, NEVER jump directly to Overcast (code 3). The
    //      maximum uplift for a clear/mainly-clear raw code is Partly cloudy
    //      (code 2). Overcast is only returned when the raw code is already
    //      code 2 (Partly cloudy) and cloud_cover is extremely high (≥ 90%).
    //   3. Thresholds are raised vs WMO definitions to accept that NWP
    //      total cloud cover routinely reads 10–20% higher than perceived sky
    //      cover, especially in summer when boundary-layer cumulus is sparse.
    //
    // Correction table (Guard C only):
    //   raw 0, cloud_cover < 35%    → keep Clear sky  (code 0)
    //   raw 0, cloud_cover 35–64%   → Mainly clear    (code 1)
    //   raw 0, cloud_cover ≥ 65%    → Partly cloudy   (code 2) — max for code 0
    //   raw 1, cloud_cover < 50%    → keep Mainly clear (code 1)
    //   raw 1, cloud_cover 50–89%   → Partly cloudy   (code 2)
    //   raw 1, cloud_cover ≥ 90%    → Partly cloudy   (code 2) — max for code 1
    //   raw 2, cloud_cover ≥ 90%    → Overcast        (code 3)
    //   raw 3 or non-fair codes     → unchanged (guard never fires)
    //
    // Rain, snow, fog, thunder codes are all outside CLEAR_CODES and
    // rawCurrentCode===2/3 paths, so they are never touched here.
    const currentCloudCover: number = c.cloud_cover ?? -1;
    if (currentCloudCover >= 0) {
      if (rawCurrentCode === 0) {
        // Clear sky: cap correction at Partly cloudy
        if (currentCloudCover >= 65) return 2; // Partly cloudy
        if (currentCloudCover >= 35) return 1; // Mainly clear
        // < 35% — keep Clear sky
      } else if (rawCurrentCode === 1) {
        // Mainly clear: cap correction at Partly cloudy
        if (currentCloudCover >= 50) return 2; // Partly cloudy
        // < 50% — keep Mainly clear
      } else if (rawCurrentCode === 2) {
        // Partly cloudy: allow promotion to Overcast only at extreme cover
        if (currentCloudCover >= 90) return 3; // Overcast
        // < 90% — keep Partly cloudy
      }
      // codes 3+ (Overcast, fog, rain, snow, thunder): unchanged
    }
    // All other codes: use c.weather_code directly as the authoritative observation.
    return rawCurrentCode;
  })();

  const resolvedCode = resolvedCurrentCode;
  const resolvedCondition = codeMap[resolvedCode] ?? codeMap[rawCurrentCode] ?? "—";

  // ── Guard D: atmospheric haze / smoke classification ─────────────────────
  // Only fires when the code after A/B/C is still 0 or 1 (clear/mainly-clear).
  const atmosphereResult = classifyAtmosphere(resolvedCode, aqiSnapshot);
  const finalCode      = atmosphereResult?.code      ?? resolvedCode;
  const finalCondition = atmosphereResult?.condition ?? resolvedCondition;
  const atmosphericAlert: string | undefined = atmosphereResult?.alert ?? undefined;

  if (import.meta.env.DEV) {
    console.debug("[aeruvo:weather] current", {
      city,
      rawCode: rawCurrentCode,
      rawCondition: codeMap[rawCurrentCode] ?? "—",
      currentTime,
      nowAtLocation: nowKey,
      currentTimeStaleMinutes,
      precipAmountMm: currentPrecipMm,
      cloudCoverPct: c.cloud_cover ?? "n/a",
      thunderEvidencePresent,
      resolvedCode,
      resolvedCondition,
      // Guard D — atmospheric
      aqi_pm2_5: aqiSnapshot?.pm2_5 ?? "n/a",
      aqi_pm10:  aqiSnapshot?.pm10  ?? "n/a",
      aqi_aod:   aqiSnapshot?.aod   ?? "n/a",
      aqi_dust:  aqiSnapshot?.dust  ?? "n/a",
      aqi_co:    aqiSnapshot?.co    ?? "n/a",
      aqi_null:  aqiSnapshot === null,
      finalCode,
      finalCondition,
      atmosphericAlert: atmosphericAlert ?? "none",
    });
  }

  // ── Daily forecast — representative daytime condition per day ────────────
  const hourlyWeatherCodes = h.weather_code as number[];
  const hourlyPrecipProbs = h.precipitation_probability as number[];

  const daily: DailyForecast[] = (d.time as string[]).map((date, i) => {
    const rawDailyCode: number = d.weather_code[i];
    const dayPrecipMax: number = d.precipitation_probability_max?.[i] ?? 0;
    const dayPrecipMm: number = d.precipitation_sum?.[i] ?? 0;

    const dayResolved = getRepresentativeDayCondition(
      date,
      hourlyTimes,
      hourlyWeatherCodes,
      dayPrecipMax,
      dayPrecipMm,
      rawDailyCode,
    );

    // Per-hour precipitation for this calendar day (6 AM–11 PM).
    // Stored on DailyForecast so precipAdvice.ts can derive rain timing
    // from real API data without inventing any values.
    const hourlyPrecip: { hour: number; prob: number; code: number }[] = [];
    for (let h_i = 0; h_i < hourlyTimes.length; h_i++) {
      if (!hourlyTimes[h_i].startsWith(date)) continue;
      const hr = parseInt(hourlyTimes[h_i].slice(11, 13), 10);
      if (hr < 6) continue;
      hourlyPrecip.push({
        hour: hr,
        prob: hourlyPrecipProbs[h_i] ?? 0,
        code: hourlyWeatherCodes[h_i] ?? 0,
      });
    }

    // Open-Meteo returns sunrise/sunset as ISO 8601 local-time strings,
    // e.g. "2026-07-07T05:42". Stored as-is for display and isDay logic.
    const sunrise: string | undefined = (d.sunrise as string[] | undefined)?.[i];
    const sunset: string | undefined = (d.sunset as string[] | undefined)?.[i];

    return {
      date,
      tempMaxC: d.temperature_2m_max[i],
      tempMinC: d.temperature_2m_min[i],
      feelsMaxC: d.apparent_temperature_max[i],
      feelsMinC: d.apparent_temperature_min[i],
      precipProb: dayPrecipMax,
      snowCm: d.snowfall_sum?.[i] ?? 0,
      windMaxKph: d.wind_speed_10m_max[i],
      uvMax: d.uv_index_max?.[i] ?? 0,
      code: dayResolved.code,
      condition: dayResolved.condition,
      stormWarning: dayResolved.stormWarning,
      hourlyPrecip,
      sunrise,
      sunset,
    };
  });

  return {
    tempC: c.temperature_2m,
    feelsLikeC: c.apparent_temperature,
    windKph: c.wind_speed_10m,
    precipProb,
    snowProb: snowExpected ? 100 : 0,
    uv: c.uv_index ?? 0,
    code: finalCode,
    isDay: c.is_day === 1,
    condition: finalCondition,
    city,
    // The live current block never has a stormWarning — that only exists on
    // DailyForecast entries and is forwarded by dailyToWeather().
    hasSecondaryWeather: false,
    atmosphericAlert,
    // Today's sunrise/sunset from daily[0] — used by the Home screen for
    // the sun times card and accurate isDay computation.
    sunrise: daily[0]?.sunrise,
    sunset: daily[0]?.sunset,
    // The "Now" slot (i === 0) must always match the hero card exactly.
    // weather.hourly[0].code comes from h.weather_code[startIdx] — the raw
    // hourly WMO code — which bypasses every normalization guard (cloud_cover
    // correction, precipitation override, thunder demotion). This caused the
    // hero and "Now" to disagree: e.g. hero=Overcast (after Guard C lifted
    // code 1 to 3) while Now=Rain (raw hourly code 61). Fix: for i === 0
    // only, use the already-normalized current values. Future slots (i > 0)
    // continue to use the raw hourly API values unchanged.
    hourly: hourlyTimes.slice(startIdx, startIdx + 12).map((t, i) => ({
      time: t,
      tempC: i === 0 ? c.temperature_2m : h.temperature_2m[startIdx + i],
      precipProb:
        i === 0
          ? precipProb
          : (h.precipitation_probability?.[startIdx + i] ?? 0),
      code: i === 0 ? finalCode : h.weather_code[startIdx + i],
      isDay: i === 0 ? c.is_day === 1 : (h.is_day?.[startIdx + i] ?? 1) === 1,
    })),
    daily,
  };
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  fetchWeather,
};
