import { Wind, Umbrella, Snowflake } from "lucide-react";
import type { WeatherAlert } from "@/lib/alerts";

const ICONS = { "wind-chill": Wind, rain: Umbrella, snow: Snowflake } as const;

export function WeatherAlertCards({ alerts }: { alerts: WeatherAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <section className="mt-4 space-y-2.5">
      {alerts.map((a) => {
        const Icon = ICONS[a.kind];
        const warning = a.severity === "warning";
        return (
          <div
            key={a.kind}
            className={`glass-card flex gap-3 rounded-3xl p-4 ${warning ? "ring-1 ring-destructive/25" : ""}`}
          >
            <div
              className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                warning ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{a.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.message}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
