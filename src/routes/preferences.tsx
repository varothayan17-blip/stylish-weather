import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CANADIAN_CITIES, getBrowserLocation, reverseGeocode, searchCity } from "@/lib/weather";
import { loadPrefs, savePrefs, defaultPrefs, type Prefs, type Commute } from "@/lib/preferences";
import { Snowflake, Thermometer, Flame, PersonStanding, Train, Car, Bike, Check, Locate, Search, Crown, Mail, User } from "lucide-react";

export const Route = createFileRoute("/preferences")({
  head: () => ({ meta: [
    { title: "Your preferences — WeatherWear AI" },
    { name: "description", content: "Tell us how you experience the weather so we can dress you for it." },
  ]}),
  component: Preferences,
});

function Preferences() {
  const [p, setP] = useState<Prefs>(defaultPrefs);
  const [saved, setSaved] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ name: string; lat: number; lon: number; country?: string; admin1?: string }[]>([]);
  const [locating, setLocating] = useState(false);
  useEffect(() => { setP(loadPrefs()); }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => { searchCity(q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    const next = { ...p, [k]: v };
    setP(next); savePrefs(next);
    setSaved(true); setTimeout(() => setSaved(false), 1200);
  }

  async function useGps() {
    setLocating(true);
    try {
      const { lat, lon } = await getBrowserLocation();
      const name = await reverseGeocode(lat, lon);
      update("city", { name, lat, lon });
    } catch {/* ignore */} finally { setLocating(false); }
  }

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Profile</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Make it yours</h1>
        <p className="mt-2 text-sm text-muted-foreground">We use this to fine-tune every recommendation.</p>
      </header>

      {/* Account / Premium */}
      <Section title="Account" subtitle="Your plan and login details.">
        <div className="space-y-3">
          <div className="glass-card flex items-center gap-3 rounded-2xl px-4 py-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-100 text-zinc-500">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Name</p>
              <p className="truncate text-sm font-medium">{p.name || "Not set"}</p>
            </div>
          </div>
          <div className="glass-card flex items-center gap-3 rounded-2xl px-4 py-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-100 text-zinc-500">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Email</p>
              <p className="truncate text-sm font-medium">{p.email || "Not set"}</p>
            </div>
          </div>
          {p.premium ? (
            <div className="glass-card flex items-center gap-3 rounded-2xl px-4 py-3 border-amber-200 bg-amber-50/60">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-600">
                <Crown className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Plan</p>
                <p className="truncate text-sm font-medium text-amber-800">Premium — free trial active</p>
              </div>
            </div>
          ) : (
            <Link
              to="/premium"
              className="glass-card flex items-center justify-between rounded-2xl px-4 py-3 transition-colors hover:bg-zinc-50"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-100 text-zinc-500">
                  <Crown className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Upgrade to Premium</p>
                  <p className="text-xs text-muted-foreground">$1/month — 7-day free trial</p>
                </div>
              </div>
              <span className="text-xs font-bold text-primary">Start trial</span>
            </Link>
          )}
        </div>
      </Section>

      <Section title="Temperature sensitivity" subtitle="How do you usually feel?">
        <Grid>
          <Choice active={p.coldSensitivity==="cold"} onClick={()=>update("coldSensitivity","cold")} icon={<Snowflake className="h-5 w-5" />} label="Get cold easily" />
          <Choice active={p.coldSensitivity==="normal"} onClick={()=>update("coldSensitivity","normal")} icon={<Thermometer className="h-5 w-5" />} label="Average" />
          <Choice active={p.coldSensitivity==="hot"} onClick={()=>update("coldSensitivity","hot")} icon={<Flame className="h-5 w-5" />} label="Run warm" />
        </Grid>
      </Section>

      <Section title="Your commute" subtitle="So we can warn you about your route.">
        <Grid cols={2}>
          {([
            ["walk", "Walking", PersonStanding],
            ["ttc", "Transit", Train],
            ["drive", "Driving", Car],
            ["cycle", "Cycling", Bike],
          ] as [Commute, string, any][]).map(([key, label, Icon]) => (
            <Choice key={key} active={p.commute===key} onClick={()=>update("commute", key)} icon={<Icon className="h-5 w-5" />} label={label} />
          ))}
        </Grid>
      </Section>

      <Section title="Your city" subtitle="Search any city, or use GPS for pinpoint accuracy.">
        <button
          onClick={useGps}
          disabled={locating}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-60"
        >
          <Locate className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
          {locating ? "Locating…" : "Use my current location"}
        </button>

        <div className="glass-card mb-3 flex items-center gap-2 rounded-2xl px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search city…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {results.length > 0 && (
          <div className="mb-3 space-y-2">
            {results.map((r) => (
              <button
                key={`${r.name}-${r.lat}-${r.lon}`}
                onClick={() => { update("city", { name: r.name, lat: r.lat, lon: r.lon }); setQ(""); setResults([]); }}
                className="glass-card flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm"
              >
                <span><span className="font-medium">{r.name}</span><span className="ml-1 text-xs text-muted-foreground">{[r.admin1, r.country].filter(Boolean).join(", ")}</span></span>
              </button>
            ))}
          </div>
        )}

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quick pick</p>
        <div className="grid grid-cols-2 gap-2">
          {CANADIAN_CITIES.map((c) => {
            const active = p.city?.name === c.name;
            return (
              <button
                key={c.name}
                onClick={() => update("city", c)}
                className={`glass-card flex items-center justify-between rounded-2xl px-4 py-3 text-sm transition-all ${active ? "ring-2 ring-primary text-primary" : ""}`}
              >
                <span className="font-medium">{c.name}</span>
                {active && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </Section>

      <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 transition-all ${saved ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}>
        <div className="glass-card flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-primary">
          <Check className="h-4 w-4" /> Saved
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 animate-fade-up">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  );
}
function Grid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-2 ${cols===2?"grid-cols-2":"grid-cols-3"}`}>{children}</div>;
}
function Choice({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`glass-card flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-xs font-medium transition-all active:scale-95 ${active ? "ring-2 ring-primary text-primary" : "text-foreground/80"}`}
    >
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}