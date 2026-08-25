/**
 * OutfitSlotList.tsx
 *
 * Slot-by-slot outfit list for Today's recommendation.
 *
 * ── Product rule ─────────────────────────────────────────────────────────
 *   Free    → plain generic bullets; saved item names never revealed.
 *   Premium → each slot replaced in-place with "Your {saved item name}"
 *             when a compatible saved item exists. Unmatched slots keep
 *             their generic text. Slot order is always preserved.
 *
 * ── Strict Mode / ref safety ─────────────────────────────────────────────
 * Slot resolution is performed by useResolvedSlots() in index.tsx (the
 * parent). This component receives the pre-computed { sMap, resolvedSlots }
 * and renders them. The save handler in index.tsx closes over resolvedSlots
 * directly — the same value used for display. No ref mutation during child
 * render; no parent-owned ref mutated inside a child; no Strict Mode issues.
 *
 * ── Navigation ───────────────────────────────────────────────────────────
 * Tapping a matched slot stores the item ID in sessionStorage and navigates
 * to /wardrobe, where wardrobe.tsx opens the ItemDetailSheet for that item.
 */

import { useNavigate } from "@tanstack/react-router";
import { Shirt } from "lucide-react";
import { WARDROBE_OPEN_ITEM_KEY } from "@/lib/wardrobeMatch";
import type { ResolvedSlotsResult } from "@/lib/useResolvedSlots";
import type { Recommendation } from "@/lib/recommend";

type Props = {
  rec:     Pick<Recommendation, "outfit">;
  /** Pre-computed by useResolvedSlots() in the parent. */
  slots:   ResolvedSlotsResult;
};

export function OutfitSlotList({ rec, slots: { sMap } }: Props) {
  const navigate = useNavigate();

  function openItem(id: string) {
    try { sessionStorage.setItem(WARDROBE_OPEN_ITEM_KEY, id); } catch { /* ignore */ }
    navigate({ to: "/wardrobe" });
  }

  return (
    <ul className="mt-5 space-y-2">
      {rec.outfit.map((genericText, i) => {
        const match = sMap.get(i);

        if (!match) {
          return (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="text-foreground/90">{genericText}</span>
            </li>
          );
        }

        const { item } = match;
        return (
          <li key={i}>
            <button
              onClick={() => openItem(item.id)}
              className="press flex w-full items-center gap-2.5 rounded-2xl bg-primary/[0.05] px-3 py-2 text-left transition-colors hover:bg-primary/[0.09]"
            >
              <span
                aria-hidden
                className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${item.tint}`}
              />
              <span className="min-w-0 flex-1">
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
