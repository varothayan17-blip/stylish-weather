import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WeatherIcon } from "@/components/WeatherIcon";
import { RegretRiskCard } from "@/components/RegretRiskCard";
import { WeatherAlertCards } from "@/components/WeatherAlertCards";
import { ErrorState } from "@/components/ErrorState";
import {
  fetchWeather,
  CANADIAN_CITIES,
  dailyToWeather,
  getBrowserLocation,
  reverseGeocode,
  type Weather,
} from "@/lib/weather";
import {
  loadPrefs,
  savePrefs,
  saveFavorite,
  loadFavorites,
  safeUUID,
  type Prefs,
} from "@/lib/preferences";
import { cloudSync } from "@/lib/cloudSync";
import { getUid } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { recommend } from "@/lib/recommend";
import { computeRegretRisk } from "@/lib/regretRisk";
import { getWeatherAlerts } from "@/lib/alerts";
import { UMBRELLA_LABEL, UMBRELLA_ICON } from "@/lib/precipAdvice";
import {
  Wind,
  Droplets,
  Sun,
  Sunrise,
  Sunset,
  SprayCan,
  Heart,
  MapPin,
  Sparkles,
  AlertTriangle,
  Hand,
  Locate,
  Crown,
  RotateCw,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aeruvo — What to wear today" },
      {
        name: "description",
        content:
          "Personalized clothing recommendations for Canadians based on real-time weather, wind chill, and your commute.",
      },
      { property: "og:title", content: "Aeruvo" },
      { property: "og:description", content: "Know what to wear before you leave." },
    ],
  }),
  component: Home,
});

function computeGreeting(): { label: string; isNight: boolean } {
  const h = new Date().getHours();
  if (h < 6) return { label: "Good night", isNight: true };
  if (h < 12) return { label: "Good morning", isNight: false };
  if (h < 18) return { label: "Good afternoon", isNight: false };
  if (h < 21) return { label: "Good evening", isNight: false };
  return { label: "Good night", isNight: true }; // 9 PM+
}

/**
 * Format an ISO local-time string from Open-Meteo ("2026-07-07T05:42")
 * into a readable 12-hour clock string ("5:42 AM").
 * The string has no timezone suffix so we parse it literally — no Date
 * constructor which would apply the browser's own UTC offset.
 */
