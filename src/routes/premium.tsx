import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { loadPrefs, savePrefs } from "@/lib/preferences";
import { useState } from "react";
import { Sparkles, Check, Shirt, Bell, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/premium")({
  head: () => ({ meta: [
    { title: "WeatherWear Premium — $1/month" },
    { name: "description", content: "Advanced AI outfit recommendations, wardrobe tracking, and daily push notifications." },
  ]}),
  component: Premium,
});

const features = [
  { icon: Shirt, title: "Wardrobe tracking", desc: "Log what you own — we'll pick from your closet, not a generic list." },
  { icon: Sparkles, title: "Advanced AI styling", desc: "Outfits tuned to color, occasion, and your week's calendar." },
  { icon: Bell, title: "Smart morning push", desc: "One notification at 7 AM with the only thing you need to know." },
  { icon: BarChart3, title: "Weekly trends", desc: "See how the week looks and plan laundry, packing, and travel." },
];

function Premium() {
  const navigate = useNavigate();
  const [activating, setActivating] = useState(false);

  function startTrial() {
    setActivating(true);
    const prefs = loadPrefs();
    if (!prefs.onboarded || !prefs.email) {
      navigate({ to: "/signup" });
      return;
    }
    savePrefs({ ...prefs, premium: true });
    setTimeout(() => {
      setActivating(false);
      navigate({ to: "/recommendation" });
    }, 500);
  }

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          <Sparkles className="h-3 w-3" /> Premium
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Dress smarter for <span className="text-gradient">$1/month</span>.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Unlock AI tailored to your wardrobe, calendar, and Canadian climate quirks.</p>
      </header>

      <div className="glass-card overflow-hidden rounded-[2rem] p-6 animate-fade-up delay-100">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-extralight tracking-tighter">$1</span>
          <span className="text-sm text-muted-foreground">/ month</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Cancel anytime. Free 7-day trial.</p>

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
          disabled={activating}
          className="mt-7 w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {activating ? "Activating…" : "Start free trial"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 animate-fade-up delay-200">
        {["No ads", "Cancel anytime", "Made in Canada"].map((t) => (
          <div key={t} className="glass-card flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center text-[11px] font-medium">
            <Check className="h-3.5 w-3.5 text-primary" /> {t}
          </div>
        ))}
      </div>
    </AppShell>
  );
}