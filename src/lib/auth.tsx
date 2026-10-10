import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { friendlyAuthError } from "@/lib/auth-errors";

type Result = { error: string | null };
type SignUpInput = { email: string; password: string; fullName: string; username: string };
type SignUpResult = Result & { needsVerification: boolean };

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** true until the session (and the profile, when logged in) has been checked */
  loading: boolean;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signIn: (identifier: string, password: string) => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const userId = session?.user.id ?? null;

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
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), username: username.trim().toLowerCase() },
          emailRedirectTo: `${window.location.origin}/home`,
        },
      });
      if (error) return { error: friendlyAuthError(error), needsVerification: false };
      // Supabase hides "email already exists" by returning a user with no identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0)
        return {
          error: "This email is already registered. Try logging in instead.",
          needsVerification: false,
        };
      return { error: null, needsVerification: !data.session };
    },
    [],
  );

  const signIn = useCallback<AuthContextValue["signIn"]>(async (identifier, password) => {
    let email = identifier.trim();
    // "@basava_2005" (leading @, nothing else) is a username, not an email.
    const asUsername =
      email.startsWith("@") && !email.slice(1).includes("@")
        ? email.slice(1)
        : email.includes("@")
          ? null
          : email;
    if (asUsername !== null) {
      const { data, error } = await supabase.rpc("get_login_email", {
        p_username: asUsername.toLowerCase(),
      });
      if (error) return { error: friendlyAuthError(error) };
      if (!data) return { error: "Incorrect email/username or password." };
      email = data;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? friendlyAuthError(error) : null };
  }, []);

  const signInWithGoogle = useCallback<AuthContextValue["signInWithGoogle"]>(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/home` },
    });
    return { error: error ? friendlyAuthError(error) : null };
  }, []);

  const signOut = useCallback(async () => {
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
