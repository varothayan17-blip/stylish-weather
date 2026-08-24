import { useEffect, useState } from "react";
import { Camera, ImageIcon, X, Sparkles, Check } from "lucide-react";
import { ItemTile } from "./ItemTile";
import { MOCK_SCAN_RESULT, CATEGORIES, type WardrobeItem } from "./wardrobeData";

type Step = "pick" | "scanning" | "confirm";

/** Mock add-clothing flow: pick → fake scan → confirm. Nothing is uploaded. */
export function AddClothingSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (item: Omit<WardrobeItem, "id">) => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [draft, setDraft] = useState<Omit<WardrobeItem, "id">>(MOCK_SCAN_RESULT);

  useEffect(() => {
    if (!open) {
      setStep("pick");
      setDraft(MOCK_SCAN_RESULT);
    }
  }, [open]);

  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => setStep("confirm"), 2200);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add clothing"
      className="fixed inset-0 z-[60] flex items-end justify-center"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="glass-card relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[2rem] p-5 pb-8 animate-fade-up sm:mb-6 sm:rounded-[2rem]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {step === "confirm" ? "Confirm item" : "Add clothing"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close add clothing"
            className="press grid h-9 w-9 place-items-center rounded-full bg-foreground/5 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "pick" && (
          <div>
            <div className="glass-card flex flex-col items-center gap-3 rounded-[1.75rem] px-6 py-10 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Camera className="h-7 w-7" strokeWidth={1.6} />
              </div>
              <p className="font-semibold">Add something from your closet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Snap a photo and Aeruvo will fill in the details for you.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => setStep("scanning")}
                className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background"
              >
                <Camera className="h-4 w-4" /> Take photo
              </button>
              <button
                onClick={() => setStep("scanning")}
                className="press glass-card flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold"
              >
                <ImageIcon className="h-4 w-4" /> Choose photo
              </button>
            </div>
          </div>
        )}

        {step === "scanning" && (
          <div
            className="flex flex-col items-center gap-4 py-6 text-center"
            role="status"
            aria-live="polite"
          >
            <div className="relative overflow-hidden rounded-[1.75rem]">
              <ItemTile category="Tops" tint={draft.tint} className="h-48 w-48" iconClassName="h-16 w-16" />
              <div
                aria-hidden
                className="scan-sweep pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-primary/35 to-transparent"
              />
            </div>
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" /> Analyzing your item…
            </p>
            <p className="text-sm text-muted-foreground">Reading colour, fabric weight, and warmth.</p>
          </div>
        )}

        {step === "confirm" && (
          <div>
            <div className="flex items-center gap-4">
              <ItemTile category={draft.category} tint={draft.tint} className="h-24 w-24 shrink-0" />
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
                  <Check className="h-3.5 w-3.5" /> We found a {draft.name.toLowerCase()}.
                </p>
                <p className="mt-1 text-lg font-semibold leading-tight">{draft.name}</p>
                <p className="text-sm text-muted-foreground">{draft.type}</p>
              </div>
            </div>

            <div className="mt-5 space-y-2.5">
              <Field label="Item">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Category">
                <select
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value as WardrobeItem["category"] })
                  }
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Color">
                <input
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Warmth">
                <select
                  value={draft.warmth}
                  onChange={(e) =>
                    setDraft({ ...draft, warmth: e.target.value as WardrobeItem["warmth"] })
                  }
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {["Light", "Medium", "Warm"].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weather fit">
                <input
                  value={draft.weatherFit}
                  onChange={(e) => setDraft({ ...draft, weatherFit: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Water resistance">
                <select
                  value={draft.waterResistance}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      waterResistance: e.target.value as WardrobeItem["waterResistance"],
                    })
                  }
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {["Low", "Medium", "High"].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Style">
                <input
                  value={draft.style}
                  onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Season">
                <input
                  value={draft.season}
                  onChange={(e) => setDraft({ ...draft, season: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
            </div>

            <button
              onClick={() => {
                onAdd({ ...draft, labels: [`${draft.warmth} warmth`, draft.style] });
                onClose();
              }}
              className="press mt-5 w-full rounded-full bg-foreground px-5 py-3.5 text-sm font-semibold text-background"
            >
              Add to wardrobe
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl bg-foreground/[0.04] px-4 py-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </label>
  );
}
