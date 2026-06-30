import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_CONFIG } from "@/lib/social";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${APP_CONFIG.name}` },
      { name: "description", content: "How Wethra handles your data." },
    ],
  }),
  component: Privacy,
});

const LAST_UPDATED = "June 2025";

function Privacy() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <Link to="/about" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/85">
          <Section title="Overview">
            Wethra is a weather and clothing recommendation app. This policy explains what data we
            collect, how we use it, and your rights. We collect only what is necessary to provide
            recommendations and sync your preferences across devices.
          </Section>

          <Section title="Data we collect">
            <ul className="mt-2 space-y-2">
              <Li>
                <strong>Name and email address</strong> — entered voluntarily during sign-up. Used
                to identify your profile in our cloud database so your settings sync across devices.
              </Li>
              <Li>
                <strong>Location</strong> — requested when you tap "Use my location." We use your
                GPS coordinates to fetch local weather. We do not store your location on our
                servers.
              </Li>
              <Li>
                <strong>Preferences</strong> — your city, commute type, temperature sensitivity, and
                theme. Stored locally on your device and, if you signed in, synced to our cloud
                database linked to your email address.
              </Li>
              <Li>
                <strong>Saved outfits</strong> — outfit recommendations you choose to save. Stored
                locally and, if you signed in, synced to our cloud database.
              </Li>
              <Li>
                <strong>Premium status and trial dates</strong> — whether you have an active free
                trial and when it expires. Stored locally and synced to your cloud profile.
              </Li>
            </ul>
          </Section>

          <Section title="Data we do not collect">
            <ul className="mt-2 space-y-2">
              <Li>Passwords — Wethra does not use password-based authentication.</Li>
              <Li>
                Payment information — payments are processed by Stripe. We do not see or store card
                numbers.
              </Li>
              <Li>Device identifiers, advertising IDs, or tracking pixels.</Li>
              <Li>Contacts, photos, calendar, or any data outside the app.</Li>
              <Li>Background location when the app is closed.</Li>
            </ul>
          </Section>

          <Section title="Cloud storage (Firebase / Firestore)">
            If you choose to sign in, your preferences and saved outfits are stored in Google
            Firebase Firestore, a cloud database provided by Google LLC. Your profile document is
            identified by your normalized email address. Data is stored on Google servers and is
            subject to{" "}
            <a
              href="https://firebase.google.com/support/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Google's Privacy Policy
            </a>
            .
            <p className="mt-2 text-muted-foreground">
              If you do not sign in, no data leaves your device.
            </p>
          </Section>

          <Section title="Weather data">
            Weather data is fetched from{" "}
            <a
              href="https://open-meteo.com/en/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Open-Meteo
            </a>{" "}
            using your geographic coordinates. Open-Meteo is a free, open-source weather API. We
            send only your latitude and longitude to retrieve the forecast — no name or account
            information is included in that request.
          </Section>

          <Section title="Payments (Stripe)">
            Premium subscriptions are processed by Stripe, Inc. When you subscribe, you are directed
            to Stripe's hosted checkout page. We receive a confirmation from Stripe that your
            payment was successful — we do not receive or store your card details. Stripe's privacy
            policy: stripe.com/privacy.
            <p className="mt-2 text-muted-foreground">
              <em>
                Note: Paid subscriptions are not yet active. This section applies once billing is
                enabled.
              </em>
            </p>
          </Section>

          <Section title="Data retention">
            Your cloud profile (if you signed in) is retained until you request deletion. Local
            device data is stored in your browser's localStorage and is cleared when you clear site
            data or uninstall the app.
          </Section>

          <Section title="Your rights">
            <ul className="mt-2 space-y-2">
              <Li>
                <strong>Access</strong> — you can view your stored preferences in the Preferences
                and Settings screens.
              </Li>
              <Li>
                <strong>Deletion</strong> — tap Settings → Reset app data to clear all local data.
                To delete your cloud profile, email us at {APP_CONFIG.privacyEmail}.
              </Li>
              <Li>
                <strong>Portability</strong> — your data is simple key-value preferences. We can
                provide a copy on request.
              </Li>
            </ul>
          </Section>

          <Section title="Children">
            Wethra is not directed at children under 13. We do not knowingly collect data from
            children.
          </Section>

          <Section title="Changes to this policy">
            We will post updates here with a new "Last updated" date. Continued use of Wethra after
            changes constitutes acceptance of the updated policy.
          </Section>

          <Section title="Contact">
            <p>
              Privacy questions:{" "}
              <a
                href={`mailto:${APP_CONFIG.privacyEmail}`}
                className="text-primary underline underline-offset-2"
              >
                {APP_CONFIG.privacyEmail}
              </a>
            </p>
            <p className="mt-1">
              General support:{" "}
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

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
      <span>{children}</span>
    </li>
  );
}
