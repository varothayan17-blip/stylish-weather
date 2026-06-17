import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-primary/30 blur-3xl animate-float" />
        <div className="absolute top-1/3 -right-24 h-72 w-72 rounded-full bg-accent/40 blur-3xl animate-float" style={{ animationDelay: "2s" }} />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-primary/20 blur-3xl animate-float" style={{ animationDelay: "4s" }} />
      </div>
      <main className="mx-auto max-w-md px-5 pb-32 pt-6">{children}</main>
      <BottomNav />
    </div>
  );
}