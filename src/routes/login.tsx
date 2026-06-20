import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { loadPrefs, savePrefs } from "@/lib/preferences";
import { ArrowRight, Mail } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — WeatherWear AI" },
      { name: "description", content: "Sign in to WeatherWear AI with your email." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setError(null);
    setLoading(true);
    const prefs = loadPrefs();
    const known = prefs.email?.trim().toLowerCase();
    if (known && known === value) {
      savePrefs({ ...prefs, onboarded: true });
      setTimeout(() => navigate({ to: "/" }), 200);
    } else {
      setLoading(false);
      setError("No account found for that email on this device. Create one to continue.");
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white font-['Outfit']">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#E0F2FE] via-[#F8FAFC] to-white" />
      <main className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col px-8 pb-12 pt-16">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-500">Sign in with the email you used before.</p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 animate-fade-up delay-100">
          <label className="block rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-md">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Mail className="h-4 w-4 text-blue-500" /> Email
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoFocus
              placeholder="you@email.com"
              className="mt-1 w-full bg-transparent text-base outline-none placeholder:text-slate-400"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500 animate-fade-up delay-200">
          New here?{" "}
          <Link to="/signup" className="font-medium text-blue-600">Create an account</Link>
        </p>
      </main>
    </div>
  );
}