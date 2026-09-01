/** Pill-style "1 of 3" progress indicator */
export function IntroProgress({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of ${total}`}>
      <span className="text-xs font-semibold text-primary">
        {step} of {total}
      </span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`block h-1 rounded-full transition-all duration-300 ${
              i < step ? "w-6 bg-primary" : "w-2 bg-primary/25"
            }`}
          />
        ))}
      </span>
    </div>
  );
}
