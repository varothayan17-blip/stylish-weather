# Aeruvo — Architecture

This document explains how the codebase is put together: the folder
structure, and how data actually flows through the five subsystems that
matter most (weather, recommendations, forecast, regret risk, auth/billing),
plus how the app gets deployed. It reflects the codebase as it stands after
this engineering pass — not a future or aspirational state.

## Tech stack

React 19 + TanStack Start (file-based routing, SSR) + TanStack Query,
Tailwind v4 + shadcn/ui, TypeScript throughout. No backend database — all
user state is `localStorage`. Builds to Cloudflare Workers via Nitro.

## Folder structure

```
src/
├── routes/              One file per screen (file-based routing).
│   ├── __root.tsx        App shell: <html>/<head>, theme boot script,
│   │                     SW registration, error boundary wiring.
│   ├── welcome.tsx        Onboarding (single screen)
│   ├── signup.tsx         Account creation — see Auth Architecture
│   ├── index.tsx          Home dashboard (the main screen)
│   ├── recommendation.tsx "Daily Recommendations" screen
│   ├── forecast.tsx       Weekly Forecast screen
│   ├── preferences.tsx    Personalization (cold sensitivity, commute, city)
│   ├── settings.tsx       App settings hub (theme, account, premium, about)
│   ├── premium.tsx        Upgrade screen — see Billing Architecture
│   └── saved.tsx          Saved outfit history
│
├── lib/                  All business logic. No JSX here.
│   ├── weather.ts                Thin public API — re-exports the active provider
│   ├── weatherProviders/         Provider abstraction (see Weather API Flow)
│   │   ├── types.ts               Weather/DailyForecast types, WeatherProvider interface
│   │   ├── openMeteo.ts           Active default — free, no API key
│   │   ├── weatherApiCom.ts       Scaffolded alternate, inactive by default
│   │   └── index.ts               Picks the active provider from env
│   ├── recommend.ts              The outfit decision engine (see Recommendation Flow)
│   ├── regretRisk.ts             Confidence scoring on top of a recommendation
│   ├── alerts.ts                 Wind chill / rain / snow alert derivation
│   ├── preferences.ts            localStorage read/write for Prefs + Favorites
│   ├── theme.ts                  Light/dark/system resolution + boot script
│   ├── auth.ts                   Auth abstraction (see Auth Architecture)
│   ├── billing.ts                Billing abstraction (see Billing Architecture)
│   ├── firebase.ts               Guarded, dynamically-imported Firebase client
│   ├── cloudSync.ts              Firestore sync abstraction — prepared, NOT wired in
│   ├── registerSW.ts             Client-only service worker registration
│   └── utils.ts                  cn() class merger, getErrorMessage()
│
├── components/
│   ├── AppShell.tsx, BottomNav.tsx   App-wide layout/navigation
│   ├── RegretRiskCard.tsx, WeatherAlertCards.tsx, ErrorState.tsx, FormControls.tsx
│   ├── WeatherIcon.tsx
│   └── ui/                        Full shadcn/ui primitive library (mostly
│                                   unused by current screens — see
│                                   TECHNICAL_DEBT.md before deleting any of it)
│
├── server.ts, start.ts   Cloudflare Workers entry + SSR error normalization
└── styles.css            Tailwind + design tokens (incl. .dark overrides)

public/
├── manifest.webmanifest, sw.js, icon-*.png   PWA assets
```

## Weather API Flow

```
screen (index.tsx / recommendation.tsx / forecast.tsx)
   │  fetchWeather(lat, lon, city)
   ▼
lib/weather.ts  ──────────────►  weatherProviders/index.ts
                                       │  reads VITE_WEATHER_PROVIDER
                                       │  (defaults to "open-meteo")
                                       ▼
                          weatherProviders/openMeteo.ts
                                       │  one fetch() to api.open-meteo.com
                                       │  current + hourly (7 days) + daily (7 days)
                                       ▼
                              Weather object returned
```

