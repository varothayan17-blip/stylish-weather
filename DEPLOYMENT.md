# Deploying WeatherWear AI

This app builds to **Cloudflare Workers** (via Nitro's `cloudflare-module`
preset, pinned explicitly in `vite.config.ts`). `npm run build` always
produces the same output regardless of where it's run:

```
dist/client/   → static assets (served as the Worker's ASSETS binding)
dist/server/   → the Worker itself (index.mjs) + a generated wrangler.json
```

## Option A — Publish through Lovable (no setup)

If you're editing this project in Lovable, the built-in Publish button
handles the Cloudflare deployment for you — nothing in this guide is
required for that path.

## Option B — Self-deploy to your own Cloudflare account

Useful if you want a custom domain, your own env vars/secrets, or to take
this off Lovable's infrastructure entirely.

1. `npm install -g wrangler` (or use `npx wrangler` each time, no global install needed)
2. `wrangler login` — authenticates against your own Cloudflare account
3. `npm run build`
4. `npx wrangler deploy --config dist/server/wrangler.json` — run from the
   project root (see the note below about why `cd`-ing into `dist/server`
   first causes a config conflict)

The worker deploys under the name set in `package.json`'s `"name"` field
(`weatherwear-ai`) — rename that before deploying if you want a different
worker name.

### Environment variables in production

Every `VITE_*` variable (see `.env.example`) is inlined into the client
bundle **at build time**, not read at runtime. That means:

- For local development: put them in a `.env` file (gitignored, never commit it).
- For Cloudflare deployment: set them wherever `npm run build` actually
  runs — as repo/CI secrets if you build in GitHub Actions, or as Wrangler
  build-time vars if you build directly before `wrangler deploy`. They do
  **not** go in `wrangler.json`'s runtime `vars`/`secrets` sections, since
  those only affect server-side code, and a Vite client build has already
  baked `VITE_*` values into the JS by the time Wrangler sees it.
- The only genuinely server-side secret this app would ever need is a
  Stripe **secret** key, and only once `/api/create-checkout-session` (see
  `src/lib/billing.ts`) is actually implemented as a server route — that
  one belongs in Wrangler secrets (`wrangler secret put STRIPE_SECRET_KEY`),
  never in a `VITE_*` variable, since `VITE_*` vars are public by design.

### Smoke-testing the build before deploying

```
npm run build
npx wrangler dev --config dist/server/wrangler.json --port 8787
```

Run this from the **project root**, not from inside `dist/server` — Nitro
also generates `.wrangler/deploy/config.json` at the project root, and
Wrangler needs both config files to share a base path to avoid an
ambiguous-config error. The explicit `--config` flag resolves that.

This runs the real Worker locally against Cloudflare's dev runtime (via
Miniflare) — closer to production behavior than `vite dev`, since it
exercises the actual built Worker rather than Vite's dev server. Verified
working: this serves the real server-rendered app (confirmed via a direct
HTTP request returning the actual page HTML, not a placeholder).

One harmless warning you may see on startup —
`Unable to fetch the 'Request.cf' object! Falling back to a default
placeholder` — is Miniflare trying to fetch real Cloudflare request
metadata and failing gracefully; it doesn't block the server from starting
or serving requests.

For an actual deploy (not just a local smoke test):

```
npx wrangler deploy --config dist/server/wrangler.json
```
