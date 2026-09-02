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

interface GarmentProps {
  label: string;
  children: React.ReactNode;
  color: string;
  bg: string;
}

function GarmentCard({ label, children, color, bg }: GarmentProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`${bg} flex h-24 w-full items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ring-foreground/5`}
      >
        <div className={`${color} h-[68px] w-[76px]`}>{children}</div>
      </div>
      <p className="text-center text-[10px] font-medium leading-tight text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function WardrobeDemoCard() {
  return (
    <div className="glass-card rounded-3xl p-4">
      <p className="ob-anim ob-rise mb-4 text-sm font-semibold text-foreground/80">My wardrobe</p>

      {/* 3-column grid of garment cards, staggered in */}
      <div className="grid grid-cols-3 gap-3">
        <div className="ob-anim ob-pop ob-d2">
          <GarmentCard label="Blue crewneck" color="text-blue-400" bg="bg-blue-50 dark:bg-blue-950/30">
            <CrewneckSVG className="h-full w-full" />
          </GarmentCard>
        </div>
        <div className="ob-anim ob-pop ob-d4">
          <GarmentCard
            label="Grey sweatpants"
            color="text-slate-400"
            bg="bg-slate-50 dark:bg-slate-800/40"
          >
            <SweatpantsSVG className="h-full w-full" />
          </GarmentCard>
        </div>
        <div className="ob-anim ob-pop ob-d6">
          <GarmentCard
            label="White sneakers"
            color="text-gray-100 dark:text-gray-300"
            bg="bg-gray-50 dark:bg-gray-800/40"
          >
            <SneakerSVG className="h-full w-full" />
          </GarmentCard>
        </div>
      </div>

      {/* Today's recommendation — revealed after the garments, with one sweep */}
      <div className="ob-anim ob-slide-up ob-d8 relative mt-4 flex items-center gap-3 overflow-hidden rounded-2xl bg-primary/10 px-3 py-2.5 ring-1 ring-inset ring-primary/15">
        <span
          aria-hidden
          className="ob-anim ob-sweep ob-d9 pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
        />
        {/* Miniature versions of the items above */}
        <div className="flex shrink-0 items-end gap-1" aria-hidden>
          <div className="ob-anim ob-pop ob-d9 h-6 w-5 text-blue-400">
            <CrewneckSVG className="h-full w-full" />
          </div>
          <div className="ob-anim ob-pop ob-d10 h-6 w-4 text-slate-400">
            <SweatpantsSVG className="h-full w-full" />
          </div>
          <div className="ob-anim ob-pop ob-d11 h-4 w-6 text-gray-100 dark:text-gray-300">
            <SneakerSVG className="h-full w-full" />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Today's recommendation
          </p>
          <p className="text-xs text-muted-foreground">10° / Cloudy</p>
        </div>
      </div>
    </div>
  );
}
