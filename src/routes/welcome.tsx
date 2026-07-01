import { createFileRoute, Link } from "@tanstack/react-router";
import { CloudSun, Sparkles, Shirt, MapPin } from "lucide-react";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Aeruvo" },
      { name: "description", content: "Personalized clothing recommendations for Canadians." },
    ],
  }),
  component: Welcome,
});

const bullets = [
  {
    icon: CloudSun,
    title: "Live Canadian weather",
    desc: "Real wind chill, not just temperature.",
  },
  { icon: Shirt, title: "AI outfit picks", desc: "Tuned to your commute and cold tolerance." },
  { icon: MapPin, title: "Made for your city", desc: "From Vancouver fog to Winnipeg windchill." },
];

function Welcome() {
  return (
    <div className="relative min-h-screen overflow-hidden isolate">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 [transform:translateZ(0)]"
      >
        <div className="absolute -top-24 -left-16 h-80 w-80 rounded-full bg-primary/30 blur-3xl animate-float [transform:translateZ(0)]" />
        <div
          className="absolute bottom-0 -right-16 h-80 w-80 rounded-full bg-accent/40 blur-3xl animate-float [transform:translateZ(0)]"
          style={{ animationDelay: "2s" }}
        />
      </div>
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-10 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-3 w-3" /> Aeruvo
          </span>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight">
            Never guess <br /> what to wear <br /> <span className="text-gradient">again.</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Real-time weather meets AI styling — built for Canada's wildest days.
          </p>
        </div>

        <ul className="mt-10 space-y-4 animate-fade-up delay-100">
          {bullets.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="glass-card flex gap-4 rounded-3xl p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-10 space-y-3 animate-fade-up delay-200">
          <Link
            to="/signup"
            className="block w-full rounded-2xl bg-foreground py-4 text-center text-sm font-semibold text-background transition-transform active:scale-[0.98]"
          >
            Get started — it's free
          </Link>
          <Link
            to="/"
            className="block w-full rounded-2xl py-3 text-center text-sm font-medium text-muted-foreground"
          >
            Skip for now
          </Link>
        </div>
      </main>
    </div>
  );
}
