import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  AuthShell,
  GoogleIcon,
  OrDivider,
  OutlineButton,
  PasswordField,
  PrimaryButton,
  TextField,
} from "@/components/auth-ui";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log In — SabZone" },
      { name: "description", content: "Log in to SabZone to see what your network is up to." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Ephesis&display=swap",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    identifier?: string | undefined;
    password?: string | undefined;
  }>({});
  const [formError, setFormError] = useState<string>();
  const [verifyUser, setVerifyUser] = useState<{ username: string; masked: string }>();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const errs: typeof errors = {};
    if (!identifier.trim()) errs.identifier = "Enter your username";
    if (!password) errs.password = "Enter your password";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    const { error, verifyUsername, maskedEmail } = await signIn(identifier, password);
    setVerifyUser(
      verifyUsername ? { username: verifyUsername, masked: maskedEmail ?? "" } : undefined,
    );
    // On success the session changes and <AuthGate /> sends the user to /home (or /onboarding).
    setLoading(false);
    if (error) {
      setFormError(error);
      toast.error(error);
    }
  };

  const google = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setGoogleLoading(false);
      toast.error(error);
    }
  };

  return (
    <AuthShell
      variant="immersive"
      title="Welcome back"
      subtitle="Log in to continue"
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="font-semibold text-primary">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setErrors((p) => ({ ...p, identifier: undefined }));
          }}
          error={errors.identifier}
          placeholder="susheel_08"
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((p) => ({ ...p, password: undefined }));
          }}
          error={errors.password}
        />
        <div className="text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-primary">
            Forgot password?
          </Link>
        </div>

        {formError && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}{" "}
            {verifyUser && (
              <Link
                to="/verify"
                search={{ username: verifyUser.username, masked: verifyUser.masked }}
                className="font-semibold underline"
              >
                Enter code
              </Link>
            )}
          </p>
        )}

        <PrimaryButton type="submit" loading={loading}>
          Log In
        </PrimaryButton>
      </form>

      <OrDivider />
      <div className="space-y-3">
        <OutlineButton type="button" onClick={google} loading={googleLoading}>
          {!googleLoading && <GoogleIcon />}
          Continue with Google
        </OutlineButton>
      </div>
    </AuthShell>
  );
}
