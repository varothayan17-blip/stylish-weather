/**
 * /signup — Create your free account / Sign in
 *
 * Modes: "create" (default) | "signin"
 *
 * ── Bootstrap / race-free design ─────────────────────────────────────────────
 * There is ONE coordinated effect that:
 *   1. Clears the obsolete guest routing marker.
 *   2. Checks for a settled Firebase session via onAuthStateChanged.
 *      - Waits for the FIRST onAuthStateChanged event; that event carries
 *        the result of any pending Google redirect restoration.
 *      - If the session is already established → navigate away.
 *      - If not → check getRedirectResult (in case a redirect just returned
 *        but onAuthStateChanged hasn't fired yet in this tick).
 *   3. Never inspects prefs.onboarded — only Firebase Auth is the authority.
 *
 * ── Localhost vs production Google sign-in ────────────────────────────────────
 * signInWithGoogle() automatically selects:
 *   localhost / 127.0.0.1 → signInWithPopup (redirect storage is cross-origin)
 *   production            → signInWithRedirect (same-origin via Vercel proxy)
 *
 * ── React Strict Mode safety ──────────────────────────────────────────────────
 * The effect uses a `cancelled` flag so the double-invoke in Strict Mode
 * unsubscribes the first listener before the second mounts.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadPrefs } from "@/lib/preferences";
import { markFirstSetupPending, clearObsoleteGuestMarker, markDone } from "@/lib/introState";
import { auth, signInWithGoogle, getGoogleRedirectResult } from "@/lib/auth";
import { ArrowRight, Mail, User, Lock, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>) => ({
    mode: s.mode === "signin" ? "signin" as const : "create" as const,
  }),
  head: () => ({
    meta: [
      { title: "Create your free account — Aeruvo" },
      { name: "description", content: "Save your preferences and saved outfits securely across your devices." },
    ],
  }),
  component: Signup,
});

function authErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential")
      return "Incorrect password. Please try again.";
    if (code === "auth/weak-password")
      return "Password must be at least 6 characters.";
    if (code === "auth/invalid-email")
      return "Please enter a valid email address.";
    if (code === "auth/user-not-found")
      return "No account found for this email. Check the address or create a new account.";
    if (code === "auth/too-many-requests")
      return "Too many attempts. Please wait a moment and try again.";
    if (code === "auth/network-request-failed")
      return "Network error. Check your connection and try again.";
    if (code === "auth/account-exists-with-different-credential")
      return "An account with this email already exists with a different sign-in method. Please use your original sign-in method, or contact support.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
      return "";
    if (code === "auth/popup-blocked")
      return "Sign-in popup was blocked. Please allow popups for this site and try again.";
    if (code === "auth/operation-not-allowed")
      return "Google sign-in is not currently enabled. Please use email and password.";
    if (code === "auth/unauthorized-domain")
      return "This domain is not authorised for Google sign-in. Please contact support.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

/** Where to send the user after Firebase authentication succeeds. */
function postSignInDestination(uid: string): "/" | "/preferences" {
  const prefs = loadPrefs();
  if (prefs.city) return "/";
  markFirstSetupPending(uid);
  return "/preferences";
}

