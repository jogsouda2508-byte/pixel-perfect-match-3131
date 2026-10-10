import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  usernameSchema,
  validateSignUp,
  type SignUpErrors,
  type SignUpFields,
} from "@/lib/validation";
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

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create Account — Ediraa" },
      {
        name: "description",
        content: "Join Ediraa to connect, share and grow your local network.",
      },
    ],
  }),
  component: SignUpPage,
});

type Availability = "idle" | "checking" | "available" | "taken" | "error";

function SignUpPage() {
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [v, setV] = useState<SignUpFields>({
    fullName: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
    terms: false,
  });
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [avail, setAvail] = useState<Availability>("idle");

  const set = <K extends keyof SignUpFields>(k: K, val: SignUpFields[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  // Live username availability (debounced).
  useEffect(() => {
    if (!usernameSchema.safeParse(v.username).success) {
      setAvail("idle");
      return;
    }
    setAvail("checking");
    let active = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_username_available", {
        p_username: v.username.trim().toLowerCase(),
      });
      if (!active) return;
      setAvail(error ? "error" : data ? "available" : "taken");
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [v.username]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const errs = validateSignUp(v);
    if (!errs.username && avail === "taken") errs.username = "Already taken";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setLoading(true);
    const res = await signUp({
      email: v.email,
      password: v.password,
      fullName: v.fullName,
      username: v.username,
    });
    setLoading(false);
    if (res.error) {
      setFormError(res.error);
      toast.error(res.error);
      return;
    }
    if (res.needsVerification) {
      toast.success("We sent a 6-digit code to your email.");
      navigate({ to: "/verify", search: { email: v.email.trim() } });
    } else {
      toast.success("Account created!");
      navigate({ to: "/onboarding" });
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

  const usernameHint =
    avail === "checking" ? (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking…
      </span>
    ) : avail === "available" ? (
      <span className="flex items-center gap-1 text-success">
        <Check className="h-3 w-3" />
        Username is available
      </span>
    ) : avail === "taken" ? (
      <span className="flex items-center gap-1 text-destructive">
        <X className="h-3 w-3" />
        Already taken
      </span>
    ) : undefined;

  return (
    <AuthShell
      title="Create account"
      subtitle="Connect • Share • Grow"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Full name"
          autoComplete="name"
          value={v.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          error={errors.fullName}
          placeholder="Basava Jarkande"
        />
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={v.username}
          onChange={(e) => set("username", e.target.value)}
          error={errors.username}
          hint={usernameHint}
          placeholder="basava_2005"
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={v.email}
          onChange={(e) => set("email", e.target.value)}
          error={errors.email}
          placeholder="you@example.com"
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          showStrength
          value={v.password}
          onChange={(e) => set("password", e.target.value)}
          error={errors.password}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={v.confirm}
          onChange={(e) => set("confirm", e.target.value)}
          error={errors.confirm}
        />

        <div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.terms}
              onChange={(e) => set("terms", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              I agree to the <span className="text-primary">Terms of Service</span> and{" "}
              <span className="text-primary">Privacy Policy</span>
            </span>
          </label>
          {errors.terms && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.terms}
            </p>
          )}
        </div>

        {formError && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <PrimaryButton type="submit" loading={loading}>
          Create Account
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
