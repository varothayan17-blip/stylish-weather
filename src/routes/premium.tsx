import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEntitlement } from "@/lib/entitlement";
import { billing } from "@/lib/billing";
import { getErrorMessage } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Sparkles, Check, Shirt, Bell, BarChart3 } from "lucide-react";
import { loadPrefs } from "@/lib/preferences";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Aeruvo Premium — CA$2.99/month" },
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

function Premium() {
  // useEntitlement: waits for Auth to settle, re-fetches on focus,
  // never hangs. localStorage and prefs.premium are NOT consulted.
  const entitlement = useEntitlement();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = !entitlement.loading && entitlement.active;
  // Detect return from Stripe checkout — do NOT grant Premium from URL param.
  // The webhook writes the entitlement; useEntitlement() will reflect it once
  // Firestore updates (may take a few seconds after checkout completes).
  const searchParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const checkoutStatus = searchParams.get("checkout") as "success" | "cancelled" | null;

  async function startCheckout() {
    setActivating(true);
    setError(null);
    try {
      // Pass email for display in Stripe checkout (not for identity).
      // The server uses the Firebase Auth token to establish identity.
      const email = loadPrefs().email ?? "";
      await billing.startCheckout(email);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't start checkout"));
    } finally {
      setActivating(false);
    }
  }

  const buttonLabel = activating ? "Loading…" : isActive ? "✓ Premium active" : "Upgrade to Premium";
  const buttonDisabled = activating || isActive || entitlement.loading;

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          <Sparkles className="h-3 w-3" /> Premium
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          {isActive ? "You're a member." : "Dress smarter for "}
          {!isActive ? <span className="text-gradient">CA$2.99/month</span> : null}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isActive
            ? "Your premium subscription is active. All features are unlocked."
            : "Unlock AI tailored to your wardrobe, calendar, and Canadian climate quirks."}
        </p>
      </header>

      {/* ── Active member card ─────────────────────────────────── */}
      {isActive && !entitlement.loading && entitlement.active ? (
        <div className="animate-fade-up space-y-3 delay-100">
          <div className="glass-card rounded-[2rem] p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold">Premium active</p>
                {entitlement.entitlement.trialEnd && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Trial ends {new Date(entitlement.entitlement.trialEnd).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
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

            <button
              disabled
              className="mt-6 w-full rounded-2xl bg-primary/10 py-3.5 text-sm font-semibold text-primary opacity-80"
            >
              ✓ Premium active — no action needed
            </button>
          </div>
        </div>
      ) : (
        /* ── Upgrade card (free users) ─────────────────────── */
        <div className="glass-card overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extralight tracking-tighter">CA$2.99</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Cancel anytime. Wardrobe AI coming soon.</p>

          {checkoutStatus === "success" && !isActive && (
            <p className="mt-3 text-xs leading-relaxed text-green-600">
              Payment received — activating your subscription… (may take a few seconds)
            </p>
          )}
          {checkoutStatus === "cancelled" && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Checkout cancelled. You can try again below.
            </p>
          )}
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
            onClick={startCheckout}
            disabled={buttonDisabled}
            className="mt-7 w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
          >
            {buttonLabel}
          </button>

          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Secure checkout. Powered by Stripe.
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
