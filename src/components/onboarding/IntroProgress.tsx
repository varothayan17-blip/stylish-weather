/** Segmented "1 of 4" progress indicator (text + segments, not colour alone). */
export function IntroProgress({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-xs font-semibold tabular-nums text-primary" aria-label={`Step ${step} of ${total}`}>
        {step} of {total}
      </span>
      <span className="flex flex-1 gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="relative block h-1 flex-1 overflow-hidden rounded-full bg-primary/15">
            <span
              className={`absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-500 ${
                i < step ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </span>
        ))}
      </span>
    </div>
  );
}
