/**
 * useAuthGuard — centralized Firebase authentication guard for protected routes.
 *
 * AUTHORITY: Firebase Auth user object (uid present = authenticated).
 * `prefs.onboarded` is NOT used — a legacy signed-out guest with onboarded=true
 * must still be treated as unauthenticated.
 *
 * DESIGN:
 *   Firebase Auth resolves asynchronously. onAuthStateChanged fires once on
 *   mount with the current session state (user | null). We wait for this
 *   before redirecting so authenticated users are never bounced to /signup.
 *
 *   Google redirect: getRedirectResult is called only on /signup. Protected
 *   routes wait for onAuthStateChanged, which fires after the session from
 *   a Google redirect is established.
 *
 *   Sign-out: onAuthStateChanged fires immediately, setting uid=null and
 *   redirecting. Browser Back after sign-out hits a route that re-runs this
 *   effect and redirects again — protected content is never shown.
 *
 *   Firebase not configured: treated as signed-out → redirect to /signup.
 *
 * SSR: all Firebase access is inside useEffect. No browser globals at module scope.
 *
 * Usage:
 *   const { authLoading, uid } = useAuthGuard();
 *   if (authLoading) return null;   // prevents flash of protected content
 *   // uid is guaranteed non-null here
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isFirebaseConfigured } from "./firebase";

export interface AuthGuardResult {
  /** True while Firebase auth state is resolving. Return null from the component while true. */
  authLoading: boolean;
  /** The Firebase uid once resolved, or null if signed out. Non-null when authLoading=false and user is authenticated. */
  uid: string | null;
}

export function useAuthGuard(): AuthGuardResult {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!isFirebaseConfigured()) {
      setAuthLoading(false);
      setUid(null);
      navigate({ to: "/signup", search: { mode: "create" } });
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { getFirebaseAuth } = await import("./firebase");
        const fbAuth = await getFirebaseAuth();
        if (!fbAuth || cancelled) { setAuthLoading(false); return; }

        const { onAuthStateChanged } = await import("firebase/auth");
        unsub = onAuthStateChanged(fbAuth, (user) => {
          if (cancelled) return;
          setAuthLoading(false);
          if (user) {
            setUid(user.uid);
          } else {
            setUid(null);
            // Redirect signed-out users. replace:true prevents Back exposing content.
            navigate({ to: "/signup", search: { mode: "create" }, replace: true });
          }
        });
      } catch {
        if (!cancelled) {
          setAuthLoading(false);
          navigate({ to: "/signup", search: { mode: "create" }, replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [navigate]);

  return { authLoading, uid };
}
