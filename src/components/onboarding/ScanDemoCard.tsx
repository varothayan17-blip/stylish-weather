/**
 * ScanDemoCard — non-interactive feature preview for intro screen 4.
 * Shows a garment and a three-step flow: Photograph → Review → Save.
 *
 * Rules:
 *   • Does NOT invoke camera, file picker, Gemini, Firebase or any AI endpoint.
 *   • Does NOT show or scan a person, face or body.
 *   • Uses a Lucide Shirt icon as the garment — consistent with the rest of the app.
 *   • No emoji, no external images.
 */
import { Camera, FileText, Check, Shirt } from "lucide-react";

const STEPS = [
  { icon: Camera, label: "Photograph" },
  { icon: FileText, label: "Review" },
  { icon: Check, label: "Save" },
] as const;

export function ScanDemoCard() {
  return (
    <div className="glass-card overflow-hidden rounded-3xl">
      {/* Garment display area */}
      <div className="relative flex h-52 items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-slate-800 dark:to-slate-900">
        {/* Blue crewneck using Lucide Shirt icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-32 w-32 items-center justify-center rounded-3xl bg-blue-400/20">
            <Shirt
              className="h-20 w-20 text-blue-400"
              strokeWidth={1.2}
              aria-label="Blue crewneck sweater"
            />
          </div>
        </div>

        {/* Scan-frame corner brackets */}
        {[
          "top-5 left-5 border-t-2 border-l-2",
          "top-5 right-5 border-t-2 border-r-2",
          "bottom-5 left-5 border-b-2 border-l-2",
          "bottom-5 right-5 border-b-2 border-r-2",
        ].map((cls) => (
          <div
            key={cls}
            aria-hidden
            className={`pointer-events-none absolute h-5 w-5 rounded-sm border-primary/50 ${cls}`}
          />
        ))}
      </div>

      {/* Three-step flow indicator */}
      <div className="flex items-center justify-around border-t border-border/50 px-4 py-4">
        {STEPS.map(({ icon: Icon, label }, idx) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  idx === 0 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
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
