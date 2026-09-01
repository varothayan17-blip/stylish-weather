/** Primary + secondary button pair used on every intro screen. */
interface IntroButtonsProps {
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  primaryDisabled?: boolean;
}

export function IntroButtons({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  primaryDisabled = false,
}: IntroButtonsProps) {
  return (
    <div className="mt-auto pt-8 space-y-3">
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="press block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={onSecondary}
        className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {secondaryLabel}
      </button>
    </div>
  );
}
