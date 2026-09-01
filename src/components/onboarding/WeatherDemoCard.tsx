/**
 * WeatherDemoCard — static weather visualization for intro screen 2.
 * Uses only Lucide icons + CSS. No emoji, no remote images, no API calls.
 * All values are hardcoded demonstration data — no live weather is fetched.
 */
import {
  Sun,
  CloudRain,
  CloudSun,
  Moon,
  Umbrella,
  Layers,
  ArrowRightLeft,
  Footprints,
} from "lucide-react";

const PERIODS = [
  {
    label: "Morning",
    time: "8 AM",
    Icon: Sun,
    iconClass: "text-amber-400",
    temp: "8°",
    top: "bg-slate-400",
    topLabel: "jacket",
    bottom: "bg-stone-400",
    shoes: "bg-slate-600",
  },
  {
    label: "Midday",
    time: "12 PM",
    Icon: CloudSun,
    iconClass: "text-amber-300",
    temp: "12°",
    top: "bg-blue-400",
    topLabel: "sweater",
    bottom: "bg-stone-400",
    shoes: "bg-slate-500",
  },
  {
    label: "Afternoon",
    time: "4 PM",
    Icon: CloudRain,
    iconClass: "text-primary",
    temp: "9°",
    top: "bg-slate-500",
    topLabel: "rain jacket",
    bottom: "bg-stone-500",
    shoes: "bg-slate-700",
  },
  {
    label: "Evening",
    time: "8 PM",
    Icon: Moon,
    iconClass: "text-indigo-400",
    temp: "6°",
    top: "bg-slate-600",
    topLabel: "coat",
    bottom: "bg-stone-600",
    shoes: "bg-slate-800",
  },
] as const;

// Normalised temps for sparkline: 8°=0, 12°=1, 9°=0.5, 6°=0.17
const TEMP_NORM = [0, 1, 0.5, 0.17];

/** Tiny rounded pill garment swatch */
function Swatch({ color, shape = "square" }: { color: string; shape?: "square" | "wide" | "tall" }) {
  return (
    <div
      aria-hidden
      className={`${color} rounded-lg opacity-80 ${
        shape === "wide" ? "h-3 w-7" : shape === "tall" ? "h-5 w-3" : "h-4 w-4"
      }`}
    />
  );
}

export function WeatherDemoCard() {
  const minY = 16;
  const maxY = 4;
  const colW = 100 / PERIODS.length;

  const points = TEMP_NORM.map((n, i) => {
    const x = (colW * i + colW / 2).toFixed(1);
    const y = (maxY + (1 - n) * (minY - maxY)).toFixed(2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div
      className="glass-card overflow-hidden rounded-3xl p-4"
      role="img"
      aria-label="Example daily weather forecast showing morning through evening"
    >
      {/* Column headers + weather icons + temperatures */}
      <div className="grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, time, Icon, iconClass, temp }) => (
          <div key={label} className="flex flex-col items-center gap-0.5">
            <p className="text-[9px] font-semibold text-foreground/70">{label}</p>
            <p className="text-[9px] text-muted-foreground">{time}</p>
            <Icon aria-hidden className={`mt-1 h-6 w-6 ${iconClass}`} strokeWidth={1.5} />
            <p className="mt-0.5 text-base font-bold tracking-tight">{temp}</p>
          </div>
        ))}
      </div>

      {/* Temperature sparkline */}
      <div className="mt-2 px-1">
        <svg
          viewBox="0 0 100 22"
          preserveAspectRatio="none"
          className="h-5 w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="wdc-line-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.3" />
              <stop offset="50%" stopColor="oklch(0.62 0.16 248)" stopOpacity="1" />
              <stop offset="75%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <polyline
            points={points}
            fill="none"
            stroke="url(#wdc-line-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {TEMP_NORM.map((n, i) => (
            <circle
              key={i}
              cx={(colW * i + colW / 2).toFixed(1)}
              cy={(maxY + (1 - n) * (minY - maxY)).toFixed(2)}
              r="1.5"
              fill="oklch(0.62 0.16 248)"
            />
          ))}
        </svg>
      </div>

      {/* Outfit rows: top / bottom / shoes as colour swatches */}
      {/* Top row */}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, top }) => (
          <div key={label} className="flex justify-center">
            <Swatch color={top} shape="square" />
          </div>
        ))}
      </div>
      {/* Bottom row */}
      <div className="mt-1 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, bottom }) => (
          <div key={label} className="flex justify-center">
            <Swatch color={bottom} shape="wide" />
          </div>
        ))}
      </div>
      {/* Shoes row */}
      <div className="mt-1 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, shoes }) => (
          <div key={label} className="flex justify-center">
            <Swatch color={shoes} shape="tall" />
          </div>
        ))}
      </div>

      {/* Umbrella reminder chip */}
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-primary/8 px-3 py-2">
        <Umbrella aria-hidden className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
        <p className="text-xs font-medium text-primary">Bring an umbrella in the afternoon</p>
      </div>
    </div>
  );
}
