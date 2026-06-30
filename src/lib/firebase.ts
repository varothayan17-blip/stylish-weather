/**
 * Firebase client — Firestore + Auth.
 * Inert until all VITE_FIREBASE_* env vars are present.
 * All SDK imports are dynamic so the bundle stays small when unconfigured.
 */
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

export function isFirebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
  );
}

let appPromise: Promise<FirebaseApp | null> | null = null;

function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  if (!appPromise) {
    appPromise = import("firebase/app").then(({ initializeApp, getApps }) => {
      if (getApps().length > 0) return getApps()[0];
      return initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      });
    });
  }
  return appPromise;
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  const app = await getFirebaseApp();
  if (!app) return null;
  const { getAuth } = await import("firebase/auth");
  return getAuth(app);
}

export async function getFirestoreDb(): Promise<Firestore | null> {
  const app = await getFirebaseApp();
  if (!app) return null;
  const { getFirestore } = await import("firebase/firestore");
  return getFirestore(app);
}
