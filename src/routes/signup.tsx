import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { loadPrefs } from "@/lib/preferences";
import { auth } from "@/lib/auth";
import { ArrowRight, Mail, User, Lock, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign in — Aeruvo" },
      {
        name: "description",
        content: "Create an account or sign in to sync your preferences and saved outfits.",
      },
    ],
  }),
  component: Signup,
});

/**
 * Maps Firebase Auth error codes to short, user-friendly messages.
 * Full error codes: https://firebase.google.com/docs/auth/admin/errors
 */
function authErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return "Incorrect password. Please try again.";
    }
    if (code === "auth/weak-password") {
      return "Password must be at least 6 characters.";
    }
    if (code === "auth/invalid-email") {
      return "Please enter a valid email address.";
    }
    if (code === "auth/user-not-found") {
      return "No account found for this email. Check the address or create a new account.";
    }
    if (code === "auth/too-many-requests") {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (code === "auth/network-request-failed") {
      return "Network error. Check your connection and try again.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

function Signup() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isReturning] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadPrefs().onboarded === true;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) return;
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await auth.signIn(name.trim(), email.trim(), password);
      const prefs = loadPrefs();
      navigate({ to: prefs.city ? "/" : "/preferences" });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden isolate">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/3 h-80 w-80 rounded-full bg-primary/25 blur-3xl animate-float" />
        <div
          className="absolute bottom-10 -left-16 h-72 w-72 rounded-full bg-accent/30 blur-3xl animate-float"
          style={{ animationDelay: "3s" }}
        />
      </div>

      <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-10 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-semibold tracking-tight">
            {isReturning ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isReturning
              ? "Sign in to restore your preferences, premium status, and saved outfits."
              : "Your preferences and saved outfits sync securely across all your devices."}
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-3 animate-fade-up delay-100">
          <Field icon={<User className="h-4 w-4" />} label="Your name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
              autoComplete="given-name"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />
          </Field>

          <Field icon={<Mail className="h-4 w-4" />} label="Email address">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="alex@email.com"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          <Field
            icon={<Lock className="h-4 w-4" />}
            label="Password"
            action={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-muted-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          >
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete={isReturning ? "current-password" : "new-password"}
              placeholder={isReturning ? "Your password" : "Choose a password (6+ characters)"}
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          {error && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim() || !email.trim() || !password}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
                Signing in…
              </span>
            ) : (
              <>
                {isReturning ? "Sign in" : "Create account"} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-4 animate-fade-up delay-200 space-y-3 text-center text-xs text-muted-foreground">
          <p>Aeruvo uses your email and password to secure your account. Minimum 6 characters.</p>
          <p>
            <Link to="/" className="font-medium text-primary">
              Skip for now — continue as guest
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({
  icon,
  label,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="glass-card block rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}
