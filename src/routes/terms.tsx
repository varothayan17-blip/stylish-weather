import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_CONFIG } from "@/lib/social";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: `Terms of Service — ${APP_CONFIG.name}` },
      { name: "description", content: "Terms of Service for Aeruvo." },
    ],
  }),
  component: Terms,
});

const LAST_UPDATED = "June 2025";

function Terms() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <Link to="/about" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed">
          <Section title="Acceptance">
            By using Aeruvo, you agree to these terms. If you do not agree, please do not use the
            app. These terms apply to the web app and any installed PWA version.
          </Section>

          <Section title="What Aeruvo provides">
            Aeruvo provides weather-based clothing recommendations. Recommendations are generated
            automatically from public weather data and predefined clothing logic. They are
            suggestions only — not professional advice. We make no guarantee that the
            recommendations will be suitable for your specific situation, health condition, or
            weather event.
          </Section>

          <Section title="Accuracy of weather data">
            Weather data is sourced from Open-Meteo (open-meteo.com), a free and open-source
            weather API. Air quality and aerosol data is sourced from the Open-Meteo Air Quality
            API, which uses data from the Copernicus Atmosphere Monitoring Service (CAMS). Aeruvo
            does not control the accuracy or availability of this data. Forecasts may be incorrect,
            delayed, or unavailable. Always use your own judgement before going outside, especially
            in severe weather or poor air quality conditions.
          </Section>

          <Section title="Account and data">
            Signing up with an email address creates a profile in our cloud database. You are
            responsible for providing an accurate email address. We use it solely to sync your
            preferences — we do not send marketing email. You may request deletion of your account
            at any time by emailing {APP_CONFIG.privacyEmail}.
          </Section>

          <Section title="Premium and billing">
            Premium features are available through a free trial and a paid subscription processed by
            Stripe, Inc. Subscription terms, pricing, and cancellation conditions are presented at
            the time of purchase. We reserve the right to change pricing with reasonable notice.
            Refunds are handled on a case-by-case basis — contact {APP_CONFIG.supportEmail}.
            <p className="mt-2 text-muted-foreground">
              <em>Note: Paid subscriptions are not yet active.</em>
            </p>
          </Section>

          <Section title="Acceptable use">
            You agree not to: reverse-engineer or scrape the app; use Aeruvo in a way that harms
            others; submit false information; or attempt to access other users' data.
          </Section>

          <Section title="Intellectual property">
            Aeruvo's name, logo, and content are property of the developer. Weather data is provided
            by Open-Meteo under their open license. Open-source libraries used are credited in the
            app's acknowledgements.
          </Section>

          <Section title="Limitation of liability">
            To the maximum extent permitted by applicable law, Aeruvo and its developers are not
            liable for any damages arising from use of the app, including but not limited to
            clothing choices made based on recommendations, inaccurate weather data, or service
            unavailability.
          </Section>

          <Section title="Governing law">
            These terms are governed by the laws of Ontario, Canada.
          </Section>

          <Section title="Changes">
            We may update these terms. Continued use after updates constitutes acceptance. We will
            update the "Last updated" date when changes are made.
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms:{" "}
              <a
                href={`mailto:${APP_CONFIG.supportEmail}`}
                className="text-primary underline underline-offset-2"
              >
                {APP_CONFIG.supportEmail}
              </a>
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-foreground">{title}</h2>
      <div className="text-foreground/75">{children}</div>
    </div>
  );
}
