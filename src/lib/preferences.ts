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
};

const KEY = "weatherwear:prefs";
const FAV_KEY = "weatherwear:favs";

export const defaultPrefs: Prefs = {
  coldSensitivity: "normal",
  commute: "walk",
  theme: "system",
};

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrefs;
    return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch { return defaultPrefs; }
}
export function savePrefs(p: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(p));
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
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]"); } catch { return []; }
}
export function saveFavorite(f: Favorite) {
  const all = loadFavorites();
  all.unshift(f);
  localStorage.setItem(FAV_KEY, JSON.stringify(all.slice(0, 50)));
}
export function removeFavorite(id: string) {
  const all = loadFavorites().filter(f => f.id !== id);
  localStorage.setItem(FAV_KEY, JSON.stringify(all));
}