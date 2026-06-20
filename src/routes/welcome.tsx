import { createFileRoute, Link } from "@tanstack/react-router";
import { CloudSun, Shirt, MapPin } from "lucide-react";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to WeatherWear AI" },
      { name: "description", content: "Personalized clothing recommendations for Canadians." },
    ],
  }),
  component: Welcome,
});

const bullets = [
  { Icon: CloudSun, title: "Live Canadian weather", desc: "Real wind chill, not just temperature.", tone: "bg-blue-50 border-blue-100/60 text-blue-600" },
  { Icon: Shirt, title: "AI outfit picks", desc: "Tuned to your commute & tolerance.", tone: "bg-indigo-50 border-indigo-100/60 text-indigo-600" },
  { Icon: MapPin, title: "Made for your city", desc: "Vancouver fog to Winnipeg windchill.", tone: "bg-rose-50 border-rose-100/60 text-rose-600" },
];

function Welcome() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white font-['Outfit']">
      {/* Atmospheric background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#E0F2FE] via-[#F8FAFC] to-white" />
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl animate-pulse" />
      <div aria-hidden className="pointer-events-none absolute top-40 -left-20 h-72 w-72 rounded-full bg-amber-100/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col px-8 pb-12 pt-16">
        {/* Brand chip */}
        <div className="animate-fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/60 px-3 py-1.5 shadow-sm backdrop-blur-md">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-600/80">WeatherWear AI</span>
          </div>
        </div>

        {/* Hero */}
        <div className="mt-8 space-y-3 animate-fade-up delay-100">
          <h1 className="text-[42px] font-bold leading-[1.05] tracking-tight text-slate-900">
            Never guess what to wear{" "}
            <span className="mt-1 block font-['Playfair_Display'] font-bold italic text-blue-600">again.</span>
          </h1>
          <p className="max-w-[280px] text-[17px] font-light leading-relaxed text-slate-500">
            Real-time weather meets AI styling — built for{" "}
            <span className="font-medium text-slate-800">Canada's wildest days.</span>
          </p>
        </div>

        {/* Feature cards */}
        <div className="mt-10 flex-1 space-y-4 animate-fade-up delay-200">
          {bullets.map(({ Icon, title, desc, tone }) => (
            <div
              key={title}
              className="rounded-3xl border border-white/60 bg-white/40 p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl transition-all duration-500 hover:bg-white/60"
            >
              <div className="flex items-center gap-4">
                <div className={`grid h-12 w-12 place-items-center rounded-2xl border ${tone}`}>
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{title}</h3>
                  <p className="text-sm text-slate-500">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-8 space-y-4 animate-fade-up delay-300">
          <Link
            to="/signup"
            className="flex h-16 w-full items-center justify-center gap-2 rounded-[2rem] bg-slate-900 text-lg font-semibold text-white shadow-xl shadow-slate-200 transition-all active:scale-[0.98]"
          >
            Get started <span className="font-light opacity-40">— it's free</span>
          </Link>
          <Link to="/login" className="block w-full py-3 text-center text-sm font-medium text-slate-500 transition-colors hover:text-slate-700">
            I already have an account
          </Link>
        </div>
      </main>
    </div>
  );
}