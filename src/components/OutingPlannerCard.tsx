import { Link } from "@tanstack/react-router";
import { Crown, CalendarClock, ChevronRight } from "lucide-react";

export function OutingPlannerCard() {
  return (
    <Link
      {...{to: "/plan" as any}}
      className="press block rounded-3xl bg-foreground/[0.04] px-5 py-4 ring-1 ring-transparent hover:ring-primary/20 transition-all"
      aria-label="Open Outing Planner"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <CalendarClock className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold leading-snug">Plan an outing</p>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
              <Crown className="h-2.5 w-2.5" /> Premium
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground leading-snug">
            Choose when and where you're going. Aeruvo checks the whole outing
            and builds one adaptable outfit.
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
      </div>
    </Link>
  );
}
