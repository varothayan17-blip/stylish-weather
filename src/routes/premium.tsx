import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { fetchEntitlement } from "@/lib/entitlement";
import { billing } from "@/lib/billing";
import { getErrorMessage } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Sparkles, Check, Shirt, Bell, BarChart3 } from "lucide-react";
import type { EntitlementResult } from "@/lib/entitlement";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Aeruvo Premium — $1/month" },
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
  const [entitlement, setEntitlement] = useState<EntitlementResult>({ loading: true });
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Premium state comes exclusively from the Firestore entitlements subcollection.
    // localStorage and prefs.premium are NOT consulted — they are not authoritative.
    async function load() {
      const result = await fetchEntitlement();
      setEntitlement(result);
    }
    load();

    // Refresh on tab focus (user may have completed checkout in another tab)
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const isActive = !entitlement.loading && entitlement.active;

  async function startCheckout() {
    setActivating(true);
    setError(null);
    try {
      await billing.startCheckout();
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
          {!isActive ? <span className="text-gradient">$1/month</span> : null}
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
            <span className="text-5xl font-extralight tracking-tighter">$1</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Cancel anytime. Wardrobe AI coming soon.</p>

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
