/**
 * PreAuthQuestions — personalization questions collected BEFORE account creation.
 *
 * ISOLATION: reads/writes ONLY the dedicated "aeruvo:onboarding-draft:v1" key.
 * It NEVER touches "weatherwear:prefs" (PREFS_KEY). This prevents User B from
 * inheriting User A's preferences on a shared browser.
 *
 * After Firebase authentication, auth.ts reads the draft, applies only the
 * allowed fields (clothingProfile, coldSensitivity, commute, city) to the
 * new user's payload, and clears the draft after successful cloud persistence.
 *
 * For returning users (sign-in path), the draft is NOT applied — cloud wins.
 * The draft is preserved if authentication is cancelled or fails.
 *
 * draft.completed is set when the user taps "Continue to create your account".
 * It does NOT mean the user is authenticated or that onboarded=true is set.
 */
import { useState, useEffect } from "react";
import {
  CANADIAN_CITIES,
  getBrowserLocation,
  reverseGeocode,
  searchCity,
} from "@/lib/weather";
import { type Commute } from "@/lib/preferences";
import { PROFILES, type ClothingProfileId } from "@/lib/clothingProfiles";
import { getErrorMessage } from "@/lib/utils";
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/introState";
import { Section, Grid, Choice } from "@/components/FormControls";
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

interface Props {
  /** Called when the user taps "Continue to create your account". */
  onContinue: () => void;
  /** Called when the user taps "Back". */
  onBack: () => void;
}

export function PreAuthQuestions({ onContinue, onBack }: Props) {
  const [draft, setDraft] = useState<OnboardingDraft>(() =>
    typeof window !== "undefined" ? loadOnboardingDraft() : {},
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { name: string; lat: number; lon: number; country?: string; admin1?: string }[]
  >([]);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [cityError, setCityError] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      searchCity(q, draft.city?.countryCode, draft.city?.lat, draft.city?.lon)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, draft.city?.countryCode, draft.city?.lat, draft.city?.lon]);

  /**
   * Update the draft.
   * Writes ONLY to aeruvo:onboarding-draft:v1.
   * Never touches weatherwear:prefs.
   * Never sets onboarded.
   */
  function update(field: keyof OnboardingDraft, value: unknown) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    saveOnboardingDraft(next);
    if (field === "city") setCityError(false);
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

  function handleContinue() {
    if (!draft.city) {
      setCityError(true);
      document.getElementById("paq-city")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // Mark draft completed — afterSignIn will apply it for new accounts.
    // Does NOT set onboarded or grant any access.
    saveOnboardingDraft({ ...draft, completed: true });
    onContinue();
  }

  return (
    <div className="flex flex-col">
      <div className="animate-fade-up mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Step 4 of 4
        </p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Make it yours</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us how you experience the weather. You can change these any time.
        </p>
      </div>

      <Section delay={50} title="Clothing style" subtitle="We'll tailor recommendations to your wardrobe.">
        <Grid cols={3}>
          {(Object.values(PROFILES) as (typeof PROFILES)[ClothingProfileId][]).map((profile) => (
            <Choice
              key={profile.id}
              active={draft.clothingProfile === profile.id || (!draft.clothingProfile && profile.id === "neutral")}
              onClick={() => update("clothingProfile", profile.id)}
              icon={<span className="text-lg leading-none">{profile.emoji}</span>}
              label={profile.label}
            />
          ))}
        </Grid>
      </Section>

      <Section delay={100} title="Temperature sensitivity" subtitle="How do you usually feel?">
        <Grid>
          <Choice active={draft.coldSensitivity === "cold"}   onClick={() => update("coldSensitivity", "cold")}   icon={<Snowflake className="h-5 w-5" />}   label="Get cold easily" />
          <Choice active={draft.coldSensitivity === "normal" || !draft.coldSensitivity} onClick={() => update("coldSensitivity", "normal")} icon={<Thermometer className="h-5 w-5" />} label="Average" />
          <Choice active={draft.coldSensitivity === "hot"}    onClick={() => update("coldSensitivity", "hot")}    icon={<Flame className="h-5 w-5" />}         label="Run warm" />
        </Grid>
      </Section>

      <Section delay={150} title="Your commute" subtitle="So we can warn you about your route.">
        <Grid cols={2}>
          {(
            [
              ["walk",  "Walking", PersonStanding],
              ["ttc",   "Transit", Train],
              ["drive", "Driving", Car],
              ["cycle", "Cycling", Bike],
            ] as [Commute, string, LucideIcon][]
          ).map(([key, label, Icon]) => (
            <Choice
              key={key}
              active={draft.commute === key || (!draft.commute && key === "walk")}
              onClick={() => update("commute", key)}
              icon={<Icon className="h-5 w-5" />}
              label={label}
            />
          ))}
        </Grid>
      </Section>

      <div id="paq-city">
        <Section
          delay={200}
          title="Your city"
          subtitle="Required — choose a city so Aeruvo can fetch your local weather."
        >
          {cityError && (
            <p role="alert" className="mb-3 rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
          {gpsError && <p className="mb-3 text-xs text-destructive">{gpsError}</p>}

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
                    update("city", { name: r.name, lat: r.lat, lon: r.lon, ...(r.country ? { countryCode: r.country } : {}) });
                    setQ(""); setResults([]);
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

          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quick pick</p>
          <div className="grid grid-cols-2 gap-2">
            {CANADIAN_CITIES.map((c) => {
              const active = draft.city?.name === c.name;
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

      <div className="mt-2 mb-8 space-y-3">
        <button
          type="button"
          onClick={handleContinue}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-sm font-semibold text-background shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Continue to create your account
          <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onBack}
          className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Back
        </button>
      </div>
    </div>
  );
}
