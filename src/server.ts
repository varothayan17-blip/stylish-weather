import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ── Stripe API route handlers (server-only) ──────────────────────────────────
// These imports are server-only. They must NEVER be imported from client code.
// Loaded lazily so the bundle never includes stripe/firebase-admin.
async function getApiHandlers() {
  return import("./lib/stripe-api-handlers");
}

async function getWardrobeHandlers() {
  return import("./lib/wardrobe-ai-handler");
}


type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // ── Stripe API routes ─────────────────────────────────────────────────
      // Intercepted before TanStack Start so these never appear in the client
      // bundle and the server-only imports (stripe, firebase-admin) stay server-only.
      const { pathname } = new URL(request.url);
      const apiPaths = new Set([
        "/api/create-checkout-session",
        "/api/create-portal-session",
        "/api/stripe-webhook",
        "/api/wardrobe/scan",
      ]);
      if (apiPaths.has(pathname)) {
        // Reject all non-POST methods explicitly — prevents information disclosure
        // via falling through to TanStack Start router for wrong-method requests.
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { Allow: "POST" },
          });
        }
        const handlers = await getApiHandlers();
        if (pathname === "/api/create-checkout-session") {
          return await handlers.handleCreateCheckoutSession(request);
        }
        if (pathname === "/api/create-portal-session") {
          return await handlers.handleCreatePortalSession(request);
        }
        if (pathname === "/api/stripe-webhook") {
          return await handlers.handleStripeWebhook(request);
        }
        if (pathname === "/api/wardrobe/scan") {
          const { handleWardrobeScan } = await getWardrobeHandlers();
          return await handleWardrobeScan(request);
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
