import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Sparkles, Shirt, CalendarClock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ItemTile } from "@/components/wardrobe/ItemTile";
import { AddClothingSheet } from "@/components/wardrobe/AddClothingSheet";
import { ItemDetailSheet } from "@/components/wardrobe/ItemDetailSheet";
import { useWardrobe, wardrobe } from "@/components/wardrobe/wardrobeStore";
import { useResolvedOutfit, clearResolvedOutfit, isOutfitFresh } from "@/lib/resolvedOutfit";
import { getUid } from "@/lib/auth";
import { useEntitlement } from "@/lib/entitlement";
import { WardrobeEntrance } from "@/components/wardrobe/WardrobeEntrance";
import { CATEGORIES, type WardrobeItem } from "@/components/wardrobe/wardrobeData";
import { WARDROBE_OPEN_ITEM_KEY } from "@/lib/wardrobeMatch";
import { useAuthGuard } from "@/lib/useAuthGuard";

export const Route = createFileRoute("/wardrobe")({
  head: () => ({
    meta: [
      { title: "My Wardrobe — Aeruvo" },
      {
        name: "description",
        content:
          "Your clothes, matched to today's weather. Build your Aeruvo wardrobe and get outfits from pieces you actually own.",
      },
      { property: "og:title", content: "My Wardrobe — Aeruvo" },
      {
        property: "og:description",
        content: "Your clothes, matched to today's weather.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Wardrobe,
});

const FILTERS = ["All", ...CATEGORIES] as const;

function Wardrobe() {
  const { authLoading } = useAuthGuard();
  const items = useWardrobe();

  // Open item detail when navigating from the "From your wardrobe" section
  // on the Today screen. The item ID is stored in sessionStorage.
  useEffect(() => {
    try {
      const id = typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem(WARDROBE_OPEN_ITEM_KEY)
        : null;
      if (id) {
        sessionStorage.removeItem(WARDROBE_OPEN_ITEM_KEY);
        setSelected(id);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [intro, setIntro] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "All" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );
  const resolvedOutfit = useResolvedOutfit();
  const entitlement    = useEntitlement();
  const isPremium      = !entitlement.loading && entitlement.active;

  // Clear stored snapshot when the user is not Premium (signed out or free)
  // so a prior Premium session's clothing names cannot leak.
  useEffect(() => {
    if (!entitlement.loading && !isPremium) {
      getUid().then((uid) => clearResolvedOutfit(uid));
    }
  }, [entitlement.loading, isPremium]);

  // Live Today's picks: matched items from the current resolved outfit.
  // Premium only. Uses the same snapshot as Home so they always agree.
  // Unmatched slots and unavailable items are excluded.
  // Stale (yesterday's) snapshots are filtered at the store level (loadFromStorage).
  const picks = useMemo(() => {
    if (!isPremium || !resolvedOutfit) return [];
    if (!isOutfitFresh(resolvedOutfit)) return []; // extra safety check
    return resolvedOutfit.slots
      .filter((s) => s.matched)
      .map((s) => {
        if (!s.matched) return null;
        return items.find((i) => i.id === s.itemId && !i.unavailable) ?? null;
      })
      .filter((item): item is WardrobeItem => item !== null);
  }, [isPremium, resolvedOutfit, items]);
  const current = items.find((i) => i.id === selected) ?? null;

  if (authLoading) return null;

  return (
    <>
      {intro && <WardrobeEntrance onDone={() => setIntro(false)} />}
      <div
        style={intro
          ? { opacity: 0, pointerEvents: "none" }
          : { opacity: 1, transition: "opacity 300ms ease" }
        }
      >
      <AppShell>
      <header className="mb-6 animate-fade-up">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Wardrobe AI
          </p>
          <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-inset ring-primary/20">
            Premium
          </span>
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">My Wardrobe</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your clothes, matched to today&apos;s weather.
        </p>
      </header>

      <button
        onClick={() => setAdding(true)}
        className="press mb-6 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3.5 text-sm font-semibold text-background animate-fade-up"
        style={{ animationDelay: "40ms" }}
      >
        <Plus className="h-4 w-4" /> Add clothing
      </button>

      {/* Today's picks: live matches from the current Home recommendation.
          Premium only — free users see the generic recommendation without
          personal wardrobe items. Hidden if no matches or not yet resolved. */}
      {isPremium && picks.length > 0 && (
        <section
          className="glass-card mb-6 rounded-[2rem] p-5 animate-fade-up"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">Today&apos;s picks</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">From your wardrobe — best for today</p>
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            {picks.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                aria-label={`View ${p.name}`}
                className="press text-left"
              >
                <ItemTile category={p.category} tint={p.tint} className="aspect-square w-full" iconClassName="h-7 w-7" />
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                  {p.name}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Plan with my wardrobe shortcut — links to /plan */}
      <div className="mb-4 animate-fade-up" style={{ animationDelay: "60ms" }}>
        <Link {...{to: "/plan" as any}}
          className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] px-4 py-3 ring-1 ring-primary/15 hover:ring-primary/30 transition-all">
          <CalendarClock className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary">Plan with my wardrobe</span>
        </Link>
      </div>

      {items.length > 0 && (
        <div
          className="scrollbar-none -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1 animate-fade-up"
          style={{ animationDelay: "120ms" }}
          role="tablist"
          aria-label="Filter wardrobe by category"
        >
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={`press shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"
                    : "glass-card text-muted-foreground"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div className="glass-card mt-8 flex flex-col items-center gap-3 rounded-[2rem] px-6 py-14 text-center animate-fade-up">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Shirt className="h-6 w-6" />
          </div>
          <p className="font-semibold">Your wardrobe starts here.</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Add a few pieces and Aeruvo will eventually build outfits from what you actually own.
          </p>
          <button
            onClick={() => setAdding(true)}
            className="press mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
          >
            Add your first item
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing in {filter} yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((item, i) => (
            <li key={item.id} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <button
                onClick={() => setSelected(item.id)}
                className={`press glass-card w-full overflow-hidden rounded-[1.75rem] p-3 text-left ${
                  item.unavailable ? "opacity-50" : ""
                }`}
              >
                <ItemTile
                  category={item.category}
                  tint={item.tint}
                  className="aspect-square w-full"
                  iconClassName="h-10 w-10"
                />
                <p className="mt-2.5 truncate text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.category}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.labels.slice(0, 2).map((l) => (
                    <span
                      key={l}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddClothingSheet open={adding} onClose={() => setAdding(false)} onAdd={(i) => wardrobe.add(i)} />
      <ItemDetailSheet
        item={current}
        onClose={() => setSelected(null)}
        onToggleFavourite={() => current && wardrobe.update(current.id, { favourite: !current.favourite })}
        onToggleUnavailable={() =>
          current && wardrobe.update(current.id, { unavailable: !current.unavailable })
        }
        onRemove={() => current && wardrobe.remove(current.id)}
      />
    </AppShell>
      </div>
    </>
  );
}
