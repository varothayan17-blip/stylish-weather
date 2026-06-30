import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { loadPrefs, type Prefs } from "@/lib/preferences";
import { billing } from "@/lib/billing";
import { getErrorMessage } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Sparkles, Check, Shirt, Bell, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Wethra Premium — $1/month" },
      {
        name: "description",
        content:
          "Advanced AI outfit recommendations, wardrobe tracking, and daily push notifications.",
      },
    ],
  }),
  component: Premium,
});

const features = [
  {
    icon: Shirt,
    title: "Wardrobe tracking",
    desc: "Log what you own — we'll pick from your closet, not a generic list.",
  },
  {
    icon: Sparkles,
    title: "Advanced AI styling",
    desc: "Outfits tuned to color, occasion, and your week's calendar.",
  },
  {
    icon: Bell,
    title: "Smart morning push",
    desc: "One notification at 7 AM with the only thing you need to know.",
  },
  {
    icon: BarChart3,
    title: "Weekly trends",
    desc: "See how the week looks and plan laundry, packing, and travel.",
  },
];

function syncPrefs(): Prefs {
  return loadPrefs();
}

function Premium() {
  const navigate = useNavigate();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(syncPrefs);

  // Re-read prefs on mount AND whenever the tab regains focus.
  // Without this, navigating away and back via the bottom nav
  // keeps React's stale useState value — the button would show
  // "Start free trial" even after a trial was already activated.
  useEffect(() => {
    function refresh() {
      setPrefs(syncPrefs());
    }
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const isActive = prefs.premium === true;
  const trialExpired = isActive && prefs.trialEndsAt != null && Date.now() > prefs.trialEndsAt;
  const trialDaysLeft =
    isActive && prefs.trialEndsAt != null && !trialExpired
      ? Math.ceil((prefs.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

  async function startTrial() {
    setActivating(true);
    setError(null);
    try {
      await billing.startCheckout();
      setPrefs(syncPrefs());
      navigate({ to: "/" });
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't start checkout"));
    } finally {
      setActivating(false);
    }
  }

  // Button state — three distinct cases with correct disabled behavior
  const buttonLabel = activating
    ? "Activating…"
    : trialExpired
      ? "Renew subscription"
      : isActive
        ? trialDaysLeft != null
          ? `✓ Trial active — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
          : "✓ Premium active"
        : "Start free trial";

  // Disable the button when the trial is genuinely active so the user cannot
  // accidentally click it and reset their 7-day window. Also disable during
  // the async startTrial() call to prevent double-submission.
  const buttonDisabled = activating || (isActive && !trialExpired);

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          <Sparkles className="h-3 w-3" /> Premium
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          {isActive && !trialExpired ? "You're a member." : "Dress smarter for "}
          {!isActive || trialExpired ? <span className="text-gradient">$1/month</span> : null}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isActive && !trialExpired
            ? "Your premium trial is active. All features are unlocked."
            : "Unlock AI tailored to your wardrobe, calendar, and Canadian climate quirks."}
        </p>
      </header>

      {/* ── Active member card ─────────────────────────────────── */}
      {isActive && !trialExpired ? (
        <div className="animate-fade-up space-y-3 delay-100">
          <div className="glass-card rounded-[2rem] p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold">Premium active</p>
                {trialDaysLeft != null && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} remaining in your free trial
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t border-border/60 pt-5">
              {features.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Disabled button — makes it clear no action is needed */}
            <button
              disabled
              className="mt-6 w-full rounded-2xl bg-primary/10 py-3.5 text-sm font-semibold text-primary opacity-80"
            >
              ✓ Trial active — no action needed
            </button>

            <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
              Trial status syncs across your devices when you sign in.
            </p>
          </div>
        </div>
      ) : (
        /* ── Upgrade card (free / expired users) ─────────────── */
        <div className="glass-card overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extralight tracking-tighter">$1</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Cancel anytime. Free 7-day trial.</p>

          {error && <p className="mt-3 text-xs leading-relaxed text-destructive">{error}</p>}

          <ul className="mt-6 space-y-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={startTrial}
            disabled={buttonDisabled}
            className="mt-7 w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
          >
            {buttonLabel}
          </button>

          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Trial status syncs across your devices when you sign in.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 animate-fade-up delay-200">
        {["No ads", "Cancel anytime", "Made in Canada"].map((t) => (
          <div
            key={t}
            className="glass-card flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center text-[11px] font-medium"
          >
            <Check className="h-3.5 w-3.5 text-primary" /> {t}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
