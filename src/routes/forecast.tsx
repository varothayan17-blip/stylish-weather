import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { WeatherAlertCards } from "@/components/WeatherAlertCards";
import { ErrorState } from "@/components/ErrorState";
import { fetchWeather, dailyToWeather, CANADIAN_CITIES, type Weather } from "@/lib/weather";
import { loadPrefs, type Prefs } from "@/lib/preferences";
import { getErrorMessage } from "@/lib/utils";
import { recommend } from "@/lib/recommend";
import { computeRegretRisk, type RegretLevel } from "@/lib/regretRisk";
import { getWeatherAlerts } from "@/lib/alerts";
import { UMBRELLA_LABEL, UMBRELLA_ICON } from "@/lib/precipAdvice";
import { ChevronDown, Droplets } from "lucide-react";

export const Route = createFileRoute("/forecast")({
  head: () => ({
    meta: [
      { title: "Weekly Forecast — Aeruvo" },
      { name: "description", content: "Your 7-day outlook with a clothing call for every day." },
    ],
  }),
  component: Forecast,
});

const RISK_DOT: Record<RegretLevel, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-destructive",
};

function dayLabel(dateStr: string, index: number) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  // Open-Meteo daily.time values are plain calendar strings ("2026-06-24") with no
  // time or timezone component. new Date("2026-06-24") parses as UTC midnight —
  // which in any timezone west of UTC (all of Canada) converts to the PREVIOUS
  // calendar day when toLocaleDateString() uses the browser's local timezone.
  // { timeZone: "UTC" } forces interpretation as a UTC calendar date, which is
  // what the string actually represents, giving the correct weekday name.
  return new Date(dateStr).toLocaleDateString("en-CA", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function Forecast() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    if (!prefs) return;
    let cancelled = false;
    async function load() {
      try {
        setError(null);
        const city = prefs!.city ?? CANADIAN_CITIES[0];
        const w = await fetchWeather(city.lat, city.lon, city.name);
        if (!cancelled) setWeather(w);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e, "Couldn't load the forecast"));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [prefs, refreshTick]);

  // Build a per-day recommendation + risk score by running the same engine
  // NIGHT-AWARE HEADLINE MAP: rec.headline comes from analyzeWeather() which has
  // no concept of day/night. For the Tonight card we swap the positive daytime
  // phrases with calm evening equivalents at the display layer.
  // Storm, rain, snow, and cold overrides are equally valid at night — unchanged.
  const NIGHT_HEADLINES: Record<string, string> = {
    "Hot — dress light and hydrate.": "Warm night — dress light and stay cool.",
    "Warm & lovely — keep it breezy.": "Warm evening — light clothing is enough.",
    "Beautiful day — easy layers.": "Pleasant evening — easy layers.",
    "Crisp & cool — a light hoodie is perfect.": "Cool evening — a light hoodie is ideal.",
  };

  const days = useMemo(() => {
    if (!weather || !prefs) return [];

    // Determine whether it is currently night using the same sunrise/sunset
    // comparison as the Home hero card. This ensures the Today card on the
    // Forecast page always agrees with the hero about day/night state.
    // weather.sunrise/sunset are ISO local strings e.g. "2026-07-11T05:46".
    // Comparing fractional hours avoids Date constructor timezone pitfalls.
    const toFracHour = (iso: string) => {
      const t = iso.slice(11, 16); // "HH:MM"
      const [h, m] = t.split(":").map(Number);
      return h + m / 60;
    };
    const nowFrac =
      new Date().getHours() + new Date().getMinutes() / 60;
    const isNight =
      weather.sunrise && weather.sunset
        ? nowFrac < toFracHour(weather.sunrise) || nowFrac >= toFracHour(weather.sunset)
        : new Date().getHours() >= 21 || new Date().getHours() < 6; // fallback

    return weather.daily.map((d, index) => {
      let effectiveDay = d;
      let isTonightCard = false;

      if (index === 0 && isNight) {
        isTonightCard = true;

        const currentHour = new Date().getHours();
        const remainingHourly = d.hourlyPrecip.filter((h) => h.hour >= currentHour);
        const remainingPrecipProb =
          remainingHourly.length > 0 ? Math.max(...remainingHourly.map((h) => h.prob)) : 0;

        effectiveDay = {
          ...d,
          tempMaxC: weather.tempC,
          feelsMaxC: weather.feelsLikeC,
          tempMinC: d.tempMinC,
          feelsMinC: d.feelsMinC,
          code: weather.code,
          condition: weather.condition,
          precipProb: remainingPrecipProb,
          hourlyPrecip: remainingHourly,
          stormWarning:
            remainingHourly.some((h) => [95, 96, 99].includes(h.code)) && remainingPrecipProb >= 20
              ? d.stormWarning
              : undefined,
        };
      }

      const dayWeather = dailyToWeather(effectiveDay, weather.city);
      const rec = recommend(dayWeather, prefs);
      const risk = computeRegretRisk(dayWeather, prefs, rec);
      const alerts = getWeatherAlerts(dayWeather);

      // Night-aware headline: swap daytime positive phrases for evening equivalents.
      // Only applies to the Tonight card — all future day cards use daytime wording.
      const displayHeadline =
        isTonightCard && rec.headline in NIGHT_HEADLINES
          ? NIGHT_HEADLINES[rec.headline]
          : rec.headline;

      return { day: effectiveDay, rec, displayHeadline, risk, alerts, isTonightCard };
    });
  }, [weather, prefs]);

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          7-day outlook
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Weekly forecast</h1>
        {weather && (
          <p className="mt-1 text-sm text-muted-foreground">
            {weather.city} · tap any day to see the full outfit
          </p>
        )}
      </header>

      {error && <ErrorState message={error} onRetry={() => setRefreshTick((t) => t + 1)} />}

      {!weather && !error && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-3xl bg-foreground/10" />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {days.map(({ day, rec, displayHeadline, risk, alerts, isTonightCard }, i) => {
          const open = openIndex === i;
          const cardLabel = isTonightCard ? "Tonight" : dayLabel(day.date, i);
          return (
            <section
              key={day.date}
              className="glass-card overflow-hidden rounded-[2rem] animate-fade-up"
            >
              <button
                onClick={() => setOpenIndex(open ? null : i)}
                className="flex w-full items-center gap-4 p-4 text-left"
                aria-expanded={open}
              >
                <div className="w-24 shrink-0">
                  <p className="text-sm font-semibold">{cardLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">{day.condition}</p>
                  {day.stormWarning && (
                    <p className="truncate text-[10px] text-amber-500 dark:text-amber-400">
                      ⚠ {day.stormWarning}
                    </p>
                  )}
                </div>
                {/* isDay=false for Tonight so Moon/CloudMoon replaces Sun/CloudSun */}
                <WeatherIcon
                  code={day.code}
                  isDay={!isTonightCard}
                  className="h-8 w-8 shrink-0 text-primary"
                />
                <div className="flex flex-1 items-center justify-end gap-3">
                  {day.precipProb >= 30 && (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <Droplets className="h-3.5 w-3.5" />
                      {Math.round(day.precipProb)}%
                      <span className="text-[10px] text-muted-foreground">
                        {isTonightCard ? "now" : "day"}
                      </span>
                    </span>
                  )}
                  <span
                    className={`h-2 w-2 rounded-full ${RISK_DOT[risk.level]}`}
                    title={`${risk.level} regret risk`}
                  />
                  <span className="tabular-nums text-sm">
                    <span className="font-semibold">{Math.round(day.tempMaxC)}°</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {Math.round(day.tempMinC)}°
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {open && (
                <div className="border-t border-border/60 px-4 pb-4 pt-3">
                  <p className="text-sm font-medium leading-snug">{displayHeadline}</p>
                  <ul className="mt-3 space-y-1.5">
                    {rec.outfit.map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2.5 text-sm text-foreground/85"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  {rec.commuteWarning && (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {rec.commuteWarning}
                    </p>
                  )}
                  {/* Tiered umbrella advice — shown only when level ≥ 1 */}
                  {rec.umbrellaLevel > 0 && UMBRELLA_LABEL[rec.umbrellaLevel] && (
                    <div className="mt-3 space-y-0.5">
                      <p className="text-xs font-medium text-primary">
                        {UMBRELLA_ICON[rec.umbrellaLevel]} {UMBRELLA_LABEL[rec.umbrellaLevel]}
                      </p>
                      {rec.rainTiming && (
                        <p className="text-xs text-muted-foreground">{rec.rainTiming}</p>
                      )}
                    </div>
                  )}
                  {day.stormWarning && (
                    <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                      ⚠ {day.stormWarning}
                    </p>
                  )}
                  <WeatherAlertCards alerts={alerts} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
