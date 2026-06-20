import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { fetchWeather, CANADIAN_CITIES, getBrowserLocation, reverseGeocode, type Weather } from "@/lib/weather";
import { loadPrefs, savePrefs, saveFavorite, type Prefs } from "@/lib/preferences";
import { recommend } from "@/lib/recommend";
import { Umbrella, Wind, Droplets, Sun, Heart, MapPin, Sparkles, AlertTriangle, Hand, Locate } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WeatherWear AI — What to wear today" },
      { name: "description", content: "Personalized clothing recommendations for Canadians based on real-time weather, wind chill, and your commute." },
      { property: "og:title", content: "WeatherWear AI" },
      { property: "og:description", content: "Know exactly what to wear before you step outside." },
    ],
  }),
  component: Home,
});

function computeGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Home() {
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [greeting, setGreeting] = useState("Hello");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    if (!p.onboarded) {
      setRedirecting(true);
      navigate({ to: "/welcome" });
      return;
    }
    setPrefs(p);
    setGreeting(computeGreeting());
  }, [navigate]);

  useEffect(() => {
    if (!prefs) return;
    let cancelled = false;
    async function load() {
      try {
        const city = prefs!.city ?? CANADIAN_CITIES[0];
        const w = await fetchWeather(city.lat, city.lon, city.name);
        if (!cancelled) setWeather(w);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Couldn't load weather");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [prefs]);

  async function useMyLocation() {
    if (!prefs) return;
    setLocating(true);
    setError(null);
    try {
      const { lat, lon } = await getBrowserLocation();
      const name = await reverseGeocode(lat, lon);
      const city = { name, lat, lon };
      const next = { ...prefs, city };
      savePrefs(next);
      setPrefs(next);
    } catch (e: any) {
      setError(e.message ?? "Couldn't get location");
    } finally {
      setLocating(false);
    }
  }

  // Auto-detect location on very first load (only if no city saved yet)
  useEffect(() => {
    if (prefs && !prefs.city) {
      useMyLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.onboarded]);

  const rec = useMemo(() => weather && prefs ? recommend(weather, prefs) : null, [weather, prefs]);

  if (redirecting) return null;

  return (
    <AppShell>
      <header className="mb-6 flex items-center justify-between animate-fade-up">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{greeting}</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">WeatherWear<span className="text-primary"> AI</span></h1>
        </div>
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="glass-card flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium disabled:opacity-60"
          title="Use my GPS location"
        >
          {locating ? <Locate className="h-3.5 w-3.5 text-primary animate-pulse" /> : <MapPin className="h-3.5 w-3.5 text-primary" />}
          {locating ? "Locating…" : (weather?.city ?? "Use my location")}
        </button>
      </header>

      {error && (
        <div className="glass-card mb-4 rounded-3xl p-4 text-sm text-destructive animate-fade-up">{error}</div>
      )}

      {/* Hero weather card */}
      <section className="glass-card relative overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
        <div aria-hidden className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/25 blur-3xl" />
        {!weather ? (
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded-full bg-foreground/10" />
            <div className="h-20 w-40 animate-pulse rounded-2xl bg-foreground/10" />
            <div className="h-4 w-32 animate-pulse rounded-full bg-foreground/10" />
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{weather.condition}</p>
                <div className="mt-1 flex items-baseline">
                  <span className="text-7xl font-extralight tracking-tighter tabular-nums">{Math.round(weather.tempC)}</span>
                  <span className="ml-1 text-2xl text-muted-foreground">°C</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Feels like <span className="font-semibold text-foreground">{Math.round(weather.feelsLikeC)}°</span>
                </p>
              </div>
              <div className="text-primary animate-float">
                <WeatherIcon code={weather.code} className="h-24 w-24" />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2">
              <Stat icon={<Droplets className="h-4 w-4" />} label="Rain" value={`${Math.round(weather.precipProb)}%`} />
              <Stat icon={<Wind className="h-4 w-4" />} label="Wind" value={`${Math.round(weather.windKph)} km/h`} />
              <Stat icon={<Sun className="h-4 w-4" />} label="UV" value={`${Math.round(weather.uv)}`} />
            </div>
          </div>
        )}
      </section>

      {/* Hourly strip */}
      {weather && (
        <section className="glass-card mt-4 rounded-3xl p-4 animate-fade-up delay-200">
          <div className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
            {weather.hourly.map((h, i) => {
              const d = new Date(h.time);
              const label = i === 0 ? "Now" : `${d.getHours()}`;
              return (
                <div key={h.time} className="flex min-w-[52px] flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <WeatherIcon code={h.code} className="h-5 w-5 text-primary" />
                  <span className="font-semibold tabular-nums">{Math.round(h.tempC)}°</span>
                  <span className="text-[10px] text-primary/80">{h.precipProb}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* AI recommendation */}
      {rec && weather && (
        <section className="mt-6 animate-fade-up delay-300">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Today's recommendation</h2>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> AI
            </span>
          </div>

          <div className="glass-card overflow-hidden rounded-[2rem] p-6">
            <p className="text-xl font-medium leading-snug tracking-tight">{rec.headline}</p>

            <ul className="mt-5 space-y-2">
              {rec.outfit.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="text-foreground/90">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap gap-2">
              {rec.umbrella && <Chip icon={<Umbrella className="h-3.5 w-3.5" />} label="Bring umbrella" />}
              {rec.gloves && <Chip icon={<Hand className="h-3.5 w-3.5" />} label="Wear gloves" />}
              {rec.sunglasses && <Chip icon={<Sun className="h-3.5 w-3.5" />} label="Sunglasses" />}
            </div>

            {rec.commuteWarning && (
              <div className="mt-5 flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed text-foreground/90">{rec.commuteWarning}</p>
              </div>
            )}

            <button
              onClick={() => {
                saveFavorite({
                  id: crypto.randomUUID(),
                  title: rec.headline,
                  items: rec.outfit,
                  tempC: weather.tempC,
                  condition: weather.condition,
                  savedAt: Date.now(),
                });
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
              }}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3.5 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
            >
              <Heart className={`h-4 w-4 transition-all ${saved ? "fill-current scale-125" : ""}`} />
              {saved ? "Saved to favorites" : "Save this outfit"}
            </button>
          </div>
        </section>
      )}
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-foreground/5 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] font-medium uppercase tracking-wider">{label}</span></div>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
      {icon}{label}
    </span>
  );
}
