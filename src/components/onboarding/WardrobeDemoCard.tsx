/**
 * WardrobeDemoCard — static wardrobe preview for intro screen 3.
 *
 * Built entirely with CSS + Tailwind + layered SVG garment illustrations.
 * Motion is CSS-only (./onboarding-motion.css): the three garments stagger in,
 * then the recommendation row reveals with a single blue highlight sweep.
 * No emoji, no remote images, no AI calls, no timers.
 */
import "./onboarding-motion.css";

/** Layered crewneck/sweatshirt with seams and edge highlights. */
function CrewneckSVG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 76" fill="none" className={className} aria-hidden>
      <ellipse cx="40" cy="72" rx="24" ry="3" className="fill-foreground/10" />
      {/* Body */}
      <path
        d="M20 22 L8 36 L16 41 L18 44 V68 H62 V44 L64 41 L72 36 L60 22 Z"
        fill="currentColor"
        opacity="0.92"
      />
      {/* Sleeves (darker) */}
      <path d="M20 22 L8 36 L16 41 L24 29 Z" fill="currentColor" opacity="0.7" />
      <path d="M60 22 L72 36 L64 41 L56 29 Z" fill="currentColor" opacity="0.7" />
      {/* Collar */}
      <path d="M30 18 Q40 12 50 18 L52 22 Q40 28 28 22 Z" fill="currentColor" />
      <path d="M30 18 Q40 13 50 18" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      {/* Shoulder seams */}
      <path d="M25 24 L22 30 M55 24 L58 30" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* Hem ribbing */}
      <path d="M18 63 H62" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      {/* Fabric highlight */}
      <path d="M27 30 V60" stroke="white" strokeWidth="1.6" opacity="0.18" strokeLinecap="round" />
    </svg>
  );
}

/** Sweatpants with waistband, drawcord and leg seams. */
function SweatpantsSVG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 94" fill="none" className={className} aria-hidden>
      <ellipse cx="40" cy="90" rx="26" ry="3" className="fill-foreground/10" />
      <rect x="12" y="4" width="56" height="12" rx="4" fill="currentColor" opacity="0.7" />
      <path d="M36 10 h8" stroke="currentColor" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
      <path d="M12 16 L16 84 H38 L40 16 Z" fill="currentColor" opacity="0.9" />
      <path d="M40 16 L42 84 H64 L68 16 Z" fill="currentColor" opacity="0.9" />
      {/* Cuffs */}
      <path d="M16 80 H38 M42 80 H64" stroke="currentColor" strokeWidth="2.4" opacity="0.55" />
      {/* Highlight + inner seam */}
      <path d="M22 22 V78" stroke="white" strokeWidth="1.6" opacity="0.16" strokeLinecap="round" />
      <path d="M40 18 V82" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
    </svg>
  );
}

/**
 * Sneaker with a cool-grey outline, darker sole, tongue, eyelets and laces so
 * a white shoe stays clearly visible on a light card.
 */
function SneakerSVG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 92 54" fill="none" className={className} aria-hidden>
      <ellipse cx="46" cy="50" rx="34" ry="2.6" className="fill-foreground/10" />
      {/* Sole (darker) */}
      <path
        d="M4 36 Q4 46 15 46 H80 Q88 46 88 39 V34 L4 34 Z"
        className="fill-slate-400 dark:fill-slate-500"
      />
      <path d="M4 40 H88" className="stroke-slate-500/50" strokeWidth="1" />
      {/* Upper */}
      <path
        d="M14 34 V22 Q14 13 23 11 H46 Q54 9 62 15 L86 29 V34 Z"
        fill="currentColor"
        className="stroke-slate-500"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Tongue */}
      <path
        d="M24 12 Q22 20 24 30"
        className="stroke-slate-500"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      {/* Laces */}
      <path
        d="M27 16 L40 20 M27 22 L45 26 M27 28 L50 31"
        className="stroke-slate-500"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Eyelets */}
      <circle cx="28" cy="16" r="1.1" className="fill-slate-500" />
      <circle cx="28" cy="22" r="1.1" className="fill-slate-500" />
      <circle cx="28" cy="28" r="1.1" className="fill-slate-500" />
      {/* Heel + toe detail */}
      <path d="M72 24 Q78 30 80 34" className="stroke-slate-400" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

const ITEMS = [
  { label: "Blue crewneck", color: "text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", Svg: CrewneckSVG, delay: "ob-d2" },
  { label: "Grey trousers", color: "text-slate-400", bg: "bg-slate-50 dark:bg-slate-800/40", Svg: SweatpantsSVG, delay: "ob-d3" },
  { label: "White sneakers", color: "text-gray-100 dark:text-gray-300", bg: "bg-gray-50 dark:bg-gray-800/40", Svg: SneakerSVG, delay: "ob-d4" },
] as const;

/** Slide 3: saved items (sweatpants-style trousers SVG reused) → today's recommendation using the exact same items. */
export function WardrobeDemoCard() {
  return (
    <div
      className="glass-card rounded-3xl p-4"
      role="img"
      aria-label="Example wardrobe with a blue crewneck, grey trousers and white sneakers, each with a saved photo. Today's recommendation uses those exact three items."
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">My wardrobe</p>
        <p className="text-[11px] font-medium text-muted-foreground">Saved photos</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {ITEMS.map(({ label, color, bg, Svg, delay }, i) => (
          <div key={label} className={`ob-anim ob-pop ${delay} flex flex-col items-center gap-1.5`}>
            <div className={`${bg} relative flex h-20 w-full items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ring-foreground/5`}>
              <div className={`${color} h-[56px] w-[64px]`}><Svg className="h-full w-full" /></div>
              <span className="absolute left-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{i + 1}</span>
            </div>
            <p className="text-center text-[10px] font-medium leading-tight text-foreground/75">{label}</p>
          </div>
        ))}
      </div>

      {/* Connectors from each saved item down into the recommendation */}
      <div aria-hidden className="grid grid-cols-3 gap-2.5">
        {ITEMS.map(({ label, delay }) => (
          <div key={label} className="flex justify-center">
            <span className={`ob-anim ob-fade ${delay} block h-4 w-px bg-gradient-to-b from-primary/10 to-primary/60`} />
          </div>
        ))}
      </div>

      <div className="ob-anim ob-slide-up ob-d6 relative overflow-hidden rounded-2xl bg-primary/10 p-3 ring-1 ring-inset ring-primary/20">
        <span
          aria-hidden
          className="ob-anim ob-sweep ob-d8 pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
        />
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Today's recommendation</p>
          <p className="text-[10px] text-muted-foreground">14°C · Cloudy</p>
        </div>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {ITEMS.map(({ label, color, Svg }, i) => (
            <li key={label} className={`ob-anim ob-pop ob-d${8 + i} flex items-center gap-1.5 rounded-xl bg-background/70 p-1.5`}>
              <span className={`${color} relative h-7 w-7 shrink-0`}>
                <Svg className="h-full w-full" />
                <span className="absolute -left-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">{i + 1}</span>
              </span>
              <span className="min-w-0 text-[9px] font-medium leading-tight text-foreground/80">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
