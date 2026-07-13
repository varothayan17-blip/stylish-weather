import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  const orb =
    "absolute rounded-full blur-3xl animate-float will-change-transform [transform:translateZ(0)] [backface-visibility:hidden]";
  return (
    <div className="relative min-h-screen overflow-x-hidden isolate">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [transform:translateZ(0)]"
      >
        <div className={`${orb} -top-40 -left-32 h-[26rem] w-[26rem] bg-primary/25`} />
        <div
          className={`${orb} top-1/3 -right-32 h-[22rem] w-[22rem] bg-accent/35`}
          style={{ animationDelay: "2s" }}
        />
        <div
          className={`${orb} bottom-[-4rem] left-1/4 h-[22rem] w-[22rem] bg-primary/15`}
          style={{ animationDelay: "4s" }}
        />
        {/* Soft top-lit gradient for depth */}
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/40 to-transparent dark:from-white/[0.04]" />
        {/* Subtle noise texture for premium feel */}
        <div
          className="absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.06]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
      </div>
      <main className="mx-auto max-w-md px-5 pb-36 pt-[calc(env(safe-area-inset-top)+2rem)]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
