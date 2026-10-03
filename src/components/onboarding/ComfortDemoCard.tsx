/**
 * ComfortDemoCard — slide 2 "Comfort that feels personal".
 *
 * Local, non-persisted demo state only: tapping a comfort option updates the
 * example recommendation. It never writes preferences — the real setting is
 * collected later in the pre-auth questions. Not medical guidance.
 */
import { useState } from "react";
import { Snowflake, Scale, Flame, Check } from "lucide-react";
import "./onboarding-motion.css";

type Comfort = "cold" | "balanced" | "warm";

const OPTIONS: { id: Comfort; label: string; Icon: typeof Snowflake }[] = [
  { id: "cold", label: "Run cold", Icon: Snowflake },
  { id: "balanced", label: "Balanced", Icon: Scale },
  { id: "warm", label: "Run warm", Icon: Flame },
];

const RESULT: Record<Comfort, { feels: string; layers: string[]; note: string }> = {
  cold: { feels: "Feels cooler to you", layers: ["Thermal tee", "Wool sweater", "Insulated jacket"], note: "One extra warm layer" },
  balanced: { feels: "Feels like 8°C", layers: ["Long-sleeve tee", "Light sweater", "Jacket"], note: "Standard layering" },
  warm: { feels: "Feels milder to you", layers: ["T-shirt", "Light jacket"], note: "One fewer layer" },
};

export function ComfortDemoCard() {
  const [comfort, setComfort] = useState<Comfort>("cold");
  const r = RESULT[comfort];

  return (
    <div className="glass-card rounded-3xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Example · 8°C, breezy</p>
      </div>

      <div role="radiogroup" aria-label="Example comfort preference" className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-foreground/[0.05] p-1">
        {OPTIONS.map(({ id, label, Icon }) => {
          const active = id === comfort;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setComfort(id)}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon aria-hidden className={`h-4 w-4 ${active ? "text-primary" : ""}`} strokeWidth={1.75} />
              {label}
            </button>
          );
        })}
      </div>

      <div key={comfort} className="ob-anim ob-fade mt-3 rounded-2xl bg-background/60 p-3 ring-1 ring-inset ring-foreground/5" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{r.feels}</p>
          <p className="text-[11px] font-medium text-primary">{r.note}</p>
        </div>
        <ul className="mt-2 space-y-1.5">
          {r.layers.map((l, i) => (
            <li key={l} className={`ob-anim ob-rise ob-d${i + 1} flex items-center gap-2 text-xs text-foreground/85`}>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/12 text-primary">
                <Check aria-hidden className="h-3 w-3" strokeWidth={2.4} />
              </span>
              {l}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground">Try it — example only, not saved.</p>
    </div>
  );
}
