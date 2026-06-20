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
      <div className="mx-auto max-w-md px-4 pb-3 pt-2">
        <div className="glass-card flex items-center justify-around rounded-full px-2 py-2">
          {items.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-2 transition-all ${
                  active ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}