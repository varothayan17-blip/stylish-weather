import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CANADIAN_CITIES, getBrowserLocation, reverseGeocode, searchCity } from "@/lib/weather";
import {
  loadPrefs,
  savePrefs,
  saveAndSyncPrefs,
  defaultPrefs,
  type Prefs,
  type Commute,
} from "@/lib/preferences";
import { PROFILES, type ClothingProfileId } from "@/lib/clothingProfiles";
import { getErrorMessage } from "@/lib/utils";
import {
  Snowflake,
  Thermometer,
  Flame,
  PersonStanding,
  Train,
  Car,
  Bike,
  Check,
  Locate,
  Search,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Section, Grid, Choice } from "@/components/FormControls";
import { isFirstSetupPending, clearFirstSetupPending } from "@/lib/introState";
import { useAuthGuard } from "@/lib/useAuthGuard";

export const Route = createFileRoute("/preferences")({
  head: () => ({
    meta: [
      { title: "Your preferences — Aeruvo" },
      {
        name: "description",
        content: "Tell us how you experience the weather so we can dress you for it.",
      },
    ],
  }),
  component: Preferences,
});

function Preferences() {
  const navigate = useNavigate();
  const [p, setP] = useState<Prefs>(defaultPrefs);
  const [saved, setSaved] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { name: string; lat: number; lon: number; country?: string; admin1?: string }[]
  >([]);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  /**
   * isFirstSetup: true only when a guest is mid-setup (has not yet been
   * marked onboarded). Computed once on mount from localStorage.
   *
   * When true: show "Save and continue" button at the bottom.
   *            Completing it sets onboarded=true and clears pending state.
   * When false: existing user editing preferences — show normal behaviour
   *             with the floating "Saved" toast only.
   *
   * This distinction is intentional: every visit to /preferences by an
   * already-onboarded user must behave as normal editing, not first-time
   * setup, to satisfy requirement 4.
   */
  const { authLoading, uid: authUid } = useAuthGuard();
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [completeCityError, setCompleteCityError] = useState(false);

  useEffect(() => {
    const prefs = loadPrefs();
    setP(prefs);
    // Read pending state exactly once on mount.
    // isGuestSetupPending() checks localStorage; it is safe to call here.
    setIsFirstSetup(!!authUid && isFirstSetupPending(authUid));
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchCity(q, p.city?.countryCode, p.city?.lat, p.city?.lon)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, p.city?.countryCode, p.city?.lat, p.city?.lon]);

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    const next = { ...p, [k]: v };
    setP(next);
    saveAndSyncPrefs(next);
    if (!isFirstSetup) {
      // Only show the floating toast for existing users editing preferences.
      // First-setup users see the "Save and continue" button instead.
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    }
    // Clear the city error whenever the city changes
    if (k === "city") setCompleteCityError(false);
  }

  async function useGps() {
    setLocating(true);
    setGpsError(null);
    try {
      const { lat, lon } = await getBrowserLocation();
      const name = await reverseGeocode(lat, lon);
      update("city", { name, lat, lon });
    } catch (e) {
      setGpsError(getErrorMessage(e, "Couldn't get your location"));
    } finally {
      setLocating(false);
    }
  }

  /**
   * Complete first-time setup.
   *
   * Called only when isFirstSetup === true (guest mid-setup).
   * Requires a valid city. Sets onboarded=true, clears the pending flag,
   * then navigates to home. No default city is silently substituted.
   */
  function completeSetup() {
    if (!p.city) {
      setCompleteCityError(true);
      // Scroll city section into view
      document.getElementById("city-section")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // Set onboarded=true now that the guest has a real city
    const completed: Prefs = { ...p, onboarded: true };
    savePrefs(completed);
    if (authUid) clearFirstSetupPending(authUid);
    navigate({ to: "/" });
  }

  if (authLoading) return null;

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {isFirstSetup ? "Almost there" : "Profile"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Make it yours</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isFirstSetup
            ? "Choose your city to get started. The other settings can be changed any time."
            : "We use this to fine-tune every recommendation."}
        </p>
      </header>

      <Section
        delay={100}
        title="Clothing style"
        subtitle="We'll tailor recommendations to your wardrobe."
      >
        <Grid cols={3}>
          {(Object.values(PROFILES) as (typeof PROFILES)[ClothingProfileId][]).map((profile) => (
            <Choice
              key={profile.id}
              active={
                p.clothingProfile === profile.id || (!p.clothingProfile && profile.id === "neutral")
              }
              onClick={() => update("clothingProfile", profile.id)}
              icon={<span className="text-lg leading-none">{profile.emoji}</span>}
              label={profile.label}
            />
          ))}
        </Grid>
      </Section>

      <Section delay={150} title="Temperature sensitivity" subtitle="How do you usually feel?">
        <Grid>
          <Choice
            active={p.coldSensitivity === "cold"}
            onClick={() => update("coldSensitivity", "cold")}
            icon={<Snowflake className="h-5 w-5" />}
            label="Get cold easily"
          />
          <Choice
            active={p.coldSensitivity === "normal"}
            onClick={() => update("coldSensitivity", "normal")}
            icon={<Thermometer className="h-5 w-5" />}
            label="Average"
          />
          <Choice
            active={p.coldSensitivity === "hot"}
            onClick={() => update("coldSensitivity", "hot")}
            icon={<Flame className="h-5 w-5" />}
            label="Run warm"
          />
        </Grid>
      </Section>

      <Section delay={200} title="Your commute" subtitle="So we can warn you about your route.">
        <Grid cols={2}>
          {(
            [
              ["walk", "Walking", PersonStanding],
              ["ttc", "Transit", Train],
              ["drive", "Driving", Car],
              ["cycle", "Cycling", Bike],
            ] as [Commute, string, LucideIcon][]
          ).map(([key, label, Icon]) => (
            <Choice
              key={key}
              active={p.commute === key}
              onClick={() => update("commute", key)}
              icon={<Icon className="h-5 w-5" />}
              label={label}
            />
          ))}
        </Grid>
      </Section>

      <div id="city-section">
      <Section
        delay={250}
        title="Your city"
        subtitle={
          isFirstSetup
            ? "Required — choose a city so Aeruvo can fetch your local weather."
            : "Search any city, or use GPS for pinpoint accuracy."
        }
      >
        {completeCityError && (
          <p className="mb-3 rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            Please choose a city before continuing.
          </p>
        )}

        <button
          onClick={useGps}
          disabled={locating}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-60"
        >
          <Locate className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
          {locating ? "Locating…" : "Use my current location"}
        </button>
        {gpsError && <p className="mb-3 text-xs leading-relaxed text-destructive">{gpsError}</p>}

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
                onClick={() => {
                  update("city", {
                    name: r.name,
                    lat: r.lat,
                    lon: r.lon,
                    ...(r.country ? { countryCode: r.country } : {}),
                  });
                  setQ("");
                  setResults([]);
                }}
                className="glass-card flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    {[r.admin1, r.country].filter(Boolean).join(", ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Quick pick
        </p>
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

      </div>

      {/* ── First-setup completion button ── */}
      {isFirstSetup && (
        <div className="mb-8 mt-6 animate-fade-up">
          <button
            type="button"
            onClick={completeSetup}
            disabled={!p.city}
            aria-disabled={!p.city}
            className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-sm font-semibold text-background shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Save and continue
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
          {!p.city && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Choose a city above to continue.
            </p>
          )}
        </div>
      )}

      {/* Floating "Saved" toast — only for existing users editing preferences */}
      {!isFirstSetup && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 transition-all ${saved ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}
        >
          <div className="glass-card flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-primary">
            <Check className="h-4 w-4" /> Saved
          </div>
        </div>
      )}
    </AppShell>
  );
}
