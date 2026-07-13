import { Link, useRouterState } from "@tanstack/react-router";
import { Home, CalendarDays, Heart, Settings } from "lucide-react";

const items = [
  { to: "/", icon: Home, label: "Today" },
  { to: "/forecast", icon: CalendarDays, label: "Forecast" },
  { to: "/saved", icon: Heart, label: "Saved" },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;

export function BottomNav() {
  const { location } = useRouterState();
  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto max-w-md px-5 pb-4 pt-2">
        <div className="glass-card flex items-center justify-around rounded-full px-1.5 py-1.5">
          {items.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={`press relative flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-2 ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-primary/10 ring-1 ring-inset ring-primary/15"
                  />
                )}
                <Icon
                  className={`relative h-5 w-5 transition-transform duration-300 ${active ? "scale-110" : ""}`}
                  strokeWidth={active ? 2.2 : 1.7}
                />
                <span className="relative text-[10px] font-medium tracking-wide">
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
