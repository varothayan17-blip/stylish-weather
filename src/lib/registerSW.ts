/**
 * registerSW.ts — Service worker registration for Aeruvo.
 *
 * Provides two exports:
 *
 * registerServiceWorker()
 *   Called once at app startup from __root.tsx useEffect.
 *   Registers /sw.js with diagnostic logging. Never blocks the app.
 *   Handles the iOS standalone PWA case where `load` may already have
 *   fired before React hydration runs.
 *
 * ensureServiceWorkerRegistration(timeoutMs?)
 *   Used by the notification enable flow (notifications.ts).
 *   Guarantees a registered, active ServiceWorkerRegistration is returned,
 *   or throws a ServiceWorkerError with a specific machine-readable code.
 *
 *   Algorithm:
 *   1. Verify serviceWorker API is available.
 *   2. Look for any existing registration whose scriptURL ends with /sw.js.
 *   3. If none found: call register() now (no load-event dependency).
 *   4. If already active: return immediately.
 *   5. Otherwise: attach a statechange listener on the installing/waiting
 *      worker and check reg.active immediately after (avoids the race where
 *      the SW activates between register() returning and the listener being
 *      attached).
 *   6. A bounded timeout ensures the call always resolves or rejects.
 *
 * Why this matters:
 *   navigator.serviceWorker.ready waits indefinitely when there are zero
 *   registrations (SW_NOT_REGISTERED). This function registers if needed
 *   and waits with a timeout, so the notification flow always gets a
 *   precise error instead of hanging.
 */

const SW_URL   = "/sw.js";
const SW_SCOPE = "/";

// ── Startup registration ──────────────────────────────────────────────────

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  // Do not register the production service worker during local development.
  // On localhost the SW intercepts requests that are served by the Vite dev
  // server (hot-module replacement, etc.) and can throw:
  //   TypeError: Failed to execute 'clone' on 'Response': Response body is already used
  // This guard ensures the error is not hidden — production behaviour is intact.
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    console.info("[swreg] skipping registration on localhost (dev mode)");
    return;
  }

  const doRegister = () => {
    console.log("[swreg] start");
    console.log("[swreg] supported:yes");
    console.log(`[swreg] register:start url=${SW_URL} scope=${SW_SCOPE}`);

    navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .then((reg) => {
        const state =
          reg.active?.state ??
          (reg.installing ? "installing" : reg.waiting ? "waiting" : "unknown");
        console.log(`[swreg] register:success scope=${reg.scope} state=${state}`);
        console.log(`[swreg] controller:${navigator.serviceWorker.controller ? "yes" : "no"}`);
      })
      .catch((err: unknown) => {
        // Log the error — never swallow it silently so it appears in diagnostics.
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn(`[swreg] register:error name=${e.name} message=${e.message}`);
      });
  };

  // On iOS standalone PWA, `load` fires before React hydration, so the
  // event listener may never fire. Detect this and call doRegister() directly.
  if (document.readyState === "complete") {
    doRegister();
  } else {
    window.addEventListener("load", doRegister, { once: true });
  }
}

// ── Typed error ───────────────────────────────────────────────────────────

export type SwRegistrationErrorCode =
  | "SW_UNSUPPORTED"
  | "SW_REGISTRATION_FAILED"
  | "SW_ACTIVATION_TIMEOUT"
  | "SW_SCRIPT_ERROR";

export class ServiceWorkerError extends Error {
  constructor(
    public readonly code: SwRegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceWorkerError";
  }
}

// ── Shared ensure-registration ────────────────────────────────────────────