No screen ever imports a provider file directly — they all import
`fetchWeather` from `lib/weather.ts`, which is just a pass-through to
whichever provider is currently active. Switching providers later (e.g. to
WeatherAPI.com, already scaffolded in `weatherApiCom.ts`) is a `.env`
change, not a code change in any screen.

**A non-obvious correctness detail, since it caused a real bug this pass:**
Open-Meteo's hourly array always starts at midnight of the current day, not
from the current hour. `openMeteo.ts` finds the real "now" index using the
response's own `utc_offset_seconds` (so it's correct for the forecast
location's timezone, independent of which timezone the server process
itself runs in — important since Cloudflare Workers run in UTC) before
slicing the 12-hour window the Home screen displays.

Geocoding (`reverseGeocode`, `searchCity` in `weather.ts`) stays on
Open-Meteo's geocoding API regardless of which weather provider is active —
it's a separate, unrelated free service.

## Recommendation Engine Flow

```
Weather + Prefs
   │
   ▼
recommend(w, p)  [lib/recommend.ts]
   │  1. adjust feels-like by cold/hot sensitivity (±4°C)
   │  2. branch on OUTFIT_BAND_EDGES = [-10, 0, 8, 15, 22, 28]
   │  3. layer on umbrella/gloves/sunglasses booleans from precip/temp/UV
   │  4. layer on a commute-specific warning (walk/ttc/drive/cycle)
   ▼
Recommendation { headline, outfit[], umbrella, gloves, sunglasses,
                 commuteWarning?, mood, effectiveFeelsC }
```

`OUTFIT_BAND_EDGES` is exported specifically so other modules (regret risk)
can reference the exact same thresholds instead of keeping a second,
driftable copy — this was a real duplication bug found and fixed this pass.
`effectiveFeelsC` is exposed for the same reason: it's the post-adjustment
number the decision was actually made on, so downstream consumers don't
have to recompute the sensitivity adjustment themselves.

This function is pure and synchronous — no I/O, nothing async, safe to call
7 times in a row for a week of forecast data with zero performance concern.

## Forecast Flow

```
weather.daily[]  (7 entries from the one fetchWeather() call)
   │
   │  for each day:
   ▼
dailyToWeather(day, city)  [lib/weather.ts]
   │  reshapes ONE day into a full Weather-shaped object —
   │  tempC/feelsLikeC = that day's max/feels-max,
   │  hourly = [day-low, day-high] as two synthetic points
   │  (just enough for regretRisk's "temperature swing" factor to work
   │  unchanged on forecast days too, with zero duplicated logic)
   ▼
recommend(dayWeather, prefs)  +  computeRegretRisk(...)  +  getWeatherAlerts(...)
   ▼
one expandable card per day, forecast.tsx
```

The deliberate design choice here: there is no separate "forecast
recommendation" function. A forecast day and "today" are both just
`Weather` objects by the time they reach `recommend()` — one recommendation
engine, fed different inputs, which is also why a behavior fix to
`recommend.ts` instantly applies correctly to the forecast screen too.

## Regret Risk Flow

```
Weather + Prefs + Recommendation
   │
   ▼
computeRegretRisk(w, p, rec)  [lib/regretRisk.ts]
   │  sums weighted factors:
   │   - wind-chill gap (actual vs feels-like)
   │   - precipitation uncertainty (risk peaks near 50%, not 100%)
   │   - snow presence
   │   - high wind
   │   - temperature swing across the day's hourly data
   │   - proximity to an OUTFIT_BAND_EDGES boundary
   ▼
RegretRisk { level: low|medium|high, score: 0-100, headline, reasons[] }
   │
   ▼
<RegretRiskCard />  — rendered on Home, Recommendation, and each forecast day
```

Reasons are ranked by point contribution and the top 2–3 are surfaced in the
UI, so the score is never just a bare number — it always comes with "why."

## Auth Architecture

One interface (`AuthProvider`), two implementations, resolved once at
module load based on whether Firebase env vars are present:

