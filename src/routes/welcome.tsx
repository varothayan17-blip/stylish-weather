/**
 * /welcome — Aeruvo onboarding state machine
 *
 * Step sequence (no skip, no guest, no bypass):
 *   0 = Landing      "Never guess what to wear again."
 *   1 = Plan for the whole day       (WeatherDemoCard)
 *   2 = Make your wardrobe useful    (WardrobeDemoCard)
 *   3 = Add clothing in seconds      (ScanDemoCard)
 *   4 = Personalization questions    (PreAuthQuestions)
 *   → /signup?mode=create
 *
 * Returning users:
 *   "Already have an account? Sign in" → /signup?mode=signin  (on step 0)
 *
 * Authenticated Firebase users are detected via onAuthStateChanged and
 * redirected to "/" immediately (no prefs.onboarded check).
 *
 * Step state persists in localStorage so refresh resumes correctly.
 * The personalization draft (city, preferences) is written to the shared
 * PREFS_KEY (without onboarded:true). afterSignIn() reads it automatically.
 *
 * SSR safe: all Firebase and localStorage access is inside useEffect.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, CloudSun, Shirt, MapPin } from "lucide-react";

import {
  loadIntro,
  markInProgress,
  clearObsoleteGuestMarker,
} from "@/lib/introState";

import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { IntroProgress } from "@/components/onboarding/IntroProgress";
import { IntroButtons } from "@/components/onboarding/IntroButtons";
import { WeatherDemoCard } from "@/components/onboarding/WeatherDemoCard";
import { WardrobeDemoCard } from "@/components/onboarding/WardrobeDemoCard";
import { ScanDemoCard } from "@/components/onboarding/ScanDemoCard";
import { PreAuthQuestions } from "@/components/onboarding/PreAuthQuestions";

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
  { icon: CloudSun, title: "Live local weather", desc: "Real wind chill, not just temperature." },
  { icon: Shirt, title: "Personalized outfit picks", desc: "Tuned to your commute and cold tolerance." },
  { icon: MapPin, title: "Made for your city", desc: "From Vancouver fog to Winnipeg windchill." },
];

type Step = 0 | 1 | 2 | 3 | 4;

function WelcomeRoute() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  // direction: 1 = forward (enter from right), -1 = back (enter from left)
  const [direction, setDirection] = useState<1 | -1>(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    // Clear any obsolete guest routing marker (safe: never deletes user data)
    clearObsoleteGuestMarker();

    // Use Firebase auth as authority — not localStorage.
    // If a Firebase user is already signed in, skip the onboarding entirely.
    import("@/lib/firebase").then(async ({ isFirebaseConfigured, getFirebaseAuth }) => {
      if (!isFirebaseConfigured() || cancelled) return;
      const fbAuth = await getFirebaseAuth();
      if (!fbAuth || cancelled) return;
      const { onAuthStateChanged } = await import("firebase/auth");
      let resolved = false;
      const timer = setTimeout(() => { resolved = true; }, 1500);
      const unsub = onAuthStateChanged(fbAuth, (user) => {
        if (resolved || cancelled) { unsub(); return; }
        resolved = true;
        clearTimeout(timer);
        unsub();
        if (user && !cancelled) navigate({ to: "/", replace: true });
      });
    }).catch(() => {});

    // Resume from saved step when in-progress.
    const intro = loadIntro();
    if (intro.status === "done") {
      // All screens completed — go to signup.
      navigate({ to: "/signup", search: { mode: "create" } });
      return () => { cancelled = true; };
    }
    if (intro.status === "in-progress") {
      setStep(Math.min(intro.step, 4) as Step);
    }
    // "new" or "skipped" (legacy) → start at step 0

    setReady(true);
    return () => { cancelled = true; };
  }, [navigate]);

  function goToStep(s: Step, dir: 1 | -1 = 1) {
    markInProgress(s);
    setDirection(dir);
    setStep(s);
  }

  /** Navigates to /signup in sign-in mode — bypasses new-user questions. */
  function goToSignIn() {
    navigate({ to: "/signup", search: { mode: "signin" } });
  }

  /**
   * After questions are answered (draft completed), navigate to signup.
   * markDone() is NOT called here — it is called in signup.tsx AFTER
   * successful Firebase authentication, so cancelled auth doesn't mark
   * the intro as done.
   */
  function goToSignup() {
    navigate({ to: "/signup", search: { mode: "create" } });
  }

  if (!ready) return null;

  // ── Step 4: Personalization questions (pre-auth) ───────────────────────────
  // Rendered inside OnboardingShell with scroll; questions component handles layout.
  if (step === 4) {
    return (
      <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
        <PreAuthQuestions
          onContinue={goToSignup}
          onBack={() => goToStep(3, -1)}
        />
      </OnboardingShell>
    );
  }

  // ── Step 0: Landing ────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <Sparkles aria-hidden className="h-3 w-3" />
            Aeruvo
          </span>
          <h1 className="mt-5 text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-foreground">
            Never guess <br />what to wear <br />
            <span className="text-gradient">again.</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Personal weather and wardrobe guidance for every day.
          </p>
        </div>

        <ul className="mt-8 space-y-3 animate-fade-up delay-100" role="list">
          {BENEFIT_ITEMS.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="glass-card flex items-start gap-4 rounded-3xl p-4">
              <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary" aria-hidden>
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
          <button type="button" onClick={() => goToStep(1)}
            className="press block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Get started — it's free
          </button>
          <button type="button" onClick={goToSignIn}
            className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Already have an account? Sign in
          </button>
        </div>
      </OnboardingShell>
    );
  }

  // ── Step 1: Plan for the whole day ─────────────────────────────────────────
  if (step === 1) {
    return (
      <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
        <div className="animate-fade-up">
          <IntroProgress step={1} total={4} />
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
            Plan for the whole day
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            See what to wear as conditions change — including rain, wind and how the temperature feels to you.
          </p>
        </div>
        <div className="mt-8 animate-fade-up delay-100"><WeatherDemoCard /></div>
        <IntroButtons
          primaryLabel="Continue"
          onPrimary={() => goToStep(2)}
          secondaryLabel="Already have an account? Sign in"
          onSecondary={goToSignIn}
        />
      </OnboardingShell>
    );
  }

  // ── Step 2: Make your wardrobe useful ─────────────────────────────────────
  if (step === 2) {
    return (
      <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
        <div className="animate-fade-up">
          <IntroProgress step={2} total={4} />
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
            Make your wardrobe useful
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Add clothing you already own and get recommendations using your own items.
          </p>
        </div>
        <div className="mt-8 animate-fade-up delay-100"><WardrobeDemoCard /></div>
        <IntroButtons
          primaryLabel="Continue"
          onPrimary={() => goToStep(3)}
          secondaryLabel="Already have an account? Sign in"
          onSecondary={goToSignIn}
        />
      </OnboardingShell>
    );
  }

  // ── Step 3: Add clothing in seconds ───────────────────────────────────────
  return (
    <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
      <div className="animate-fade-up">
        <IntroProgress step={3} total={4} />
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground">
          Add clothing in seconds
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Photograph one clothing item, review the suggested details and save it to your wardrobe.
        </p>
      </div>
      <div className="mt-8 animate-fade-up delay-100"><ScanDemoCard /></div>
      <div className="mt-auto pt-8 space-y-3">
        <button type="button" onClick={() => goToStep(4)}
          className="press block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          Continue
        </button>
        <button type="button" onClick={() => goToStep(2)}
          className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          Back
        </button>
      </div>
    </OnboardingShell>
  );
}