function Signup() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"create" | "signin">(search.mode ?? "create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Single coordinated bootstrap effect.
   *
   * Order of operations (critical for production Google redirect):
   *   1. Clear obsolete guest marker.
   *   2. Call getGoogleRedirectResult() FIRST — if returning from a production
   *      Google redirect, this runs afterSignIn() which migrates the local draft
   *      (preferences, city) to Firestore and sets onboarded:true. Returns uid.
   *   3. If redirect result returned a uid → navigate immediately.
   *   4. Otherwise, subscribe to onAuthStateChanged for the settled auth state.
   *      - Existing session (email/password or already signed in) → navigate.
   *      - Null → stay on /signup, render the form.
   *
   * Why both getRedirectResult AND onAuthStateChanged:
   *   onAuthStateChanged alone will fire with the user after a redirect, but it
   *   does NOT call afterSignIn() — that migration only happens inside
   *   getGoogleRedirectResult(). Without calling getRedirectResult, the local
   *   draft (city, preferences collected pre-auth) would not be migrated.
   *
   * afterSignIn() runs exactly once:
   *   - Popup path: called directly in signInWithGoogle().
   *   - Redirect path: called inside getGoogleRedirectResult().
   *   - Email path: called inside auth.signIn().
   *   onAuthStateChanged does NOT call it — it only fires for navigation.
   *
   * Strict Mode safe: cancelled flag prevents double-navigation.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    clearObsoleteGuestMarker();

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { isFirebaseConfigured, getFirebaseAuth } = await import("@/lib/firebase");
      if (!isFirebaseConfigured()) return;

      const fbAuth = await getFirebaseAuth();
      if (!fbAuth || cancelled) return;

      // Show loading state — we don't know yet if a redirect is pending.
      setGoogleLoading(true);

      // Step 1: Check for a pending production Google redirect result.
      // This calls afterSignIn() if a redirect just completed.
      let redirectUid: string | null = null;
      try {
        redirectUid = await getGoogleRedirectResult();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code !== "auth/no-auth-event" && code !== undefined) {
          const msg = authErrorMessage(err);
          if (msg && !cancelled) setError(msg);
          console.warn("[google-auth] redirect result error:", code);
        }
      }

      if (cancelled) { setGoogleLoading(false); return; }

      if (redirectUid) {
        // Redirect sign-in completed — mark intro done, then navigate.
        // markDone() here (not in welcome.tsx) ensures cancelled auth doesn't
        // permanently mark onboarding as done.
        markDone();
        setGoogleLoading(false);
        navigate({ to: postSignInDestination(redirectUid), replace: true });
        return;
      }

      // Step 2: No redirect result — check for existing session via onAuthStateChanged.
      // This covers: already signed in, email/password, popup (popup case navigates
      // before this runs, but the auth state will confirm it).
      const { onAuthStateChanged } = await import("firebase/auth");

      unsubscribe = onAuthStateChanged(fbAuth, (user) => {
        if (cancelled) return;
        setGoogleLoading(false);
        if (user) {
          markDone();
          navigate({ to: postSignInDestination(user.uid), replace: true });
        }
        // null → signed out, stay on form
        unsubscribe?.();
      });
    })().catch(() => {
      if (!cancelled) setGoogleLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [navigate]);

  async function handleGoogleSignIn() {
    if (googleLoading || loading) return;
    setError(null);
    setGoogleLoading(true);
    try {
      const uid = await signInWithGoogle();
      if (uid) {
        // Popup completed (localhost) — mark done, navigate.
        markDone();
        navigate({ to: postSignInDestination(uid), replace: true });
      }
      // If uid is null → redirect initiated (production); page will reload.
    } catch (err: unknown) {
      const msg = authErrorMessage(err);
      if (msg) setError(msg);
      setGoogleLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const needsName = mode === "create";
    if (needsName && !name.trim()) return;
    if (!email.trim() || !password) return;
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    setError(null);
    try {
      await auth.signIn(name.trim(), email.trim(), password);
      const { getUid } = await import("@/lib/auth");
      const resolvedUid = await getUid() ?? "";
      markDone();
      navigate({ to: postSignInDestination(resolvedUid), replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const isSignIn = mode === "signin";

  return (
    <div className="relative min-h-[100dvh] overflow-hidden isolate">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/3 h-80 w-80 rounded-full bg-primary/25 blur-3xl animate-float" />
        <div className="absolute bottom-10 -left-16 h-72 w-72 rounded-full bg-accent/30 blur-3xl animate-float" style={{ animationDelay: "3s" }} />
      </div>

      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            {isSignIn ? "Welcome back" : "Create your free account"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSignIn
              ? "Sign in to restore your preferences and saved outfits."
              : "Save your preferences and saved outfits securely across your devices."}
          </p>
        </div>

        <div className="mt-8 space-y-3 animate-fade-up delay-100">
          {/* ── Google ─────────────────────────────────────────────────── */}
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
                <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* ── or divider ─────────────────────────────────────────────── */}
          <div className="relative flex items-center gap-3 py-1" role="separator" aria-label="or">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* ── Email form ─────────────────────────────────────────────── */}
          <form onSubmit={submit} className="space-y-3">
            {!isSignIn && (
              <Field icon={<User className="h-4 w-4" />} label="Your name">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Alex"
                  autoComplete="given-name" autoFocus
                  className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60" />
              </Field>
            )}
            <Field icon={<Mail className="h-4 w-4" />} label="Email address">
              <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                inputMode="email" autoComplete="email" placeholder="alex@email.com"
                autoFocus={isSignIn}
                className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60" />
            </Field>
            <Field
              icon={<Lock className="h-4 w-4" />} label="Password"
              action={
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }>
              <input value={password} onChange={e => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete={isSignIn ? "current-password" : "new-password"}
                placeholder={isSignIn ? "Your password" : "Choose a password (6+ characters)"}
                className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60" />
            </Field>

            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive">{error}</p>
            )}

            <button type="submit"
              disabled={loading || googleLoading || (!isSignIn && !name.trim()) || !email.trim() || !password}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
                  {isSignIn ? "Signing in…" : "Creating account…"}
                </span>
              ) : (
                <>{isSignIn ? "Sign in" : "Create account"} <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </form>
        </div>

        {/* ── Mode toggle ────────────────────────────────────────────── */}
        <div className="mt-6 animate-fade-up delay-200 text-center text-sm text-muted-foreground">
          {isSignIn ? (
            <p>New to Aeruvo?{" "}
              <button type="button" onClick={() => { setMode("create"); setError(null); }}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Create an account
              </button>
            </p>
          ) : (
            <p>Already have an account?{" "}
              <button type="button" onClick={() => { setMode("signin"); setError(null); }}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Sign in
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ icon, label, action, children }: {
  icon: React.ReactNode; label: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <label className="glass-card block rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span className="text-primary">{icon}</span>{label}
        </div>
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}
