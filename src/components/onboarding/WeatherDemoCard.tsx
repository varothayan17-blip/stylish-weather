/**
 * WeatherDemoCard — slide 1 "Dress for where the day takes you".
 *
 * A static day/location timeline (Home → Campus → Night out → Return) with
 * the practical decision attached to each stop. Motion is CSS-only
 * (./onboarding-motion.css): the timeline rail draws top-to-bottom (ob-draw)
 * and each stop + decision chip reveals in order, once. All values are
 * hardcoded demonstration data — no live weather is fetched.
 */
import { Home, GraduationCap, Sparkles, MoonStar, Umbrella } from "lucide-react";
import "./onboarding-motion.css";

type Decision = "wear" | "remove" | "pack" | "wearPacked";

const STOPS = [
  { place: "Home", time: "8 AM", temp: "17°C", Icon: Home, decision: "wear" as Decision, item: "Light knit + jeans", delay: "ob-d2" },
  { place: "Campus", time: "2 PM", temp: "Indoor est. 21°C", Icon: GraduationCap, decision: "remove" as Decision, item: "Open or remove the knit", delay: "ob-d4" },
  { place: "Night out", time: "10 PM", temp: "12°C · rain", Icon: Sparkles, decision: "pack" as Decision, item: "Jacket in your bag", delay: "ob-d6" },
  { place: "Return", time: "1 AM", temp: "9°C", Icon: MoonStar, decision: "wearPacked" as Decision, item: "Jacket on, zipped", delay: "ob-d8" },
] as const;

const DECISION_LABEL: Record<Decision, string> = {
  wear: "Wear now",
  remove: "Remove indoors",
  pack: "Pack for later",
  wearPacked: "Put jacket on",
};

const DECISION_STYLE: Record<Decision, string> = {
  wear: "bg-foreground text-background",
  remove: "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25",
  pack: "bg-primary text-primary-foreground",
  wearPacked: "bg-foreground/[0.06] text-foreground ring-1 ring-inset ring-foreground/10",
};

export function WeatherDemoCard() {
  return (
    <div
      className="glass-card relative overflow-hidden rounded-3xl p-4"
      role="img"
      aria-label="Example outing: home at 8 AM, 17 degrees, wear a light knit now; campus at 2 PM indoors, remove the knit; night out at 10 PM, 12 degrees with rain, pack a jacket; return at 1 AM, 9 degrees, put the jacket on. Rain later, bring an umbrella."
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Today's outing</p>
        <p className="text-[11px] font-medium text-muted-foreground">4 stops</p>
      </div>

      <div className="relative mt-3">
        {/* Timeline rail — draws once, top to bottom */}
        <svg aria-hidden className="absolute left-[17px] top-4 h-[calc(100%-2rem)] w-1" viewBox="0 0 2 100" preserveAspectRatio="none">
          <line x1="1" y1="0" x2="1" y2="100" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-foreground/10" />
          <line
            x1="1" y1="0" x2="1" y2="100"
            stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            className="ob-anim ob-draw ob-d1"
            style={{ ["--ob-len" as string]: "100", animationDuration: "1600ms" }}
          />
        </svg>

        <ol className="space-y-2.5">
          {STOPS.map(({ place, time, temp, Icon, decision, item, delay }) => (
            <li key={place} className={`ob-anim ob-rise ${delay} relative flex items-center gap-3`}>
              <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background shadow-sm ring-1 ring-foreground/10">
                <Icon aria-hidden className="h-4 w-4 text-primary" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p className="truncate text-[13px] font-semibold text-foreground">{place}</p>
                  <p className="shrink-0 text-[11px] text-muted-foreground">{time}</p>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">{temp} · {item}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${DECISION_STYLE[decision]}`}>
                {DECISION_LABEL[decision]}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="ob-anim ob-slide-up ob-d10 mt-3 flex items-center gap-2 rounded-2xl bg-primary/10 px-3 py-2 ring-1 ring-inset ring-primary/15">
        <Umbrella aria-hidden className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
        <p className="text-xs font-medium text-primary">Rain later — bring an umbrella</p>
      </div>
    </div>
  );
}
