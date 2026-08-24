import { Shirt, Footprints, Layers, Watch, PanelBottom } from "lucide-react";
import type { WardrobeCategory } from "./wardrobeData";

const ICONS = {
  Tops: Shirt,
  Bottoms: PanelBottom,
  Outerwear: Layers,
  Shoes: Footprints,
  Accessories: Watch,
} as const;

/**
 * Mock "photo" tile. No real uploads exist in this prototype, so each item is
 * represented by a tinted glass plate with a category glyph.
 */
export function ItemTile({
  category,
  tint,
  className = "",
  iconClassName = "h-9 w-9",
}: {
  category: WardrobeCategory;
  tint: string;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = ICONS[category] ?? Shirt;
  return (
    <div
      aria-hidden
      className={`relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br ${tint} ring-1 ring-inset ring-white/15 ${className}`}
    >
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      <Icon className={`relative text-white/85 ${iconClassName}`} strokeWidth={1.4} />
    </div>
  );
}
