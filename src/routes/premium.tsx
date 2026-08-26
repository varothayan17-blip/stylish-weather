import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEntitlement } from "@/lib/entitlement";
import { billing, AlreadySubscribedError } from "@/lib/billing";
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  SUBSCRIPTION_DISCLOSURE,
} from "@/lib/policyVersions";
import { getErrorMessage } from "@/lib/utils";
import { useState } from "react";
import { Sparkles, Check, Shirt, Bell, BarChart3, Settings } from "lucide-react";
import { loadPrefs } from "@/lib/preferences";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "Aeruvo Premium — 7 days free, then CA$2.99/month" },
      {
        name: "description",
        content:
          "7-day free trial, then CA$2.99/month. Advanced AI outfit recommendations, wardrobe tracking, and daily push notifications.",
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

function fmt(ms: number) {
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function Premium() {
  const entitlement = useEntitlement();
  const [activating, setActivating]           = useState(false);
  const [portalLoading, setPortalLoading]     = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  // Set true when the server returns 409 — distinct from generic errors.
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  // Consent checkbox: must be ticked before checkout is enabled.
  const [consentAccepted, setConsentAccepted]     = useState(false);

  const isActive = !entitlement.loading && entitlement.active;
  const ent = !entitlement.loading && entitlement.active ? entitlement.entitlement : null;
  const isTrialing      = ent?.status === "trialing";
  const willCancel      = ent?.cancelAtPeriodEnd === true;
  const periodEndMs     = ent?.currentPeriodEnd ?? 0;

  const searchParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const checkoutStatus = searchParams.get("checkout") as "success" | "cancelled" | null;

  async function startCheckout() {
    setActivating(true);
    setError(null);
    setAlreadySubscribed(false);
    try {
      const email = loadPrefs().email ?? "";
      await billing.startCheckout(email, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION);
    } catch (e) {
      if (e instanceof AlreadySubscribedError) {
        // 409: server confirmed existing subscription — show Manage prompt.
        setAlreadySubscribed(true);
      } else {
        setError(getErrorMessage(e, "Couldn't start checkout"));
      }
    } finally {
      setActivating(false);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    setError(null);
    try {
      // POST /api/create-portal-session — requires Firebase ID token.
      // Server resolves Stripe customer ID; never trusts any client-supplied ID.
      await billing.openCustomerPortal();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't open billing portal"));
    } finally {
      setPortalLoading(false);
    }
  }

  const checkoutButtonLabel = activating ? "Loading…" : "Start free trial";

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          <Sparkles className="h-3 w-3" /> Premium
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          {isActive ? "You're a member." : "Dress smarter,"}
          {!isActive ? <><br /><span className="text-gradient">starting free.</span></> : null}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isActive
            ? "Your premium subscription is active. All features are unlocked."
            : "Unlock AI tailored to your wardrobe, calendar, and Canadian climate quirks."}
        </p>
      </header>

      {/* ── Active member card ─────────────────────────────────────── */}
      {isActive && ent ? (
        <div className="animate-fade-up space-y-3 delay-100">
          <div className="glass-card rounded-[2rem] p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold">
                  {isTrialing ? "Free trial active" : "Premium active"}
                </p>
                {isTrialing && periodEndMs > 0 && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Trial ends {fmt(periodEndMs)}
                  </p>
                )}
                {!isTrialing && willCancel && periodEndMs > 0 && (
                  <p className="mt-0.5 text-sm text-amber-600">
                    Plan ends {fmt(periodEndMs)} — access until then
                  </p>
                )}
                {!isTrialing && !willCancel && periodEndMs > 0 && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Renews {fmt(periodEndMs)}
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

            {error && (
              <p className="mt-4 text-xs leading-relaxed text-destructive">{error}</p>
            )}

            {/* Manage subscription — opens Stripe Customer Portal server-side */}
            <button
              onClick={openPortal}
              disabled={portalLoading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3.5 text-sm font-semibold transition-transform active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
            >
              <Settings className="h-4 w-4" />
              {portalLoading ? "Opening portal…" : "Manage subscription"}
            </button>
          </div>
        </div>

      ) : (
        /* ── Upgrade card (free / loading) ─────────────────────── */
        <div className="glass-card overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
          {/* Pricing */}
          <div>
            <p className="text-2xl font-semibold">7 days free</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              then CA$2.99/month — cancel anytime
            </p>
          </div>

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

          {/* 409: already subscribed — targeted message instead of generic error */}
          {alreadySubscribed && (
            <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
              <p className="font-medium text-foreground">
                You already have an active subscription.
              </p>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {portalLoading ? "Opening…" : "Manage subscription"}
              </button>
            </div>
          )}

          {!alreadySubscribed && (
            <div className="mt-6 space-y-4">
              {/* ── Recurring-payment disclosure + consent ─────────────────── */}
              <div className="rounded-2xl border border-border bg-card/60 p-4 text-xs leading-relaxed text-foreground/75">
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary"
                    aria-label="Accept subscription terms"
                  />
                  <span>
                    {SUBSCRIPTION_DISCLOSURE}{" "}
                    By checking this box you confirm you have read and agree to the{" "}
                    <Link to="/terms" className="text-primary underline underline-offset-2">Terms of Service</Link>
                    {" "}and{" "}
                    <Link to="/privacy" className="text-primary underline underline-offset-2">Privacy Policy</Link>.
                  </span>
                </label>
              </div>
              <button
                onClick={startCheckout}
                disabled={activating || entitlement.loading || !consentAccepted}
                className="w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
              >
                {checkoutButtonLabel}
              </button>
            </div>
          )}

          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Secure checkout via Stripe. No credit card charged during trial.
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
