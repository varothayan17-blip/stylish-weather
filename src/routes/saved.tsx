import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { loadFavorites, removeFavorite, FAV_KEY, type Favorite } from "@/lib/preferences";
import { Heart, Trash2 } from "lucide-react";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved outfits — Aeruvo" },
      { name: "description", content: "Your favorite outfit recommendations, saved for later." },
    ],
  }),
  component: Saved,
});

function Saved() {
  const [favs, setFavs] = useState<Favorite[]>([]);

  function refresh() {
    setFavs(loadFavorites());
  }

  useEffect(() => {
    // Load on mount
    refresh();

    // BUG FIX: TanStack Router keeps this component mounted when navigating
    // between bottom-nav tabs. The initial useEffect([]) fires only on first
    // mount, so saving on the Home screen and then tapping Saved showed an
    // empty or stale list because the component was never unmounted/remounted.
    //
    // Fix 1: 'storage' event — fires in the current window when any tab
    // writes to localStorage (including the same tab, in modern browsers).
    // This catches the case where Home saves a favorite and the user then
    // taps the Saved tab.
    //
    // Fix 2: 'focus' + 'visibilitychange' — catches app reopen, switching
    // back from another app, and cross-device Firestore restores.
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAV_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Wardrobe
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Saved outfits</h1>
      </header>

      {favs.length === 0 ? (
        <div className="glass-card mt-12 flex flex-col items-center gap-3 rounded-[2rem] px-6 py-12 text-center animate-fade-up">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Heart className="h-6 w-6" />
          </div>
          <p className="font-semibold">Nothing saved yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Tap "Save this outfit" on today's recommendation to keep it here.
          </p>
          <Link
            to="/"
            className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
          >
            See today
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {favs.map((f, i) => (
            <li
              key={f.id}
              className="glass-card rounded-[2rem] p-5 animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {Math.round(f.tempC)}° · {f.condition} ·{" "}
                    {new Date(f.savedAt).toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <p className="mt-1 font-medium leading-snug">{f.title}</p>
                </div>
                <button
                  onClick={() => {
                    removeFavorite(f.id);
                    refresh();
                  }}
                  aria-label={`Remove "${f.title}" from saved outfits`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground/5 text-muted-foreground transition-colors hover:text-destructive active:scale-95"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {f.items.map((it) => (
                  <span
                    key={it}
                    className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
                  >
                    {it}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
