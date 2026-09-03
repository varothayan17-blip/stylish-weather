/**
 * WeatherDataSourcesSheet.tsx — Informational sheet about Aeruvo's weather data.
 *
 * Opened from the hero overflow menu → "Weather data sources".
 * No technical radar terminology is shown to ordinary users.
 */
import { useEffect, useRef } from "react";
import { X, CloudSun, Radar } from "lucide-react";

interface Props {
  isOpen:  boolean;
  onClose: () => void;
}

export function WeatherDataSourcesSheet({ isOpen, onClose }: Props) {
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const triggerRef    = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Weather data sources"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-background shadow-2xl">
        <div aria-hidden className="mx-auto mt-3 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-lg font-semibold text-foreground">Weather data sources</h2>
          <button
            ref={firstFocusRef}
            onClick={onClose}
            aria-label="Close"
            className="press -m-2 rounded-full p-2 text-muted-foreground hover:text-foreground
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 pb-8 space-y-5">
          <div className="flex gap-4 rounded-2xl bg-muted/40 p-4">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CloudSun aria-hidden className="h-4.5 w-4.5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">Forecasts &amp; conditions</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Temperature, wind, precipitation probability and hourly forecasts come from{" "}
                <span className="font-medium text-foreground">Open-Meteo</span>, a free and open-source
                weather API that uses global numerical weather-prediction models.
              </p>
            </div>
          </div>
          <div className="flex gap-4 rounded-2xl bg-muted/40 p-4">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Radar aria-hidden className="h-4.5 w-4.5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">Current precipitation</p>
              <p className="mt-1 text-sm text-muted-foreground">
                For Canadian locations, Aeruvo may also use weather radar data from{" "}
                <span className="font-medium text-foreground">Environment and Climate Change Canada</span>{" "}
                to refine whether precipitation is active right now. Forecast data from Open-Meteo is used
                when radar observations are unavailable.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Weather data is typically refreshed every few minutes. Short-lived or very localised events
            may not be immediately reflected. If something looks wrong, you can report it using the
            "Report weather" option.
          </p>
          <button
            onClick={onClose}
            className="w-full rounded-2xl bg-foreground py-3 text-sm font-semibold text-background
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
