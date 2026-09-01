/**
 * WardrobeDemoCard — static wardrobe preview for intro screen 3.
 * Built entirely with CSS + Tailwind + SVG path garment outlines.
 * No emoji, no remote images, no AI calls, no external dependencies.
 */

/** Inline SVG crewneck/sweatshirt silhouette */
function CrewneckSVG({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Body */}
      <path
        d="M20 22 L8 36 L16 40 L16 68 L64 68 L64 40 L72 36 L60 22"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Sleeve left */}
      <path d="M20 22 L8 36 L16 40 L24 28 Z" fill="currentColor" opacity="0.75" />
      {/* Sleeve right */}
      <path d="M60 22 L72 36 L64 40 L56 28 Z" fill="currentColor" opacity="0.75" />
      {/* Neck */}
      <path
        d="M30 18 Q40 12 50 18 L52 22 Q40 28 28 22 Z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

/** Inline SVG sweatpants silhouette */
function SweatpantsSVG({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Waistband */}
      <rect x="12" y="4" width="56" height="12" rx="4" fill="currentColor" opacity="0.7" />
      {/* Left leg */}
      <path d="M12 16 L16 86 L38 86 L40 16 Z" fill="currentColor" opacity="0.85" />
      {/* Right leg */}
      <path d="M40 16 L42 86 L64 86 L68 16 Z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

/** Inline SVG sneaker silhouette */
function SneakerSVG({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 90 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Sole */}
      <path d="M4 36 Q4 44 14 44 L80 44 Q88 44 88 38 L88 34 Z" fill="currentColor" opacity="0.5" />
      {/* Upper */}
      <path
        d="M14 36 L14 22 Q14 14 22 12 L46 12 Q54 10 62 16 L86 30 L86 36 Z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Tongue / detail */}
      <path d="M26 12 L28 36" stroke="white" strokeWidth="1.5" opacity="0.4" />
      <path d="M28 20 L62 24" stroke="white" strokeWidth="1" opacity="0.3" />
      <path d="M26 28 L68 30" stroke="white" strokeWidth="1" opacity="0.3" />
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
      <div className={`${bg} flex h-24 w-28 items-center justify-center rounded-2xl shadow-sm`}>
        <div className={`${color} h-16 w-20`}>{children}</div>
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
      <p className="mb-4 text-sm font-semibold text-foreground/80">My wardrobe</p>

      {/* 3-column grid of garment cards */}
      <div className="grid grid-cols-3 gap-3">
        <GarmentCard
          label="Blue crewneck"
          color="text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/30"
        >
          <CrewneckSVG className="h-full w-full" />
        </GarmentCard>

        <GarmentCard
          label="Grey sweatpants"
          color="text-slate-400"
          bg="bg-slate-50 dark:bg-slate-800/40"
        >
          <SweatpantsSVG className="h-full w-full" />
        </GarmentCard>

        <GarmentCard
          label="White sneakers"
          color="text-gray-300 dark:text-gray-500"
          bg="bg-gray-50 dark:bg-gray-800/40"
        >
          <SneakerSVG className="h-full w-full" />
        </GarmentCard>
      </div>

      {/* Today's recommendation mini card */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-primary/8 px-3 py-2.5">
        {/* Mini outfit preview row */}
        <div className="flex shrink-0 items-end gap-0.5" aria-hidden>
          <div className="h-5 w-4 rounded-sm bg-blue-400 opacity-80" />
          <div className="h-3.5 w-5 rounded-sm bg-slate-400 opacity-80" />
          <div className="h-3 w-4 rounded-sm bg-gray-300 opacity-80" />
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
