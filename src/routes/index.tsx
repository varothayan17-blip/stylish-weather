import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { fetchWeather, CANADIAN_CITIES, getBrowserLocation, reverseGeocode, type Weather } from "@/lib/weather";
import { loadPrefs, savePrefs, saveFavorite, type Prefs } from "@/lib/preferences";
import { recommend } from "@/lib/recommend";
import { MapPin, AlertTriangle, Locate, Crown } from "lucide-react";

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
    <AppShell bare>
      {/* Header */}
      <header className="flex items-end justify-between px-6 pb-6 pt-12 animate-fade-up">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">{greeting}</p>
          <h1 className="mt-1 truncate text-2xl font-bold text-zinc-900">WeatherWear AI</h1>
        </div>
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 disabled:opacity-60"
        >
          {locating ? <Locate className="h-3.5 w-3.5 animate-pulse text-zinc-500" /> : <MapPin className="h-3.5 w-3.5 text-zinc-500" />}
          <span className="max-w-[140px] truncate">{locating ? "Locating…" : weather?.city ?? "Use my location"}</span>
        </button>
      </header>

      <main className="px-6">
        {error && (
          <div className="mb-4 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        {/* Weather Hero */}
        <section className="mb-8 animate-fade-up delay-100">
          {!weather ? (
            <div className="space-y-4">
              <div className="h-24 w-40 animate-pulse rounded-2xl bg-zinc-100" />
              <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-zinc-100" />)}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div className="flex flex-col">
                  <span className="font-['Instrument_Serif'] text-8xl leading-none text-zinc-900 tabular-nums">
                    {Math.round(weather.tempC)}°
                  </span>
                  <div className="mt-2">
                    <p className="text-lg font-semibold text-zinc-800">{weather.condition}</p>
                    <p className="text-sm font-medium text-zinc-500">Feels like {Math.round(weather.feelsLikeC)}°</p>
                  </div>
                </div>
                <div className="grid h-24 w-24 place-items-center rounded-3xl bg-blue-50">
                  <WeatherIcon code={weather.code} className="h-16 w-16 text-blue-400" />
                </div>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-4">
                <StatTile label="Precip" value={`${Math.round(weather.precipProb)}%`} />
                <StatTile label="Wind" value={`${Math.round(weather.windKph)} km/h`} />
                <StatTile label="UV Index" value={`${Math.round(weather.uv)}`} />
              </div>
            </>
          )}
        </section>

        {/* Hourly */}
        {weather && (
          <section className="mb-8 flex gap-6 overflow-x-auto pb-2 animate-fade-up delay-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {weather.hourly.map((h, i) => {
              const d = new Date(h.time);
              const label = i === 0 ? "Now" : `${d.getHours()}`;
              return (
                <div key={h.time} className="flex min-w-[40px] flex-col items-center gap-2">
                  <span className="text-[11px] font-bold uppercase text-zinc-400">{label}</span>
                  <WeatherIcon code={h.code} className={`h-5 w-5 ${h.precipProb >= 30 ? "text-blue-400" : "text-zinc-400"}`} />
                  <span className="text-sm font-bold text-zinc-900 tabular-nums">{Math.round(h.tempC)}°</span>
                </div>
              );
            })}
          </section>
        )}

        {/* AI Outfit */}
        {rec && weather && (
          <section className="mb-6 rounded-[32px] bg-zinc-900 p-6 text-white shadow-xl shadow-zinc-200 animate-fade-up delay-300">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">Daily Uniform</h2>
              <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                AI Optimized
              </span>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-zinc-300">{rec.headline}</p>

            <ul className="mb-6 space-y-4">
              {rec.outfit.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <p className="text-sm leading-relaxed text-zinc-200">{item}</p>
                </li>
              ))}
            </ul>

            {(rec.umbrella || rec.gloves || rec.sunglasses) && (
              <div className="mb-6 flex flex-wrap gap-2">
                {rec.umbrella && <Tag label="Umbrella" />}
                {rec.gloves && <Tag label="Gloves" />}
                {rec.sunglasses && <Tag label="Sunglasses" />}
              </div>
            )}

            {rec.commuteWarning && (
              <div className="mb-6 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <span className="text-xs font-bold uppercase tracking-wide text-orange-500">Commute Alert</span>
                </div>
                <p className="text-xs leading-relaxed text-orange-200/80">{rec.commuteWarning}</p>
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
              className="w-full rounded-2xl bg-white py-4 text-sm font-bold text-zinc-900 transition-transform active:scale-95"
            >
              {saved ? "Saved to wardrobe" : "Save outfit"}
            </button>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="text-sm font-semibold text-zinc-900 tabular-nums">{value}</p>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300">
      {label}
    </span>
  );
}
