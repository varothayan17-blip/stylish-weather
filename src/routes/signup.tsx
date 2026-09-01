import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadPrefs } from "@/lib/preferences";
import { auth, signInWithGoogleRedirect, getGoogleRedirectResult } from "@/lib/auth";
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
    if (code === "auth/account-exists-with-different-credential") {
      // This error can occur when the same email is registered with a
      // non-Google provider (e.g. Apple, phone auth, passwordless).
      // For Gmail addresses with an existing email+password account,
      // Firebase typically links automatically — this error may not appear.
      return "An account with this email already exists with a different sign-in method. Please use your original sign-in method, or contact support if you need help accessing your account.";
    }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      // User closed the popup — silent, not an error.
      return "";
    }
    if (code === "auth/popup-blocked") {
      return "Sign-in popup was blocked by your browser. Please allow popups for this site and try again.";
    }
    if (code === "auth/operation-not-allowed") {
      return "Google sign-in is not currently enabled. Please use email and password.";
    }
    if (code === "auth/unauthorized-domain") {
      return "This domain is not authorised for Google sign-in. Please contact support.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

/** Determine where to send the user after a successful sign-in. */
function postSignInDestination(): "/" | "/preferences" {
  const prefs = loadPrefs();
  return prefs.city ? "/" : "/preferences";
}

function Signup() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isReturning] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadPrefs().onboarded === true;
  });

  // Process any pending Google redirect result on mount.
  // getRedirectResult() returns null immediately when no redirect is pending,
  // so the loading state only lasts for the async resolution — not a full render.
  // We only set googleLoading=true if Firebase is configured, to avoid
  // a button-disabled flash on every ordinary (non-redirect) visit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Import isFirebaseConfigured lazily to avoid SSR issues.
    import("@/lib/firebase").then(({ isFirebaseConfigured }) => {
      if (!isFirebaseConfigured()) return; // no Firebase → no redirect pending

      let cancelled = false;
      // Set loading only now — after confirming Firebase is configured.
      // This is synchronous before the getRedirectResult async call,
      // so there is no observable flash in the configured case.
      setGoogleLoading(true);

      getGoogleRedirectResult()
        .then((uid) => {
          if (cancelled) return;
          if (uid) {
            navigate({ to: postSignInDestination() });
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const code = (err as { code?: string })?.code;
          // Suppress the "no redirect pending" pseudo-error some Firebase
          // versions emit when getRedirectResult is called with no pending result.
          if (code === "auth/no-auth-event") return;
          const msg = authErrorMessage(err);
          if (msg) setError(msg);
          console.warn("[google-auth] redirect result error:", code);
        })
        .finally(() => {
          if (!cancelled) setGoogleLoading(false);
        });

      return () => { cancelled = true; };
    }).catch(() => {
      // Firebase import failed — treat as unconfigured, no loading state
    });
  }, [navigate]);

  async function handleGoogleSignIn() {
    if (googleLoading || loading) return;
    setError(null);
    setGoogleLoading(true);
    try {
      // This redirects away from the page; execution resumes on the next mount.
      await signInWithGoogleRedirect();
    } catch (err: unknown) {
      const msg = authErrorMessage(err);
      if (msg) setError(msg);
      setGoogleLoading(false);
    }
  }

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
      navigate({ to: postSignInDestination() });
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

        <div className="mt-8 space-y-3 animate-fade-up delay-100">
          {/* ── Google sign-in ─────────────────────────────────────────── */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            aria-label="Continue with Google"
            className="press flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-background py-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {googleLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                Connecting to Google…
              </>
            ) : (
              <>
                {/* Official Google "G" mark — multicolour SVG per Google's brand guidelines */}
                <svg
                  aria-hidden
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                    fill="#4285F4"
                  />
                  <path
                    d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                    fill="#34A853"
                  />
                  <path
                    d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* ── Divider ────────────────────────────────────────────────── */}
          <div className="relative flex items-center gap-3 py-1" role="separator" aria-label="or">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* ── Email + Password form ──────────────────────────────────── */}
          <form onSubmit={submit} className="space-y-3">
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
              <p
                role="alert"
                className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading || !name.trim() || !email.trim() || !password}
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
        </div>

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
