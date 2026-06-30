import type { Weather } from "./weather";
import type { Prefs } from "./preferences";
import { OUTFIT_BAND_EDGES, type Recommendation } from "./recommend";

export type RegretLevel = "low" | "medium" | "high";

export type RegretRisk = {
  level: RegretLevel;
  score: number; // 0-100
  headline: string;
  reasons: string[]; // ranked, top contributing factors
};

function nearestEdgeDistance(tempC: number): number {
  return Math.min(...OUTFIT_BAND_EDGES.map((e) => Math.abs(tempC - e)));
}

type Factor = { points: number; reason: string };

export function computeRegretRisk(w: Weather, p: Prefs, rec: Recommendation): RegretRisk {
  const factors: Factor[] = [];

  // 1. Wind chill / feels-like gap — the bigger the gap, the easier it is to
  // under-dress because the "actual" temperature looks fine on its own.
  const chillGap = w.tempC - w.feelsLikeC;
  if (chillGap >= 8) {
    factors.push({
      points: 30,
      reason: `Wind makes it feel ${Math.round(chillGap)}° colder than the thermometer reading.`,
    });
  } else if (chillGap >= 4) {
    factors.push({
      points: 15,
      reason: `Feels a noticeable ${Math.round(chillGap)}° colder than the actual temperature.`,
    });
  } else if (chillGap <= -4) {
    factors.push({
      points: 10,
      reason: "Feels warmer than the actual temperature — easy to overdress.",
    });
  }

  // 2. Precipitation uncertainty — risk peaks around 50%, where the call is
  // genuinely a coin flip, and tapers off as it gets more certain either way.
  if (w.precipProb >= 30 && w.precipProb < 70) {
    factors.push({
      points: 25,
      reason: `${Math.round(w.precipProb)}% rain chance — could go either way.`,
    });
  } else if (w.precipProb >= 70) {
    factors.push({
      points: 10,
      reason: `${Math.round(w.precipProb)}% rain chance — likely, but easy to forget the umbrella anyway.`,
    });
  }

  // 3. Snow always adds logistical risk (footing, boots, timing) regardless
  // of probability magnitude reported.
  if (w.snowProb > 0) {
    factors.push({
      points: 15,
      reason: "Snow in the forecast — footwear matters as much as the jacket.",
    });
  }

  // 4. High wind compounds discomfort even when temperature itself is mild.
  if (w.windKph >= 30) {
    factors.push({
      points: 15,
      reason: `${Math.round(w.windKph)} km/h winds — exposed layers will feel it.`,
    });
  } else if (w.windKph >= 20) {
    factors.push({ points: 8, reason: `${Math.round(w.windKph)} km/h winds expected.` });
  }

  // 5. Temperature swing across the day — a single outfit has to cover the
  // whole commute window, not just the current reading.
  if (w.hourly.length > 1) {
    const temps = w.hourly.map((h) => h.tempC);
    const swing = Math.max(...temps) - Math.min(...temps);
    if (swing >= 8) {
      factors.push({
        points: 20,
        reason: `${Math.round(swing)}° swing between today's high and low — one outfit may not cover it.`,
      });
    } else if (swing >= 5) {
      factors.push({ points: 10, reason: `${Math.round(swing)}° swing expected over the day.` });
    }
  }

  // 6. Boundary proximity — if the effective feels-like temperature sits
  // right on the edge of an outfit band, a small forecast miss flips the
  // recommendation entirely.
  const edgeDistance = nearestEdgeDistance(rec.effectiveFeelsC);
  if (edgeDistance <= 1.5) {
    factors.push({ points: 15, reason: "Right on the edge between two outfit categories." });
  }

  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0),
  );
  const level: RegretLevel = score >= 55 ? "high" : score >= 28 ? "medium" : "low";

  const headline =
    level === "high"
      ? "High regret risk — conditions are tricky today."
      : level === "medium"
        ? "Medium risk — conditions could shift on you."
        : "Low risk — your outfit should hold up fine.";

  const reasons = factors
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => f.reason);

  return { level, score, headline, reasons };
}
