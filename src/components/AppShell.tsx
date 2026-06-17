import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  const orb = "absolute rounded-full blur-3xl animate-float will-change-transform [transform:translateZ(0)] [backface-visibility:hidden]";
  return (
    <div className="relative min-h-screen overflow-x-hidden isolate">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [transform:translateZ(0)]"
      >
        <div className={`${orb} -top-32 -left-24 h-80 w-80 bg-primary/30`} />
        <div className={`${orb} top-1/3 -right-24 h-72 w-72 bg-accent/40`} style={{ animationDelay: "2s" }} />
        <div className={`${orb} bottom-0 left-1/4 h-72 w-72 bg-primary/20`} style={{ animationDelay: "4s" }} />
      </div>
      <main className="mx-auto max-w-md px-5 pb-32 pt-6">{children}</main>
      <BottomNav />
    </div>
  );
}