/**
 * ScanDemoCard — non-interactive feature preview for intro screen 4.
 * Shows a large detailed blue crewneck SVG with scan corners,
 * and the Photograph → Review → Save progression.
 * No AI calls, no camera, no emoji, no external images.
 */
import { Camera, FileText, Check } from "lucide-react";

const STEPS = [
  { icon: Camera, label: "Photograph" },
  { icon: FileText, label: "Review" },
  { icon: Check, label: "Save" },
] as const;

/** Large detailed blue crewneck for the scan preview area */
function LargeSweaterSVG() {
  return (
    <svg
      viewBox="0 0 180 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Blue crewneck sweater"
      className="h-full w-full drop-shadow-md"
    >
      {/* Main body */}
      <path d="M44 58 L38 144 L142 144 L136 58 Z" fill="#60a5fa" />
      {/* Left sleeve — shaped with elbow curve */}
      <path d="M44 58 L8 76 L8 100 Q8 108 16 110 L38 104 L44 58 Z" fill="#60a5fa" />
      {/* Right sleeve */}
      <path d="M136 58 L172 76 L172 100 Q172 108 164 110 L142 104 L136 58 Z" fill="#60a5fa" />
      {/* Shoulder darks */}
      <path d="M44 58 Q90 46 136 58 L134 66 Q90 54 46 66 Z" fill="#3b82f6" />
      {/* Crewneck collar band */}
      <path d="M64 42 Q90 30 116 42 L114 56 Q90 44 66 56 Z" fill="#3b82f6" />
      {/* Collar inner rib */}
      <path d="M68 52 Q90 40 112 52 Q90 46 68 52 Z" fill="#2563eb" />
      {/* Left cuff ribbing */}
      <path d="M8 98 Q8 112 16 114 L38 110 L38 106 L16 108 Q10 106 10 98 Z" fill="#3b82f6" />
      {/* Right cuff ribbing */}
      <path d="M172 98 Q172 112 164 114 L142 110 L142 106 L164 108 Q170 106 170 98 Z" fill="#3b82f6" />
      {/* Hem rib */}
      <rect x="38" y="138" width="104" height="8" rx="3" fill="#3b82f6" />
      {/* Body highlight — left panel */}
      <path d="M44 58 L46 144 L56 144 L58 58 Z" fill="#93c5fd" opacity="0.35" />
      {/* Subtle centre seam */}
      <path d="M90 62 L90 140" stroke="#93c5fd" strokeWidth="1" opacity="0.3" />
      {/* Sleeve highlight left */}
      <path d="M8 76 L10 100 L16 100 L20 76 Z" fill="#93c5fd" opacity="0.2" />
      {/* Waist taper hint */}
      <path d="M38 100 Q36 120 38 144 L44 144 L46 100 Z" fill="#3b82f6" opacity="0.15" />
      <path d="M142 100 Q144 120 142 144 L136 144 L134 100 Z" fill="#3b82f6" opacity="0.15" />
    </svg>
  );
}

export function ScanDemoCard() {
  return (
    <div className="glass-card overflow-hidden rounded-3xl">
      {/* Garment display area with scan frame */}
      <div className="relative flex h-56 items-center justify-center bg-gradient-to-br from-blue-50 via-blue-50 to-sky-100 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900 p-8">
        {/* The sweater fills the frame naturally */}
        <LargeSweaterSVG />

        {/* Scan-frame corner brackets — surrounding the actual garment */}
        {[
          "top-4 left-4 border-t-[2.5px] border-l-[2.5px] rounded-tl-lg",
          "top-4 right-4 border-t-[2.5px] border-r-[2.5px] rounded-tr-lg",
          "bottom-4 left-4 border-b-[2.5px] border-l-[2.5px] rounded-bl-lg",
          "bottom-4 right-4 border-b-[2.5px] border-r-[2.5px] rounded-br-lg",
        ].map((cls) => (
          <div
            key={cls}
            aria-hidden
            className={`pointer-events-none absolute h-6 w-6 border-primary/60 ${cls}`}
          />
        ))}

        {/* Scanning line animation */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-4 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          style={{ top: "40%" }}
        />
      </div>

      {/* Three-step progression */}
      <div className="flex items-center justify-around border-t border-border/50 px-4 py-4">
        {STEPS.map(({ icon: Icon, label }, idx) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  idx === 0
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
