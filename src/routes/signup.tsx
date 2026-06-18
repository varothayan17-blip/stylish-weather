import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { loadPrefs, savePrefs } from "@/lib/preferences";
import { ArrowRight, Mail, User } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [
    { title: "Sign up — WeatherWear AI" },
    { name: "description", content: "Create your free WeatherWear AI account." },
  ]}),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setLoading(true);
    const prefs = loadPrefs();
    savePrefs({ ...prefs, name: name.trim(), email: email.trim(), onboarded: true });
    setTimeout(() => navigate({ to: "/preferences" }), 250);
  }

  return (
    <div className="relative min-h-screen overflow-hidden isolate">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 [transform:translateZ(0)]">
        <div className="absolute -top-24 left-1/3 h-80 w-80 rounded-full bg-primary/25 blur-3xl animate-float [transform:translateZ(0)]" />
        <div className="absolute bottom-10 -left-16 h-72 w-72 rounded-full bg-accent/30 blur-3xl animate-float [transform:translateZ(0)]" style={{ animationDelay: "3s" }} />
      </div>
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-10 pt-14">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">Takes 10 seconds. No password needed.</p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 animate-fade-up delay-100">
          <Field icon={<User className="h-4 w-4" />} label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />
          </Field>
          <Field icon={<Mail className="h-4 w-4" />} label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="alex@email.com"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          <button
            type="submit"
            disabled={loading || !name.trim() || !email.trim()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "Creating…" : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground animate-fade-up delay-200">
          By continuing you agree to our terms. <br />
          Already have an account?{" "}
          <Link to="/" className="font-medium text-primary">Skip</Link>
        </p>
      </main>
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <label className="glass-card block rounded-2xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="text-primary">{icon}</span>{label}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}