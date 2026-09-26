/**
 * ActivePlanCard — locked outing plan snapshot shown on the Home screen.
 *
 * Security: only rendered when the caller has verified entitlement.active.
 * The component itself is dumb — it does not check Premium; the caller must.
 * This prevents any free user from seeing plan content even with injected
 * localStorage data (see index.tsx for the entitlement guard).
 */
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import type { LockedPlan } from "@/lib/outingPlanStore";
import { formatHour } from "@/lib/outingPlanner";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function planLabel(plan: LockedPlan): string {
  const { coverageStart, coverageEnd, occasion } = plan.snapshot;
  return `Your ${formatHour(coverageStart)}–${formatHour(coverageEnd)} ${capitalize(occasion)} plan`;
}

export function ActivePlanCard({ plan }: { plan: LockedPlan }) {
  const baseNames  = plan.snapshot.baseItems.map((i) => i.name).join(", ");
  // Use split fields when available; fall back to removableLayers for old snapshots
  const snap = plan.snapshot;
  const allLayers = snap.departureLayers !== undefined
    ? [...(snap.departureLayers ?? []), ...(snap.carryLayers ?? [])]
    : snap.removableLayers;
  const layerNames = allLayers.map((i) => i.name).join(", ");

  return (
    <Link
      {...{to: "/plan" as any}}
      className="press block rounded-3xl bg-primary/[0.06] px-5 py-4 ring-1 ring-primary/15 hover:ring-primary/30 transition-all"
      aria-label={`View locked outing plan: ${planLabel(plan)}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <CalendarClock className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {planLabel(plan)}
            </p>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shrink-0">
              <CheckCircle2 className="h-2.5 w-2.5" /> Locked
            </span>
          </div>
          {baseNames && (
            <p className="text-sm font-medium leading-snug line-clamp-1">{baseNames}</p>
          )}
          {layerNames && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-1">
              + {layerNames}
            </p>
          )}
          {plan.adaptationNote && (
            <div className="mt-2 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug line-clamp-2">
                {plan.adaptationNote}
              </p>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-primary/60 shrink-0 mt-1" />
      </div>
    </Link>
  );
}
