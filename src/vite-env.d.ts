/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHER_PROVIDER?: "open-meteo" | "weatherapi";
  readonly VITE_WEATHER_API_KEY?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
