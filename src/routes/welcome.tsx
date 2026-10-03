/**
 * /welcome — Aeruvo onboarding state machine
 *
 * Step sequence (no skip, no guest, no bypass):
 *   0 = Dress for where the day takes you  (WeatherDemoCard)
 *   1 = Comfort that feels personal        (ComfortDemoCard)
 *   2 = Wear what you already own          (WardrobeDemoCard)
 *   3 = Build your wardrobe your way       (ScanDemoCard, manual fallback)
 *   4 = Personalization questions    (PreAuthQuestions)
 *   → /signup?mode=create
 *
 * Returning users:
 *   "Already have an account? Sign in" → /signup?mode=signin  (every slide)
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
import { useEffect, useState, type ReactNode } from "react";

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
import { ComfortDemoCard } from "@/components/onboarding/ComfortDemoCard";
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

interface Slide {
  title: string;
  body: string;
  visual: ReactNode;
}

/**
 * Slide 4 uses the truthful manual fallback: scanner availability is a
 * server-side setting and onboarding makes no network calls, so AI scanning
 * cannot be safely advertised here.
 */
const SLIDES: Record<0 | 1 | 2 | 3, Slide> = {
  0: {
    title: "Dress for where the day takes you",
    body: "Home in the morning, campus in the afternoon, or out late at night—Aeruvo checks every time and place before suggesting what to wear and pack.",
    visual: <WeatherDemoCard />,
  },
  1: {
    title: "Comfort that feels personal",
    body: "Run cold or warm? Aeruvo combines your comfort, plans and changing conditions—not just one temperature.",
    visual: <ComfortDemoCard />,
  },
  2: {
    title: "Wear what you already own",
    body: "Build your wardrobe once. Aeruvo can recommend the exact item—and its saved reference photo—instead of a generic white T-shirt.",
    visual: <WardrobeDemoCard />,
  },
  3: {
    title: "Build your wardrobe your way",
    body: "Add clothing manually with details such as colour, warmth, style and weather fit.",
    visual: <ScanDemoCard variant="manual" />,
  },
};

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

  // ── Steps 0–3: four presentation slides from one typed config ───────────
  const slide = SLIDES[step];
  const isLast = step === 3;
  return (
    <OnboardingShell transitionKey={step} direction={direction === 1 ? "forward" : "back"}>
      <header className="animate-fade-up">
        {step === 0 && (
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            Aeruvo · Never guess what to wear again
          </p>
        )}
        <IntroProgress step={step + 1} total={4} />
        <h1 className="mt-4 text-[1.85rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl">
          {slide.title}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{slide.body}</p>
      </header>
      <div className="mt-5 animate-fade-up delay-100">{slide.visual}</div>
      {isLast ? (
        <IntroButtons
          primaryLabel="Get started"
          onPrimary={() => goToStep(4)}
          secondaryLabel="Already have an account? Sign in"
          onSecondary={goToSignIn}
          onBack={() => goToStep(2, -1)}
        />
      ) : (
        <IntroButtons
          primaryLabel="Continue"
          onPrimary={() => goToStep((step + 1) as Step)}
          secondaryLabel="Already have an account? Sign in"
          onSecondary={goToSignIn}
          onBack={step > 0 ? () => goToStep((step - 1) as Step, -1) : undefined}
        />
      )}
    </OnboardingShell>
  );
}
