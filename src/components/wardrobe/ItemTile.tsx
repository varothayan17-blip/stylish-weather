import { Shirt, Footprints, Layers, Watch, PanelBottom } from "lucide-react";
import type { WardrobeCategory } from "./wardrobeData";
import { useWardrobePhotoUrl } from "@/lib/wardrobePhotoStore";

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
  itemId,
  hasLocalPhoto = false,
  photoAlt = "Saved wardrobe item",
}: {
  category: WardrobeCategory;
  tint: string;
  className?: string;
  iconClassName?: string;
  itemId?: string;
  hasLocalPhoto?: boolean;
  photoAlt?: string;
}) {
  const Icon = ICONS[category] ?? Shirt;
  const photoUrl = useWardrobePhotoUrl(itemId, hasLocalPhoto);
  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br ${tint} ring-1 ring-inset ring-white/15 ${className}`}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={photoAlt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
          />
          <Icon
            aria-hidden
            className={`relative text-white/85 ${iconClassName}`}
            strokeWidth={1.4}
          />
        </>
      )}
    </div>
  );
}
