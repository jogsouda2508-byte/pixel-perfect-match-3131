// TODO: remove once 20261118000001_revoke_email_lookup
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { authRedirect, isNativeApp } from "@/lib/auth-redirect";
import { consumeNativeAuthPending, parseNativeAuthUrl } from "@/lib/native-auth-callback";
import { removePushOnLogout } from "@/lib/push";
import { friendlyAuthError } from "@/lib/auth-errors";
import { callGateway, gatewayProblem, startSession, tokensFrom } from "@/lib/auth-gateway";

type Result = { error: string | null };
type LoginResult = Result & {
  /** Set when the account's email isn't verified yet: the username to enter the code for. */
  verifyUsername?: string;
  /** The address the code went to, hidden like j***@g***.com. The real one never reaches the app. */
  maskedEmail?: string;
};

const BAD_LOGIN = "Incorrect username or password.";
type SignUpInput = { email: string; password: string; fullName: string; username: string };
type SignUpResult = Result & {
  needsVerification: boolean;
  /** Where to enter the 6-digit code: the verify page is opened for this username. */
  verifyUsername?: string;
  /** The address the person typed, hidden like j***@g***.com. */
  maskedEmail?: string;
};

/** Friendly text for what the sign-up gateway can refuse. */
function signUpProblem(error: unknown, reason: unknown): string {
  switch (error) {
    case "username_taken":
      return "This username is already taken. Please choose another one.";
    case "invalid_username":
      return "Username can only use letters, numbers and underscores (3–20 characters).";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_name":
      return "Enter your name (up to 80 characters).";
    case "weak_password":
      return reason === "too_short"
        ? "Password must be at least 8 characters."
        : reason === "too_long"
          ? "Password is too long. Use 72 characters or fewer."
          : reason === "too_similar"
            ? "Password is too similar to your username or email."
            : "That password is too easy to guess. Choose a stronger one.";
    default:
      return "Couldn't create the account. Please try again.";
  }
}

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** true until the session (and the profile, when logged in) has been checked */
  loading: boolean;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signIn: (identifier: string, password: string) => Promise<LoginResult>;
  signInWithGoogle: () => Promise<Result>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  // Which user id the current `profile` state was loaded for. Comparing it with the
  // live user id avoids a render where a new session exists but its profile hasn't loaded.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // 1) Session: initial check + live updates.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
    });
    // Keep this callback synchronous: calling supabase from inside it can deadlock.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Native app: Google sign-in finishes in the phone's browser, which then opens
  // sabzone://auth-callback#access_token=... Catch that link, start the session, close the browser.
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", async ({ url }) => {
        // Validate before consuming the pending flag so malformed links cannot use it up.
        const callback = parseNativeAuthUrl(url);
        if (!callback || !consumeNativeAuthPending(callback.kind)) return;

        try {
          if ("accessToken" in callback) {
            const { error } = await supabase.auth.setSession({
              access_token: callback.accessToken,
              refresh_token: callback.refreshToken,
            });
            if (error) throw error;
          } else {
            const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
            if (error) throw error;
          }

          if (callback.kind === "reset") {
            window.history.pushState({}, "", "/reset-password");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }

          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
        } catch (e) {
          console.error("Native authentication callback failed", e);
        }
      });
      if (cancelled) handle.remove();
      else remove = () => handle.remove();
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (previousUserId.current !== userId) {
      queryClient.clear();
      previousUserId.current = userId;
    }
  }, [userId, queryClient]);

  const fetchProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    if (error) console.error("Failed to load profile", error);
    return data ?? null;
  }, []);

  // 2) Profile: (re)load whenever the logged-in user changes.
  useEffect(() => {
    if (!sessionReady) return;
    if (!userId) {
      setProfile(null);
      setLoadedFor(null);
      return;
    }
    let active = true;
    fetchProfile(userId).then((p) => {
      if (!active) return;
      setProfile(p);
      setLoadedFor(userId);
    });
    return () => {
      active = false;
    };
  }, [sessionReady, userId, fetchProfile]);

  const profileReady = userId === null ? true : loadedFor === userId;

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfile(await fetchProfile(userId));
    setLoadedFor(userId);
  }, [userId, fetchProfile]);

  const signUp = useCallback<AuthContextValue["signUp"]>(
    async ({ email, password, fullName, username }) => {
      // The server checks the username, the per-email limits and which address to use, then
      // creates the account. It answers the same whether or not the email already has accounts.
      const r = await callGateway("signup", {
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        username: username.trim().toLowerCase(),
        redirect_to: authRedirect("/home"),
      });
      if (!r.ok)
        return {
          error: gatewayProblem(r, signUpProblem(r.data["error"], r.data["reason"])),
          needsVerification: false,
        };
      const tokens = tokensFrom(r);
      if (tokens) {
        // Email confirmation is switched off in this project, so the account is ready now.
        const started = await startSession(tokens);
        return { error: started.error, needsVerification: false };
      }
      return {
        error: null,
        needsVerification: true,
        verifyUsername: String(r.data["username"] ?? username.trim().toLowerCase()),
        maskedEmail: String(r.data["masked_email"] ?? ""),
      };
    },
    [],
  );

  const signIn = useCallback<AuthContextValue["signIn"]>(async (identifier, password) => {
    // Log in with the USERNAME only ("susheel_08" or "@susheel_08"). Emails are not accepted,
    // because one email can belong to up to 3 different accounts.
    const raw = identifier.trim();
    const username = (raw.startsWith("@") ? raw.slice(1) : raw).toLowerCase();
    if (username.includes("@"))
      return { error: "Please log in with your username, not your email." };

    // The server looks the account up, checks the password and starts the session. The email
    // address never reaches this device.
    const r = await callGateway("login", { username, password });
    const tokens = r.ok ? tokensFrom(r) : null;
    if (tokens) return startSession(tokens);
    if (r.status === 403 && r.data["error"] === "email_not_verified")
      return {
        error: "Please verify your email first. Check your inbox for the code.",
        verifyUsername: String(r.data["username"] ?? username),
        maskedEmail: String(r.data["masked_email"] ?? ""),
      };
    if (r.status === 401) {
      const wait = r.data["retry_after"];
      return {
        error:
          typeof wait === "number" && wait > 0
            ? `${BAD_LOGIN} Too many tries: wait ${wait < 90 ? `${wait} seconds` : `${Math.round(wait / 60)} minutes`} before trying again.`
            : BAD_LOGIN,
      };
    }
    return { error: gatewayProblem(r, "Couldn't log in. Please try again.") };
  }, []);

  const signInWithGoogle = useCallback<AuthContextValue["signInWithGoogle"]>(async () => {
    // Native app: window.location.origin is "http://localhost" inside the app, which is not a real
    // page after Google finishes. Open Google in the phone browser and come back via sabzone://.
    if (isNativeApp()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
      });
      if (error || !data?.url) return { error: friendlyAuthError(error ?? new Error("No URL")) };
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url });
      return { error: null };
    }
    // Website: land on /onboarding. AuthGate sends people who already finished it on to /home.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/onboarding` },
    });
    return { error: error ? friendlyAuthError(error) : null };
  }, []);

  const signOut = useCallback(async () => {
    // Stop this device getting the signed-out person's notifications (needs the session, so
    // it runs first; it never throws and never blocks logging out).
    await removePushOnLogout();
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading: !sessionReady || !profileReady,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      sessionReady,
      profileReady,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
