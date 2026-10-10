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
import { PhoneAuth } from "@/components/phone-auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log In — Ediraa" },
      { name: "description", content: "Log in to Ediraa to see what your network is up to." },
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
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const errs: typeof errors = {};
    if (!identifier.trim()) errs.identifier = "Enter your email or username";
    if (!password) errs.password = "Enter your password";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    const { error } = await signIn(identifier, password);
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

  const needsVerify =
    formError?.toLowerCase().includes("verify your email") && identifier.includes("@");

  return (
    <AuthShell
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
          label="Email or username"
          autoComplete="username"
          autoCapitalize="none"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setErrors((p) => ({ ...p, identifier: undefined }));
          }}
          error={errors.identifier}
          placeholder="you@example.com or @username"
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
            {needsVerify && (
              <Link
                to="/verify"
                search={{ email: identifier.trim() }}
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
        <PhoneAuth />
      </div>
    </AuthShell>
  );
}
