import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isSupabaseConfigured } from "@/integrations/supabase/client";

// Logged-in users are bounced away from these.
const PUBLIC_ONLY = ["/", "/login", "/signup", "/forgot-password"];
// Need a session AND a finished onboarding.
const PROTECTED = ["/home", "/discover", "/create", "/profile", "/notifications", "/more"];
// Need a session, but are the onboarding step itself.
const ONBOARDING = "/onboarding";
// Everything else (/verify, /reset-password, 404) is reachable in any state.

function normalize(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid min-h-screen place-items-center ${className}`}
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/** Decides where the user should be, given the auth state. Returns null = stay. */
export function resolveRedirect(
  path: string,
  s: { session: boolean; onboardingDone: boolean },
): "/login" | "/home" | "/onboarding" | null {
  const p = normalize(path);
  if (PUBLIC_ONLY.includes(p))
    return s.session ? (s.onboardingDone ? "/home" : "/onboarding") : null;
  if (PROTECTED.includes(p)) {
    if (!s.session) return "/login";
    return s.onboardingDone ? null : "/onboarding";
  }
  if (p === ONBOARDING) {
    if (!s.session) return "/login";
    return s.onboardingDone ? "/home" : null;
  }
  return null;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (st) => st.location.pathname });

  const target = loading
    ? null
    : resolveRedirect(path, {
        session: !!session,
        onboardingDone: !!profile?.onboarding_completed,
      });

  useEffect(() => {
    if (target) navigate({ to: target, replace: true });
  }, [target, navigate]);

  if (!isSupabaseConfigured) return <MissingConfig />;

  const p = normalize(path);
  // Logged-out visitors are the common case on public pages, so render them right
  // away (good for the server-rendered splash) instead of showing a spinner first.
  if (loading) return PUBLIC_ONLY.includes(p) ? <>{children}</> : <Spinner />;
  if (target) return <Spinner />;
  return <>{children}</>;
}

function MissingConfig() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="glass-card space-y-3 p-6">
        <h1 className="text-xl font-bold">Supabase is not connected</h1>
        <p className="text-sm text-muted-foreground">
          Add these two variables to a <code>.env</code> file (or connect Supabase in Lovable) and
          restart the dev server:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-3 text-xs">
          {`VITE_SUPABASE_URL=...\nVITE_SUPABASE_PUBLISHABLE_KEY=...`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Use only the anon/publishable key, never the service-role key.
        </p>
      </div>
    </main>
  );
}
