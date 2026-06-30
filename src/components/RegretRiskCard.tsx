import { useState, useEffect, useRef } from "react";
import type { RegretRisk } from "@/lib/regretRisk";

// ─── SVG arc gauge constants ────────────────────────────────────────────────
// The gauge is a half-circle arc (180°) drawn as an SVG path.
// We use a 200×110 viewBox so the arc sits in the top half and
// the label text sits just below the midpoint.
const CX = 100; // arc centre x
const CY = 100; // arc centre y (sits at the bottom of the viewBox)
const R = 80; // radius
const STROKE = 12; // track + fill stroke width
const DASH = Math.PI * R; // half-circumference (180° arc length)

// Colours keyed by level — must be CSS colour strings (not Tailwind classes)
// because they are used inside SVG stroke attributes.
const ARC_COLOR = {
  low: "oklch(0.67 0.17 145)", // emerald
  medium: "oklch(0.72 0.18 70)", // amber
  high: "oklch(0.58 0.22 25)", // destructive red
} as const;

const LABEL_COLOR = {
  low: {
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  medium: {
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  high: { text: "text-destructive", chip: "bg-destructive/10 text-destructive" },
} as const;

const LEVEL_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

// ─── Animated arc fill ──────────────────────────────────────────────────────
// dashoffset controls how much of the arc is "filled".
//   offset = DASH          → 0% filled (empty)
//   offset = 0             → 100% filled
//   offset = DASH*(1-f)    → f fraction filled
function scoreToOffset(score: number): number {
  const fraction = Math.min(100, Math.max(0, score)) / 100;
  return DASH * (1 - fraction);
}

// ─── Component ──────────────────────────────────────────────────────────────
export function RegretRiskCard({ risk }: { risk: RegretRisk }) {
  const [open, setOpen] = useState(false);
  // Animate the arc from 0 → actual score on first render
  const [displayScore, setDisplayScore] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 900; // ms

  useEffect(() => {
    const target = risk.score;
    startRef.current = null;

    function step(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / DURATION, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [risk.score]);

  const offset = scoreToOffset(displayScore);
  const arcColor = ARC_COLOR[risk.level];
  const lc = LABEL_COLOR[risk.level];

  return (
    <section className="glass-card rounded-[2rem] p-5">
      {/* ── Gauge ───────────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={open}
        aria-label={`Regret risk: ${LEVEL_LABEL[risk.level]}, score ${risk.score} out of 100. Tap to ${open ? "collapse" : "expand"} details.`}
      >
        <div className="flex items-center gap-5">
          {/* SVG arc gauge */}
          <div className="relative shrink-0" style={{ width: 110, height: 62 }}>
            <svg
              viewBox="0 0 200 110"
              width={110}
              height={62}
              aria-hidden
              style={{ overflow: "visible" }}
            >
              {/* Track (grey background arc) */}
              <path
                d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE}
                strokeLinecap="round"
                className="text-foreground/10"
              />
              {/* Filled arc — animates via strokeDashoffset */}
              <path
                d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
                fill="none"
                stroke={arcColor}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${DASH} ${DASH}`}
                strokeDashoffset={offset}
                style={{ transition: "none" }} // RAF handles animation
              />
              {/* Score label inside the arc */}
              <text
                x={CX}
                y={CY - 18}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={28}
                fontWeight={300}
                fill={arcColor}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {displayScore}
              </text>
              <text
                x={CX}
                y={CY - 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill="currentColor"
                className="text-muted-foreground"
                style={{ opacity: 0.6 }}
              >
                / 100
              </text>
            </svg>
          </div>

          {/* Text block */}
          <div className="min-w-0 flex-1">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${lc.chip}`}
            >
              {LEVEL_LABEL[risk.level]}
            </span>
            <p className="mt-1.5 text-sm font-medium leading-snug text-foreground/90">
              {risk.headline}
            </p>
            {risk.reasons.length > 0 && (
              <p className={`mt-1 text-[11px] leading-tight ${lc.text}`}>
                {open
                  ? "Tap to collapse"
                  : `${risk.reasons.length} contributing factor${risk.reasons.length > 1 ? "s" : ""}`}
              </p>
            )}
          </div>

          {/* Expand chevron */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* ── Expanded reasons ────────────────────────────────────────────── */}
      {open && risk.reasons.length > 0 && (
        <ul className="mt-4 space-y-2.5 border-t border-border/60 pt-4 animate-fade-up">
          {risk.reasons.map((r) => (
            <li key={r} className="flex items-start gap-2.5 text-sm text-foreground/80">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: arcColor }}
              />
              {r}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
