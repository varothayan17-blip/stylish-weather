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

async function fetchWeather(lat: number, lon: number, city = "Your location"): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,uv_index,is_day,cloud_cover` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,snowfall,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,weather_code,snowfall_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset` +
    `&timezone=auto&forecast_days=7`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const j = await res.json();
  const c = j.current;
  const h = j.hourly;
  const d = j.daily;

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
    code: resolvedCode,
    isDay: c.is_day === 1,
    condition: resolvedCondition,
    city,
    // The live current block never has a stormWarning — that only exists on
    // DailyForecast entries and is forwarded by dailyToWeather().
    hasSecondaryWeather: false,
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
      code: i === 0 ? resolvedCode : h.weather_code[startIdx + i],
      isDay: i === 0 ? c.is_day === 1 : (h.is_day?.[startIdx + i] ?? 1) === 1,
    })),
    daily,
  };
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  fetchWeather,
};
