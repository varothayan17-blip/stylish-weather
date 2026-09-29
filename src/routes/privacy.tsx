import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_CONFIG } from "@/lib/social";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${APP_CONFIG.name}` },
      { name: "description", content: "How Aeruvo handles your data." },
    ],
  }),
  component: Privacy,
});

const LAST_UPDATED = "2026-08-26";
const EFFECTIVE_DATE = "2026-08-26";

/*
 * OWNER ACTION REQUIRED — before Live launch:
 *
 * 1. ANTHROPIC DATA RETENTION (section "AI wardrobe analysis — Anthropic Claude"):
 *    Verify the data-retention statement against Anthropic's current documentation
 *    (platform.claude.com/docs/en/manage-claude/api-and-data-retention) and your
 *    account's Data Processing Addendum before enabling the AI scanner.
 *
 * 2. LEGAL REVIEW — age and consent:
 *    Have a Canadian lawyer confirm (PIPEDA / Quebec Law 25) whether the 15+ age
 *    gate and self-attestation flow satisfy applicable requirements before enabling
 *    AI scanning for users under 18.
 *
 * 3. VERCEL LOG RETENTION:
 *    Verify the actual log-retention period for your Vercel plan/configuration
 *    and replace the placeholder in the Vercel section.
 *
 * 4. BREACH HANDLING:
 *    Add any internal breach-detection/notification procedure you have in place.
 */

function Privacy() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <Link to="/about" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Effective: {EFFECTIVE_DATE} · Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/85">
          <Section title="Who we are">
            Aeruvo is operated by <strong>Varothayan Arumairatnam, operating as Aeruvo</strong>.
            Privacy questions:{" "}
            <a
              href={`mailto:${APP_CONFIG.privacyEmail}`}
              className="text-primary underline underline-offset-2"
            >
              {APP_CONFIG.privacyEmail}
            </a>
            .
          </Section>

          <Section title="Overview">
            <p>
              Aeruvo is a weather and clothing recommendation app. This policy explains what
              personal information we collect, why, who we share it with, and your rights. We
              collect only what is necessary to deliver the service.
            </p>
            <p className="mt-2">If you do not sign in, no personal data leaves your device.</p>
          </Section>

          <Section title="Minimum age">
            {/*
              ⚠️ LEGAL REVIEW REQUIRED before public launch.
              The age thresholds below reflect the product's intended audience and
              Anthropic's guidelines for serving minors. A Canadian lawyer familiar with
              PIPEDA and Quebec Law 25 should confirm these thresholds and whether any
              additional parental-consent mechanism is required before the AI scanner
              is enabled for users under 18.
            */}
            <p>
              Aeruvo is intended for users aged 13 and older for general access, subject to
              applicable local consent requirements. We do not knowingly collect personal
              information from children under 13. If you believe a person under 13 has submitted
              data, contact us at{" "}
              <a
                href={`mailto:${APP_CONFIG.privacyEmail}`}
                className="text-primary underline underline-offset-2"
              >
                {APP_CONFIG.privacyEmail}
              </a>
              .
            </p>
            <p className="mt-2">
              The AI clothing scanner is available to users aged <strong>15 and older</strong>.
              Users aged 15–17 must attest that they have a parent or guardian&apos;s permission to
              use the AI scanner. Users under 15 may add clothing items using the manual entry form.
              Aeruvo does not collect full date of birth; age band is self-attested.
            </p>
          </Section>

          <Section title="Data we collect and why">
            <DataItem label="Email address and display name">
              Collected when you sign up. Used to authenticate your account, sync your preferences
              across devices, and (if needed) contact you about your account. Stored in Firebase
              Authentication and in your Firestore profile document (Firestore database region:
              northamerica-northeast2, Montréal, Canada).
            </DataItem>
            <DataItem label="Authentication credentials">
              Authentication is handled by Firebase Authentication (Google LLC). Aeruvo does not
              receive or store your password. Firebase processes authentication credentials
              according to Google's infrastructure and terms. Aeruvo does not receive or store your
              password.
            </DataItem>
            <DataItem label="City name and geographic coordinates">
              When you select a city, the city name and its geographic coordinates (latitude and
              longitude) are stored in your cloud profile to enable weather lookups on future
              visits. These coordinates identify a city-level location — not a precise street-level
              position.
            </DataItem>
            <DataItem label="One-time GPS location">
              If you tap "Use my location," your device's GPS coordinates are used once to look up
              your local weather via Open-Meteo. These coordinates are not stored on Aeruvo's
              servers.
            </DataItem>
            <DataItem label="Preferences">
              Your cold sensitivity, commute type, theme, and notification settings. Stored in your
              browser's local storage and, if signed in, synced to your Firestore profile.
            </DataItem>
            <DataItem label="Saved outfits">
              Outfit recommendations you choose to save, including the outfit slot details and names
              of saved wardrobe items you have linked. Stored locally and, if signed in, synced to
              Firestore (northamerica-northeast2, Montréal).
            </DataItem>
            <DataItem label="Wardrobe items (local only)">
              The results of AI wardrobe scans (garment category, warmth rating, style label, colour
              swatch) are stored only on your device in your browser's local storage. If you
              separately choose “Save a reference photo on this device,” Aeruvo also creates a small
              re-encoded thumbnail and stores it locally in your browser's IndexedDB storage. The
              thumbnail is not uploaded to Aeruvo, Firebase Storage, or Firestore. You can remove it
              by deleting the wardrobe item, resetting local app data, or clearing the app/site
              data.
            </DataItem>
            <DataItem label="Wardrobe scan quota">
              The number of AI wardrobe scans you have used (lifetime total for free accounts; daily
              count for Premium) is stored in your Firestore profile for quota enforcement.
            </DataItem>
            <DataItem label="Push notification token">
              If you enable rain reminders, a Firebase Cloud Messaging (FCM){" "}
              <strong>push-notification token</strong> is stored in your Firestore profile (in the
              devices subcollection). This token identifies your device for notification delivery.
              It is deleted from Firestore when you sign out.
            </DataItem>
            <DataItem label="Subscription status and Stripe identifiers">
              If you subscribe to Premium, a Stripe customer identifier (an opaque reference number)
              is stored in your Firestore profile. Your subscription status, plan, and
              billing-period information are stored to control feature access.
            </DataItem>
            <DataItem label="Checkout consent record">
              When you start a paid subscription, we record your acceptance of the Terms of Service
              and Privacy Policy (the version identifiers, the disclosure text you saw, and the
              Stripe Checkout Session ID). This record is retained as a legal record — see Retention
              below.
            </DataItem>
          </Section>

          <Section title="AI wardrobe analysis — Anthropic Claude">
            {/*
              ⚠️ LEGAL REVIEW REQUIRED before public launch.
              The data-retention statement below reflects Anthropic's published API and
              data retention documentation (platform.claude.com/docs/en/manage-claude/
              api-and-data-retention) as verified September 2026. It must be re-verified
              before enabling the scanner and whenever Anthropic's retention policy changes.
              A contractual Zero Data Retention (ZDR) arrangement with Anthropic is not
              currently in place; obtain legal advice on whether ZDR is required before
              enabling AI scanning for users under 18.
            */}
            <p>
              When you scan a clothing item, the image is transmitted to the{" "}
              <strong>Anthropic API</strong> (the <code>claude-haiku-4-5-20251001</code> model at{" "}
              <code>api.anthropic.com/v1/messages</code>). Aeruvo does not store the original scan
              image after the analysis is complete. If you opt in to an on-device wardrobe reference
              photo, the app creates a separate low-resolution, re-encoded thumbnail after analysis;
              this removes the original image metadata and is stored only on that device. The
              evidence or description text produced during analysis is not stored anywhere.
            </p>
            <p className="mt-2">
              <strong>Data retention at Anthropic:</strong> Aeruvo uses Anthropic&apos;s standard
              commercial API. According to Anthropic&apos;s API and data retention documentation
              (verified September 2026):
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 pl-2">
              <li>
                Conversation content (prompts and outputs) is{" "}
                <strong>not retained by default</strong> for this configuration. The Messages API is
                eligible for Zero Data Retention (ZDR).
              </li>
              <li>
                The JSON output schema used with Structured Outputs may be cached for up to 24 hours
                for performance optimisation. No prompt or image data is retained in this cache.
              </li>
              <li>
                Content flagged by Anthropic&apos;s automated trust-and-safety systems may be
                retained for up to two years.
              </li>
              <li>
                Aeruvo does not currently have a contractual Zero Data Retention (ZDR) arrangement
                with Anthropic. This will be noted if it changes.
              </li>
              <li>
                Aeruvo retains numeric usage metadata (token counts, model name, success/failure)
                for cost, quota, security and operational monitoring. No image, prompt, garment
                description, or user identifier is included in this metadata.
              </li>
            </ul>
            <p className="mt-2">
              The AI scanner is available to users aged 15 and older. We instruct the AI model to
              refuse images that contain people, faces, bodies, identification documents or personal
              information. Before uploading, Aeruvo attempts to detect faces and persons locally on
              your device using on-device AI models (MediaPipe). If a face or person is detected,
              the upload is blocked and the image is never transmitted. This on-device check reduces
              prohibited uploads but does not guarantee that all prohibited content is blocked —
              Anthropic&apos;s Claude AI independently classifies image content and may decline to
              analyze images it determines are outside the permitted categories.
            </p>
            <p className="mt-2">
              To report a concern about an AI scan, use the <strong>Report AI clothing scan</strong>{" "}
              option in the in-app feedback form, or contact us at{" "}
              <a
                href={`mailto:${APP_CONFIG.privacyEmail}`}
                className="text-primary underline underline-offset-2"
              >
                {APP_CONFIG.privacyEmail}
              </a>
              .
            </p>
            <p className="mt-2">
              For Anthropic&apos;s current data handling policies, refer to the{" "}
              <a
                href="https://www.anthropic.com/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Anthropic Privacy Policy
              </a>{" "}
              and{" "}
              <a
                href="https://www.anthropic.com/legal/aup"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Anthropic Usage Policy
              </a>
              .
            </p>
          </Section>

          <Section title="Weather data — Open-Meteo">
            Weather forecasts are fetched from{" "}
            <a
              href="https://open-meteo.com/en/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Open-Meteo
            </a>{" "}
            (open-meteo.com). We send only your latitude and longitude — no name, email, or account
            information is included in the weather request. Open-Meteo is operated from Switzerland.
            Refer to Open-Meteo's terms for their data handling practices.
          </Section>

          <Section title="Payments — Stripe">
            <p>
              Premium subscriptions are processed by <strong>Stripe, Inc.</strong> (United States).
              When you subscribe, you are redirected to Stripe's hosted checkout page. Stripe
              collects the billing and payment details required for your selected payment method,
              fraud prevention, regulatory compliance and, where configured, tax calculation.
            </p>
            <p className="mt-2">
              Aeruvo does not directly collect card numbers or CVCs and does not store full card
              details. Limited billing information (such as billing country, postal code, or the
              last four digits of a card) and Stripe-generated identifiers may be available to
              Aeruvo through Stripe's merchant tools. Such information may be used for subscription
              administration, customer support, fraud prevention and legal compliance. Aeruvo's code
              does not retrieve or persist full billing addresses from Stripe's API.
            </p>
            <p className="mt-2">
              Stripe retains transaction and payment records under its own legal obligations,
              independently of Aeruvo's data-deletion processes. See{" "}
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Stripe's Privacy Policy
              </a>
              .
            </p>
          </Section>

          <Section title="Server infrastructure — Vercel">
            Aeruvo's server functions are hosted on <strong>Vercel, Inc.</strong> (United States).
            All requests to the server (checkout, webhook handling, AI scan) are processed by
            Vercel. Vercel may retain server logs according to your plan's retention configuration.{" "}
            {/*
              OWNER ACTION REQUIRED (source only): verify log-retention period in Vercel
              dashboard (Project Settings → Logs) and update this sentence before Live launch.
            */}
            Log retention duration is governed by your Vercel plan and project configuration.
          </Section>

          <Section title="Third-party services summary">
            <div className="mt-2 space-y-2">
              <Provider
                name="Firebase Authentication"
                provider="Google LLC"
                region="Global (Google infrastructure)"
                purpose="User authentication"
              />
              <Provider
                name="Cloud Firestore"
                provider="Google LLC"
                region="northamerica-northeast2 (Montréal, Canada)"
                purpose="Cloud profile/preferences storage"
              />
              <Provider
                name="Firebase Cloud Messaging"
                provider="Google LLC"
                region="Global (Google infrastructure)"
                purpose="Push notifications"
              />
              <Provider
                name="Open-Meteo"
                provider="Open-Meteo (Switzerland)"
                region="Switzerland / CDN"
                purpose="Weather data"
              />
              <Provider
                name="Anthropic API"
                provider="Anthropic, PBC"
                region="United States (Anthropic infrastructure)"
                purpose="AI wardrobe image analysis"
              />
              <Provider
                name="Stripe"
                provider="Stripe, Inc."
                region="United States"
                purpose="Payment processing"
              />
              <Provider
                name="Vercel"
                provider="Vercel, Inc."
                region="United States and/or edge network"
                purpose="Server hosting and functions"
              />
            </div>
            <p className="mt-3">
              By using Aeruvo, you acknowledge that your personal information may be processed
              outside Canada by the service providers listed above, subject to their respective
              infrastructures, terms of service, and applicable law.
            </p>
          </Section>

          <Section title="Cookies and local storage">
            <p>
              Aeruvo does not use advertising cookies or tracking pixels. We use browser{" "}
              <code>localStorage</code> to store your preferences, saved outfits, and wardrobe
              metadata, and browser <code>IndexedDB</code> for optional wardrobe reference
              thumbnails. This storage stays on your device and is not used for cross-site tracking.
            </p>
            <p className="mt-2">
              A small functional cookie may be used to remember sidebar state on the web app. This
              is a technical preference only and not used for advertising or analytics.
            </p>
          </Section>

          <Section title="Data retention">
            <table className="mt-2 w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-foreground/60">
                  <th className="pb-1 pr-2">Category</th>
                  <th className="pb-1">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <RetRow
                  cat="Account profile (prefs, name, email)"
                  ret="Until account deletion request"
                />
                <RetRow cat="Saved outfits" ret="Until deleted by user or account deletion" />
                <RetRow cat="Wardrobe scan quota" ret="Until account deletion" />
                <RetRow
                  cat="Push notification token"
                  ret="Deleted on sign-out; otherwise until account deletion"
                />
                <RetRow
                  cat="Subscription status / Stripe customer ID"
                  ret="Until account deletion (note: Stripe retains transaction records independently)"
                />
                <RetRow
                  cat="Checkout consent records"
                  ret="Retained for the period required by applicable tax, accounting, dispute-resolution and legal obligations. Records remain linked to the account UID for the retention period. The specific retention duration is to be confirmed by qualified legal/tax counsel."
                />
                <RetRow cat="Vercel server logs" ret="Per Vercel plan and project configuration" />
                <RetRow
                  cat="Local wardrobe reference thumbnails"
                  ret="Until the wardrobe item is removed, local app data is reset, or the user clears site/app data"
                />
                <RetRow
                  cat="Other local device data"
                  ret="Until user clears site data or deletes the app"
                />
              </tbody>
            </table>
          </Section>

          <Section title="Your rights">
            <ul className="mt-2 space-y-2">
              <Li>
                <strong>Access and correction</strong> — You can view and edit your preferences in
                the app. To request a copy of personal data held on our servers, email{" "}
                <a
                  href={`mailto:${APP_CONFIG.privacyEmail}`}
                  className="text-primary underline underline-offset-2"
                >
                  {APP_CONFIG.privacyEmail}
                </a>
                .
              </Li>
              <Li>
                <strong>Deletion</strong> — See "Account deletion" below.
              </Li>
              <Li>
                <strong>Portability</strong> — We can provide your stored profile data in a portable
                format on request.
              </Li>
              <Li>
                <strong>Withdrawal of consent</strong> — You may cancel your subscription at any
                time. Withdrawal does not affect lawfulness of prior processing.
              </Li>
            </ul>
          </Section>

          <Section title="Account deletion">
            <p>To delete your Aeruvo account and associated data:</p>
            <ul className="mt-2 space-y-2">
              <Li>
                <strong>In-app self-service (recommended):</strong> Settings → Delete Account. This
                cancels any active subscription, deletes your Firebase Authentication identity, and
                deletes your Firestore profile documents (preferences, saved outfits, notification
                tokens, scan quota). Wardrobe data stored on your device is also cleared.
              </Li>
              <Li>
                <strong>Subscription note:</strong> Deleting your account cancels any active
                subscription. Your Premium access will end at the current period end unless the
                subscription is cancelled immediately. We will not charge you for the next period.
              </Li>
              <Li>
                <strong>What is not deleted:</strong> Certain billing, consent and transaction
                records are retained for the period required by applicable tax, accounting and legal
                obligations. Stripe's own transaction records are retained under Stripe's legal
                obligations. Vercel server logs are retained per Vercel's platform policy.
              </Li>
              <Li>
                <strong>Manual request:</strong> If you cannot use the in-app flow, email{" "}
                <a
                  href={`mailto:${APP_CONFIG.privacyEmail}`}
                  className="text-primary underline underline-offset-2"
                >
                  {APP_CONFIG.privacyEmail}
                </a>{" "}
                and we will process your request within 30 days.
              </Li>
            </ul>
          </Section>

          <Section title="Safeguards">
            We use industry-standard safeguards including HTTPS for data in transit, Firestore
            security rules restricting access to each user's own data, and server-only secret keys
            for payment and AI services.
          </Section>

          <Section title="Security incidents">
            In the event of a personal-data breach that creates a real risk of significant harm, we
            will notify affected individuals and, where required, the applicable Canadian privacy
            authority, in accordance with PIPEDA and applicable provincial law.
          </Section>

          <Section title="Changes to this policy">
            We will post updates here with a new effective date. For material changes we will
            provide advance notice by email or in-app notice. Continued use after the effective date
            constitutes acceptance of the updated policy.
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

function DataItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="font-medium text-foreground/90">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function Provider({
  name,
  provider,
  region,
  purpose,
}: {
  name: string;
  provider: string;
  region: string;
  purpose: string;
}) {
  return (
    <div className="rounded-xl bg-card/60 px-3 py-2 text-xs">
      <span className="font-medium text-foreground/90">{name}</span>
      {" — "}
      {provider}
      <span className="block text-foreground/60">
        {region} · {purpose}
      </span>
    </div>
  );
}

function RetRow({ cat, ret }: { cat: string; ret: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-2 align-top text-foreground/80">{cat}</td>
      <td className="py-1.5 align-top">{ret}</td>
    </tr>
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
