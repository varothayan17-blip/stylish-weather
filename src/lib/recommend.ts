import type { Weather } from "./weather";
import type { Prefs } from "./preferences";

export type Recommendation = {
  headline: string;
  outfit: string[];
  umbrella: boolean;
  gloves: boolean;
  sunglasses: boolean;
  commuteWarning?: string;
  mood: "sunny" | "cloudy" | "rainy" | "snowy" | "cold" | "hot";
  /** Feels-like temperature after the user's cold/hot sensitivity adjustment —
   * the actual number this recommendation was decided on. */
  effectiveFeelsC: number;
};

/**
 * The temperature thresholds that separate outfit categories below. Exported
 * so regretRisk.ts can check "how close is the effective temperature to a
 * boundary" against the exact same numbers this function branches on,
 * instead of keeping its own separate copy that could silently drift out of
 * sync if these thresholds ever change here.
 */
export const OUTFIT_BAND_EDGES = [-10, 0, 8, 15, 22, 28] as const;

export function recommend(w: Weather, p: Prefs): Recommendation {
  const adj = p.coldSensitivity === "cold" ? -4 : p.coldSensitivity === "hot" ? 4 : 0;
  const feels = w.feelsLikeC + adj;
  const outfit: string[] = [];
  let headline = "";
  let mood: Recommendation["mood"] = "cloudy";

  if (feels <= OUTFIT_BAND_EDGES[0]) {
    headline = "Bundle up — it's freezing out there.";
    outfit.push(
      "Heavy parka",
      "Thermal base layer",
      "Insulated boots",
      "Wool socks",
      "Beanie & scarf",
    );
    mood = "snowy";
  } else if (feels <= OUTFIT_BAND_EDGES[1]) {
    headline = "Winter mode — layer up properly.";
    outfit.push("Warm coat", "Sweater", "Long pants", "Boots", "Beanie");
    mood = "snowy";
  } else if (feels <= OUTFIT_BAND_EDGES[2]) {
    headline = "Chilly — a warm jacket will do the trick.";
    outfit.push("Insulated jacket", "Long sleeve", "Jeans", "Sneakers");
    mood = "cold";
  } else if (feels <= OUTFIT_BAND_EDGES[3]) {
    headline = "Crisp & cool — a light hoodie is perfect.";
    outfit.push("Light hoodie or jacket", "T-shirt", "Jeans", "Sneakers");
    mood = "cloudy";
  } else if (feels <= OUTFIT_BAND_EDGES[4]) {
    headline = "Beautiful day — easy layers.";
    outfit.push("Long-sleeve tee", "Light pants", "Sneakers");
    mood = "sunny";
  } else if (feels <= OUTFIT_BAND_EDGES[5]) {
    headline = "Warm & lovely — keep it breezy.";
    outfit.push("T-shirt", "Shorts or chinos", "Breathable sneakers");
    mood = "sunny";
  } else {
    headline = "Hot — dress light and hydrate.";
    outfit.push("Linen shirt", "Shorts", "Sandals", "Cap");
    mood = "hot";
  }

  // Rain/drizzle WMO codes — when the current weather IS precipitation,
  // umbrella is always required regardless of the probability value.
  const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
  const umbrella = w.precipProb >= 40 || RAIN_CODES.has(w.code);
  const gloves = feels <= -2;

  // Sunglasses only make sense when precipitation isn't actively occurring.
  // UV is typically 0–2 during rain, but a stale UV reading could be elevated
  // from earlier in the day — suppress to avoid the "sunglasses in a downpour" contradiction.
  const sunglasses = w.uv >= 5 && !RAIN_CODES.has(w.code) && w.precipProb < 40;

  // Sandals + rain is a trust-breaking contradiction. If precipitation is
  // expected (umbrella flag already accounts for code + probability), replace
  // Sandals with Sneakers. The rest of the outfit (linen shirt, shorts, cap)
  // is still appropriate for a hot rainy day — only the footwear changes.
  if (umbrella) {
    const sandalsIdx = outfit.indexOf("Sandals");
    if (sandalsIdx !== -1) outfit[sandalsIdx] = "Sneakers";
  }

  // ── Condition-aware headline override ────────────────────────────────────
  // The temperature band above sets the headline based on how warm or cold it
  // feels, but it never reads w.code. This means a 31°C thunderstorm day
  // produces "Hot — dress light and hydrate." while the icon shows ⛈️, which
  // is misleading and erodes trust. The override below checks the dominant
  // WMO condition and adjusts the headline when it would otherwise contradict
  // the icon. Priority: thunderstorm > snow > rain/drizzle > fog.
  // Temperature thresholds are NOT changed — only the summary text.
  const tempBase = w.tempC; // raw temperature for context in overridden strings
  if ([95, 96, 99].includes(w.code)) {
    // Thunderstorms — always override regardless of temperature
    if (tempBase > 28) {
      headline = "Hot with thunderstorms — stay aware of storm risk.";
    } else if (tempBase > 22) {
      headline = "Warm with thunderstorms — keep an eye on the sky.";
    } else if (tempBase > 15) {
      headline = "Thunderstorms expected — bring an umbrella.";
    } else {
      headline = "Thunderstorms possible — layer up and stay covered.";
    }
    mood = "rainy";
  } else if ([71, 73, 75, 77, 85, 86].includes(w.code)) {
    // Snow codes — override only when headline is not already cold/winter
    if (tempBase <= 0) {
      headline = "Snow expected — winter jacket, boots, and patience.";
    } else {
      headline = "Snow possible — waterproof boots recommended.";
    }
    mood = "snowy";
  } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(w.code)) {
    // Rain/drizzle — override only when headline is misleadingly positive
    // ("Beautiful day", "Warm & lovely", "Hot") to avoid direct contradiction.
    // Cold/cloudy headlines are already neutral and don't need changing.
    const positivePrefix = ["Beautiful day", "Warm & lovely", "Hot"].find((p) =>
      headline.startsWith(p),
    );
    if (positivePrefix) {
      const prefix = positivePrefix;
      if (w.code === 51 || w.code === 53) headline = `${prefix} — light drizzle expected.`;
      else if (w.code === 55) headline = `${prefix} — drizzle throughout the day.`;
      else if (w.code === 61) headline = `${prefix} — light rain possible.`;
      else if (w.code === 63) headline = `${prefix} — rain expected.`;
      else if (w.code === 65) headline = `${prefix} — heavy rain expected.`;
      else if (w.code === 80 || w.code === 81) headline = `${prefix} — showers likely.`;
      else if (w.code === 82) headline = `${prefix} — heavy showers expected.`;
      mood = "rainy";
    }
  } else if (w.code === 45 || w.code === 48) {
    // Fog — only override strongly positive headlines
    const fogPositive = ["Beautiful day", "Warm & lovely"].find((p) => headline.startsWith(p));
    if (fogPositive) {
      headline = `${fogPositive} — foggy start to the day.`;
    }
  }

  if (w.precipProb >= 60) {
    outfit.push("Waterproof shell");
    mood = "rainy";
  }
  if (w.snowProb > 0) {
    outfit.push("Snow boots");
    mood = "snowy";
  }
  if (w.windKph >= 25) outfit.push("Windbreaker layer");

  // ── Context-aware commute warnings ──────────────────────────────────────
  // IMPORTANT: every warning below must be consistent with the outfit already
  // recommended above. The outfit bands are determined by `feels`:
  //   ≤ -10°C  → heavy parka / thermal layers  (isWinter, hasParka)
  //   -10–0°C  → warm coat / sweater            (isWinter, hasCoat)
  //    0–8°C   → insulated jacket               (hasJacket)
  //    8–15°C  → light hoodie                   (hasHoodie)
  //   15–22°C  → long-sleeve tee only           (noOuter)
  //   22–28°C  → t-shirt/shorts                 (isWarm, noOuter)
  //    >28°C   → linen shirt/shorts/sandals     (isHot, noOuter)
  //
  // The original bug: `tempC >= 24` triggered "wear a thin top under your jacket"
  // even when the outfit contained no jacket at all (at 36°C it recommended
  // sandals). Commute advice must read from the same `feels` value, not from
  // raw `w.tempC`, and must only reference clothing items that are in the outfit.
  const hasParka = feels <= OUTFIT_BAND_EDGES[0]; // ≤ -10°C band
  const hasCoat = feels > OUTFIT_BAND_EDGES[0] && feels <= OUTFIT_BAND_EDGES[1]; // -10–0°C
  const hasJacket = feels > OUTFIT_BAND_EDGES[1] && feels <= OUTFIT_BAND_EDGES[2]; // 0–8°C
  const hasHoodie = feels > OUTFIT_BAND_EDGES[2] && feels <= OUTFIT_BAND_EDGES[3]; // 8–15°C
  const isWarm = feels > OUTFIT_BAND_EDGES[4] && feels <= OUTFIT_BAND_EDGES[5]; // 22–28°C
  const isHot = feels > OUTFIT_BAND_EDGES[5]; // > 28°C
  const isWinter = hasParka || hasCoat;

  let commuteWarning: string | undefined;

  if (p.commute === "walk") {
    if (w.precipProb >= 50) {
      commuteWarning = "Wet sidewalks — grab the umbrella before you leave.";
    } else if (isHot) {
      commuteWarning = "It's hot out — shade the route where you can and carry water.";
    } else if (isWinter) {
      commuteWarning = "Icy sidewalks possible — watch your step and allow extra time.";
    } else if (hasJacket) {
      commuteWarning = "Cold wind on the walk — cover ears and hands.";
    }
    // Cool, mild, and warm days with no precipitation need no walk warning.
  } else if (p.commute === "ttc") {
    // TTC-specific: subway cars are climate-controlled and run warm relative to
    // the outside temperature. The advice must match what the user is actually wearing.
    if (w.precipProb >= 50) {
      commuteWarning = "Streetcar stops are exposed — bring an umbrella for the wait.";
    } else if (isHot) {
      // 36°C outside: platforms are hot, no jacket exists — remind them to dress breathably
      commuteWarning =
        "Subway platforms can be hot in summer — stay hydrated and dress breathably.";
    } else if (isWarm) {
      // 22–28°C: t-shirt weather, subway will feel fine or cool
      commuteWarning = "Subway cars run warm — a single breathable layer works well underground.";
    } else if (hasHoodie) {
      // 8–15°C: hoodie exists, subway will be warm enough to want to remove it
      commuteWarning =
        "Subway cars run warm — your hoodie may be plenty inside; keep it handy for outside.";
    } else if (hasJacket) {
      // 0–8°C: insulated jacket — valid to reference it
      commuteWarning =
        "Subway cars run warm — wear a lighter layer under your jacket for comfort on the train.";
    } else if (isWinter) {
      // ≤ 0°C: coat or parka — valid to reference it
      commuteWarning =
        "Subway cars run warm — wear a lighter layer under your coat; you'll want it outside.";
    }
    // Mild (15–22°C): no TTC warning needed — temperature is comfortable everywhere.
  } else if (p.commute === "cycle") {
    if (isWinter) {
      commuteWarning = "Icy roads — consider transit instead, or ride with extra caution.";
    } else if (isHot) {
      commuteWarning = "Ride early or late to avoid the peak heat. Bring water.";
    } else if (w.windKph >= 25) {
      commuteWarning = "Strong headwinds expected — give yourself extra time.";
    } else if (w.precipProb >= 40) {
      commuteWarning = "Slick roads expected — ride cautiously and leave extra stopping distance.";
    } else if (hasJacket) {
      // 0–8°C cycling: cold headwind makes it feel much colder
      commuteWarning = "Cold headwind on the bike — windproof gloves recommended.";
    }
  } else if (p.commute === "drive") {
    if (w.snowProb > 0) {
      commuteWarning = "Snow on the roads — leave early and check your tires.";
    } else if (w.precipProb >= 60) {
      commuteWarning = "Heavy rain expected — reduced visibility on the drive.";
    } else if (isWinter && w.precipProb >= 30) {
      commuteWarning = "Roads may be slippery — drive with extra caution today.";
    }
  }

  return {
    headline,
    outfit,
    umbrella,
    gloves,
    sunglasses,
    commuteWarning,
    mood,
    effectiveFeelsC: feels,
  };
}
