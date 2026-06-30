import { RotateCw } from "lucide-react";

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass-card mb-4 flex items-center justify-between gap-3 rounded-3xl p-4 animate-fade-up">
      <p className="text-sm leading-snug text-destructive">{message}</p>
      <button
        onClick={onRetry}
        aria-label="Try again"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive active:scale-95"
      >
        <RotateCw className="h-4 w-4" />
      </button>
    </div>
  );
}
