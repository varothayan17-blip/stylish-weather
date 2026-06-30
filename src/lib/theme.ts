import { PREFS_KEY } from "./preferences";

export type Theme = "light" | "dark" | "system";

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

/**
 * Inline boot script injected directly into <head>, before hydration.
 * Reads the persisted theme synchronously and applies the `dark` class
 * before first paint, so there's no flash of the wrong theme on load.
 * Kept deliberately tiny and dependency-free since it runs outside React.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(PREFS_KEY)});var theme='system';if(raw){var p=JSON.parse(raw);if(p&&p.theme)theme=p.theme;}var dark=theme==='dark'||(theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`;