```
lib/auth.ts
  localOnlyAuth   ← active today (no Firebase configured)
                     signIn() just writes name/email to localStorage,
                     flips onboarded: true. Synchronous, always works.

  firebaseAuth    ← would activate automatically once VITE_FIREBASE_*
                     are all set. Uses Firebase's passwordless EMAIL-LINK
                     sign-in specifically (not email+password) — chosen
                     because signup.tsx already promises "No password
                     needed," so this is the Firebase method that matches
                     what's built rather than requiring a form redesign.

  auth = isFirebaseConfigured() ? firebaseAuth : localOnlyAuth
```

`signup.tsx` only ever calls `auth.signIn(...)` and `auth.completeSignIn()`
— it has no branching logic on which auth backend is active.

**Important performance detail from this pass:** `firebase/auth` (and
`firebase/app`, `firebase/firestore`) are imported _dynamically_ inside
`auth.ts`'s methods, not statically at the top of the file. A static import
was measured to add ~480KB to `signup.tsx`'s bundle even with Firebase
completely unconfigured, since Vite bundles whatever's statically imported
regardless of whether the configured-check would ever let it run. Dynamic
imports mean the Firebase SDK is only fetched over the network the moment
it's actually needed.

`cloudSync.ts` follows the identical adapter pattern for syncing
preferences/favorites to Firestore, but — important distinction —
**nothing calls it yet.** It's architecture, not a working feature; see
TECHNICAL_DEBT.md for the full functional-status breakdown.

## Billing Architecture

Same adapter pattern as Auth:

```
lib/billing.ts
  localOnlyBilling  ← active today. startCheckout() flips premium: true
                        in localStorage — today's actual demo trial.

  stripeBilling     ← would activate once VITE_STRIPE_PUBLISHABLE_KEY is
                        set. startCheckout() calls POST /api/create-
                        checkout-session and redirects to the returned
                        Checkout URL — but that server route does not
                        exist yet (see TECHNICAL_DEBT.md for exactly what's
                        missing).

  billing = isStripeConfigured() ? stripeBilling : localOnlyBilling
```

`premium.tsx` only calls `billing.startCheckout()` — same shape as auth,
the screen doesn't know or care which billing backend is active.

**Why there's no Stripe secret key anywhere in this codebase:** real
Stripe Checkout Session creation requires a secret key, which can never
live in client code — `VITE_*` vars are inlined into the public JS bundle.
That secret key belongs in a server-side route. This app's server side is
the Cloudflare Worker (`src/server.ts`), which currently only proxies to
TanStack Start's SSR handler — it defines no custom API routes. Adding
`/api/create-checkout-session` means adding a TanStack Start server route
(file-based, under `src/routes/api/...`, or a server function) — that
hasn't been built, intentionally, since there's no Stripe account behind it
yet.

## Deployment Process

```
npm run build
   │  vite.config.ts pins nitro: { preset: "cloudflare-module", output: {...},
   │  cloudflare: { nodeCompat: true, deployConfig: true } } explicitly —
   │  not relying on Lovable-sandbox auto-detection, so this is deterministic
   │  regardless of where it runs.
   ▼
dist/client/   static assets (served via the Worker's ASSETS binding)
dist/server/   the Worker itself + a generated wrangler.json
   │
   ├─ Path A: Publish via Lovable (zero setup)
   └─ Path B: npx wrangler deploy --config dist/server/wrangler.json
              (run from the project root — see DEPLOYMENT.md for why
              cd-ing into dist/server first causes a config conflict,
              verified directly rather than assumed)
```

Full details, including the verified local smoke-test command and where
`VITE_*` vars need to be set for each path, are in `DEPLOYMENT.md`.

## Functional Status Summary

See `TECHNICAL_DEBT.md` for the full audit, but in short: the weather
pipeline, recommendation engine, regret risk, forecast, theme, and PWA
install are all fully functional today. Auth and Billing are real,
correctly-built adapters whose _local_ path is fully functional and whose
_remote_ path (Firebase / Stripe) is architecture-only — present, typed,
following the right API shapes, but missing either external configuration,
a server route, or both, and not yet exercised against a live account from
this environment.
