/**
 * WardrobeDemoCard — polished wardrobe preview for intro screen 3.
 * All garments are detailed inline SVG illustrations.
 * No emoji, no remote images, no external dependencies.
 */

/** Blue crewneck sweater with collar, sleeves, cuffs and rib details */
function CrewneckSVG() {
  return (
    <svg viewBox="0 0 120 110" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      {/* Body */}
      <path d="M30 38 L28 100 L92 100 L90 38 Z" fill="#60a5fa" />
      {/* Left sleeve */}
      <path d="M30 38 L10 52 L14 72 L32 60 L30 38 Z" fill="#60a5fa" />
      {/* Right sleeve */}
      <path d="M90 38 L110 52 L106 72 L88 60 L90 38 Z" fill="#60a5fa" />
      {/* Shoulder shaping */}
      <path d="M30 38 Q60 30 90 38 L88 44 Q60 36 32 44 Z" fill="#3b82f6" />
      {/* Crewneck collar */}
      <path d="M42 30 Q60 20 78 30 L76 38 Q60 28 44 38 Z" fill="#3b82f6" />
      {/* Collar rib band */}
      <path d="M44 36 Q60 26 76 36 Q60 30 44 36 Z" fill="#2563eb" />
      {/* Left cuff rib */}
      <rect x="10" y="68" width="8" height="6" rx="2" fill="#3b82f6" />
      {/* Right cuff rib */}
      <rect x="102" y="68" width="8" height="6" rx="2" fill="#3b82f6" />
      {/* Hem rib */}
      <rect x="28" y="96" width="64" height="6" rx="2" fill="#3b82f6" />
      {/* Centre seam highlight */}
      <path d="M60 44 L60 98" stroke="#93c5fd" strokeWidth="0.8" opacity="0.5" />
      {/* Subtle body shadow */}
      <path d="M30 38 L28 100 L36 100 L37 38 Z" fill="#3b82f6" opacity="0.3" />
    </svg>
  );
}

