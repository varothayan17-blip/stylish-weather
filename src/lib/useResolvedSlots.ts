/**
 * useResolvedSlots.ts — Custom hook that computes and publishes resolved slots.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────
 * Centralises slot resolution so both the display (OutfitSlotList) and the
 * save handler (index.tsx) consume the SAME computed value — no ref mutation
 * during child render, no Strict Mode surprises.
 *
 * ── Data flow ─────────────────────────────────────────────────────────────
 * 1. useMemo computes sMap + resolvedSlots (pure — no side effects).
 * 2. useEffect publishes to resolvedOutfit store after render.
 * 3. useEffect hydrates from localStorage once Auth UID is known.
 * 4. useEffect clears snapshot when the user is not Premium.
 *
 * The hook returns { sMap, resolvedSlots } — both used by OutfitSlotList
 * for display.  resolvedSlots is also consumed directly by the save handler
 * via a closure, so display and save values are always identical.
 *
 * wardrobeMatch.ts stays billing-unaware.
 */

import { useEffect, useMemo } from "react";
import { useWardrobe } from "@/components/wardrobe/wardrobeStore";
import { useEntitlement } from "@/lib/entitlement";
import { slotMatchMap, bandFromFeels } from "@/lib/wardrobeMatch";
import {
  setResolvedOutfit,
  clearResolvedOutfit,
  hydrateResolvedOutfit,
  localDateString,
  type ResolvedSlot,
} from "@/lib/resolvedOutfit";
import { getUid } from "@/lib/auth";
import type { Recommendation } from "@/lib/recommend";

export type ResolvedSlotsResult = {
  sMap:          ReturnType<typeof slotMatchMap>;
  resolvedSlots: ResolvedSlot[];
};

export function useResolvedSlots(
  rec: Pick<Recommendation, "outfit" | "effectiveFeelsC" | "headline">,
): ResolvedSlotsResult {
  const entitlement = useEntitlement();
  const items       = useWardrobe();

  const isPremium = !entitlement.loading && entitlement.active;
  const band      = bandFromFeels(rec.effectiveFeelsC);

  // ── 1. Pure computation (useMemo — no side effects) ───────────────────
  const sMap = useMemo(
    () => (isPremium ? slotMatchMap(rec, items, band) : new Map()),
    [isPremium, rec, items, band],
  );

  const resolvedSlots = useMemo<ResolvedSlot[]>(
    () =>
      rec.outfit.map((genericText, i) => {
        const match = sMap.get(i);
        if (!match) return { matched: false, genericText };
        return {
          matched:     true,
          genericText,
          itemName:    match.item.name,
          itemId:      match.item.id,
          itemTint:    match.item.tint,
        };
      }),
    [sMap, rec.outfit],
  );

  // ── 2. Hydrate from localStorage once Auth UID is known ────────────────
  // This runs once after entitlement settles, so we know whether to trust
  // a stored Premium snapshot. Auth UID is fetched async — getUid() resolves
  // synchronously if currentUser is already set (which it is post-load).
  useEffect(() => {
    if (entitlement.loading) return; // wait for Auth to settle
    getUid().then((uid) => {
      if (!uid || !isPremium) {
        // Not authenticated or not Premium: clear any stored snapshot so
        // a prior user's clothing names cannot be seen.
        clearResolvedOutfit(uid);
      } else {
        hydrateResolvedOutfit(uid);
      }
    });
  // Only run once after entitlement settles — not on every isPremium flip.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlement.loading]);

  // ── 3. Publish resolved slots to shared store (after render) ──────────
  // setResolvedOutfit is a no-op when slots are structurally unchanged
  // (anti-emit-loop via outfitsEqual). Only publishes for Premium users —
  // free users have no personal picks to show on the Wardrobe screen.
  useEffect(() => {
    if (entitlement.loading || !isPremium) return;

    getUid().then((uid) => {
      if (!uid) return;
      setResolvedOutfit({
        slots:           resolvedSlots,
        resolvedAt:      new Date().toISOString(),
        localDate:       localDateString(),
        headline:        rec.headline,
        effectiveFeelsC: rec.effectiveFeelsC,
        ownerUid:        uid,
      });
    });
  }, [entitlement.loading, isPremium, resolvedSlots, rec.headline, rec.effectiveFeelsC]);

  // ── 4. Clear snapshot when not Premium (sign-out, downgrade) ──────────
  useEffect(() => {
    if (!entitlement.loading && !isPremium) {
      getUid().then((uid) => clearResolvedOutfit(uid));
    }
  }, [entitlement.loading, isPremium]);

  return { sMap, resolvedSlots };
}
