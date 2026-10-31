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
import { removePushOnLogout } from "@/lib/push";
import { friendlyAuthError } from "@/lib/auth-errors";

type Result = { error: string | null };
type LoginResult = Result & {
  /** Set when the account's email isn't verified yet: the email the code was sent to. */
  verifyEmail?: string;
};

const OLD_BAD_LOGIN = "Incorrect email/username or password.";
const BAD_LOGIN = "Incorrect username or password.";
type SignUpInput = { email: string; password: string; fullName: string; username: string };
type SignUpResult = Result & {
  needsVerification: boolean;
  /** The email the account was really created with (an inbox alias for the 2nd/3rd account on one email). */
  authEmail?: string;
};

/** Friendly text for the reasons `plan_signup_email` can refuse a sign-up. */
function planReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case "username_taken":
      return "This username is already taken. Please choose another one.";
    case "invalid_username":
      return "Username can only use letters, numbers and underscores (3–20 characters).";
    case "invalid_email":
      return "Enter a valid email address.";
    case "limit_reached":
      return "This email already has 3 accounts. Use a different email or log in to one of them.";
    case "unsupported_domain":
      return "This email provider can't be used for more than one account. Please use a different email (Gmail, Outlook or iCloud work).";
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
      const realEmail = email.trim();
      const cleanUsername = username.trim().toLowerCase();

      // Ask the database first: is the username free, is the 3-accounts-per-email limit
      // reached, and which email should this account use (the real one, or an inbox alias
      // like you+username@gmail.com when the real one already has an account)?
      let authEmail = realEmail;
      const plan = await supabase.rpc("plan_signup_email", {
        p_email: realEmail,
        p_username: cleanUsername,
      });
      if (!plan.error && plan.data) {
        if (!plan.data.ok)
          return { error: planReasonMessage(plan.data.reason), needsVerification: false };
        if (plan.data.auth_email) authEmail = plan.data.auth_email;
      }

      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: cleanUsername,
            // the mailbox the person actually typed (used to enforce the 3-account limit)
            contact_email: realEmail,
          },
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
      return { error: null, needsVerification: !data.session, authEmail };
    },
    [],
  );

  const signIn = useCallback<AuthContextValue["signIn"]>(async (identifier, password) => {
    // Log in with the USERNAME only ("susheel_08" or "@susheel_08"). Emails are not accepted,
    // because one email can now belong to up to 3 different accounts.
    const raw = identifier.trim();
    const username = (raw.startsWith("@") ? raw.slice(1) : raw).toLowerCase();
    if (username.includes("@"))
      return { error: "Please log in with your username, not your email." };

    const { data: email, error: lookupError } = await supabase.rpc("get_login_email", {
      p_username: username,
    });
    if (lookupError) return { error: friendlyAuthError(lookupError) };
    if (!email) return { error: BAD_LOGIN };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return { error: null };
    const message = friendlyAuthError(error);
    if (error.code === "email_not_confirmed" || message.includes("verify your email"))
      return { error: message, verifyEmail: email };
    return { error: message === OLD_BAD_LOGIN ? BAD_LOGIN : message };
  }, []);

  const signInWithGoogle = useCallback<AuthContextValue["signInWithGoogle"]>(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/home` },
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
