/**
 * OutfitSlotList.tsx
 *
 * Slot-by-slot outfit list for Today's recommendation.
 *
 * ── Product rule ─────────────────────────────────────────────────────────
 *   Free    → plain generic bullet list; saved item names never revealed.
 *   Premium → each generic slot is replaced in-place with "Your {saved item name}"
 *             when an exact compatible saved item exists. Unmatched slots keep
 *             their generic text. Slot order is always preserved.
 *
 * ── Entitlement boundary ─────────────────────────────────────────────────
 * useEntitlement() is the single authoritative hook (reads Firestore backend doc).
 * wardrobeMatch.ts remains pure and billing-unaware.
 *
 * ── Navigation ───────────────────────────────────────────────────────────
 * Tapping a matched slot stores the item ID under WARDROBE_OPEN_ITEM_KEY
 * (from @/lib/wardrobeMatch) and navigates to /wardrobe, where wardrobe.tsx
 * reads the key and opens the ItemDetailSheet for that item.
 */

import { useNavigate } from "@tanstack/react-router";
import { Shirt } from "lucide-react";
import { useWardrobe } from "@/components/wardrobe/wardrobeStore";
import { useEntitlement } from "@/lib/entitlement";
import {
  slotMatchMap,
  bandFromFeels,
  WARDROBE_OPEN_ITEM_KEY,
} from "@/lib/wardrobeMatch";
import type { Recommendation } from "@/lib/recommend";

type Props = {
  rec: Pick<Recommendation, "outfit" | "effectiveFeelsC">;
};

export function OutfitSlotList({ rec }: Props) {
  const entitlement = useEntitlement();
  const items       = useWardrobe();
  const navigate    = useNavigate();

  // While entitlement is loading → render generic slots (no flash of premium content).
  // active:false for any reason → free experience, generic text only.
  const isPremium = !entitlement.loading && entitlement.active;

  const band = bandFromFeels(rec.effectiveFeelsC);
  // slotMatchMap is only computed for Premium users — saves unnecessary work for free users.
  const sMap = isPremium ? slotMatchMap(rec, items, band) : new Map();

  function openItem(id: string) {
    try {
      sessionStorage.setItem(WARDROBE_OPEN_ITEM_KEY, id);
    } catch { /* ignore — navigation still works */ }
    navigate({ to: "/wardrobe" });
  }

  return (
    <ul className="mt-5 space-y-2">
      {rec.outfit.map((genericText, i) => {
        const match = sMap.get(i);

        if (!match) {
          // ── Generic slot: free user OR no compatible saved item for this slot ──
          return (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="text-foreground/90">{genericText}</span>
            </li>
          );
        }

        // ── Premium: specific saved item replaces this slot in-place ─────────
        const { item } = match;
        return (
          <li key={i}>
            <button
              onClick={() => openItem(item.id)}
              className="press flex w-full items-center gap-2.5 rounded-2xl bg-primary/[0.05] px-3 py-2 text-left transition-colors hover:bg-primary/[0.09]"
            >
              {/* Colour swatch from the saved item's tint gradient */}
              <span
                aria-hidden
                className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${item.tint}`}
              />
              <span className="min-w-0 flex-1">
                {/* item.name comes from user confirmation — never inferred or invented */}
                <span className="block truncate text-sm font-medium text-foreground/95">
                  Your {item.name}
                </span>
              </span>
              <Shirt
                className="h-3.5 w-3.5 shrink-0 text-primary/50"
                aria-label="From your wardrobe"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
