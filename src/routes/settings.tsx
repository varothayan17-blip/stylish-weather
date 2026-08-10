import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Section, Grid, Choice } from "@/components/FormControls";
import {
  loadPrefs,
  savePrefs,
  saveAndSyncPrefs,
  defaultPrefs,
  PREFS_KEY,
  FAV_KEY,
  NOTIF_DISMISSED_KEY,
  NOTIFICATIONS_ENABLED,
  buildNotificationPrefs,
  type Prefs,
  type NotificationPrefs,
} from "@/lib/preferences";
import { cloudSync } from "@/lib/cloudSync";
import { getUid } from "@/lib/auth";
import { orchestrateEnable, orchestrateDisable } from "@/lib/notifications";
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
  Bell,
  Clock,
  Globe,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Aeruvo" },
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

  // ── Notification preferences state ──────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifSaved, setNotifSaved] = useState(false);
  // Track the detected local timezone once on mount
  const detectedTz = useRef<string>(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC",
  );

  function syncPrefs() {
    setP(loadPrefs());
  }

  const loadNotifPrefs = useCallback(async () => {
    const uid = await getUid();
    if (!uid) return;
    try {
      const np = await cloudSync.pullNotificationPrefs(uid);
      setNotifPrefs(np);
    } catch {
      // Non-fatal — UI shows current local state
    }
  }, []);

  useEffect(() => {
    syncPrefs();
    loadNotifPrefs();
    // Re-read on tab/app focus so navigating to Settings after activating
    // premium shows the updated state without requiring a full page reload.
    window.addEventListener("focus", syncPrefs);
    document.addEventListener("visibilitychange", syncPrefs);
    return () => {
      window.removeEventListener("focus", syncPrefs);
      document.removeEventListener("visibilitychange", syncPrefs);
    };
  }, []);

  async function saveNotifPrefs(next: NotificationPrefs) {
    setNotifLoading(true);
    setNotifError(null);
    try {
      const uid = await getUid();
      if (!uid) throw new Error("Sign in to save notification settings.");
      await cloudSync.syncNotificationPrefs(uid, next);
      setNotifPrefs(next);
      // When the user enables via Settings, also clear the discovery card dismissal
      // so the card reflects current state (it checks notifPrefs?.enabled).
      if (next.enabled) {
        localStorage.setItem(NOTIF_DISMISSED_KEY, "true"); // keep card hidden
      }
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 1500);
    } catch (e) {
      setNotifError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setNotifLoading(false);
    }
  }

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
      "Reset all Aeruvo data on this device? This clears your preferences and saved outfits.",
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

      <Section delay={100} title="Appearance" subtitle="Choose how Aeruvo looks on this device.">
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
              <p className="truncate text-sm font-medium">{p.name ?? "Aeruvo user"}</p>
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

      {NOTIFICATIONS_ENABLED && <Section delay={270} title="Notifications" subtitle="Control morning rain reminders.">
        <div className="glass-card overflow-hidden rounded-[2rem]">
          {/* Toggle row */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Rain reminders</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Morning alert when meaningful rain is expected later today.
              </p>
            </div>
            {/* Toggle */}
            <button
              role="switch"
              aria-checked={notifPrefs?.enabled ?? false}
              aria-label="Rain reminders"
              disabled={notifLoading}
              onClick={async () => {
                const current = notifPrefs;
                const willEnable = !(current?.enabled ?? false);
                const tz = detectedTz.current;

                if (willEnable) {
                  // Toggle ON: orchestrateEnable handles permission, FID,
                  // device record, and notificationPrefs atomically with rollback.
                  setNotifLoading(true);
                  setNotifError(null);
                  try {
                    const uid = await getUid();
                    if (!uid) throw new Error("Sign in to enable reminders.");
                    const result = await orchestrateEnable(uid, current);
                    if (!result.ok) {
                      // errorCode identifies the exact failing step.
                      // SW_READY_TIMEOUT = serviceWorker.ready hung (10s)
                      // FID_TIMEOUT = SW ready but onRegistered never fired (15s)
                      // REGISTER_FAILED = register() threw (check console)
                      setNotifError(
                        result.reason === "denied"
                          ? `Notifications blocked — enable in Settings app. (${result.errorCode})`
                          : result.reason === "unsupported"
                          ? `Browser doesn't support reminders yet. (${result.errorCode})`
                          : result.reason === "dismissed"
                          ? `Permission dismissed — tap again to retry. (${result.errorCode})`
                          : `Could not enable reminders. (${result.errorCode})`
                      );
                      // Do NOT return — fall through to finally so loading clears.
                    } else {
                      // Refresh from Firestore after full success
                      const uid2 = await getUid();
                      if (uid2) {
                        const updated = await cloudSync.pullNotificationPrefs(uid2).catch(() => null);
                        if (updated) setNotifPrefs(updated);
                      }
                      setNotifSaved(true);
                      setTimeout(() => setNotifSaved(false), 1500);
                    }
                  } catch (e) {
                    setNotifError(`Could not save. (UNEXPECTED: ${e instanceof Error ? e.message : String(e)})`);
                  } finally {
                    setNotifLoading(false);
                  }
                } else {
                  // Toggle OFF: orchestrateDisable handles prefs-first (server-safe)
                  // then device deletion, then best-effort unregister.
                  if (!current) return;
                  const uid3 = await getUid();
                  if (!uid3) { setNotifError("Not signed in."); return; }
                  setNotifLoading(true);
                  setNotifError(null);
                  try {
                    const next = await orchestrateDisable(uid3, current);
                    setNotifPrefs(next);
                    setNotifSaved(true);
                    setTimeout(() => setNotifSaved(false), 1500);
                  } catch (e) {
                    setNotifError(e instanceof Error ? e.message : "Could not disable reminders.");
                  } finally {
                    setNotifLoading(false);
                  }
                }
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                (notifPrefs?.enabled ?? false)
                  ? "bg-primary"
                  : "bg-foreground/20"
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  (notifPrefs?.enabled ?? false) ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Reminder time — only when enabled */}
          {notifPrefs?.enabled && (
            <>
              <div className="border-t border-border/40 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Reminder time</p>
                    <p className="text-xs text-muted-foreground">When to check for rain in the morning.</p>
                  </div>
                  {/* Native time input — works on iOS Safari without extra dependencies */}
                  <input
                    type="time"
                    aria-label="Reminder time"
                    value={`${String(notifPrefs.reminderHour).padStart(2, "0")}:${String(notifPrefs.reminderMinute).padStart(2, "0")}`}
                    onChange={async (e) => {
                      const [hStr, mStr] = e.target.value.split(":");
                      const h = parseInt(hStr, 10);
                      const m = parseInt(mStr, 10);
                      if (isNaN(h) || isNaN(m)) return;
                      const tz = detectedTz.current;
                      const desired = {
                        enabled: notifPrefs.enabled,
                        timezone: tz,
                        reminderHour: h,
                        reminderMinute: m,
                      };
                      // buildNotificationPrefs no-ops if nothing changed
                      const next = buildNotificationPrefs(notifPrefs, desired);
                      if (next.schedulingVersion === notifPrefs.schedulingVersion) return;
                      await saveNotifPrefs(next);
                    }}
                    className="rounded-xl border border-border bg-background px-2.5 py-1.5 text-sm font-medium tabular-nums accent-primary"
                  />
                </div>
              </div>

              {/* Timezone row */}
              <div className="border-t border-border/40 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Timezone</p>
                    <p className="truncate text-xs text-muted-foreground">{notifPrefs.timezone}</p>
                  </div>
                  {/* Auto-update button shown only when detected tz differs from stored */}
                  {notifPrefs.timezone !== detectedTz.current && (
                    <button
                      onClick={async () => {
                        const tz = detectedTz.current;
                        const next = buildNotificationPrefs(notifPrefs, {
                          enabled: notifPrefs.enabled,
                          timezone: tz,
                          reminderHour: notifPrefs.reminderHour,
                          reminderMinute: notifPrefs.reminderMinute,
                        });
                        await saveNotifPrefs(next);
                      }}
                      className="shrink-0 rounded-xl border border-primary/30 px-2.5 py-1 text-xs font-medium text-primary active:bg-primary/10"
                    >
                      Update
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Error + saved feedback */}
        {notifError && (
          <p className="mt-2 px-1 text-xs text-destructive">{notifError}</p>
        )}
        {notifSaved && !notifError && (
          <p className="mt-2 px-1 text-xs text-primary font-medium">Saved.</p>
        )}
        {!p.onboarded && (
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            <Link to="/signup" className="underline">Create a free account</Link> to enable reminders.
          </p>
        )}
      </Section>}

      <Section delay={300} title="About">
        <div className="glass-card overflow-hidden rounded-[2rem]">
          {[
            { to: "/about", icon: Info, label: "About Aeruvo" },
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
            Version 1.0.0 · Built for Canadian weather · Weather: Open-Meteo · Air quality: Open-Meteo / CAMS
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
