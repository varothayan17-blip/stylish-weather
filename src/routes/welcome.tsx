/**
 * /welcome — Aeruvo introductory onboarding experience
 *
 * Four screens driven by a single step state (0–3):
 *   0 = Welcome         (brand hero + benefits)
 *   1 = Plan for the whole day  (weather timeline demo)
 *   2 = Make your wardrobe useful  (wardrobe preview)
 *   3 = Add clothing in seconds    (scan feature preview)
 *
 * ── Navigation rules ─────────────────────────────────────────────────────────
 * • Existing onboarded users are redirected to "/" immediately on mount.
 * • Users who skipped/done intro but not yet onboarded go to "/signup".
 * • Step state (status + step) is persisted in localStorage so refresh
 *   mid-tour resumes at the exact screen the user left.
 * • "Continue as guest": sets onboarded=true FIRST, then navigates using the
 *   same city-presence logic as the auth sign-in flow:
 *     city set   → "/"
 *     no city    → "/preferences"
 *   This prevents a redirect loop when preferences sets the city and the
 *   user taps the Today tab (BottomNav → "/" → onboarded=true → renders).
 * • "Skip introduction" marks skipped and goes to "/signup".
 * • Google redirect result is processed on every mount via getGoogleRedirectResult.
 *
 * ── SSR safety ───────────────────────────────────────────────────────────────
 * All localStorage/window access is inside useEffect or SSR-guarded.
 * No browser globals are accessed at module scope.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, CloudSun, Shirt, MapPin } from "lucide-react";

import { loadPrefs, savePrefs } from "@/lib/preferences";
import { loadIntro, markInProgress, markSkipped, markDone, guestDestination, markGuestSetupPending } from "@/lib/introState";
import { getGoogleRedirectResult } from "@/lib/auth";

import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { IntroProgress } from "@/components/onboarding/IntroProgress";
import { IntroButtons } from "@/components/onboarding/IntroButtons";
import { WeatherDemoCard } from "@/components/onboarding/WeatherDemoCard";
import { WardrobeDemoCard } from "@/components/onboarding/WardrobeDemoCard";
import { ScanDemoCard } from "@/components/onboarding/ScanDemoCard";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Aeruvo" },
      { name: "description", content: "Personal weather and wardrobe guidance for every day." },
    ],
  }),
  component: WelcomeRoute,
});

const BENEFIT_ITEMS = [
  {
    icon: CloudSun,
    title: "Live local weather",
    desc: "Real wind chill, not just temperature.",
  },
  {
    icon: Shirt,
    title: "Personalized outfit picks",
    desc: "Tuned to your commute and cold tolerance.",
  },
  {
    icon: MapPin,
    title: "Made for your city",
    desc: "From Vancouver fog to Winnipeg windchill.",
  },
];

function WelcomeRoute() {
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Existing onboarded users → home immediately, skip intro entirely.
    const prefs = loadPrefs();
    if (prefs.onboarded) {
      navigate({ to: "/" });
      return;
    }

    // 2. Process any pending Google OAuth redirect result (fires when returning
    //    from the Google sign-in page). Errors are handled inside auth.ts.
    getGoogleRedirectResult().catch(() => {});

    // 3. Check intro state. Skipped/done (but not yet onboarded) → signup.
    const intro = loadIntro();
    if (intro.status === "skipped" || intro.status === "done") {
      navigate({ to: "/signup" });
      return;
    }

    // 4. Resume from saved step when in-progress.
    if (intro.status === "in-progress") {
      const s = Math.min(intro.step, 3) as 0 | 1 | 2 | 3;
      setStep(s);
    }
    // status === "new" → stays at step 0 (welcome)

    setReady(true);
  }, [navigate]);

  /** Advance to a screen and persist the exact step to localStorage. */
  function goToStep(s: 0 | 1 | 2 | 3) {
    markInProgress(s);
    setStep(s);
  }

  /** Skip introduction → /signup without creating an account. */
  function skipToSignup() {
    markSkipped();
    navigate({ to: "/signup" });
  }

  /** Final Continue on screen 3 → mark done and go to signup. */
  function finishToSignup() {
    markDone();
    navigate({ to: "/signup" });
  }

  /**
   * "Continue as guest" — enter the app without creating an account.
   *
   * Two paths depending on whether the guest already has a city:
   *
   * Path A — city already saved (e.g. returning guest, GPS already used):
   *   • Mark intro done.
   *   • Set onboarded=true (home renders immediately without redirect).
   *   • Navigate to "/".
   *
   * Path B — no city yet (brand-new guest):
   *   • Mark intro done.
   *   • Do NOT set onboarded=true yet (guest hasn't completed required setup).
   *   • Mark guest setup as pending (persisted to localStorage).
   *   • Navigate to "/preferences".
   *   • /preferences will show "Save and continue" and set onboarded=true
   *     only after the guest picks a city.
   *   • The home route checks for pending guest setup and redirects to
   *     /preferences (not /welcome) so a refresh doesn't loop.
   *
   * All existing local wardrobe items, favourites, saved outfits and other
   * preferences are preserved — we only add/change what's necessary.
   */
  function continueAsGuest() {
    markDone();
    const prefs = loadPrefs();

    if (prefs.city) {
      // Path A: city exists — full onboarding complete
      savePrefs({ ...prefs, onboarded: true as const });
      navigate({ to: "/" });
    } else {
      // Path B: no city — preferences required before onboarding is complete
      markGuestSetupPending();
      // Do NOT set onboarded=true here. /preferences will do it on completion.
      navigate({ to: "/preferences" });
    }
  }

  // Render nothing while determining the correct screen (avoids flash).
  if (!ready) return null;

  // ── Screen 0: Welcome ──────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <OnboardingShell>
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <Sparkles aria-hidden className="h-3 w-3" />
            Aeruvo
          </span>
          <h1 className="mt-5 text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-foreground">
            Never guess <br />
            what to wear <br />
            <span className="text-gradient">again.</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Personal weather and wardrobe guidance for every day.
          </p>
        </div>

        <ul className="mt-8 space-y-3 animate-fade-up delay-100" role="list">
          {BENEFIT_ITEMS.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="glass-card flex items-start gap-4 rounded-3xl p-4">
              <div
                className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"
                aria-hidden
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-semibold text-foreground">{title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-8 space-y-3 animate-fade-up delay-200">
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="press block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Get started — it's free
          </button>
          <button
            type="button"
            onClick={continueAsGuest}
            className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Continue as guest
          </button>
        </div>
      </OnboardingShell>
    );
  }

  // ── Screen 1: Plan for the whole day ──────────────────────────────────────
  if (step === 1) {
    return (
      <OnboardingShell>
        <div className="animate-fade-up">
          <IntroProgress step={1} />
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
            Plan for the whole day
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            See what to wear as conditions change — including rain, wind and how the
            temperature feels to you.
          </p>
        </div>

        <div className="mt-8 animate-fade-up delay-100">
          <WeatherDemoCard />
        </div>

        <IntroButtons
          primaryLabel="Continue"
          onPrimary={() => goToStep(2)}
          secondaryLabel="Skip introduction"
          onSecondary={skipToSignup}
        />
      </OnboardingShell>
    );
  }

  // ── Screen 2: Make your wardrobe useful ───────────────────────────────────
  if (step === 2) {
    return (
      <OnboardingShell>
        <div className="animate-fade-up">
          <IntroProgress step={2} />
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
            Make your wardrobe useful
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Add clothing you already own and get recommendations using your own items.
          </p>
        </div>

        <div className="mt-8 animate-fade-up delay-100">
          <WardrobeDemoCard />
        </div>

        <IntroButtons
          primaryLabel="Continue"
          onPrimary={() => goToStep(3)}
          secondaryLabel="Skip introduction"
          onSecondary={skipToSignup}
        />
      </OnboardingShell>
    );
  }

  // ── Screen 3: Add clothing in seconds ─────────────────────────────────────
  return (
    <OnboardingShell>
      <div className="animate-fade-up">
        <IntroProgress step={3} />
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
          Add clothing in seconds
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Photograph one clothing item, review the suggested details and save it to
          your wardrobe.
        </p>
      </div>

      <div className="mt-8 animate-fade-up delay-100">
        <ScanDemoCard />
      </div>

      <div className="mt-auto pt-8 space-y-3">
        <button
          type="button"
          onClick={finishToSignup}
          className="press block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => goToStep(2)}
          className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Back
        </button>
      </div>
    </OnboardingShell>
  );
}
