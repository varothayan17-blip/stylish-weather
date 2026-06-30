export type Commute = "walk" | "ttc" | "drive" | "cycle";
export type Prefs = {
  coldSensitivity: "cold" | "normal" | "hot";
  commute: Commute;
  city?: { name: string; lat: number; lon: number };
  theme: "light" | "dark" | "system";
  name?: string;
  email?: string;
  onboarded?: boolean;
  premium?: boolean;
  /** Unix timestamp (ms) when the free trial ends. Null = no trial started. */
  trialEndsAt?: number;
};

export const PREFS_KEY = "weatherwear:prefs";
export const FAV_KEY = "weatherwear:favs";

export const defaultPrefs: Prefs = {
  coldSensitivity: "normal",
  commute: "walk",
  theme: "system",
};

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch {
    return defaultPrefs;
  }
}
export function savePrefs(p: Prefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

/**
 * Save prefs locally AND push to Firestore if the user has an email and
 * Firebase is configured. Import this in screens that modify preferences so
 * changes sync cross-device automatically. Falls back silently on any error.
 */
export async function saveAndSyncPrefs(p: Prefs): Promise<void> {
  savePrefs(p);
  try {
    const { cloudSync } = await import("./cloudSync");
    if (!cloudSync.isActive()) return;
    const { getUid } = await import("./auth");
    const uid = await getUid();
    if (uid) {
      await cloudSync.syncPrefs(uid, p);
    }
  } catch {
    // Sync failure is non-fatal — local state is always the source of truth
  }
}

export type Favorite = {
  id: string;
  title: string;
  items: string[];
  tempC: number;
  condition: string;
  savedAt: number;
};

export function loadFavorites(): Favorite[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function saveFavorite(f: Favorite) {
  const all = loadFavorites();
  all.unshift(f);
  localStorage.setItem(FAV_KEY, JSON.stringify(all.slice(0, 50)));
}
export function removeFavorite(id: string) {
  const all = loadFavorites().filter((f) => f.id !== id);
  localStorage.setItem(FAV_KEY, JSON.stringify(all));
}

/**
 * crypto.randomUUID() requires iOS 15.4+. On older devices it throws a
 * TypeError which silently kills the entire save handler. This function
 * provides a fallback UUID-shaped string for devices that don't support it.
 */
export function safeUUID(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback: timestamp + random hex — not cryptographically strong but
    // sufficient for a locally-scoped favorite ID.
    const ts = Date.now().toString(16);
    const rand = Math.random().toString(16).slice(2, 10);
    return `${ts}-${rand}-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}