/** Grey sweatpants with waistband, drawstring, shaped legs and ankle cuffs */
function SweatpantsSVG() {
  return (
    <svg viewBox="0 0 110 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      {/* Waistband */}
      <rect x="14" y="6" width="82" height="18" rx="5" fill="#9ca3af" />
      {/* Waistband rib lines */}
      <line x1="14" y1="11" x2="96" y2="11" stroke="#6b7280" strokeWidth="0.8" opacity="0.6" />
      <line x1="14" y1="15" x2="96" y2="15" stroke="#6b7280" strokeWidth="0.8" opacity="0.6" />
      {/* Drawstring */}
      <path d="M42 6 Q55 2 68 6" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="42" cy="6" r="2.5" fill="#d1d5db" />
      <circle cx="68" cy="6" r="2.5" fill="#d1d5db" />
      {/* Left leg */}
      <path d="M14 24 L10 110 L48 110 L55 24 Z" fill="#9ca3af" />
      {/* Right leg */}
      <path d="M55 24 L62 110 L100 110 L96 24 Z" fill="#9ca3af" />
      {/* Left leg inner shadow */}
      <path d="M50 24 L55 110 L48 110 L42 24 Z" fill="#6b7280" opacity="0.4" />
      {/* Centre crotch seam */}
      <path d="M55 24 L55 50" stroke="#6b7280" strokeWidth="1" opacity="0.5" />
      {/* Left ankle cuff */}
      <rect x="10" y="106" width="38" height="8" rx="3" fill="#6b7280" />
      {/* Right ankle cuff */}
      <rect x="62" y="106" width="38" height="8" rx="3" fill="#6b7280" />
      {/* Pocket line left */}
      <path d="M22 32 Q28 44 26 52" stroke="#6b7280" strokeWidth="1" opacity="0.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** White sneakers with sole, upper, tongue, laces and subtle depth */
function SneakerSVG() {
  return (
    <svg viewBox="0 0 130 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      {/* Thick outer sole */}
      <path d="M6 56 Q6 66 18 66 L116 66 Q126 66 126 58 L126 52 Q110 56 6 56 Z" fill="#e5e7eb" />
      {/* Midsole */}
      <path d="M6 50 Q8 58 18 58 L116 58 Q124 58 126 52 L126 48 Q106 52 6 50 Z" fill="#f9fafb" />
      {/* Upper body */}
      <path d="M18 50 L18 30 Q18 18 28 16 L62 14 Q78 12 92 22 L124 42 L126 50 Z" fill="#f9fafb" />
      {/* Toe cap */}
      <path d="M18 50 L18 36 Q18 26 26 24 L44 22 Q38 30 20 50 Z" fill="#f3f4f6" />
      {/* Tongue */}
      <path d="M38 16 L42 50 L54 50 L54 14 Z" fill="#f9fafb" />
      <path d="M39 16 L43 48 L43 16 Z" fill="#e5e7eb" opacity="0.5" />
      {/* Lace eyelets row 1 */}
      <circle cx="47" cy="22" r="2" fill="#d1d5db" />
      <circle cx="64" cy="24" r="2" fill="#d1d5db" />
      <circle cx="80" cy="28" r="2" fill="#d1d5db" />
      <circle cx="96" cy="34" r="2" fill="#d1d5db" />
      {/* Lace eyelets row 2 */}
      <circle cx="47" cy="30" r="2" fill="#d1d5db" />
      <circle cx="64" cy="32" r="2" fill="#d1d5db" />
      <circle cx="80" cy="36" r="2" fill="#d1d5db" />
      <circle cx="96" cy="42" r="2" fill="#d1d5db" />
      {/* Lace straps */}
      <path d="M47 22 Q55 20 64 24" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      <path d="M47 30 Q55 28 64 32" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      <path d="M64 24 Q72 26 80 28" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      <path d="M64 32 Q72 34 80 36" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      <path d="M80 28 Q88 30 96 34" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      <path d="M80 36 Q88 38 96 42" stroke="#e5e7eb" strokeWidth="1.2" fill="none" />
      {/* Side stripe */}
      <path d="M20 44 Q60 36 110 44 L112 48 Q64 40 20 48 Z" fill="#e5e7eb" opacity="0.6" />
      {/* Heel counter */}
      <path d="M116 42 Q126 44 126 50 L120 52 Q122 46 116 44 Z" fill="#f3f4f6" />
    </svg>
  );
}

/** Mini crewneck thumbnail for recommendation preview */
function MiniCrewneck() {
  return (
    <svg viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      <path d="M7 8 L6 20 L18 20 L17 8 Z" fill="#60a5fa" />
      <path d="M7 8 L3 11 L4 15 L8 13 Z" fill="#60a5fa" />
      <path d="M17 8 L21 11 L20 15 L16 13 Z" fill="#60a5fa" />
      <path d="M9 6 Q12 4 15 6 L15 8 Q12 6 9 8 Z" fill="#3b82f6" />
    </svg>
  );
}

/** Mini sweatpants thumbnail */
function MiniSweatpants() {
  return (
    <svg viewBox="0 0 20 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      <rect x="2" y="1" width="16" height="5" rx="1.5" fill="#9ca3af" />
      <path d="M2 6 L1 22 L9 22 L10 6 Z" fill="#9ca3af" />
      <path d="M10 6 L11 22 L19 22 L18 6 Z" fill="#9ca3af" />
    </svg>
  );
}

/** Mini sneaker thumbnail */
function MiniSneaker() {
  return (
    <svg viewBox="0 0 26 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
      <path d="M2 10 Q2 14 5 14 L22 14 Q25 14 25 12 L25 10 Z" fill="#e5e7eb" />
      <path d="M4 10 L4 6 Q4 3 7 3 L14 2 Q18 2 22 6 L25 10 Z" fill="#f9fafb" />
      <path d="M8 3 L9 10 L12 10 L12 2 Z" fill="#e5e7eb" />
    </svg>
  );
}

export function WardrobeDemoCard() {
  return (
    <div className="glass-card rounded-3xl p-4">
      <p className="mb-4 text-sm font-semibold text-foreground/80">My wardrobe</p>

      <div className="grid grid-cols-3 gap-3">
        {/* Blue crewneck */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-24 w-full items-center justify-center rounded-2xl bg-blue-50 p-2 dark:bg-blue-950/30">
            <CrewneckSVG />
          </div>
          <p className="text-center text-[10px] font-medium text-muted-foreground leading-tight">Blue crewneck</p>
        </div>

        {/* Grey sweatpants */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-24 w-full items-center justify-center rounded-2xl bg-slate-50 p-2 dark:bg-slate-800/40">
            <SweatpantsSVG />
          </div>
          <p className="text-center text-[10px] font-medium text-muted-foreground leading-tight">Grey sweatpants</p>
        </div>

        {/* White sneakers */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-24 w-full items-center justify-center rounded-2xl bg-gray-50 p-3 dark:bg-gray-800/40">
            <SneakerSVG />
          </div>
          <p className="text-center text-[10px] font-medium text-muted-foreground leading-tight">White sneakers</p>
        </div>
      </div>

      {/* Today's recommendation — mini garment thumbnails, not coloured dots */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-primary/8 px-3 py-2.5">
        <div className="flex shrink-0 items-end gap-1" aria-label="Outfit preview">
          <div className="h-7 w-6"><MiniCrewneck /></div>
          <div className="h-6 w-5"><MiniSweatpants /></div>
          <div className="h-4 w-6"><MiniSneaker /></div>
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
