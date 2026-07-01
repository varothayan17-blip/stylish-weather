import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { RegretRiskCard } from "@/components/RegretRiskCard";
import { WeatherAlertCards } from "@/components/WeatherAlertCards";
import { ErrorState } from "@/components/ErrorState";
import { fetchWeather, CANADIAN_CITIES, type Weather } from "@/lib/weather";
import { loadPrefs, saveFavorite, loadFavorites, safeUUID, type Prefs } from "@/lib/preferences";
import { cloudSync } from "@/lib/cloudSync";
import { getUid } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { recommend } from "@/lib/recommend";
import { computeRegretRisk } from "@/lib/regretRisk";
import { getWeatherAlerts } from "@/lib/alerts";
import {
  Umbrella,
  Sun,
  Hand,
  Heart,
  AlertTriangle,
  Sparkles,
  ArrowLeft,
  Shirt,
} from "lucide-react";

export const Route = createFileRoute("/recommendation")({
  head: () => ({
    meta: [
      { title: "Today's outfit — Aeruvo" },
      { name: "description", content: "Your AI-picked outfit for today's weather." },
    ],
  }),
  component: Recommendation,
});

function Recommendation() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);
  useEffect(() => {
    if (!prefs) return;
    let cancelled = false;
    setError(null);
    const city = prefs.city ?? CANADIAN_CITIES[0];
    fetchWeather(city.lat, city.lon, city.name)
      .then((w) => {
        if (!cancelled) setWeather(w);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e, "Couldn't load today's recommendation"));
      });
    return () => {
      cancelled = true;
    };
  }, [prefs, refreshTick]);

  const rec = useMemo(
    () => (weather && prefs ? recommend(weather, prefs) : null),
    [weather, prefs],
  );
  const risk = useMemo(
    () => (weather && prefs && rec ? computeRegretRisk(weather, prefs, rec) : null),
    [weather, prefs, rec],
  );
  const alerts = useMemo(() => (weather ? getWeatherAlerts(weather) : []), [weather]);

  return (
    <AppShell>
      <header className="mb-6 flex items-center gap-3 animate-fade-up">
        <Link to="/" className="glass-card grid h-10 w-10 place-items-center rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Today
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Your outfit</h1>
        </div>
      </header>

      {error && <ErrorState message={error} onRetry={() => setRefreshTick((t) => t + 1)} />}

      {!error && (!weather || !rec) ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="h-5 w-40 animate-pulse rounded-full bg-foreground/10" />
          <div className="mt-4 h-24 w-full animate-pulse rounded-2xl bg-foreground/10" />
        </div>
      ) : weather && rec ? (
        <>
          <section className="glass-card relative overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {weather.city} · {weather.condition}
                </p>
                <p className="mt-1 text-5xl font-extralight tracking-tighter tabular-nums">
                  {Math.round(weather.tempC)}°
                </p>
                <p className="text-xs text-muted-foreground">
                  Feels {Math.round(weather.feelsLikeC)}°
                </p>
              </div>
              <WeatherIcon
                code={weather.code}
                isDay={weather.isDay}
                className="h-20 w-20 text-primary animate-float"
              />
            </div>
          </section>

          <section className="mt-5 animate-fade-up delay-200">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                <Shirt className="h-4 w-4 text-primary" /> What to wear
              </h2>
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3 w-3" /> AI
              </span>
            </div>

            <div className="glass-card rounded-[2rem] p-6">
              <p className="text-xl font-medium leading-snug tracking-tight">{rec.headline}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Based on current conditions in {weather.city}.
              </p>
              <ul className="mt-5 space-y-2">
                {rec.outfit.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap gap-2">
                {rec.umbrella && (
                  <Chip
                    icon={<Umbrella className="h-3.5 w-3.5" />}
                    label={`Rain today (${Math.round(weather.precipProb)}%)`}
                  />
                )}
                {rec.gloves && <Chip icon={<Hand className="h-3.5 w-3.5" />} label="Gloves" />}
                {rec.sunglasses && (
                  <Chip icon={<Sun className="h-3.5 w-3.5" />} label="Sunglasses" />
                )}
              </div>

              {rec.commuteWarning && (
                <div className="mt-5 flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-foreground/90">{rec.commuteWarning}</p>
                </div>
              )}

              <button
                onClick={() => {
                  if (saved) return;
                  try {
                    // BUG FIX 1: duplicate detection now scopes to today only.
                    // The previous check matched title+temp across ALL days, so
                    // saving the same weather headline on Tuesday was blocked
                    // because Monday's save existed with the same title and temp.
                    const today = new Date().toDateString();
                    const existing = loadFavorites();
                    const alreadySaved = existing.some(
                      (f) =>
                        f.title === rec.headline &&
                        Math.round(f.tempC) === Math.round(weather.tempC) &&
                        new Date(f.savedAt).toDateString() === today,
                    );
                    if (alreadySaved) {
                      setSaved(true);
                      setTimeout(() => {
                        setSaved(false);
                      }, 2000);
                      return;
                    }
                    // BUG FIX 2: crypto.randomUUID() throws on iOS < 15.4.
                    // The whole handler silently failed with no error boundary.
                    // safeUUID() provides a UUID-shaped fallback string.
                    const fav = {
                      id: safeUUID(),
                      title: rec.headline,
                      items: rec.outfit,
                      tempC: weather.tempC,
                      condition: weather.condition,
                      savedAt: Date.now(),
                    };
                    // Local save first — never dependent on network
                    saveFavorite(fav);
                    // Firestore sync using real Firebase Auth uid
                    getUid().then((uid) => {
                      if (uid) cloudSync.syncFavorite(uid, fav).catch(() => {});
                    });
                    setSaved(true);
                    setTimeout(() => {
                      setSaved(false);
                    }, 2500);
                  } catch {
                    // safeUUID handles the main failure point on older iOS
                  }
                }}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3.5 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
              >
                <Heart
                  className={`h-4 w-4 transition-all ${saved ? "fill-current scale-125" : ""}`}
                />
                {saved ? "Saved to favorites" : "Save this outfit"}
              </button>
            </div>
          </section>

          {risk && <RegretRiskCard risk={risk} />}
          <WeatherAlertCards alerts={alerts} />
        </>
      ) : null}
    </AppShell>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
      {icon}
      {label}
    </span>
  );
}
