/**
 * ScanDemoCard — non-interactive feature preview for intro screen 4.
 * Shows a front-facing garment and a three-step flow: Photograph → Review → Save.
 *
 * Rules:
 *   • Does NOT invoke camera, file picker, Gemini, Firebase or any AI endpoint.
 *   • Does NOT show or scan a person, face or body.
 *   • Illustration only — no material, brand or trait labels are shown.
 *   • Motion is CSS-only (./onboarding-motion.css); the beam runs a bounded
 *     three passes and then the flow settles on a confirmation state.
 */
import { Camera, FileText, Check } from "lucide-react";
import "./onboarding-motion.css";

const STEPS = [
  { icon: Camera, label: "Photograph", delay: "ob-d6" },
  { icon: FileText, label: "Review", delay: "ob-d8" },
  { icon: Check, label: "Save", delay: "ob-d10" },
] as const;

/** Front-facing blue crewneck: collar opening, shoulder seams, cuffs, hem rib. */
function FrontCrewneck() {
  return (
    <svg viewBox="0 0 120 112" fill="none" className="h-[132px] w-[140px]" aria-hidden>
      <defs>
        <linearGradient id="sdc-body" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.11 240)" />
          <stop offset="60%" stopColor="oklch(0.66 0.14 245)" />
          <stop offset="100%" stopColor="oklch(0.58 0.13 248)" />
        </linearGradient>
        <linearGradient id="sdc-sleeve" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.7 0.12 243)" />
          <stop offset="100%" stopColor="oklch(0.56 0.13 248)" />
        </linearGradient>
      </defs>

      {/* Grounded shadow */}
      <ellipse cx="60" cy="106" rx="34" ry="4" className="fill-foreground/12" />

      {/* Sleeves */}
      <path d="M34 20 L10 42 L20 56 L38 40 Z" fill="url(#sdc-sleeve)" />
      <path d="M86 20 L110 42 L100 56 L82 40 Z" fill="url(#sdc-sleeve)" />
      {/* Cuffs */}
      <path
        d="M10 42 L20 56"
        stroke="oklch(0.5 0.12 250)"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M110 42 L100 56"
        stroke="oklch(0.5 0.12 250)"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Body */}
      <path d="M34 20 H86 L88 44 V98 H32 V44 Z" fill="url(#sdc-body)" />

      {/* Shoulder seams */}
      <path
        d="M38 22 L34 40 M82 22 L86 40"
        stroke="oklch(0.5 0.12 250)"
        strokeWidth="1.6"
        opacity="0.55"
        strokeLinecap="round"
      />

      {/* Collar opening (front-facing) */}
      <path d="M46 18 Q60 30 74 18 L78 22 Q60 38 42 22 Z" fill="oklch(0.5 0.12 250)" />
      <path
        d="M46 19 Q60 30 74 19"
        stroke="oklch(0.86 0.07 235)"
        strokeWidth="1.6"
        fill="none"
        opacity="0.7"
      />

      {/* Hem ribbing */}
      <rect x="32" y="90" width="56" height="8" fill="oklch(0.5 0.12 250)" opacity="0.85" />
      <path
        d="M38 90 V98 M48 90 V98 M58 90 V98 M68 90 V98 M78 90 V98"
        stroke="oklch(0.42 0.1 250)"
        strokeWidth="0.8"
        opacity="0.6"
      />

      {/* Fabric highlights / folds */}
      <path
        d="M44 46 Q48 66 44 86"
        stroke="white"
        strokeWidth="2"
        opacity="0.16"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M76 50 Q73 68 76 86"
        stroke="oklch(0.35 0.08 250)"
        strokeWidth="2"
        opacity="0.14"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

const BRACKETS = [
  { cls: "top-5 left-5 border-t-2 border-l-2", anim: "ob-bracket-tl", delay: "" },
  { cls: "top-5 right-5 border-t-2 border-r-2", anim: "ob-bracket-tr", delay: "ob-d1" },
  { cls: "bottom-5 left-5 border-b-2 border-l-2", anim: "ob-bracket-bl", delay: "ob-d2" },
  { cls: "bottom-5 right-5 border-b-2 border-r-2", anim: "ob-bracket-br", delay: "ob-d3" },
] as const;

/** Small non-text detection markers revealed as the beam travels down. */
const POINTS = [
  { top: "28%", left: "34%", delay: "ob-d5" },
  { top: "40%", left: "66%", delay: "ob-d6" },
  { top: "58%", left: "44%", delay: "ob-d7" },
  { top: "72%", left: "60%", delay: "ob-d8" },
] as const;

export function ScanDemoCard() {
  return (
    <div className="glass-card overflow-hidden rounded-3xl">
      {/* Garment display area */}
      <div className="relative flex h-56 items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100 dark:from-slate-800 dark:to-slate-900">
        <div className="ob-anim ob-pop">
          <FrontCrewneck />
        </div>

        {/* Scanning beam — three bounded passes */}
        <span
          aria-hidden
          className="ob-anim ob-beam ob-d3 pointer-events-none absolute inset-x-6 top-4 h-3 rounded-full bg-gradient-to-b from-transparent via-primary/70 to-transparent"
        />

        {/* Detection markers */}
        {POINTS.map((p) => (
          <span
            key={`${p.top}-${p.left}`}
            aria-hidden
            style={{ top: p.top, left: p.left }}
            className={`ob-anim ob-pop ${p.delay} pointer-events-none absolute h-2.5 w-2.5 rounded-full border border-primary/80 bg-primary/25`}
          />
        ))}

        {/* Scan-frame corner brackets snapping into position */}
        {BRACKETS.map(({ cls, anim, delay }) => (
          <span
            key={cls}
            aria-hidden
            className={`ob-anim ${anim} ${delay} pointer-events-none absolute h-5 w-5 rounded-sm border-primary/60 ${cls}`}
          />
        ))}

        {/* Confirmation badge */}
        <span
          aria-hidden
          className="ob-anim ob-confirm ob-d11 absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_6px_oklch(0.62_0.16_248/0.15)]"
        >
          <Check className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      {/* Three-step flow indicator */}
      <div className="flex items-center justify-around border-t border-border/50 px-4 py-4">
        {STEPS.map(({ icon: Icon, label, delay }, idx) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`ob-anim ob-rise ${delay} flex flex-col items-center gap-1`}>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  idx === STEPS.length - 1
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
            </div>
            {idx < STEPS.length - 1 && (
              <div aria-hidden className="mb-4 h-px w-8 bg-border" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
