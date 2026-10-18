import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { emailSchema } from "@/lib/validation";
import { AuthShell, PrimaryButton, TextField } from "@/components/auth-ui";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password — Gicco chat" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (err) {
      setError(friendlyAuthError(err));
      toast.error(friendlyAuthError(err));
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link to="/login" className="font-semibold text-primary">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
          <MailCheck className="h-10 w-10 text-success" />
          <p className="font-semibold">Check your inbox</p>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="text-foreground">{email.trim()}</span>, a
            reset link is on its way.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            error={error}
            placeholder="you@example.com"
          />
          <PrimaryButton type="submit" loading={loading}>
            Send reset link
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  );
}
