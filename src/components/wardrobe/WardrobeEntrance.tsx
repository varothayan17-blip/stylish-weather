/**
 * WardrobeEntrance.tsx
 *
 * Session-gated closet-opening entrance animation for the Wardrobe route.
 * UI-only. No backend, no Firestore, no entitlement, no AI.
 *
 * EXACT TIMING (full animation, first visit):
 *   0 ms    — closed wardrobe visible, user reads "this is a closet"
 *   150 ms  — doors begin swinging outward
 *   700 ms  — doors fully/mostly open (~550 ms door swing)
 *   800 ms  — interior fully revealed, hold briefly
 *   850 ms  — closet begins dissolving (fade + slight scale)
 *   1 000ms — done, wardrobe content fades in underneath
 *
 * 3D TECHNIQUE:
 *   Parent frame has `perspective: 1000px` so both doors share one
 *   vanishing point — this is what makes it look like a physical scene
 *   rather than two independent panels.
 *   Left  door: transform-origin left center,  rotateY(-88deg)
 *   Right door: transform-origin right center, rotateY(88deg)
 *   No overflow-hidden on door wrappers — clipping defeats the 3D swing.
 *   No animated backdropFilter — expensive on iOS, prefer solid door.
 *
 * SESSION BEHAVIOR:
 *   First visit  → full ~1.0 s animation (aeruvo:wardrobe-intro-seen absent)
 *   Later visits → 300 ms quick fade-in only
 *
 * REDUCED MOTION:
 *   Detected explicitly via matchMedia. No 3D rotation, no transforms —
 *   instant opacity fade only. Does not rely on global CSS override alone.
 */

import { useEffect, useRef, useState } from "react";

const SESSION_KEY = "aeruvo:wardrobe-intro-seen";

