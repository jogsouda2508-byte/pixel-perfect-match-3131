import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { friendlyAuthError } from "@/lib/auth-errors";
import { passwordSchema } from "@/lib/validation";
import { AuthShell, PasswordField, PrimaryButton } from "@/components/auth-ui";
import { Spinner } from "@/components/auth-gate";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password — Ediraa" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{
    password?: string | undefined;
    confirm?: string | undefined;
  }>({});
  const [saving, setSaving] = useState(false);

  if (loading) return <Spinner />;

  // The emailed link signs the user in temporarily; without it the link is invalid/expired.
  if (!session) {
    return (
      <AuthShell
        title="Link expired"
        footer={
          <Link to="/login" className="font-semibold text-primary">
            Back to log in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">This reset link is invalid or has expired.</p>
        <Link
          to="/forgot-password"
          className="mt-4 block rounded-full bg-gradient-brand py-3.5 text-center font-semibold text-primary-foreground glow"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const p = passwordSchema.safeParse(password);
    if (!p.success) errs.password = p.error.issues[0]?.message;
    if (confirm !== password) errs.confirm = "Passwords do not match";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(friendlyAuthError(error));
      return;
    }
    toast.success("Password updated.");
    navigate({ to: "/home" });
  };

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password you haven't used before."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          showStrength
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((x) => ({ ...x, password: undefined }));
          }}
          error={errors.password}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErrors((x) => ({ ...x, confirm: undefined }));
          }}
          error={errors.confirm}
        />
        <PrimaryButton type="submit" loading={saving}>
          Update password
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
