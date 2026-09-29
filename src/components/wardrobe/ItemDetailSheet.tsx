import { X, Heart, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { ItemTile } from "./ItemTile";
import type { WardrobeItem } from "./wardrobeData";

export function ItemDetailSheet({
  item,
  onClose,
  onToggleFavourite,
  onToggleUnavailable,
  onRemove,
}: {
  item: WardrobeItem | null;
  onClose: () => void;
  onToggleFavourite: () => void;
  onToggleUnavailable: () => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  const rows: [string, string][] = [
    ["Category", item.type],
    ["Color", item.color],
    ["Warmth", item.warmth],
    ["Weather fit", item.weatherFit],
    ["Water resistance", item.waterResistance],
    ["Style", item.style],
    ["Season", item.season],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-[60] flex items-end justify-center"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="glass-card relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[2rem] p-5 pb-8 animate-fade-up sm:mb-6 sm:rounded-[2rem]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{item.name}</h2>
            <p className="text-sm text-muted-foreground">{item.category}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close item details"
            className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground/5 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ItemTile
          category={item.category}
          tint={item.tint}
          itemId={item.id}
          hasLocalPhoto={item.hasLocalPhoto === true}
          photoAlt={item.name}
          className="h-56 w-full rounded-[1.75rem]"
          iconClassName="h-20 w-20"
        />

        <dl className="mt-5 space-y-2">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-2xl bg-foreground/[0.04] px-4 py-3"
            >
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Action icon={<Pencil className="h-4 w-4" />} label="Edit" onClick={() => {}} />
          <Action
            icon={
              <Heart className={`h-4 w-4 ${item.favourite ? "fill-current text-primary" : ""}`} />
            }
            label={item.favourite ? "Favourited" : "Favourite"}
            onClick={onToggleFavourite}
          />
          <Action
            icon={<EyeOff className="h-4 w-4" />}
            label={item.unavailable ? "Mark available" : "Mark unavailable"}
            onClick={onToggleUnavailable}
          />
          <Action
            icon={<Trash2 className="h-4 w-4" />}
            label="Remove item"
            destructive
            onClick={() => {
              onRemove();
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`press glass-card flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium ${
        destructive ? "text-destructive" : ""
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
