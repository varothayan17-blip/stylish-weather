import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Heart, Settings, Sparkles } from "lucide-react";

const items = [
  { to: "/", icon: Home, label: "Today" },
  { to: "/saved", icon: Heart, label: "Saved" },
  { to: "/premium", icon: Sparkles, label: "Premium" },
  { to: "/preferences", icon: Settings, label: "You" },
] as const;

export function BottomNav() {
  const { location } = useRouterState();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-around border-t border-zinc-100 bg-white/85 px-6 py-3 backdrop-blur-xl">
          {items.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
                  active ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}