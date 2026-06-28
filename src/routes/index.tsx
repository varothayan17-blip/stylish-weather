import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { fetchWeather, CANADIAN_CITIES, getBrowserLocation, reverseGeocode, type Weather } from "@/lib/weather";
import { loadPrefs, savePrefs, saveFavorite, type Prefs } from "@/lib/preferences";
import { recommend } from "@/lib/recommend";
import { Umbrella, Wind, Droplets, Sun, Heart, MapPin, Sparkles, AlertTriangle, Hand, Locate, Eye, Gauge, Sunrise, Thermometer } from "lucide-react";

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
      <header className="mb-1 flex items-center justify-between animate-fade-up">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{greeting}</p>
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="glass-card flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium disabled:opacity-60"
          title="Use my GPS location"
        >
          {locating ? <Locate className="h-3 w-3 text-primary animate-pulse" /> : <MapPin className="h-3 w-3 text-primary" />}
          {locating ? "Locating…" : "My location"}
        </button>
      </header>

      {error && (
        <div className="glass-card mb-4 rounded-3xl p-4 text-sm text-destructive animate-fade-up">{error}</div>
      )}

      {/* Apple-Weather-style hero */}
      <section className="relative pt-3 pb-1 text-center animate-fade-up delay-100">
        {!weather ? (
          <div className="mx-auto space-y-3">
            <div className="mx-auto h-6 w-44 animate-pulse rounded-full bg-foreground/10" />
            <div className="mx-auto h-24 w-40 animate-pulse rounded-2xl bg-foreground/10" />
            <div className="mx-auto h-4 w-28 animate-pulse rounded-full bg-foreground/10" />
          </div>
        ) : (
          <>
            <h1 className="truncate text-3xl font-semibold tracking-tight">{weather.city}</h1>
            <div className="mt-2 flex items-start justify-center">
              <span className="text-[7rem] font-thin leading-none tracking-tighter tabular-nums">{Math.round(weather.tempC)}</span>
              <span className="mt-3 text-3xl font-thin text-foreground/70">°</span>
            </div>
            <p className="-mt-1 text-base font-medium text-foreground/85">{weather.condition}</p>
            <p className="mt-1 text-sm tabular-nums text-muted-foreground">
              H:{weather.highC}°  L:{weather.lowC}°
            </p>
            <div className="pointer-events-none absolute right-1 top-0 text-primary/85 animate-float">
              <WeatherIcon code={weather.code} className="h-14 w-14" />
            </div>
          </>
        )}
      </section>

      {/* AI outfit recommendation */}
      {rec && weather && (
        <section className="mt-5 animate-fade-up delay-200">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" /> AI Outfit
            </h2>
          </div>

          <div className="glass-card overflow-hidden rounded-[2rem] p-5">
            <p className="text-base font-medium leading-snug tracking-tight">{rec.headline}</p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {rec.outfit.map((item) => (
                <span key={item} className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-foreground/85">
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {rec.umbrella && <Chip icon={<Umbrella className="h-3.5 w-3.5" />} label="Umbrella" />}
              {rec.gloves && <Chip icon={<Hand className="h-3.5 w-3.5" />} label="Gloves" />}
              {rec.sunglasses && <Chip icon={<Sun className="h-3.5 w-3.5" />} label="Sunglasses" />}
            </div>

            {rec.commuteWarning && (
              <div className="mt-4 flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-foreground/90">{rec.commuteWarning}</p>
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
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
            >
              <Heart className={`h-4 w-4 transition-all ${saved ? "fill-current scale-125" : ""}`} />
              {saved ? "Saved" : "Save this outfit"}
            </button>
          </div>
        </section>
      )}

      {/* Hourly forecast */}
      {weather && (
        <section className="glass-card mt-4 rounded-3xl p-4 animate-fade-up delay-200">
          <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Hourly forecast
          </p>
          <div className="-mx-2 flex gap-0.5 overflow-x-auto px-2">
            {weather.hourly.map((h, i) => {
              const d = new Date(h.time);
              const label = i === 0 ? "Now" : `${d.getHours()}`;
              return (
                <div key={h.time} className="flex min-w-[52px] flex-col items-center gap-1.5 rounded-2xl px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <WeatherIcon code={h.code} className="h-6 w-6 text-primary" />
                  <span className="font-semibold tabular-nums">{Math.round(h.tempC)}°</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 10-day forecast */}
      {weather && weather.daily.length > 0 && (
        <section className="glass-card mt-4 rounded-3xl p-4 animate-fade-up delay-300">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            10-day forecast
          </p>
          <ul className="divide-y divide-foreground/10">
            {weather.daily.map((d, i) => {
              const day = i === 0 ? "Today" : new Date(d.date).toLocaleDateString(undefined, { weekday: "short" });
              const allMin = Math.min(...weather.daily.map((x) => x.min));
              const allMax = Math.max(...weather.daily.map((x) => x.max));
              const span = Math.max(1, allMax - allMin);
              const left = ((d.min - allMin) / span) * 100;
              const width = ((d.max - d.min) / span) * 100;
              return (
                <li key={d.date} className="grid grid-cols-[3rem_1.5rem_2.2rem_1fr_2.2rem] items-center gap-2 py-2.5 text-sm">
                  <span className="font-medium">{day}</span>
                  <WeatherIcon code={d.code} className="h-5 w-5 text-primary" />
                  <span className="tabular-nums text-muted-foreground">{d.min}°</span>
                  <div className="relative h-1.5 rounded-full bg-foreground/10">
                    <div
                      className="absolute top-0 h-1.5 rounded-full"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(6, width)}%`,
                        background: "linear-gradient(90deg, #38bdf8, #fbbf24, #f97316)",
                      }}
                    />
                  </div>
                  <span className="text-right font-semibold tabular-nums">{d.max}°</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Conditions grid */}
      {weather && (
        <section className="mt-4 grid grid-cols-2 gap-3 animate-fade-up delay-300">
          <InfoCard icon={<Sun className="h-3.5 w-3.5" />} label="UV Index" value={`${Math.round(weather.uv)}`} sub={uvSub(weather.uv)} />
          <InfoCard icon={<Sunrise className="h-3.5 w-3.5" />} label="Sunrise" value={fmtTime(weather.sunrise)} sub={`Sunset ${fmtTime(weather.sunset)}`} />
          <InfoCard icon={<Droplets className="h-3.5 w-3.5" />} label="Precipitation" value={`${weather.precipTodayMm} mm`} sub="Today" />
          <InfoCard icon={<Eye className="h-3.5 w-3.5" />} label="Visibility" value={`${weather.visibilityKm} km`} sub={weather.visibilityKm > 10 ? "Perfectly clear" : "Reduced view"} />
          <InfoCard icon={<Wind className="h-3.5 w-3.5" />} label="Wind" value={`${Math.round(weather.windKph)}`} sub="km/h" />
          <InfoCard icon={<Thermometer className="h-3.5 w-3.5" />} label="Feels like" value={`${Math.round(weather.feelsLikeC)}°`} sub="Apparent" />
          <InfoCard icon={<Droplets className="h-3.5 w-3.5" />} label="Humidity" value={`${weather.humidity}%`} sub={`Dew point ${weather.dewPointC}°`} />
          <InfoCard icon={<Gauge className="h-3.5 w-3.5" />} label="Pressure" value={`${weather.pressureHpa}`} sub="hPa" />
        </section>
      )}
    </AppShell>
  );
}

function InfoCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card flex aspect-square flex-col justify-between rounded-3xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      </div>
      <div>
        <p className="text-3xl font-light leading-none tabular-nums">{value}</p>
        {sub && <p className="mt-2 text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "—";
  }
}

function uvSub(uv: number): string {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
      {icon}
      {label}
    </span>
  );
}
