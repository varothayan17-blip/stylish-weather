import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Section, Grid, Choice } from "@/components/FormControls";
import {
  loadPrefs,
  savePrefs,
  saveAndSyncPrefs,
  defaultPrefs,
  PREFS_KEY,
  FAV_KEY,
  type Prefs,
} from "@/lib/preferences";
import { applyTheme, type Theme } from "@/lib/theme";
import {
  Sun,
  Moon,
  MonitorSmartphone,
  ChevronRight,
  Crown,
  User,
  Snowflake,
  Thermometer,
  Flame,
  Check,
  RotateCcw,
  Info,
  Shield,
  FileText,
  HelpCircle,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Wethra" },
      { name: "description", content: "Appearance, account, and app settings." },
    ],
  }),
  component: Settings,
});

const SENSITIVITY_LABEL: Record<Prefs["coldSensitivity"], string> = {
  cold: "Gets cold easily",
  normal: "Average",
  hot: "Runs warm",
};
const COMMUTE_LABEL: Record<Prefs["commute"], string> = {
  walk: "Walking",
  ttc: "Transit",
  drive: "Driving",
  cycle: "Cycling",
};

function Settings() {
  const [p, setP] = useState<Prefs>(defaultPrefs);
  const [saved, setSaved] = useState(false);

  function syncPrefs() {
    setP(loadPrefs());
  }

  useEffect(() => {
    syncPrefs();
    // Re-read on tab/app focus so navigating to Settings after activating
    // premium shows the updated state without requiring a full page reload.
    window.addEventListener("focus", syncPrefs);
    document.addEventListener("visibilitychange", syncPrefs);
    return () => {
      window.removeEventListener("focus", syncPrefs);
      document.removeEventListener("visibilitychange", syncPrefs);
    };
  }, []);

  function setTheme(theme: Theme) {
    const next = { ...p, theme };
    setP(next);
    saveAndSyncPrefs(next);
    applyTheme(theme);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  function resetApp() {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Reset all Wethra data on this device? This clears your preferences and saved outfits.",
    );
    if (!ok) return;
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(FAV_KEY);
    window.location.href = "/welcome";
  }

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">App settings</h1>
      </header>

      <Section delay={100} title="Appearance" subtitle="Choose how Wethra looks on this device.">
        <Grid>
          <Choice
            active={p.theme === "light"}
            onClick={() => setTheme("light")}
            icon={<Sun className="h-5 w-5" />}
            label="Light"
          />
          <Choice
            active={p.theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={<Moon className="h-5 w-5" />}
            label="Dark"
          />
          <Choice
            active={p.theme === "system"}
            onClick={() => setTheme("system")}
            icon={<MonitorSmartphone className="h-5 w-5" />}
            label="System"
          />
        </Grid>
      </Section>

      <Section delay={150} title="Personalization" subtitle="How we tailor your recommendations.">
        <Link
          to="/preferences"
          className="glass-card flex items-center justify-between rounded-3xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              {p.coldSensitivity === "cold" ? (
                <Snowflake className="h-5 w-5" />
              ) : p.coldSensitivity === "hot" ? (
                <Flame className="h-5 w-5" />
              ) : (
                <Thermometer className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">
                {SENSITIVITY_LABEL[p.coldSensitivity]} · {COMMUTE_LABEL[p.commute]}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.city?.name ?? "No city set"} — tap to edit
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </Section>

      <Section delay={200} title="Account">
        {p.onboarded ? (
          <div className="glass-card flex items-center gap-3 rounded-3xl p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.name ?? "Wethra user"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {p.email ?? "No email on file"}
              </p>
            </div>
          </div>
        ) : (
          <Link
            to="/signup"
            className="glass-card flex items-center justify-between rounded-3xl p-4"
          >
            <span className="text-sm font-medium">Create a free account</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}
      </Section>

      <Section delay={250} title="Membership">
        <Link
          to="/premium"
          className="glass-card flex items-center justify-between rounded-3xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <span className="text-sm font-medium">
                {p.premium ? "Premium active" : "You're on the Free plan"}
              </span>
              {p.premium && p.trialEndsAt && (
                <p className="text-xs text-muted-foreground">
                  {Date.now() < p.trialEndsAt
                    ? `Trial ends ${new Date(p.trialEndsAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                    : "Trial expired"}
                </p>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </Section>

      <Section delay={300} title="About">
        <div className="glass-card overflow-hidden rounded-[2rem]">
          {[
            { to: "/about", icon: Info, label: "About Wethra" },
            { to: "/support", icon: HelpCircle, label: "Support & FAQ" },
            { to: "/privacy", icon: Shield, label: "Privacy Policy" },
            { to: "/terms", icon: FileText, label: "Terms of Service" },
          ].map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 border-b border-border/50 px-4 py-3.5 text-sm last:border-0 active:bg-foreground/5"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
        <div className="mt-2 px-1">
          <p className="text-xs text-muted-foreground/60">
            Version 1.0.0 · Built for Canadian weather · Open-Meteo weather data
          </p>
        </div>
        <button
          onClick={resetApp}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 py-3 text-sm font-medium text-destructive"
        >
          <RotateCcw className="h-4 w-4" /> Reset app data
        </button>
      </Section>

      <div
        className={`fixed bottom-24 left-1/2 -translate-x-1/2 transition-all ${saved ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}
      >
        <div className="glass-card flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-primary">
          <Check className="h-4 w-4" /> Saved
        </div>
      </div>
    </AppShell>
  );
}
