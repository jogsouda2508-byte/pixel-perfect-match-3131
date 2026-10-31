import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
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
  const [multiple, setMultiple] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setError("Enter your email or username");
    setError(undefined);
    setLoading(true);

    // One email can have up to 3 accounts. Turn the typed email/username into the account
    // email(s) to send the link to (a username picks exactly one account).
    let targets: string[] = [];
    const looksLikeEmail = value.includes("@") && !value.startsWith("@");
    const lookup = await supabase.rpc("get_reset_emails", { p_identifier: value });
    if (!lookup.error && lookup.data) targets = lookup.data;
    // Fall back to the old behaviour if the lookup isn't available yet.
    if (lookup.error && looksLikeEmail) targets = [value];
    if (!looksLikeEmail && targets.length === 0) {
      // Unknown username: answer the same as a known one (don't reveal which exist).
      setLoading(false);
      setSent(true);
      return;
    }
    if (looksLikeEmail && targets.length === 0) targets = [value];

    let failed: Parameters<typeof friendlyAuthError>[0];
    for (const target of targets) {
      const { error: err } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) failed = err;
    }
    setLoading(false);
    if (failed) {
      setError(friendlyAuthError(failed));
      toast.error(friendlyAuthError(failed));
      return;
    }
    setMultiple(targets.length > 1);
    setSent(true);
  };

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your email or username and we'll send you a reset link."
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
          {multiple && (
            <p className="text-xs text-muted-foreground">
              This email has more than one account, so you'll get one link per account. To reset
              only one, go back and enter that account's username instead.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField
            label="Email or username"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            error={error}
            placeholder="you@example.com or @username"
          />
          <PrimaryButton type="submit" loading={loading}>
            Send reset link
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  );
}
