import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { fetchWeather, CANADIAN_CITIES, type Weather } from "@/lib/weather";
import { loadPrefs, saveFavorite, type Prefs } from "@/lib/preferences";
import { recommend } from "@/lib/recommend";
import { Umbrella, Sun, Hand, Heart, AlertTriangle, Sparkles, ArrowLeft, Shirt } from "lucide-react";

export const Route = createFileRoute("/recommendation")({
  head: () => ({ meta: [
    { title: "Today's outfit — WeatherWear AI" },
    { name: "description", content: "Your AI-picked outfit for today's weather." },
  ]}),
  component: Recommendation,
});

function Recommendation() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  useEffect(() => {
    if (!prefs) return;
    const city = prefs.city ?? CANADIAN_CITIES[0];
    fetchWeather(city.lat, city.lon, city.name).then(setWeather).catch(() => {});
  }, [prefs]);

  const rec = useMemo(() => weather && prefs ? recommend(weather, prefs) : null, [weather, prefs]);

  return (
    <AppShell>
      <header className="mb-6 flex items-center gap-3 animate-fade-up">
        <Link to="/" className="glass-card grid h-10 w-10 place-items-center rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Today</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your outfit</h1>
        </div>
      </header>

      {!weather || !rec ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="h-5 w-40 animate-pulse rounded-full bg-foreground/10" />
          <div className="mt-4 h-24 w-full animate-pulse rounded-2xl bg-foreground/10" />
        </div>
      ) : (
        <>
          <section className="glass-card relative overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{weather.city} · {weather.condition}</p>
                <p className="mt-1 text-5xl font-extralight tracking-tighter tabular-nums">{Math.round(weather.tempC)}°</p>
                <p className="text-xs text-muted-foreground">Feels {Math.round(weather.feelsLikeC)}°</p>
              </div>
              <WeatherIcon code={weather.code} className="h-20 w-20 text-primary animate-float" />
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
              <ul className="mt-5 space-y-2">
                {rec.outfit.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap gap-2">
                {rec.umbrella && <Chip icon={<Umbrella className="h-3.5 w-3.5" />} label="Umbrella" />}
                {rec.gloves && <Chip icon={<Hand className="h-3.5 w-3.5" />} label="Gloves" />}
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
                <Heart className={`h-4 w-4 ${saved ? "fill-current scale-125" : ""}`} />
                {saved ? "Saved" : "Save outfit"}
              </button>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
      {icon}{label}
    </span>
  );
}