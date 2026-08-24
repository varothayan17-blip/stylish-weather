/**
 * WardrobeEntrance.tsx
 *
 * Session-gated closet-opening entrance animation for the Wardrobe route.
 * UI-only. No backend, no Firestore, no entitlement, no AI.
 *
 * TIMING (full animation, ~1.1 s total):
 *   0 ms   — closet appears, doors closed
 *   80 ms  — doors begin to swing open
 *   550 ms — doors fully open, interior bright
 *   750 ms — closet fades & scales away
 *   900 ms — done, underlying content visible
 *
 * SESSION BEHAVIOR:
 *   First visit  → full animation (aeruvo:wardrobe-intro-seen absent)
 *   Later visits → 300 ms quick fade
 *
 * REDUCED MOTION:
 *   The global prefers-reduced-motion rule in styles.css already collapses
 *   all animation-duration values to 0.001 ms. No extra handling needed here —
 *   the component will simply flash briefly and clear.
 */

import { useEffect, useRef, useState } from "react";

const SESSION_KEY = "aeruvo:wardrobe-intro-seen";

type Phase = "enter" | "open" | "exit" | "done";

export function WardrobeEntrance({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("enter");
  const isFirstVisit = useRef(
    typeof sessionStorage !== "undefined"
      ? !sessionStorage.getItem(SESSION_KEY)
      : false,
  );

  // Total durations differ between first and repeat visits
  const full = isFirstVisit.current;

  useEffect(() => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "1");
    }

    // Timeline: enter → open → exit → done
    const t1 = setTimeout(() => setPhase("open"),  full ? 80  : 40);
    const t2 = setTimeout(() => setPhase("exit"),  full ? 600 : 120);
    const t3 = setTimeout(() => {
      setPhase("done");
      onDone();
    }, full ? 950 : 350);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "done") return null;

  const isOpen = phase === "open" || phase === "exit";
  const isExiting = phase === "exit";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center"
      style={{
        opacity:   isExiting ? 0 : 1,
        transform: isExiting ? "scale(1.06)" : "scale(1)",
        transition: isExiting
          ? "opacity 280ms cubic-bezier(0.4,0,1,1), transform 300ms cubic-bezier(0.4,0,1,1)"
          : "none",
      }}
    >
      {/* Atmospheric glow behind the closet */}
      <div
        className="absolute h-72 w-72 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(0.62 0.16 248 / 0.22) 0%, transparent 70%)",
          filter: "blur(32px)",
          opacity: isOpen ? 1 : 0.4,
          transition: "opacity 500ms ease",
        }}
      />

      {/* Closet frame */}
      <div
        className="relative"
        style={{ width: 220, height: 270 }}
      >
        {/* Outer frame — glass card style */}
        <div
          className="absolute inset-0 overflow-hidden rounded-2xl"
          style={{
            background: "oklch(0.97 0.006 248 / 0.12)",
            backdropFilter: "blur(24px) saturate(160%)",
            border: "1px solid oklch(0.80 0.10 248 / 0.28)",
            boxShadow:
              "0 8px 32px oklch(0.20 0.06 248 / 0.22), inset 0 1px 0 oklch(1 0 0 / 0.20)",
          }}
        >
          {/* Interior — visible between the doors */}
          <div
            className="absolute inset-0"
            style={{
              background: isOpen
                ? "linear-gradient(to bottom, oklch(0.96 0.04 248 / 0.18) 0%, oklch(0.92 0.06 248 / 0.10) 100%)"
                : "linear-gradient(to bottom, oklch(0.20 0.04 248 / 0.40) 0%, oklch(0.12 0.04 248 / 0.60) 100%)",
              transition: "background 400ms ease 200ms",
            }}
          />

          {/* Hanging rail */}
          <div
            className="absolute left-6 right-6 top-10"
            style={{
              height: 2,
              borderRadius: 1,
              background: "oklch(0.75 0.10 248 / 0.35)",
              boxShadow: "0 1px 3px oklch(0.50 0.12 248 / 0.20)",
              opacity: isOpen ? 1 : 0,
              transition: "opacity 250ms ease 300ms",
            }}
          />
          {/* Rail end caps */}
          {[20, 195].map((x) => (
            <div
              key={x}
              className="absolute top-[34px]"
              style={{
                left: x,
                width: 6,
                height: 14,
                borderRadius: 3,
                background: "oklch(0.70 0.12 248 / 0.40)",
                opacity: isOpen ? 1 : 0,
                transition: "opacity 250ms ease 350ms",
              }}
            />
          ))}

          {/* Clothing silhouettes — three soft shapes on the rail */}
          {[
            { x: 52, w: 36, h: 80, delay: 400, tilt: -4 },
            { x: 95, w: 30, h: 70, delay: 430, tilt: 0  },
            { x: 133, w: 38, h: 85, delay: 460, tilt: 3 },
          ].map(({ x, w, h, delay, tilt }, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: x,
                top: 44,
                width: w,
                height: h,
                borderRadius: "8px 8px 12px 12px",
                background:
                  i === 0
                    ? "oklch(0.55 0.14 248 / 0.22)"
                    : i === 1
                    ? "oklch(0.70 0.10 220 / 0.18)"
                    : "oklch(0.50 0.08 260 / 0.25)",
                backdropFilter: "blur(4px)",
                border: "1px solid oklch(0.80 0.10 248 / 0.18)",
                transform: `rotate(${tilt}deg)`,
                transformOrigin: "top center",
                opacity: isOpen ? 1 : 0,
                transition: `opacity 300ms ease ${delay}ms, transform 400ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms`,
              }}
            >
              {/* Hanger loop */}
              <div
                style={{
                  position: "absolute",
                  top: -9,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 14,
                  height: 10,
                  border: "1.5px solid oklch(0.75 0.10 248 / 0.45)",
                  borderBottom: "none",
                  borderRadius: "6px 6px 0 0",
                }}
              />
            </div>
          ))}

          {/* Shelf line at bottom third */}
          <div
            className="absolute left-4 right-4"
            style={{
              bottom: 60,
              height: 1,
              background: "oklch(0.75 0.10 248 / 0.20)",
              opacity: isOpen ? 1 : 0,
              transition: "opacity 250ms ease 380ms",
            }}
          />

          {/* "My Wardrobe" label — shows in the interior */}
          <div
            className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-1"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? "translateY(0)" : "translateY(6px)",
              transition: "opacity 300ms ease 350ms, transform 300ms ease 350ms",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "oklch(0.55 0.12 248 / 0.75)",
              }}
            >
              My Wardrobe
            </p>
          </div>
        </div>

        {/* ── Left door ─────────────────────────────────────────────── */}
        <div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-l-2xl"
          style={{
            width: "50%",
            transformOrigin: "left center",
            transform: isOpen ? "perspective(500px) rotateY(-82deg)" : "perspective(500px) rotateY(0deg)",
            transition: isOpen
              ? "transform 480ms cubic-bezier(0.34, 1.2, 0.64, 1)"
              : "none",
            zIndex: 2,
          }}
        >
          <DoorPanel side="left" />
        </div>

        {/* ── Right door ────────────────────────────────────────────── */}
        <div
          className="absolute inset-y-0 right-0 overflow-hidden rounded-r-2xl"
          style={{
            width: "50%",
            transformOrigin: "right center",
            transform: isOpen ? "perspective(500px) rotateY(82deg)" : "perspective(500px) rotateY(0deg)",
            transition: isOpen
              ? "transform 480ms cubic-bezier(0.34, 1.2, 0.64, 1)"
              : "none",
            zIndex: 2,
          }}
        >
          <DoorPanel side="right" />
        </div>

        {/* Center seam — hair-thin line between doors */}
        <div
          className="absolute inset-y-0 left-1/2 z-[3]"
          style={{
            width: 1,
            marginLeft: -0.5,
            background: "oklch(0.60 0.10 248 / 0.30)",
            opacity: isOpen ? 0 : 1,
            transition: "opacity 150ms ease",
          }}
        />
      </div>
    </div>
  );
}

