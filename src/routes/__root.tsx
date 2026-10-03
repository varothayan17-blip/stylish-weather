import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
import { registerServiceWorker } from "../lib/registerSW";
import { NOTIFICATIONS_ENABLED } from "../lib/preferences";
import { initRegistrationSync } from "../lib/notifications";
import { getUid } from "../lib/auth";
import { cloudSync } from "../lib/cloudSync";
import { subscribeToAuthState } from "../lib/auth";
import { clearObsoleteGuestMarker } from "../lib/introState";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Aeruvo" },
      { name: "description", content: "Know what to wear before you leave." },
      { name: "theme-color", content: "#3a8ff5" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Aeruvo" },
      { property: "og:title", content: "Aeruvo" },
      { property: "og:description", content: "Know what to wear before you leave." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/icon-512.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Aeruvo" },
      { name: "twitter:description", content: "Know what to wear before you leave." },
      { name: "twitter:image", content: "/icon-512.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    registerServiceWorker();
    clearObsoleteGuestMarker(); // remove legacy "aeruvo:guest-setup" marker safely

    // Persistent FID synchronisation: when notifications are enabled and the
    // user is authenticated, establish the onRegistered listener so Aeruvo
    // always has the current FID even if Firebase rotates it.
    let unsubFid: (() => void) | undefined;
    if (NOTIFICATIONS_ENABLED) {
      getUid().then(async (uid) => {
        if (!uid) return;
        const np = await cloudSync.pullNotificationPrefs(uid).catch(() => null);
        if (np?.enabled) {
          unsubFid = await initRegistrationSync(uid);
        }
      }).catch(() => {});
    }

    // Subscribe to Firebase Auth state. Fires immediately if a session already
    // exists (app reopen / page refresh) and syncs Firestore prefs silently.
    // Returns an unsubscribe function — call it on cleanup to avoid memory leaks.
    //
    // Scan-consent isolation (item 4 — A → B direct switch):
    //  Track the previous UID so we can detect both A → null AND A → B transitions.
    //  Clear consent state whenever the UID changes from a non-null previous value,
    //  but NOT on the initial emission (prevUid is still "__initial__") so we don't
    //  wrongly clear a valid session on first load.
    const INITIAL_SENTINEL = "__initial__";
    let prevUid: string | null = INITIAL_SENTINEL as unknown as string | null;

    let unsubscribe: (() => void) | undefined;
    subscribeToAuthState((uid) => {
      if (prevUid !== (INITIAL_SENTINEL as unknown as string | null)) {
        // Not the initial emission — clear if UID changed (A → null or A → B)
        if (uid !== prevUid) {
          import("../lib/scanConsentStore").then(({ clearConsentState }) => {
            clearConsentState();
          }).catch(() => {});
        }
      }
      prevUid = uid;
    }).then((fn) => {
      unsubscribe = fn;
    });
    return () => { unsubscribe?.(); unsubFid?.(); };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
