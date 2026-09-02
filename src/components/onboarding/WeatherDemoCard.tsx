/**
 * WeatherDemoCard — static weather visualization for intro screen 2.
 * Shows a daily weather timeline with recognizable garment combinations.
 * No emoji, no abstract shapes, no remote images, no API calls.
 */
import { Sun, CloudRain, CloudSun, Moon, Umbrella } from "lucide-react";

const PERIODS = [
  {
    label: "Morning",
    time: "8 AM",
    Icon: Sun,
    iconClass: "text-amber-400",
    temp: "8°",
    // jacket + trousers + boots
    top: { color: "#6b7280", shape: "jacket" as const },
    bottom: { color: "#374151", shape: "pants" as const },
    shoe: { color: "#1f2937", shape: "boot" as const },
  },
  {
    label: "Midday",
    time: "12 PM",
    Icon: CloudSun,
    iconClass: "text-amber-300",
    temp: "12°",
    // sweater + jeans + sneakers
    top: { color: "#60a5fa", shape: "sweater" as const },
    bottom: { color: "#1d4ed8", shape: "pants" as const },
    shoe: { color: "#e5e7eb", shape: "sneaker" as const },
  },
  {
    label: "Afternoon",
    time: "4 PM",
    Icon: CloudRain,
    iconClass: "text-primary",
    temp: "9°",
    // rain jacket + jeans + boots
    top: { color: "#1d4ed8", shape: "jacket" as const },
    bottom: { color: "#374151", shape: "pants" as const },
    shoe: { color: "#374151", shape: "boot" as const },
  },
  {
    label: "Evening",
    time: "8 PM",
    Icon: Moon,
    iconClass: "text-indigo-400",
    temp: "6°",
    // coat + pants + boots
    top: { color: "#1e1b4b", shape: "jacket" as const },
    bottom: { color: "#312e81", shape: "pants" as const },
    shoe: { color: "#1e1b4b", shape: "boot" as const },
  },
] as const;

const TEMP_NORM = [0, 1, 0.5, 0.17];

type GarmentShape = "jacket" | "sweater" | "pants" | "boot" | "sneaker";

function GarmentIcon({ shape, color }: { shape: GarmentShape; color: string }) {
  if (shape === "jacket") return (
    <svg viewBox="0 0 20 18" fill={color} xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
      <path d="M7 4 L5 5 L2 8 L3 13 L6 12 L6 17 L14 17 L14 12 L17 13 L18 8 L15 5 L13 4 Q10 2 7 4Z" />
      <path d="M8 4 L8 8 L10 9 L12 8 L12 4 Q10 3 8 4Z" fill="rgba(255,255,255,0.15)" />
    </svg>
  );
  if (shape === "sweater") return (
    <svg viewBox="0 0 20 18" fill={color} xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
      <path d="M7 5 L4 7 L3 13 L6 12 L6 17 L14 17 L14 12 L17 13 L16 7 L13 5 Q10 3 7 5Z" />
      <path d="M8 5 Q10 3 12 5 L12 6 Q10 4 8 6 Z" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  if (shape === "pants") return (
    <svg viewBox="0 0 18 22" fill={color} xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
      <rect x="2" y="2" width="14" height="4" rx="1.5" />
      <path d="M2 6 L1 21 L8 21 L9 6 Z" />
      <path d="M9 6 L10 21 L17 21 L16 6 Z" />
    </svg>
  );
  if (shape === "boot") return (
    <svg viewBox="0 0 22 16" fill={color} xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
      <path d="M4 12 Q4 15 8 15 L18 15 Q21 15 21 13 L21 11 Q16 13 4 12 Z" opacity="0.7" />
      <path d="M5 12 L5 3 L10 3 L10 8 Q12 6 18 10 L21 11 L21 13 Q10 14 5 12 Z" />
      <rect x="5" y="2" width="5" height="2" rx="1" opacity="0.8" />
    </svg>
  );
  // sneaker
  return (
    <svg viewBox="0 0 22 14" fill={color} xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
      <path d="M2 9 Q2 13 6 13 L17 13 Q21 13 21 11 L21 9 Z" opacity="0.5" />
      <path d="M4 9 L4 5 Q4 2 7 2 L13 1 Q16 1 19 5 L21 9 Z" />
      <path d="M8 2 L9 9 L11 9 L11 1 Z" opacity="0.5" />
    </svg>
  );
}

export function WeatherDemoCard() {
  const minY = 16, maxY = 4, colW = 100 / PERIODS.length;

  const points = TEMP_NORM.map((n, i) => {
    const x = (colW * i + colW / 2).toFixed(1);
    const y = (maxY + (1 - n) * (minY - maxY)).toFixed(2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="glass-card overflow-hidden rounded-3xl p-4" role="img" aria-label="Daily weather and outfit forecast">
      {/* Time periods with weather and temp */}
      <div className="grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, time, Icon, iconClass, temp }) => (
          <div key={label} className="flex flex-col items-center gap-0.5">
            <p className="text-[9px] font-semibold text-foreground/70">{label}</p>
            <p className="text-[9px] text-muted-foreground">{time}</p>
            <Icon aria-hidden className={`mt-0.5 h-6 w-6 ${iconClass}`} strokeWidth={1.5} />
            <p className="text-base font-bold tracking-tight">{temp}</p>
          </div>
        ))}
      </div>

      {/* Temperature sparkline */}
      <div className="mt-2 px-1">
        <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
          <defs>
            <linearGradient id="wdc-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.3" />
              <stop offset="50%" stopColor="oklch(0.62 0.16 248)" stopOpacity="1" />
              <stop offset="100%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <polyline points={points} fill="none" stroke="url(#wdc-grad)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {TEMP_NORM.map((n, i) => (
            <circle key={i} cx={(colW * i + colW / 2).toFixed(1)} cy={(maxY + (1 - n) * (minY - maxY)).toFixed(2)} r="1.5" fill="oklch(0.62 0.16 248)" />
          ))}
        </svg>
      </div>

      {/* Outfit rows: top / bottom / shoes — recognizable garment icons */}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, top }) => (
          <div key={label} className="flex justify-center items-center h-5">
            <GarmentIcon shape={top.shape} color={top.color} />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, bottom }) => (
          <div key={label} className="flex justify-center items-center h-5">
            <GarmentIcon shape={bottom.shape} color={bottom.color} />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, shoe }) => (
          <div key={label} className="flex justify-center items-center h-5">
            <GarmentIcon shape={shoe.shape} color={shoe.color} />
          </div>
        ))}
      </div>

      {/* Umbrella reminder */}
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-primary/8 px-3 py-2">
        <Umbrella aria-hidden className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
        <p className="text-xs font-medium text-primary">Bring an umbrella in the afternoon</p>
      </div>
    </div>
  );
}
