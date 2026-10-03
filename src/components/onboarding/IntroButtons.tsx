/** Primary CTA, sign-in link and optional Back — used on every intro slide. */
interface IntroButtonsProps {
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  onBack?: () => void;
  primaryDisabled?: boolean;
}

export function IntroButtons({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onBack,
  primaryDisabled = false,
}: IntroButtonsProps) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-auto bg-gradient-to-t from-background/70 via-background/40 to-transparent px-6 pb-1 pt-6 backdrop-blur-[2px]">
      <div className="flex gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="press min-h-[52px] shrink-0 rounded-2xl bg-foreground/[0.06] px-5 text-sm font-semibold text-foreground ring-1 ring-inset ring-foreground/10 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="press min-h-[52px] flex-1 rounded-2xl bg-foreground text-center text-sm font-semibold text-background shadow-[0_10px_30px_-12px_var(--primary)] transition-all active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {primaryLabel}
        </button>
      </div>
      <button
        type="button"
        onClick={onSecondary}
        className="mt-1 block min-h-11 w-full rounded-2xl text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {secondaryLabel}
      </button>
    </div>
  );
}
