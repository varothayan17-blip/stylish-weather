import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { WeatherIcon } from "@/components/WeatherIcon";
import { BottomNav } from "@/components/BottomNav";
import { fetchWeather, CANADIAN_CITIES, type Weather } from "@/lib/weather";
import { loadPrefs, saveFavorite, type Prefs } from "@/lib/preferences";
import { recommend } from "@/lib/recommend";
import { Umbrella, Sun, Hand, AlertTriangle, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/recommendation")({
  head: () => ({
    meta: [
      { title: "Today's outfit — WeatherWear AI" },
      { name: "description", content: "Your AI-picked outfit for today's weather." },
    ],
  }),
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
    <div className="relative min-h-screen bg-gradient-to-b from-[#A5D8FF] to-[#E7F5FF] font-['Inter']">
      <main className="mx-auto max-w-md px-0 pb-32">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-12 animate-fade-up">
          <Link
            to="/"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/40 bg-white/40 text-slate-800 shadow-sm backdrop-blur-md"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
          </Link>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700/60">Today</span>
            <h1 className="font-['Lexend'] text-2xl font-semibold tracking-tight text-slate-900">Your outfit</h1>
          </div>
        </div>

        {/* Weather summary */}
        <div className="mt-6 px-6 animate-fade-up delay-100">
          {weather ? (
            <div className="flex items-center justify-between rounded-2xl border border-white/40 bg-white/30 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-blue-600">
                  <WeatherIcon code={weather.code} className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{weather.city}</p>
                  <p className="text-[11px] text-slate-600">{weather.condition}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold leading-none text-slate-900 tabular-nums">{Math.round(weather.tempC)}°C</p>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  Feels {Math.round(weather.feelsLikeC)}°
                </p>
              </div>
            </div>
          ) : (
            <div className="h-20 animate-pulse rounded-2xl bg-white/40" />
          )}
        </div>

        {/* Stylist Card */}
        <div className="mt-6 px-6 animate-fade-up delay-200">
          {rec && weather ? (
            <div className="overflow-hidden rounded-[32px] bg-white shadow-xl shadow-blue-900/10">
              {/* Stylist note */}
              <div className="p-6 pb-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1 w-6 rounded-full bg-blue-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
                    AI Stylist Recommendation
                  </span>
                </div>
                <p className="text-lg font-medium leading-snug text-slate-800">{rec.headline}</p>
              </div>

              {/* Outfit preview placeholder */}
              <div className="relative mx-6 grid h-40 place-items-center overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                <WeatherIcon code={weather.code} className="h-24 w-24 text-slate-200" />
                <span className="absolute bottom-3 rounded border border-slate-100 bg-white px-2 py-1 text-[10px] font-bold text-slate-400 shadow-sm">
                  OUTFIT PREVIEW
                </span>
              </div>

              {/* Items */}
              <ul className="space-y-3 px-6 py-4">
                {rec.outfit.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400" />
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold">{item}</span>
                    </p>
                  </li>
                ))}
              </ul>

              {/* Chips */}
              <div className="flex flex-wrap gap-2 px-6 pb-6">
                <Chip Icon={Sun} label="SUNGLASSES" active={rec.sunglasses} />
                <Chip Icon={Umbrella} label="UMBRELLA" active={rec.umbrella} />
                <Chip Icon={Hand} label="GLOVES" active={rec.gloves} />
              </div>

              {/* Commute Warning */}
              {rec.commuteWarning && (
                <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-amber-500" />
                  <p className="text-[11px] font-medium leading-tight text-amber-800">{rec.commuteWarning}</p>
                </div>
              )}

              {/* CTA */}
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
                className="m-4 mt-0 w-[calc(100%-2rem)] rounded-2xl bg-slate-900 py-4 text-sm font-bold tracking-wide text-white shadow-lg shadow-slate-900/20 transition-transform active:scale-[0.98]"
              >
                {saved ? "Saved to Wardrobe" : "Save to Wardrobe"}
              </button>
            </div>
          ) : (
            <div className="h-72 animate-pulse rounded-[32px] bg-white/60" />
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

function Chip({ Icon, label, active }: { Icon: React.ElementType; label: string; active: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold ${
        active
          ? "border-blue-100 bg-blue-50 text-blue-700"
          : "border-slate-100 bg-slate-50 text-slate-400 line-through opacity-50"
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {label}
    </div>
  );
}