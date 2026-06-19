import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  if (bare) {
    return (
      <div className="relative min-h-screen bg-white">
        <main className="mx-auto max-w-md pb-28">{children}</main>
        <BottomNav />
      </div>
    );
  }
  return (
    <div className="relative min-h-screen bg-zinc-50">
      <main className="mx-auto max-w-md px-5 pb-32 pt-6">{children}</main>
      <BottomNav />
    </div>
  );
}