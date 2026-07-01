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
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,uv_index,is_day` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,snowfall,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,weather_code,snowfall_sum,wind_speed_10m_max,uv_index_max` +
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
  const precipProb = currentPrecipMm > 0.01 ? 100 : next4hMax;
  const snowExpected = snowMax >= 0.05;

  // ── Current condition — validated against next 6 hourly codes ───────────
  // Use getRepresentativeDayCondition with only the next 6 hours as the
  // "daytime window" for the current reading — this handles the case where
  // c.weather_code is an instantaneous noisy reading (e.g. code 95 from
  // a brief radar blip while conditions are actually clear).
  const next6hCodes = (h.weather_code as number[]).slice(startIdx, startIdx + 6);
  const next6hPrecipMax = Math.max(
    0,
    hourlyProb[startIdx] ?? 0,
    hourlyProb[startIdx + 1] ?? 0,
    hourlyProb[startIdx + 2] ?? 0,
    hourlyProb[startIdx + 3] ?? 0,
    hourlyProb[startIdx + 4] ?? 0,
    hourlyProb[startIdx + 5] ?? 0,
  );

  // Build a synthetic "day" slice from current hour for the current condition.
  // Pass currentPrecipMm as the precipitation evidence so a 0.00mm reading with
  // code 95 is caught by the evidence gate even for the live current reading.
  const currentDayCode = nowKey.slice(0, 10);
  const currentResolved = getRepresentativeDayCondition(
    currentDayCode,
    hourlyTimes.slice(startIdx, startIdx + 6).map((_, i) => `${currentDayCode}T${pad(8 + i)}:00`),
    next6hCodes,
    next6hPrecipMax,
    currentPrecipMm, // ← actual measured mm, not just probability
    c.weather_code,
  );

  const resolvedCode = currentResolved.code;
  const resolvedCondition = currentResolved.condition;

  if (import.meta.env.DEV) {
    console.debug("[aeruvo:weather] current", {
      city,
      rawCode: c.weather_code,
      rawCondition: codeMap[c.weather_code] ?? "—",
      currentTime,
      nowAtLocation: nowKey,
      currentTimeStaleMinutes,
      precipProbPct: next6hPrecipMax,
      precipAmountMm: currentPrecipMm,
      resolvedCode,
      resolvedCondition,
      stormWarning: currentResolved.stormWarning,
    });
  }

  // ── Daily forecast — representative daytime condition per day ────────────
  const hourlyWeatherCodes = h.weather_code as number[];

  const daily: DailyForecast[] = (d.time as string[]).map((date, i) => {
    const rawDailyCode: number = d.weather_code[i];
    const dayPrecipMax: number = d.precipitation_probability_max?.[i] ?? 0;
    // precipitation_sum is the total measured/forecast mm for the day.
    // This is the key evidence field: if code=95 but precipSum=0.00mm,
    // the thunderstorm label is a model artefact and must be demoted.
    const dayPrecipMm: number = d.precipitation_sum?.[i] ?? 0;

    const dayResolved = getRepresentativeDayCondition(
      date,
      hourlyTimes,
      hourlyWeatherCodes,
      dayPrecipMax,
      dayPrecipMm, // ← actual mm per day, not just probability
      rawDailyCode,
    );

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
    hourly: hourlyTimes.slice(startIdx, startIdx + 12).map((t, i) => ({
      time: t,
      tempC: h.temperature_2m[startIdx + i],
      precipProb: h.precipitation_probability?.[startIdx + i] ?? 0,
      code: h.weather_code[startIdx + i],
      isDay: (h.is_day?.[startIdx + i] ?? 1) === 1,
    })),
    daily,
  };
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  fetchWeather,
};
