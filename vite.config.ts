// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pinned explicitly rather than relying on Lovable-sandbox auto-detection,
  // which otherwise only applies a preset when building inside Lovable's own
  // environment (and defaults to Cloudflare there). This makes `npm run build`
  // produce identical Vercel-deployable output everywhere it's run.
  //
  // DEPLOYMENT TARGET: Vercel.
  // The "vercel" preset makes Nitro emit output in Vercel's Build Output API
  // v3 format under .vercel/output/ — a serverless function for SSR plus a
  // static directory for client assets. Vercel auto-detects this format with
  // zero vercel.json required; it is the same mechanism the Vercel CLI and
  // Vercel's own framework presets use under the hood.
  //
  // NOTE: this previously was "cloudflare-module" with Cloudflare-specific
  // output dirs and options (nodeCompat, deployConfig). Those options are
  // Cloudflare Workers-only and have no effect under the vercel preset, so
  // they have been removed rather than left as dead config. If you need to
  // deploy to Cloudflare Workers again later, see DEPLOYMENT.md for the
  // preset value and options to restore.
  nitro: {
    preset: "vercel",
  },
});
