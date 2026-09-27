/**
 * index.ts — Firebase Cloud Functions entry point for Aeruvo Stage E.
 *
 * Initializes Firebase Admin and exports all Stage E functions.
 *
 * Uses modular firebase-admin subpackage APIs (not deprecated namespace APIs).
 * App initialization happens once here; individual function files call
 * getFirestore(), getMessaging() without re-initializing.
 */

import { initializeApp } from "firebase-admin/app";

// Initialize Admin SDK once. Cloud Functions runtime provides credentials
// automatically — no explicit credential configuration needed.
initializeApp();

// ── Stage E functions ─────────────────────────────────────────────────────
export { onNotifPrefsUpdate }    from "./onNotifPrefsUpdate";
export { morningRainCheck }      from "./morningRainCheck";
export { sendTestNotification }  from "./sendTestNotification";