type Phase = "closed" | "opening" | "open" | "exit" | "done";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WardrobeEntrance({ onDone }: { onDone: () => void }) {
  const [phase, setPhase]  = useState<Phase>("closed");
  const reduced            = useRef(prefersReducedMotion());
  const isFirstVisit       = useRef(
    typeof sessionStorage !== "undefined"
      ? !sessionStorage.getItem(SESSION_KEY)
      : false,
  );
  const full = isFirstVisit.current && !reduced.current;

  useEffect(() => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "1");
    }

    if (reduced.current) {
      // Reduced motion: no 3D, just a very brief opacity flash then done
      const t = setTimeout(() => { setPhase("done"); onDone(); }, 120);
      return () => clearTimeout(t);
    }

    if (!full) {
      // Repeat visit: simple fade, no full drama
      setPhase("opening");
      const t1 = setTimeout(() => setPhase("open"),  60);
      const t2 = setTimeout(() => setPhase("exit"),  160);
      const t3 = setTimeout(() => { setPhase("done"); onDone(); }, 350);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }

    // First visit — full sequence
    // closed → opening → open → exit → done
    const t1 = setTimeout(() => setPhase("opening"), 150);   // hold closed 150 ms
    const t2 = setTimeout(() => setPhase("open"),    750);   // doors ~550 ms to swing
    const t3 = setTimeout(() => setPhase("exit"),    860);   // brief hold ~110 ms
    const t4 = setTimeout(() => { setPhase("done"); onDone(); }, 1050); // fade out 190 ms

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "done") return null;
  if (reduced.current)  return null; // reduced-motion: skip entirely

  const isOpening = phase === "opening";
  const isOpen    = phase === "open" || phase === "exit";
  const isExiting = phase === "exit";

  // Door angles: open vs closed
  const leftAngle  = isOpening || isOpen ? -88 : 0;
  const rightAngle = isOpening || isOpen ?  88 : 0;

  // Door opening easing: ease-out with slight deceleration — premium feel
  const doorEasing = "cubic-bezier(0.25, 0.8, 0.25, 1)";
  const doorDur    = full ? "540ms" : "140ms";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center"
      style={{
        // Outer wrapper handles the exit fade + scale
        opacity:    isExiting ? 0 : 1,
        transform:  isExiting ? "scale(1.025)" : "scale(1)",
        transition: isExiting
          ? "opacity 180ms cubic-bezier(0.4,0,1,1), transform 200ms cubic-bezier(0.4,0,1,1)"
          : "opacity 120ms ease",
      }}
    >
      {/* Ambient glow — intensifies as doors open */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 280,
          height: 280,
          background:
            "radial-gradient(ellipse at center, oklch(0.62 0.16 248 / 0.28) 0%, transparent 70%)",
          filter: "blur(36px)",
          opacity: isOpen ? 1 : 0.35,
          transition: "opacity 500ms ease 120ms",
          willChange: "opacity",
        }}
      />

      {/*
        ── CLOSET FRAME ────────────────────────────────────────────────
        perspective: 1000px here creates a SHARED vanishing point for
        both doors — this is the key to convincing 3D door-swing depth.
        Do NOT put perspective on each door individually.
      */}
      <div
        style={{
          position: "relative",
          width: 230,
          height: 280,
          perspective: "1000px",
          perspectiveOrigin: "50% 50%",
        }}
      >
        {/* ── INTERIOR (sits behind the doors in z order) ────────── */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden"
          style={{
            background: isOpen
              ? "linear-gradient(160deg, oklch(0.96 0.05 240 / 0.32) 0%, oklch(0.90 0.08 248 / 0.20) 100%)"
              : "linear-gradient(160deg, oklch(0.18 0.04 248 / 0.70) 0%, oklch(0.10 0.03 248 / 0.85) 100%)",
            border: "1px solid oklch(0.80 0.10 248 / 0.30)",
            boxShadow: "0 12px 48px oklch(0.20 0.06 248 / 0.28), inset 0 1px 0 oklch(1 0 0 / 0.18)",
            transition: "background 380ms ease 160ms",
          }}
        >
          {/* Top interior highlight */}
          <div
            className="absolute inset-x-0 top-0"
            style={{
              height: 56,
              background: "linear-gradient(to bottom, oklch(1 0 0 / 0.18), transparent)",
              opacity: isOpen ? 1 : 0,
              transition: "opacity 300ms ease 240ms",
            }}
          />

          {/* ── Hanging rail ── */}
          <div
            className="absolute"
            style={{
              left: 20, right: 20, top: 44,
              height: 2.5,
              borderRadius: 2,
              background: "linear-gradient(to right, oklch(0.72 0.10 248 / 0.20), oklch(0.80 0.12 248 / 0.55), oklch(0.72 0.10 248 / 0.20))",
              boxShadow: "0 1px 4px oklch(0.45 0.12 248 / 0.30)",
              opacity: isOpen ? 1 : 0,
              transition: "opacity 220ms ease 280ms",
            }}
          />
          {/* Rail end caps */}
          {[14, 207].map((x) => (
            <div
              key={x}
              className="absolute"
              style={{
                left: x, top: 36,
                width: 7, height: 16,
                borderRadius: 4,
                background: "oklch(0.72 0.12 248 / 0.45)",
                opacity: isOpen ? 1 : 0,
                transition: "opacity 220ms ease 300ms",
              }}
            />
          ))}

          {/* ── Clothing silhouettes ── */}
          {[
            { x: 42,  w: 38, h: 82, tilt: -5, delay: 320, color: "oklch(0.55 0.14 250 / 0.35)" },
            { x: 92,  w: 32, h: 74, tilt:  1, delay: 360, color: "oklch(0.68 0.10 220 / 0.28)" },
            { x: 140, w: 40, h: 86, tilt:  4, delay: 400, color: "oklch(0.48 0.08 265 / 0.38)" },
          ].map(({ x, w, h, tilt, delay, color }, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: x, top: 46,
                width: w, height: h,
                borderRadius: "7px 7px 11px 11px",
                background: color,
                border: "1px solid oklch(0.85 0.08 248 / 0.22)",
                // Subtle reveal: float up slightly as it fades in
                opacity: isOpen ? 1 : 0,
                transform: isOpen ? `rotate(${tilt}deg) translateY(0px)` : `rotate(${tilt}deg) translateY(5px)`,
                transformOrigin: "top center",
                transition: `opacity 280ms ease ${delay}ms, transform 360ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
              }}
            >
              {/* Hanger loop */}
              <div
                style={{
                  position: "absolute",
                  top: -10, left: "50%",
                  transform: "translateX(-50%)",
                  width: 16, height: 11,
                  border: "1.5px solid oklch(0.78 0.10 248 / 0.50)",
                  borderBottom: "none",
                  borderRadius: "7px 7px 0 0",
                }}
              />
              {/* Garment shoulder curve */}
              <div
                style={{
                  position: "absolute",
                  top: 0, left: -4, right: -4, height: 14,
                  borderRadius: "8px 8px 0 0",
                  background: "oklch(1 0 0 / 0.08)",
                }}
              />
            </div>
          ))}

          {/* ── Shelf ── */}
          <div
            className="absolute"
            style={{
              left: 12, right: 12, bottom: 68,
              height: 1.5,
              background: "oklch(0.75 0.09 248 / 0.25)",
              opacity: isOpen ? 1 : 0,
              transition: "opacity 220ms ease 360ms",
            }}
          />

          {/* ── "My Wardrobe" label ── */}
          <div
            className="absolute inset-x-0 bottom-8 flex items-center justify-center"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? "translateY(0)" : "translateY(5px)",
              transition: "opacity 260ms ease 380ms, transform 260ms ease 380ms",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "oklch(0.52 0.12 248 / 0.80)",
              }}
            >
              My Wardrobe
            </span>
          </div>
        </div>

        {/*
          ── LEFT DOOR ───────────────────────────────────────────────
          transform-origin: left center — hinge on the left edge.
          No overflow-hidden: clipping kills the 3D swing illusion.
          No backdropFilter: expensive + fights iOS compositing.
          z-index 10: doors sit above the interior.
        */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-2xl"
          style={{
            width: "50%",
            transformOrigin: "left center",
            transform: `rotateY(${leftAngle}deg)`,
            transition: `transform ${doorDur} ${doorEasing}`,
            zIndex: 10,
            backfaceVisibility: "hidden",
          }}
        >
          <DoorPanel side="left" isOpen={isOpening || isOpen} />
        </div>

        {/*
          ── RIGHT DOOR ──────────────────────────────────────────────
          transform-origin: right center — hinge on the right edge.
        */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-2xl"
          style={{
            width: "50%",
            transformOrigin: "right center",
            transform: `rotateY(${rightAngle}deg)`,
            transition: `transform ${doorDur} ${doorEasing}`,
            zIndex: 10,
            backfaceVisibility: "hidden",
          }}
        >
          <DoorPanel side="right" isOpen={isOpening || isOpen} />
        </div>

        {/* Center seam */}
        <div
          className="absolute inset-y-0 left-1/2"
          style={{
            zIndex: 11,
            width: 1,
            marginLeft: -0.5,
            background: "oklch(0.55 0.10 248 / 0.35)",
            opacity: isOpening || isOpen ? 0 : 1,
            transition: "opacity 100ms ease",
          }}
        />
      </div>
    </div>
  );
}

/** Solid door panel with handle. No animated blur — uses static background only. */
function DoorPanel({ side, isOpen }: { side: "left" | "right"; isOpen: boolean }) {
  const isLeft = side === "left";
  return (
    <div
      className="relative h-full w-full rounded-inherit"
      style={{
        // Static glass look — NO backdropFilter to avoid iOS compositing cost
        background: isOpen
          ? "linear-gradient(135deg, oklch(0.95 0.03 248 / 0.70), oklch(0.88 0.05 240 / 0.60))"
          : "linear-gradient(135deg, oklch(0.94 0.03 248 / 0.75), oklch(0.86 0.05 240 / 0.65))",
        border: "1px solid oklch(0.82 0.10 248 / 0.38)",
        boxShadow: isLeft
          ? "inset -2px 0 6px oklch(0.60 0.08 248 / 0.12)"
          : "inset 2px 0 6px oklch(0.60 0.08 248 / 0.12)",
        borderRadius: "inherit",
        // Door edge shadow deepens as it swings — creates depth
        transition: "box-shadow 300ms ease",
      }}
    >
      {/* Top gloss highlight */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background: "linear-gradient(to bottom, oklch(1 0 0 / 0.22) 0%, oklch(1 0 0 / 0.04) 40%, transparent 100%)",
        }}
      />

      {/* Inset panel recess */}
      <div
        style={{
          position: "absolute",
          inset: "18px 12px",
          border: "1px solid oklch(0.72 0.08 248 / 0.22)",
          borderRadius: 12,
          background: "oklch(0.85 0.04 248 / 0.06)",
        }}
      />

      {/* Inner panel highlight top */}
      <div
        style={{
          position: "absolute",
          top: 19,
          left: 13,
          right: 13,
          height: 24,
          borderRadius: "12px 12px 0 0",
          background: "linear-gradient(to bottom, oklch(1 0 0 / 0.10), transparent)",
        }}
      />

      {/* Door handle — pill shape on inner edge */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          [isLeft ? "right" : "left"]: 12,
          transform: "translateY(-50%)",
          width: 5,
          height: 34,
          borderRadius: 3,
          background:
            "linear-gradient(to bottom, oklch(0.88 0.10 248 / 0.80), oklch(0.72 0.12 248 / 0.65))",
          boxShadow:
            "0 1px 4px oklch(0.25 0.08 248 / 0.30), inset 0 1px 0 oklch(1 0 0 / 0.30)",
        }}
      />
    </div>
  );
}
