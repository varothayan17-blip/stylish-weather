import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_CONFIG, SOCIAL } from "@/lib/social";
import { ExternalLink, Instagram, Shield, FileText, Mail, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: `About — ${APP_CONFIG.name}` },
      { name: "description", content: APP_CONFIG.tagline },
    ],
  }),
  component: About,
});

function About() {
  const activeSocials = Object.values(SOCIAL).filter((s) => s.url !== null);

  return (
    <div className="relative min-h-screen isolate overflow-x-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/3 h-80 w-80 rounded-full bg-primary/20 blur-3xl animate-float" />
      </div>

      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        {/* Header */}
        <div className="mb-8 animate-fade-up text-center">
          <div className="mx-auto mb-4 h-20 w-20 overflow-hidden rounded-[22px] shadow-lg">
            <img src="/icon-192.png" alt="Wethra logo" className="h-full w-full object-cover" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{APP_CONFIG.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Version {APP_CONFIG.version}</p>
        </div>

        {/* Mission */}
        <section className="glass-card mb-4 rounded-[2rem] p-6 animate-fade-up delay-100">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Mission
          </h2>
          <p className="leading-relaxed text-foreground/90">{APP_CONFIG.tagline}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Wethra combines real-time weather data with a clothing recommendation engine built for
            Canadian commuters — students, transit riders, cyclists, and anyone who has ever stepped
            outside underdressed.
          </p>
        </section>

        {/* Values */}
        <section className="glass-card mb-4 rounded-[2rem] p-6 animate-fade-up delay-150">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Values
          </h2>
          <ul className="space-y-2.5 text-sm">
            {[
              ["Honest", "We only show what we know. No fake confidence."],
              ["Calm", "Clear advice, not noise. One thing to know before you leave."],
              ["Reliable", "Real weather data, real local conditions, real recommendations."],
              ["Private", "Your data stays yours. We collect only what we need."],
            ].map(([name, desc]) => (
              <li key={name} className="flex gap-3">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary translate-y-1.5" />
                <span>
                  <span className="font-medium">{name} — </span>
                  <span className="text-muted-foreground">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Follow */}
        {activeSocials.length > 0 && (
          <section className="glass-card mb-4 rounded-[2rem] p-6 animate-fade-up delay-200">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Follow Wethra
            </h2>
            <div className="space-y-2">
              {activeSocials.map((s) => (
                <a
                  key={s.label}
                  href={s.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-2xl bg-foreground/5 px-4 py-3 text-sm transition-colors active:bg-foreground/10"
                >
                  <div className="flex items-center gap-3">
                    <Instagram className="h-4 w-4 text-primary" />
                    <span>
                      <span className="font-medium">{s.label}</span>{" "}
                      <span className="text-muted-foreground">{s.handle}</span>
                    </span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Links */}
        <section className="glass-card mb-4 rounded-[2rem] p-2 animate-fade-up delay-250">
          {[
            { to: "/privacy", icon: Shield, label: "Privacy Policy" },
            { to: "/terms", icon: FileText, label: "Terms of Service" },
            { to: "/support", icon: HelpCircle, label: "Support & FAQ" },
          ].map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm transition-colors active:bg-foreground/5"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{label}</span>
              <span className="text-muted-foreground">›</span>
            </Link>
          ))}
        </section>

        {/* Contact */}
        <section className="animate-fade-up delay-300 text-center">
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Mail className="h-4 w-4" />
            {APP_CONFIG.supportEmail}
          </a>
        </section>

        {/* Acknowledgements */}
        <section className="mt-6 animate-fade-up delay-300 text-center">
          <p className="text-xs text-muted-foreground/60">
            Weather data by{" "}
            <a
              href="https://open-meteo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Open-Meteo
            </a>
            . Built with care in Canada.
          </p>
        </section>
      </main>
    </div>
  );
}