export async function ensureServiceWorkerRegistration(
  timeoutMs = 15_000,
): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new ServiceWorkerError("SW_UNSUPPORTED", "ServiceWorker API not available");
  }

  // ── Step 1: inspect existing registrations ──────────────────────────────
  let reg: ServiceWorkerRegistration | undefined;
  try {
    const all = await navigator.serviceWorker.getRegistrations();
    reg = all.find((r) => {
      const script =
        r.active?.scriptURL ??
        r.installing?.scriptURL ??
        r.waiting?.scriptURL ??
        "";
      return script.endsWith(SW_URL);
    });

    console.log(
      `[swreg] ensure: existing count=${all.length} matching=${reg ? "yes" : "no"}`,
      all.map((r) => ({
        scope: r.scope,
        script: r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "none",
        state:
          r.active?.state ??
          (r.installing ? "installing" : r.waiting ? "waiting" : "none"),
      })),
    );
  } catch (getErr) {
    console.warn("[swreg] ensure: getRegistrations error:", getErr);
    // Non-fatal — fall through to register()
  }

  // ── Step 2: register if missing ─────────────────────────────────────────
  if (!reg) {
    console.log(`[swreg] ensure: no matching reg — calling register(${SW_URL})`);
    try {
      reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      console.log(`[swreg] ensure: register() returned scope=${reg.scope}`);
    } catch (regErr) {
      const e = regErr instanceof Error ? regErr : new Error(String(regErr));
      console.warn(`[swreg] ensure: register failed name=${e.name} message=${e.message}`);
      throw new ServiceWorkerError(
        "SW_REGISTRATION_FAILED",
        `register() failed: ${e.message}`,
      );
    }
  }

  // ── Step 3: already active — return now ─────────────────────────────────
  if (reg.active) {
    console.log(`[swreg] ensure: already active state=${reg.active.state}`);
    return reg;
  }

  // ── Step 4: wait for activation with bounded timeout ────────────────────
  // The SW may be installing or waiting. We attach a statechange listener
  // and also check reg.active immediately after attaching to close the race
  // where the SW activates between register() returning and listener setup.
  const installState =
    reg.installing ? "installing" : reg.waiting ? "waiting" : "none";
  console.log(`[swreg] ensure: waiting for activation install-state=${installState}`);

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = setTimeout(() => {
      const s =
        reg!.active?.state ??
        (reg!.installing ? "installing" : reg!.waiting ? "waiting" : "none");
      console.warn(`[swreg] ensure: activation timeout install-state=${s}`);
      reject(
        new ServiceWorkerError(
          "SW_ACTIVATION_TIMEOUT",
          `SW did not activate within ${timeoutMs}ms (state=${s})`,
        ),
      );
    }, timeoutMs);

    const succeed = () => {
      clearTimeout(timer);
      console.log(`[swreg] ensure: activated state=${reg!.active?.state ?? "?"}`);
      resolve(reg!);
    };

    const fail = (reason: string) => {
      clearTimeout(timer);
      console.warn(`[swreg] ensure: SW_SCRIPT_ERROR reason=${reason}`);
      reject(new ServiceWorkerError("SW_SCRIPT_ERROR", reason));
    };

    // Identify which worker to watch. skipWaiting() is called in sw.js install,
    // so an `installing` worker will move directly to `activating` → `activated`.
    // A `waiting` worker activates when the old SW releases control.
    const worker = reg!.installing ?? reg!.waiting;

    if (!worker) {
      // Should not happen — reg.active is null but no worker is present.
      // Could occur in a brief window between states; check once more after a tick.
      setTimeout(() => {
        if (reg!.active) {
          succeed();
        } else {
          clearTimeout(timer);
          fail("No worker present after register() and reg.active is null");
        }
      }, 50);
      return;
    }

    const onStateChange = () => {
      if (reg!.active) {
        worker.removeEventListener("statechange", onStateChange);
        succeed();
        return;
      }
      if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onStateChange);
        fail("SW became redundant during installation (script may have an error)");
      }
    };

    worker.addEventListener("statechange", onStateChange);

    // Race-close: check reg.active immediately after attaching the listener.
    // If the SW activated between register() returning and listener setup,
    // this catches it without waiting for another statechange event.
    if (reg!.active) {
      worker.removeEventListener("statechange", onStateChange);
      succeed();
    }
  });
}
