# Launch Checklist

Organized by what actually blocks a real public launch vs. what's
recommended but not strictly blocking. Items are written as concrete
actions, not vague reminders.

## Hard blockers — must do before any real users arrive

- [ ] **Write a Privacy Policy and Terms of Service.** The app now collects
      name + email (signup), and has a payment surface (premium). Checked
      directly: zero references to "privacy" or "terms" exist anywhere in
      the app today. This is a legal requirement, not a nice-to-have, once
      real people's data is involved — and Stripe requires a published
      privacy policy URL before activating live payments. This should come
      from you or a lawyer/template service, not be fabricated — link it
      from `settings.tsx`'s About section once it exists.
- [ ] **Decide whether Firebase Auth or Stripe are launching at v1, or
      later.** Today, signing up and "going premium" both work via local
      demo behavior (localStorage only, no real account, no real charge).
      That's an honest, functional v1 if you're comfortable launching
      without real accounts/payments yet. If not, see the two sections
      below before flipping either on.
- [ ] **Test the actual deployed build on a real phone**, not just `vite
    dev`. This pass verified the build pipeline end-to-end via
      `wrangler dev` returning real server-rendered HTML, but did not (and
      could not, from this sandboxed environment) verify visual rendering
      on an actual iOS/Android device. Add to home screen, confirm it
      opens standalone (no browser chrome), confirm dark mode, confirm the
      bottom nav clears the home indicator on a notched phone.
- [ ] **Replace the placeholder app icon** if you want one. The current
      `public/icon.svg` (cloud + jacket silhouette) was generated
      programmatically as a functional placeholder, not as final brand
      design — it's genuinely fine to ship, but worth a deliberate look
      with fresh eyes before this represents the app on real home screens.

## Before turning on Stripe

- [ ] Create the Stripe account and product/price.
- [ ] Add a server route for `POST /api/create-checkout-session` (and
      `/api/create-portal-session` if you want subscription management) —
      see `ARCHITECTURE.md`'s Billing Architecture section for exactly
      where this needs to live (a TanStack Start server route, not a
      change to `src/server.ts` directly).
- [ ] Put the Stripe **secret** key in that server route's environment as a
      Wrangler secret (`wrangler secret put STRIPE_SECRET_KEY`) — never as
      a `VITE_*` variable.
- [ ] Set `VITE_STRIPE_PUBLISHABLE_KEY` at build time (see `DEPLOYMENT.md`
      for exactly where, since `VITE_*` vars are inlined at build, not
      read at runtime).
- [ ] Decide what `premium: true` actually unlocks. Right now it's a
      status badge with no functional gating anywhere — decide the real
      feature differentiation before asking anyone to pay for it.
- [ ] Test a real Checkout Session end-to-end with a Stripe test card.
      This hasn't been possible from this environment (no network egress
      to Stripe), so the Stripe path is unverified beyond code review.

## Before turning on Firebase

- [ ] Create the Firebase project, enable Authentication → Email link
      sign-in specifically, and add your domain to the authorized domains
      list (required for email-link auth to work).
- [ ] Set all four `VITE_FIREBASE_*` vars at build time.
- [ ] Send yourself a real sign-in link and confirm `completeSignIn()`
      actually signs you in — this is implemented against Firebase's
      documented API shape but has never been exercised against a live
      project from this environment.
- [ ] If you want preferences/favorites to follow someone across devices,
      wire `cloudSync.ts` in — it's not called from anywhere yet (see
      `TECHNICAL_DEBT.md`).
- [ ] Set Firestore security rules. None exist yet since Firestore isn't
      wired in — don't skip this when it is; a misconfigured open Firestore
      database is a real and common data-leak vector.

## Strongly recommended, not strictly blocking

- [ ] **Error monitoring.** Today, errors are caught and shown in-app
      (Home/Recommendation/Forecast all have retry states), and SSR
      crashes route through Lovable's own error reporting — but there's no
      aggregated view of what's actually failing for real users in
      production. Worth adding before relying on user reports to find bugs.
- [ ] **Basic analytics.** No usage tracking exists at all right now —
      reasonable for a v1, but you'll be flying blind on which screens
      people actually use.
- [ ] **Accessibility pass.** Not deeply audited this session — screen
      reader labels exist on icon-only buttons that were touched this pass
      (`aria-label` on refresh/retry buttons), but a full pass (focus
      order, contrast in both themes, VoiceOver/TalkBack testing) hasn't
      been done.
- [ ] **Open-Meteo rate limits at scale.** Fine today; the provider
      abstraction (`weatherProviders/`) makes switching straightforward
      when/if traffic justifies a paid provider.
- [ ] **A real custom domain**, if launching beyond Lovable's default
      subdomain — see `DEPLOYMENT.md`'s self-deploy path.

## Already verified working (no action needed)

- `npm run build`, `tsc --noEmit`, `eslint .` all pass clean.
- PWA installs correctly: manifest, icons, service worker all present and
  linked; service worker confirmed to never cache weather/geocoding API
  responses (verified by reading the actual fetch-handler logic, not
  assumed).
- The full deploy pipeline was verified end-to-end: a real build, served
  through `wrangler dev`, returned genuine server-rendered HTML containing
  the actual page title and Premium link — not a placeholder or error page.
- The hourly-forecast time-window bug and the Firebase bundle-size issue
  were both found, fixed, and the fixes verified (not just asserted) — see
  `TECHNICAL_DEBT.md` for exactly how.
