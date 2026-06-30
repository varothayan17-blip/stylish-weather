# Technical Debt

## Fixed this pass (with how they were verified, not just asserted)

**Hourly forecast showed past hours in the afternoon/evening.**
Open-Meteo's hourly array starts at midnight, not "now." The Home screen
sliced `[0, 12)` and labeled index 0 "Now" regardless. Fixed in
`weatherProviders/openMeteo.ts` by finding the real current-hour index via
the response's `utc_offset_seconds`. Verified with a standalone Node script
simulating a Toronto UTC-4 offset against a real UTC timestamp — confirmed
it lands on the correct hour. The dormant `weatherApiCom.ts` adapter had
the identical bug (`new Date().getHours()` — the server's clock, not the
forecast location's) and was fixed the same way using WeatherAPI's own
`location.localtime` field.

**Firebase SDK was bundled into every signup-page visit.**
Static `import ... from "firebase/auth"` in `auth.ts` (and `firebase/app`,
`firebase/firestore` in `firebase.ts`/`cloudSync.ts`) caused Vite to bundle
the entire Firebase SDK surface — including `analytics`, `messaging`,
`functions`, `firebase/ai`, none of which are used anywhere — into
`signup.tsx`'s chunk. Measured before/after: 495,900 bytes → 6,117 bytes
(99% reduction), confirmed via `find dist/client/assets -name "*.js" | xargs ls -la`.
Fixed by converting all Firebase imports to dynamic `import()` calls inside
the functions that actually need them, gated behind the same
`isFirebaseConfigured()` check that already existed. The SDK now lives in
its own chunk, fetched only if Firebase is actually configured.

**Duplicated outfit-band thresholds.**
`recommend.ts` hardcoded `-10, 0, 8, 15, 22, 28` inline in its if/else
chain; `regretRisk.ts` separately hardcoded an identical array with a
comment promising to "keep it in sync." Fixed by exporting
`OUTFIT_BAND_EDGES` from `recommend.ts` as the single source of truth and
having the if/else chain reference it (same numbers, zero behavior change
— this was a pure mechanical extraction, verified via `tsc`/`eslint`/build
all passing identically before and after).

**Silent error swallowing.**
`recommendation.tsx` had `.catch(() => {})` — a network failure left the
screen stuck on a loading skeleton forever, no error, no retry. Extracted a
shared `<ErrorState message retry />` component and used it identically on
Home, Recommendation, and Forecast (this also removed three near-identical
inline error-banner implementations). `preferences.tsx`'s GPS lookup had
the same silent-failure pattern (`catch { /* ignore */ }`) — fixed to
surface a real message.

**Inadequate tap target.**
The new inline refresh button on Home had zero padding — its actual
tappable area was the bare icon's 12×12px box, far under the ~40px+ mobile
minimum. Fixed with negative-margin padding that expands the hit area
without shifting surrounding layout. Audited every other `onClick` handler
in the app for the same issue; the rest were already adequately sized
(≥36px or full-width).

**Implicit, environment-dependent build target.**
The Cloudflare Workers build only ran its full output (correct output
dirs, `nodeCompat`, `deployConfig`) when `@lovable.dev/vite-tanstack-config`
detected a Lovable sandbox — traced through that package's actual source
to confirm. Pinned explicitly in `vite.config.ts` so `npm run build`
produces identical output regardless of where it runs. Also found and
fixed: the deployed Worker's name was inherited from `package.json`'s
still-generic `"tanstack_start_ts"` — renamed to `weatherwear-ai`, and
confirmed via a real build that Nitro picked it up ("Using auto generated
worker name: weatherwear-ai"). Also found a real Wrangler config-path
conflict between `dist/server/wrangler.json` and the root
`.wrangler/deploy/config.json` — reproduced the actual error, found the
fix (`--config` flag from the project root), and verified end-to-end with
a real `wrangler dev` request that returned genuine server-rendered HTML.

**Two conflicting lockfiles.**
`bun.lock` (stale — zero `firebase` entries despite it being a real
dependency) and `package-lock.json` coexisted. `bun` isn't available in
this environment to regenerate `bun.lock` properly. Standardized on npm
(verified end-to-end all session: install, build, lint, typecheck, deploy
smoke test) and removed `bun.lock` + `bunfig.toml`. If you use `bun`
locally, delete `package-lock.json` and run `bun install` to regenerate a
current `bun.lock` instead.

**Three genuinely orphaned dependencies.**
`@hookform/resolvers`, `zod`, `date-fns` had zero references anywhere in
`src/`, including inside the shadcn scaffold files (`form.tsx`,
`calendar.tsx`) that would most plausibly need them — confirmed via direct
grep before removing, not assumed. Removed; build/typecheck/lint all still
clean afterward.

## Known, accepted debt (left as-is, with reasoning)

**~36 unused shadcn/ui component files** (`accordion`, `calendar`,
`dialog`, `table`, `select`, etc.) plus `react-hook-form` (used only inside
the unused `form.tsx`). These have **zero runtime cost** — nothing imports
them, so Vite never bundles them; this is a repo-tidiness question, not a
performance one. Left in place deliberately: they're foundational
scaffolding the Lovable/shadcn template ships with, self-consistent (the
files and the packages they need match each other), and removing them is a
judgment call about future flexibility, not a clear bug. If you want a
leaner repo, removing unused `ui/*.tsx` files and re-running the unused-
dependency check is straightforward — just re-verify the build afterward.

**`cloudSync.ts` is architecture-only, zero call sites.** Even if Firebase
were fully configured today, preferences and favorites would still only
live in `localStorage` — nothing calls `cloudSync.syncPrefs` or
`syncFavorite` from any screen. Wiring it in (e.g., from inside
`savePrefs`/`saveFavorite`, or after a successful sign-in) is a deliberate
follow-up, not done here since it touches multi-device account semantics
that go beyond a prep pass.

**`billing.openCustomerPortal()` has zero call sites.** `premium.tsx` never
calls it — there's no "manage subscription" UI yet. Low priority until
real subscriptions exist.

**`premium: true` doesn't gate anything.** Upgrading flips a boolean in
`Prefs` that's displayed as a status badge in Settings, but no screen or
feature actually checks it to unlock/restrict behavior. The monetization
surface exists; the product differentiation behind it doesn't yet.

## Watch items (not bugs today, worth knowing about)

**`Favorite` schema has no defensive merge.** `loadPrefs()` safely
backfills missing fields via `{ ...defaultPrefs, ...stored }`, so old
localStorage data surviving a `Prefs` schema change is already handled.
`loadFavorites()` has no equivalent — if the `Favorite` shape ever changes,
old saved favorites won't get new fields backfilled. Not an issue today
since the shape hasn't changed, but worth the same treatment if it does.

**Open-Meteo's free tier has rate limits.** Fine at current scale; revisit
if traffic grows enough to matter (the provider abstraction makes switching
straightforward when that day comes).

**349KB baseline JS chunk (React + TanStack + Radix UI).** This is the
shared framework chunk loaded on every page — confirmed unrelated to the
Firebase issue (size was identical before and after that fix). Normal for
this stack; not flagged as a problem, just noted so it isn't mistaken for
remaining Firebase bloat.
