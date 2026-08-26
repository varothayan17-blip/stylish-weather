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

const LAST_UPDATED    = "2026-08-26";
const EFFECTIVE_DATE  = "2026-08-26";

/*
 * OWNER ACTION REQUIRED — before Live launch:
 *   1. BUSINESS_ADDRESS below is an unresolved placeholder.
 *      Obtain and insert your mailing address (P.O. Box or registered address).
 *      A home address must NEVER be used publicly — consult a Canadian legal
 *      professional about acceptable alternatives (virtual office, lawyer's
 *      address with consent, registered agent, P.O. Box).
 *   2. If GST/HST registration is required (revenue exceeds CA$30,000 threshold),
 *      add your GST/HST number.
 *   3. Have a Canadian lawyer review this document before enabling paid subscriptions.
 */
function Terms() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-md px-6 pb-16 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <Link to="/about" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Effective: {EFFECTIVE_DATE} · Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed">

          <Section title="Seller identity">
            Aeruvo is operated by <strong>Varothayan Arumairatnam, operating as Aeruvo</strong>{" "}
            ("{APP_CONFIG.name}", "we", "us", or "our"). Contact:{" "}
            <a href={`mailto:${APP_CONFIG.supportEmail}`}
               className="text-primary underline underline-offset-2">
              {APP_CONFIG.supportEmail}
            </a>.
{/* OWNER ACTION REQUIRED (source only — not rendered to customers until resolved):
               Insert a mailing address (P.O. Box or registered address) here.
               Consult a Canadian legal professional about address disclosure requirements.
               Do not use a home address publicly. */}
          </Section>

          <Section title="Acceptance and eligibility">
            <p>
              By using Aeruvo you agree to these Terms. If you do not agree, do not use the app.
            </p>
            <p className="mt-2">
              <strong>Minimum age:</strong> You must be at least 13 years old to create an account, subject
              to applicable local consent requirements in your jurisdiction.
            </p>
            <p className="mt-2">
              <strong>Paid subscriptions:</strong> If you are under the age of majority where you live,
              your parent or legal guardian must review these Terms and authorize any paid subscription
              on your behalf. This requirement applies to recurring Stripe purchases; it does not restrict
              access to free weather features.
            </p>
          </Section>

          <Section title="Service availability">
            <p>
              Aeruvo is operated from Ontario, Canada and may be accessed in countries where
              the service is available and legally permitted. We make no representation that
              the service is appropriate or available in every jurisdiction.
            </p>
            <p className="mt-2">
              Premium is priced at <strong>CA$2.99 CAD per month plus applicable taxes</strong>.
              Your bank or payment provider may apply currency-conversion or other charges.
              Nothing in these Terms limits mandatory consumer rights that apply where you live.
            </p>
          </Section>

          <Section title="What Aeruvo provides">
            <p>
              Aeruvo provides weather-based clothing recommendations and an AI-assisted wardrobe
              analysis feature. Recommendations are generated automatically from public weather data
              and matching logic. AI wardrobe analysis uses a third-party AI model (Google Gemini).
            </p>
            <p className="mt-2">
              Recommendations and AI analysis results are <strong>suggestions only</strong> — not
              professional, medical, or safety advice. We make no guarantee that they will be
              suitable for your specific situation, health condition, or weather event.
            </p>
          </Section>

          <Section title="Accuracy of weather and AI data">
            <p>
              Weather data is sourced from Open-Meteo (open-meteo.com). Air quality data uses the
              Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo. Aeruvo does not
              control the accuracy or availability of this data. Forecasts may be incorrect,
              delayed, or unavailable.
            </p>
            <p className="mt-2">
              AI wardrobe analysis results are automatically generated. They may be inaccurate.
              Always verify recommendations using your own judgement.
            </p>
          </Section>

          <Section title="Free account limits">
            <p>A free account includes:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 pl-2">
              <li>Weather-based clothing recommendations (unlimited)</li>
              <li>
                AI wardrobe scan feature: <strong>3 successful scans for the lifetime of your
                account</strong>. Scans that fail due to a technical error do not count against
                this limit.
              </li>
            </ul>
          </Section>

          <Section title="Premium subscription">
            <p>Premium is a paid subscription that provides:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 pl-2">
              <li>Personalized wardrobe-matched outfit recommendations</li>
              <li>
                AI wardrobe scan feature: <strong>up to 15 successful scans per calendar day</strong>
                and <strong>up to 100 successful scans every 30 days</strong>,
                subject to service availability and fair use.
              </li>
              <li>Daily rain and outfit push notifications</li>
              <li>Advanced recommendation features</li>
            </ul>
          </Section>

          <Section title="Subscription pricing, trial, and renewal">
            <p>
              <strong>Free trial:</strong> New subscribers receive a{" "}
              <strong>7-day free trial</strong>. No charge is made during the trial period.
            </p>
            <p className="mt-2">
              <strong>Price:</strong>{" "}
              <strong>CA$2.99 per month plus applicable taxes</strong> (e.g., GST/HST where
              applicable), billed monthly after the trial ends.
            </p>
            <p className="mt-2">
              <strong>Automatic renewal:</strong> The subscription renews automatically every month
              until you cancel. You will be charged at the start of each billing period.
            </p>
            <p className="mt-2">
              <strong>Price changes:</strong> We will provide reasonable advance notice of any price
              change. Continued use after a change takes effect constitutes acceptance of the new
              price.
            </p>
          </Section>

          <Section title="Cancellation">
            <p>
              You may cancel at any time through the Stripe Customer Portal, accessible from the
              Premium page or Settings → Manage Subscription.
            </p>
            <p className="mt-2">
              <strong>Cancel before the trial ends:</strong> If you cancel before the trial ends, you will not be charged.
            </p>
            <p className="mt-2">
              <strong>Cancel after the trial or a paid period has begun:</strong> Your Premium
              access remains active until the end of the current billing period. You will not be
              charged for the next period. No prorated refund is issued for unused days in the
              current period.
            </p>
          </Section>

          <Section title="Failed payments">
            <p>
              If a payment fails, Stripe may retry the charge. During a payment-retry period your
              Premium access may remain active temporarily. If the payment is ultimately
              unsuccessful your subscription will be cancelled and Premium features will be
              revoked. The exact retry schedule is determined by Stripe and may be adjusted in the
              Stripe Dashboard — refer to Stripe's documentation for current retry behaviour.
            </p>
          </Section>

          <Section title="Refund policy">
            <ul className="mt-2 list-inside list-disc space-y-1 pl-2">
              <li>
                <strong>Trial cancellation:</strong> Cancel before the trial ends and you will not
                be charged. No refund is required.
              </li>
              <li>
                <strong>First paid renewal — unused scans:</strong> If you request a refund within
                7 days of your first paid monthly renewal and have not used any Premium AI wardrobe
                scans since that charge, we will issue a refund. Contact{" "}
                <a href={`mailto:${APP_CONFIG.supportEmail}`}
                   className="text-primary underline underline-offset-2">
                  {APP_CONFIG.supportEmail}
                </a>.
              </li>
              <li>
                <strong>Duplicate charges and billing errors:</strong> We will refund confirmed
                duplicate charges and billing errors promptly.
              </li>
              <li>
                <strong>Unauthorized transactions:</strong> Investigated through Aeruvo and
                Stripe/payment-provider processes.
              </li>
              <li>
                <strong>All other charges:</strong> Subscription charges are generally
                non-refundable except where required by applicable law.
              </li>
              <li>
                <strong>Cancellation:</strong> Cancelling a subscription does not itself trigger
                a refund; access continues until the period end.
              </li>
              <li>
                <strong>Statutory rights:</strong> Nothing in this policy limits any rights you
                have under applicable Canadian consumer protection law.
              </li>
            </ul>
          </Section>

          <Section title="Account and data">
            <p>
              Signing up creates a profile associated with your email address. You are responsible
              for providing an accurate address. We use it to sync your preferences — we do not
              send unsolicited marketing email.
            </p>
            <p className="mt-2">
              See our{" "}
              <Link to="/privacy" className="text-primary underline underline-offset-2">
                Privacy Policy
              </Link>{" "}
              for full details on what data we collect, how we use it, and your rights.
            </p>
          </Section>

          <Section title="Acceptable use and prohibited uploads">
            <p>You agree not to:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 pl-2">
              <li>Upload images that are not photographs of clothing items</li>
              <li>
                Upload images that contain nudity, sexual content, violence, hate symbols,
                illegal material, or images of other people without their consent
              </li>
              <li>
                Upload copyrighted images that you do not have the right to submit
              </li>
              <li>Reverse-engineer, scrape, or automate access to the app or its APIs</li>
              <li>Use Aeruvo in a way that harms others or violates any applicable law</li>
              <li>Attempt to access other users' data</li>
            </ul>
          </Section>

          <Section title="Suspension and termination">
            <p>
              We may suspend or terminate your account if you violate these Terms, engage in
              fraudulent activity, or if required by law. We will use reasonable efforts to notify
              you where practicable. If your account is terminated for cause, no refund will be
              issued for any remaining subscription period.
            </p>
          </Section>

          <Section title="Intellectual property">
            <p>
              The Aeruvo name, logo, and original content are the property of{" "}
              Varothayan Arumairatnam. Weather data is provided by Open-Meteo under their open
              licence. Open-source libraries used are credited in the app's acknowledgements.
            </p>
          </Section>

          <Section title="Warranty and liability">
            <p>
              The app is provided "as is" without warranties of any kind, express or implied.
              To the maximum extent permitted by applicable law, Aeruvo and Varothayan Arumairatnam
              are not liable for any indirect, incidental, special, or consequential damages
              arising from your use of the app, including but not limited to clothing choices
              made based on recommendations, inaccurate weather or AI results, or service
              unavailability.
            </p>
            <p className="mt-2">
              Nothing in these Terms limits our liability for fraud, death or personal injury
              caused by negligence, or any liability that cannot be excluded under applicable law.
            </p>
          </Section>

          <Section title="Governing law">
            <p>
              These Terms are governed by the laws of the Province of Ontario and the laws of
              Canada applicable therein. Nothing in these Terms limits any mandatory consumer-
              protection rights that apply to you under the laws of your jurisdiction.
            </p>
          </Section>

          <Section title="Changes to these Terms">
            <p>
              We may update these Terms. We will post the updated version here with a new effective
              date. For material changes affecting paid subscribers we will provide at least 30 days'
              advance notice by email or prominent in-app notice. Continued use after the effective
              date of a change constitutes acceptance of the updated Terms.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these Terms:{" "}
              <a href={`mailto:${APP_CONFIG.supportEmail}`}
                 className="text-primary underline underline-offset-2">
                {APP_CONFIG.supportEmail}
              </a>
            </p>
            <p className="mt-1">
              Privacy requests:{" "}
              <a href={`mailto:${APP_CONFIG.privacyEmail}`}
                 className="text-primary underline underline-offset-2">
                {APP_CONFIG.privacyEmail}
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
