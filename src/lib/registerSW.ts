/**
 * Registers the app-shell service worker. Client-only, no-op during SSR.
 *
 * Firebase config for FCM is injected into the SW via the auto-generated
 * public/firebase-sw-config.js (created by scripts/generate-sw-config.cjs
 * at build/dev time). The SW importScripts() it at startup — no postMessage
 * dependency, no cold-start gap when the SW wakes from a push event.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have, not a hard requirement.
    });
  });
}
