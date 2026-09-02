/**
 * OnboardingShell — shared layout wrapper for all intro screens.
 * Provides the sky-blue gradient background, safe-area padding and
 * the directional page-transition container.
 *
 * `transitionKey` remounts the inner content when the step changes so the
 * enter animation replays; `direction` picks forward (enter from right) or
 * back (enter from left). Motion is CSS-only and disabled under
 * prefers-reduced-motion.
 */
import type { ReactNode } from "react";
import "./onboarding-motion.css";

export function OnboardingShell({
  children,
  transitionKey,
  direction = "forward",
}: {
  children: ReactNode;
  transitionKey?: string | number;
  direction?: "forward" | "back";
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden isolate bg-[var(--gradient-sky)]">
      {/* Ambient background blobs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-28 -left-20 h-96 w-96 rounded-full bg-primary/20 blur-3xl animate-float" />
        <div
          className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/30 blur-3xl animate-float"
          style={{ animationDelay: "3s" }}
        />
      </div>
      {/* Content */}
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+3rem)]">
        <div
          key={transitionKey}
          className={`flex min-h-0 flex-1 flex-col ${
            direction === "back" ? "ob-page-back" : "ob-page-forward"
          }`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
