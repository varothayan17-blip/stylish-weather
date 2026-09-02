/**
 * WeatherDemoCard — static weather visualization for intro screen 2.
 *
 * Motion: purely CSS (see ./onboarding-motion.css). Reveal order is
 * morning → midday → afternoon → evening, the temperature line draws left to
 * right, the afternoon rain icon lands before the umbrella banner slides in
 * last. No timers, no loops, no people, no emoji, no remote images.
 * All values are hardcoded demonstration data — no live weather is fetched.
 */
import { Sun, CloudRain, CloudSun, Moon, Umbrella } from "lucide-react";
import "./onboarding-motion.css";

const PERIODS = [
  {
    label: "Morning",
    time: "8 AM",
    Icon: Sun,
    iconClass: "text-amber-400",
    temp: "8°",
    top: "text-slate-400",
    bottom: "text-stone-400",
    shoe: "text-slate-600",
  },
  {
    label: "Midday",
    time: "12 PM",
    Icon: CloudSun,
    iconClass: "text-amber-300",
    temp: "12°",
    top: "text-blue-400",
    bottom: "text-stone-400",
    shoe: "text-slate-500",
  },
  {
    label: "Afternoon",
    time: "4 PM",
    Icon: CloudRain,
    iconClass: "text-primary",
    temp: "9°",
    top: "text-slate-500",
    bottom: "text-stone-500",
    shoe: "text-slate-700",
  },
  {
    label: "Evening",
    time: "8 PM",
    Icon: Moon,
    iconClass: "text-indigo-400",
    temp: "6°",
    top: "text-slate-600",
    bottom: "text-stone-600",
    shoe: "text-slate-800",
  },
] as const;

// Normalised temps for the sparkline: 8°=0, 12°=1, 9°=0.5, 6°=0.17
const TEMP_NORM = [0, 1, 0.5, 0.17];

/** Per-column reveal delays, morning → evening. */
const COL_DELAY = ["ob-d2", "ob-d4", "ob-d6", "ob-d8"] as const;
const OUTFIT_DELAY = ["ob-d6", "ob-d7", "ob-d8", "ob-d9"] as const;

/**
 * One readable head-to-toe silhouette: top, bottom and footwear grouped as a
 * single figure with edge highlights and a grounded contact shadow.
 */
function OutfitSilhouette({
  top,
  bottom,
  shoe,
}: {
  top: string;
  bottom: string;
  shoe: string;
}) {
  return (
    <svg viewBox="0 0 44 92" fill="none" className="h-[74px] w-full" aria-hidden>
      {/* Grounded contact shadow */}
      <ellipse cx="22" cy="88" rx="14" ry="2.6" className="fill-foreground/12" />

      {/* Bottom (trousers) */}
      <g className={bottom}>
        <path
          d="M11 40 H33 L31.5 78 H24 L22 52 L20 78 H12.5 Z"
          fill="currentColor"
          opacity="0.9"
        />
        <path d="M11 40 H33 L32.7 46 H11.3 Z" fill="currentColor" opacity="0.55" />
        <path d="M22 46 V78" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
      </g>

      {/* Footwear */}
      <g className={shoe}>
        <path d="M11 78 H20.5 v5 q0 2.4 -2.6 2.4 H11 q-2 0 -2 -2 Z" fill="currentColor" />
        <path d="M23.5 78 H33 v5.4 q0 2 -2 2 h-6.9 q-2.6 0 -2.6 -2.4 Z" fill="currentColor" />
        <path
          d="M9 84 h11.5 M23.5 84 H35"
          stroke="currentColor"
          strokeWidth="1.6"
          opacity="0.55"
          strokeLinecap="round"
        />
      </g>

      {/* Top (sweater / jacket) with sleeves */}
      <g className={top}>
        <path
          d="M15 12 L6 20 L9.6 25 L13 22 V46 H31 V22 L34.4 25 L38 20 L29 12 Z"
          fill="currentColor"
          opacity="0.95"
        />
        {/* Sleeve shading */}
        <path d="M15 12 L6 20 L9.6 25 L13 22 Z" fill="currentColor" opacity="0.7" />
        <path d="M29 12 L38 20 L34.4 25 L31 22 Z" fill="currentColor" opacity="0.7" />
        {/* Collar */}
        <path d="M17 11 Q22 7 27 11 L28.6 13.4 Q22 17.6 15.4 13.4 Z" fill="currentColor" />
        {/* Edge highlight */}
        <path
          d="M15 13 L13.6 21"
          stroke="currentColor"
          strokeWidth="0.8"
          opacity="0.35"
          strokeLinecap="round"
        />
        <path d="M13 44 H31" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      </g>
    </svg>
  );
}

export function WeatherDemoCard() {
  const minY = 16;
  const maxY = 4;
  const colW = 100 / PERIODS.length;

  const coords = TEMP_NORM.map((n, i) => ({
    x: Number((colW * i + colW / 2).toFixed(2)),
    y: Number((maxY + (1 - n) * (minY - maxY)).toFixed(2)),
  }));
  const points = coords.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div
      className="glass-card overflow-hidden rounded-3xl p-4"
      role="img"
      aria-label="Example daily forecast: morning 8 degrees, midday 12 degrees, afternoon 9 degrees with rain, evening 6 degrees, with a suggested outfit for each period."
    >
      {/* Column headers + weather icons + temperatures */}
      <div className="grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, time, Icon, iconClass, temp }, i) => (
          <div
            key={label}
            className={`ob-anim ob-rise ${COL_DELAY[i]} flex flex-col items-center gap-0.5`}
          >
            <p className="text-[10px] font-semibold text-foreground/70">{label}</p>
            <p className="text-[9px] text-muted-foreground">{time}</p>
            <Icon aria-hidden className={`mt-1 h-7 w-7 ${iconClass}`} strokeWidth={1.5} />
            <p className="mt-0.5 text-lg font-bold tracking-tight">{temp}</p>
          </div>
        ))}
      </div>

      {/* Temperature sparkline — drawn left to right, points revealed in order */}
      <div className="mt-2 px-1">
        <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
          <defs>
            <linearGradient id="wdc-line-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.35" />
              <stop offset="50%" stopColor="oklch(0.62 0.16 248)" stopOpacity="1" />
              <stop offset="100%" stopColor="oklch(0.62 0.16 248)" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <polyline
            points={points}
            fill="none"
            stroke="url(#wdc-line-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="ob-anim ob-draw ob-d2"
            style={{ ["--ob-len" as string]: "160" }}
          />
          {coords.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="1.6"
              fill="oklch(0.62 0.16 248)"
              className={`ob-anim ob-fade ${COL_DELAY[i]}`}
            />
          ))}
        </svg>
      </div>

      {/* One grouped outfit per period */}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {PERIODS.map(({ label, top, bottom, shoe }, i) => (
          <div key={label} className={`ob-anim ob-pop ${OUTFIT_DELAY[i]} flex justify-center`}>
            <OutfitSilhouette top={top} bottom={bottom} shoe={shoe} />
          </div>
        ))}
      </div>

      {/* Umbrella reminder — arrives last, after the afternoon rain is visible */}
      <div className="ob-anim ob-slide-up ob-d11 mt-3 flex items-center gap-2 rounded-2xl bg-primary/10 px-3 py-2 ring-1 ring-inset ring-primary/15">
        <Umbrella aria-hidden className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
        <p className="text-xs font-medium text-primary">Bring an umbrella in the afternoon</p>
      </div>
    </div>
  );
}