function formatSunTime(isoLocal: string): string {
  const timePart = isoLocal.slice(11, 16); // "05:42"
  const [hStr, mStr] = timePart.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const suffix = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Derive a human-readable day label from the date portion of an Open-Meteo
 * ISO local-time string, e.g. "2026-07-07T05:42" -> "Today" or "Tomorrow".
 * The date portion is sliced directly from the string (characters 0-9), so
 * no Date constructor or timezone conversion is needed.
 * Uses en-CA local date comparison to match how the rest of the app handles
 * Open-Meteo date strings.
 */
function sunDateLabel(isoLocal: string): string {
  const dateStr = isoLocal.slice(0, 10); // "2026-07-07"
  const todayStr = new Date().toLocaleDateString("en-CA"); // "2026-07-07"
  if (dateStr === todayStr) return "Today";
  // Tomorrow: compare to date + 1 day
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-CA");
  if (dateStr === tomorrowStr) return "Tomorrow";
  // Future days: show weekday name
  return new Date(dateStr + "T12:00").toLocaleDateString("en-CA", { weekday: "long" });
}

/**
 * Derive isDay from the API sunrise/sunset strings for the current moment.
 * Falls back to the API's own is_day flag if sun times are unavailable.
 * Compares fractional hours to avoid Date timezone pitfalls.
 */
function computeIsDay(apiIsDay: boolean, sunrise?: string, sunset?: string): boolean {
  if (!sunrise || !sunset) return apiIsDay;
  const toFrac = (s: string) => {
    const t = s.slice(11, 16);
    const [h, m] = t.split(":").map(Number);
    return h + m / 60;
  };
  const now = new Date().getHours() + new Date().getMinutes() / 60;
  return now >= toFrac(sunrise) && now < toFrac(sunset);
}

function Home() {
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [greeting, setGreeting] = useState<{ label: string; isNight: boolean }>({
    label: "Hello",
    isNight: false,
  });
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
        setError(null);
        const city = prefs!.city ?? CANADIAN_CITIES[0];
        const w = await fetchWeather(city.lat, city.lon, city.name);
        if (!cancelled) setWeather(w);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e, "Couldn't load weather"));
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [prefs, refreshTick]);

  function refresh() {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
  }

  async function locateMe() {
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
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't get location"));
    } finally {
      setLocating(false);
    }
  }

  // Auto-detect location on very first load (only if no city saved yet).
  // We use a ref so the effect has a stable, non-stale reference to locateMe
  // without needing to add it to deps (which would cause an infinite loop since
  // locateMe is recreated each render while prefs changes).
  const locateMeRef = useRef(locateMe);
  useEffect(() => {
    locateMeRef.current = locateMe;
  });
  useEffect(() => {
    if (prefs && !prefs.city) {
      locateMeRef.current();
    }
    // Only run when onboarded status changes — intentionally not including locateMe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.onboarded]);

  const rec = useMemo(
    () => (weather && prefs ? recommend(weather, prefs) : null),
    [weather, prefs],
  );
  const risk = useMemo(
    () => (weather && prefs && rec ? computeRegretRisk(weather, prefs, rec) : null),
    [weather, prefs, rec],
  );
  const alerts = useMemo(() => (weather ? getWeatherAlerts(weather) : []), [weather]);

  if (redirecting) return null;

  return (
    <AppShell>
      <header className="mb-6 flex items-center justify-between animate-fade-up">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {greeting.label}
          </p>
          {/* Personalized greeting — only rendered when the user has saved a name.
               greeting.label is already "Good morning" / "Good night" etc.
               Appending the name produces "Good morning, Varo." */}
          {prefs?.name?.trim() && (
            <p className="mt-0.5 text-sm font-medium text-foreground/80">
              {greeting.label}, {prefs.name.trim()}.
            </p>
          )}
          {greeting.isNight && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {/* Hero always shows current conditions — subtitle should match.
                  Evening (21:00+) vs late night / early morning (0–5) use
                  different wording but both describe the current moment. */}
              {new Date().getHours() < 6
                ? "Here's what the night looks like."
                : "Here's what the evening looks like."}
            </p>
          )}
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">Aeruvo</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/premium"
            className="glass-card grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary"
            title="Aeruvo Premium"
          >
            <Crown className="h-4 w-4" />
          </Link>
          <button
            onClick={locateMe}
            disabled={locating}
            className="glass-card flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium disabled:opacity-60"
            title="Use my GPS location"
          >
            {locating ? (
              <Locate className="h-3.5 w-3.5 text-primary animate-pulse" />
            ) : (
              <MapPin className="h-3.5 w-3.5 text-primary" />
            )}
            {locating ? "Locating…" : (weather?.city ?? "Use my location")}
          </button>
        </div>
      </header>

      {error && <ErrorState message={error} onRetry={refresh} />}

      {/* Hero weather card */}
      <section className="glass-card relative overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/25 blur-3xl"
        />
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
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-muted-foreground">{weather.condition}</p>
                  <button
                    onClick={refresh}
                    disabled={refreshing}
                    aria-label="Refresh weather"
                    className="-m-2.5 p-2.5 text-muted-foreground/70 disabled:opacity-60"
                  >
                    <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <div className="mt-1 flex items-baseline">
                  <span className="text-7xl font-extralight tracking-tighter tabular-nums">
                    {Math.round(weather.tempC)}
                  </span>
                  <span className="ml-1 text-2xl text-muted-foreground">°C</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Feels like{" "}
                  <span className="font-semibold text-foreground">
                    {Math.round(weather.feelsLikeC)}°
                  </span>
                </p>
              </div>
              <div className="text-primary animate-float">
                <WeatherIcon
                  code={weather.code}
                  isDay={computeIsDay(weather.isDay, weather.sunrise, weather.sunset)}
                  className="h-24 w-24"
                />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2">
              <Stat
                icon={<Droplets className="h-4 w-4" />}
                label="Rain"
                value={`${Math.round(weather.precipProb)}%`}
              />
              <Stat
                icon={<Wind className="h-4 w-4" />}
                label="Wind"
                value={`${Math.round(weather.windKph)} km/h`}
              />
              <Stat
                icon={<Sun className="h-4 w-4" />}
                label="UV"
                value={`${Math.round(weather.uv)}`}
              />
            </div>
          </div>
        )}
      </section>

      {/* Hourly strip */}
      {weather && (
        <section className="glass-card mt-4 rounded-3xl p-4 animate-fade-up delay-200">
          <div className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
            {weather.hourly.map((h, i) => {
              // Parse the hour directly from the time string ("2026-06-22T14:00")
              // instead of via new Date().getHours(). Open-Meteo returns times in the
              // forecast location's local timezone (timezone=auto), with no UTC offset
              // suffix. Using Date.getHours() is fragile: it depends on the JS runtime's
              // own timezone matching the forecast location's timezone, which is false for
              // a user in Vancouver checking Toronto weather, or for SSR on Cloudflare
              // Workers. Slicing the string is unambiguous regardless of any timezone.
              const label = i === 0 ? "Now" : `${parseInt(h.time.slice(11, 13), 10)}`;
              return (
                <div
                  key={h.time}
                  className="flex min-w-[52px] flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <WeatherIcon
                    code={h.code}
                    isDay={
                      // The "Now" slot (i === 0) uses the same sunrise/sunset comparison
                      // as the hero card, because Open-Meteo's hourly is_day flag marks
                      // an entire hour as daytime if any part of it overlaps with daylight.
                      // At 9:33 PM with sunset at 9:00 PM, the 21:00 slot is still
                      // is_day=1 in the API, but the current moment is clearly night.
                      // Future slots (i > 0) correctly represent their own hour and are
                      // left unchanged.
                      i === 0
                        ? computeIsDay(h.isDay, weather.sunrise, weather.sunset)
                        : h.isDay
                    }
                    className="h-5 w-5 text-primary"
                  />
                  <span className="font-semibold tabular-nums">{Math.round(h.tempC)}°</span>
                  <span className="text-[10px] text-primary/80">{h.precipProb}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sunrise & Sunset card */}
      {weather?.sunrise && weather?.sunset && (
        <section className="glass-card mt-4 rounded-3xl p-4 animate-fade-up delay-200">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Sun Today
          </p>
          <div className="grid grid-cols-2 divide-x divide-border/50">
            <div className="flex flex-col items-center gap-1 pr-4">
              <Sunrise className="h-6 w-6 text-primary" aria-hidden />
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Sunrise
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {sunDateLabel(weather.sunrise)}
              </p>
              <p className="text-base font-semibold tabular-nums">
                {formatSunTime(weather.sunrise)}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 pl-4">
              <Sunset className="h-6 w-6 text-primary" aria-hidden />
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Sunset
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {sunDateLabel(weather.sunset)}
              </p>
              <p className="text-base font-semibold tabular-nums">
                {formatSunTime(weather.sunset)}
              </p>
            </div>
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

            {/* Tiered umbrella advice — replaces the old boolean chip.
                Visible directly on the Home screen so users never miss it. */}
            {rec.umbrellaLevel > 0 && UMBRELLA_LABEL[rec.umbrellaLevel] && (
              <div className="mt-4 flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <span className="mt-0.5 shrink-0 text-base leading-none">
                  {UMBRELLA_ICON[rec.umbrellaLevel]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug text-foreground/90">
                    {UMBRELLA_LABEL[rec.umbrellaLevel]}
                  </p>
                  {rec.rainTiming && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{rec.rainTiming}</p>
                  )}
                </div>
              </div>
            )}

            {/* Sunscreen advice — shown for UV >= 3 */}
            {rec.sunscreenAdvice && (
              <div className="mt-4 flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <SprayCan className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug text-foreground/90">
                    {rec.sunscreenAdvice}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    UV index: {Math.round(weather.uv)}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
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
                // Guard: already animating from this session
                if (saved) return;

                try {
                  const today = new Date().toDateString();
                  const existing = loadFavorites();

                  // BUG FIX: previous check was `title === headline && round(tempC) === round(tempC)`.
                  // This treated any two saves with the same temp and headline — even on
                  // different days — as duplicates. A morning save on Monday and a
                  // morning save on Tuesday with identical weather would block the second.
                  // Fix: duplicate = same title + rounded temp + same calendar day.
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

                  // BUG FIX: crypto.randomUUID() throws on iOS < 15.4 with no error
                  // boundary. The whole handler silently failed. safeUUID() provides
                  // a fallback UUID-shaped string for older devices.
                  const fav = {
                    id: safeUUID(),
                    title: rec.headline,
                    items: rec.outfit,
                    tempC: weather.tempC,
                    condition: weather.condition,
                    savedAt: Date.now(),
                  };

                  saveFavorite(fav);

                  // Sync to Firestore using the real Firebase Auth uid
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
      )}

      {risk && (
        <section className="mt-4 animate-fade-up delay-300">
          <RegretRiskCard risk={risk} />
        </section>
      )}

      <WeatherAlertCards alerts={alerts} />

      {/* Tomorrow at a glance — shown after 9 PM when the user is planning for next day */}
      {greeting.isNight &&
        weather &&
        weather.daily.length > 1 &&
        prefs &&
        (() => {
          const tomorrow = weather.daily[1];
          const tomorrowW = dailyToWeather(tomorrow, weather.city);
          const tomorrowRec = recommend(tomorrowW, prefs);
          const rainNote =
            tomorrow.precipProb >= 30
              ? `${Math.round(tomorrow.precipProb)}% chance of rain`
              : "Dry day expected";
          // One-line clothing preview: first outfit item only
          const clothingHint = tomorrowRec.outfit[0] ?? "";
          return (
            <section className="glass-card mt-4 rounded-[2rem] p-5 animate-fade-up">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Tomorrow at a glance
              </p>
              <div className="mt-3 flex items-center gap-4">
                <WeatherIcon
                  code={tomorrow.code}
                  isDay={true}
                  className="h-9 w-9 shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tabular-nums">
                    {Math.round(tomorrow.tempMaxC)}° /{" "}
                    <span className="font-normal text-muted-foreground">
                      {Math.round(tomorrow.tempMinC)}°
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{rainNote}</p>
                </div>
              </div>
              {clothingHint && (
                <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-foreground/75">
                  {tomorrowRec.headline.split(" — ")[0]}
                  {tomorrowRec.umbrella ? " — bring an umbrella." : "."}
                </p>
              )}
            </section>
          );
        })()}
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-foreground/5 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
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
