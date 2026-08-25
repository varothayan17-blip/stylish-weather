/**
 * WardrobeMatchSection.tsx
 *
 * "From your wardrobe" section — shown below Today's recommendation card
 * when the user has an active Premium or trial entitlement AND at least one
 * saved item matches the current outfit suggestion.
 *
 * ── Entitlement boundary ─────────────────────────────────────────────────
 * Aeruvo's product strategy:
 *   Free    → Aeruvo knows the weather  (generic recommendation only)
 *   Premium → Aeruvo knows you          (wardrobe-specific items surfaced)
 *
 * Entitlement is read from useEntitlement() — the single centralised hook
 * that reads users/{uid}/entitlements/premium.active from Firestore.
 * This document is written EXCLUSIVELY by the backend (Stripe webhook /
 * Admin SDK). The client never writes it.
 *
 * States and what the user sees:
 *   loading:true               → nothing (section hidden, no flicker)
 *   active:false (any reason)  → nothing (generic recommendation unchanged)
 *   active:true, no matches    → nothing (section hidden)
 *   active:true, ≥1 match      → "From your wardrobe" tiles
 *
 * Cancellation: cancelAtPeriodEnd === true still has active:true until the
 * billing period ends. The Stripe webhook sets active:false only after the
 * subscription actually lapses. Behaviour here follows that automatically.
 *
 * ── Purity boundary ──────────────────────────────────────────────────────
 * wardrobeMatch.ts stays pure and billing-unaware. The entitlement check
 * lives here (the UI integration layer) — not in the matcher.
 *
 * ── Item name display ────────────────────────────────────────────────────
 * Uses item.name as saved — the actual name the user confirmed or Gemini
 * extracted (e.g. "Navy blue crewneck T-shirt"). Never inferred or invented.
 *
 * ── Navigation ───────────────────────────────────────────────────────────
 * Tapping a tile stores the item ID in sessionStorage under
 * WARDROBE_OPEN_ITEM_KEY and navigates to /wardrobe. The Wardrobe route
 * reads that key on mount and opens the ItemDetailSheet for that item.
 *
 * ── Reactivity ───────────────────────────────────────────────────────────
 * useWardrobe() is a useSyncExternalStore subscriber: add/remove/favourite/
 * unavailable changes are reflected immediately without reload.
 */

import { useNavigate } from "@tanstack/react-router";
import { Shirt } from "lucide-react";
import { useWardrobe } from "@/components/wardrobe/wardrobeStore";
import { useEntitlement } from "@/lib/entitlement";
import { matchWardrobeToOutfit, bandFromFeels } from "@/lib/wardrobeMatch";
import type { Recommendation } from "@/lib/recommend";

/** sessionStorage key read by wardrobe.tsx to open the detail sheet */
export const WARDROBE_OPEN_ITEM_KEY = "aeruvo:wardrobe:open-item";

type Props = {
  rec: Pick<Recommendation, "outfit" | "effectiveFeelsC">;
};

export function WardrobeMatchSection({ rec }: Props) {
  const entitlement = useEntitlement();
  const items       = useWardrobe();
  const navigate    = useNavigate();

  // ── Entitlement gate ────────────────────────────────────────────────────
  // While loading: render nothing (avoid flicker — section appears only
  // once we know the user is Premium).
  // active:false for ANY reason (signed-out, missing doc, inactive, error,
  // or cancelAtPeriodEnd after the period has ended):
  //   → render nothing; free users see the generic recommendation unchanged.
  if (entitlement.loading || !entitlement.active) return null;

  // ── Match against saved wardrobe ────────────────────────────────────────
  const band    = bandFromFeels(rec.effectiveFeelsC);
  const matches = matchWardrobeToOutfit(rec, items, band);

  // No items in wardrobe or none match today's outfit → render nothing
  if (matches.length === 0) return null;

  function openItem(id: string) {
    try {
      sessionStorage.setItem(WARDROBE_OPEN_ITEM_KEY, id);
    } catch { /* ignore — navigation still works, detail just won't auto-open */ }
    navigate({ to: "/wardrobe" });
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-primary/15 bg-primary/[0.04] px-4 py-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-primary/70">
        <Shirt className="h-3.5 w-3.5" aria-hidden />
        From your wardrobe
      </p>
      <ul className="space-y-2">
        {matches.map(({ item }) => (
          <li key={item.id}>
            <button
              onClick={() => openItem(item.id)}
              className="press flex w-full items-center gap-3 rounded-2xl bg-background/60 px-3.5 py-2.5 text-left transition-colors hover:bg-background/80"
            >
              {/* Colour swatch derived from the item's tint gradient */}
              <span
                aria-hidden
                className={`h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br ${item.tint}`}
              />
              <span className="min-w-0 flex-1">
                {/* item.name is the real saved name — never inferred or brand-invented */}
                <span className="block truncate text-sm font-medium leading-tight">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.category}
                  {item.type ? ` · ${item.type.split(" / ").pop()}` : ""}
                  {item.favourite ? " ★" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