/** One door panel — glass face with handle and wood-grain hint */
function DoorPanel({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div
      className="relative h-full w-full"
      style={{
        background:
          "linear-gradient(to bottom right, oklch(0.97 0.02 248 / 0.28), oklch(0.88 0.04 240 / 0.18))",
        backdropFilter: "blur(20px) saturate(140%)",
        border: "1px solid oklch(0.80 0.10 248 / 0.30)",
        boxShadow: isLeft
          ? "inset -1px 0 0 oklch(0.70 0.08 248 / 0.15), 2px 0 8px oklch(0.20 0.06 248 / 0.12)"
          : "inset 1px 0 0 oklch(0.70 0.08 248 / 0.15), -2px 0 8px oklch(0.20 0.06 248 / 0.12)",
      }}
    >
      {/* Highlight stripe along top */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: 48,
          background:
            "linear-gradient(to bottom, oklch(1 0 0 / 0.20), transparent)",
          borderRadius: "inherit",
        }}
      />

      {/* Inset panel detail */}
      <div
        className="absolute"
        style={{
          inset: "16px 10px",
          border: "1px solid oklch(0.75 0.08 248 / 0.18)",
          borderRadius: 10,
        }}
      />

      {/* Handle */}
      <div
        className="absolute top-1/2"
        style={{
          [isLeft ? "right" : "left"]: 10,
          transform: "translateY(-50%)",
          width: 6,
          height: 32,
          borderRadius: 3,
          background:
            "linear-gradient(to bottom, oklch(0.85 0.08 248 / 0.60), oklch(0.70 0.10 248 / 0.50))",
          boxShadow: "0 1px 4px oklch(0.20 0.06 248 / 0.25)",
        }}
      />
    </div>
  );
}
