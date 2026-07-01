import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_CONFIG } from "@/lib/social";
import { ArrowLeft, Mail, ChevronDown } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: `Support — ${APP_CONFIG.name}` },
      { name: "description", content: "Get help with Aeruvo." },
    ],
  }),
  component: Support,
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "How does Aeruvo decide what to recommend?",
    a: "Aeruvo fetches real-time weather for your location — temperature, feels-like temperature, wind speed, precipitation probability, and current conditions. It then applies a clothing recommendation engine that considers your cold/heat sensitivity and commute type. The engine prioritizes the feels-like temperature, not the raw thermometer reading, because wind chill and humidity affect what you actually feel outside.",
  },
  {
    q: "Why does the umbrella recommendation sometimes appear when it looks clear?",
    a: "The umbrella recommendation is based on the next 4 hours of precipitation probability, not just the current moment. If there is a 50%+ chance of rain arriving within the next few hours, Aeruvo flags it so you can bring an umbrella when you leave — not only when it is already raining.",
  },
  {
    q: "What is the Regret Risk score?",
    a: "Regret Risk estimates how likely you are to regret your outfit choice by the end of the day. It factors in the wind-chill gap, precipitation uncertainty, temperature swing across the day, and how close the temperature sits to a boundary between two outfit categories. A high score means conditions are tricky and a single outfit may not cover the full day.",
  },
  {
    q: "Why are my preferences not restoring on a new device?",
    a: "To sync your data across devices, you need to sign in with the same email address you used on your original device. Go to Settings → Account and enter your name and email. Aeruvo will restore your preferences, premium status, and saved outfits from the cloud.",
  },
  {
    q: "What is Premium?",
    a: "Premium is a 7-day free trial that unlocks planned features including wardrobe-aware recommendations, smart morning push notifications, and extended weekly outfit planning. Full billing is not yet active — tapping 'Start free trial' activates a demo trial that syncs across your devices.",
  },
  {
    q: "How do saved outfits work?",
    a: "Tap 'Save this outfit' on any recommendation. The outfit is saved locally on your device and, if you are signed in, synced to your cloud profile. You can view saved outfits in the Saved tab. The same outfit can only be saved once per calendar day — re-tapping the button on the same day will not create a duplicate.",
  },
  {
    q: "Does Aeruvo work offline?",
    a: "The app shell (all screens, navigation, and saved data) is cached by the service worker and loads instantly without an internet connection. Weather data and recommendations require a live internet connection — they cannot be generated from cached data because forecasts update continuously.",
  },
  {
    q: "How does Aeruvo use my location?",
    a: "Location is used only to fetch weather for your area. Your GPS coordinates are sent to Open-Meteo (the weather provider) to retrieve the current forecast. Aeruvo does not store your location on its servers. You can also set a city manually in Preferences without granting location permission.",
  },
  {
    q: "How do I delete my account?",
    a: `To clear all local data, go to Settings → Reset app data. To delete your cloud profile (your Firestore document), email ${APP_CONFIG.privacyEmail} with your email address and we will remove it within 5 business days.`,
  },
  {
    q: "Why does the weather feel inaccurate for my city?",
    a: "Aeruvo uses Open-Meteo, a high-resolution open-source weather model. For best results, use 'Use my location' on the Home screen or search for your specific neighbourhood in Preferences. Large cities can have different microclimates — a city-wide forecast may not reflect your exact street.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 py-4 text-left text-sm"
        aria-expanded={open}
      >
        <span className="font-medium leading-snug">{q}</span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{a}</p>}
    </div>
  );
}

function Support() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <Link to="/about" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Answers to common questions, and a way to reach us.
          </p>
        </header>

        {/* Contact card */}
        <div className="glass-card mb-6 rounded-[2rem] p-5">
          <p className="text-sm font-medium">Need more help?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We read every message and usually reply within 1–2 business days.
          </p>
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background"
          >
            <Mail className="h-4 w-4" />
            Email support
          </a>
        </div>

        {/* FAQ */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Frequently asked questions
          </h2>
          <div className="glass-card rounded-[2rem] px-5">
            {FAQ.map((item) => (
              <FaqItem key={item.q} {...item} />
            ))}
          </div>
        </section>

        {/* Legal links */}
        <div className="mt-6 flex justify-center gap-6 text-xs text-muted-foreground/70">
          <Link to="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          <Link to="/terms" className="underline underline-offset-2">
            Terms of Service
          </Link>
        </div>
      </main>
    </div>
  );
}
