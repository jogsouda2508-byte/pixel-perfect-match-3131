// TODO: remove once 20261118000001_revoke_email_lookup
import { createFileRoute, Link } from "@tanstack/react-router";
import { authRedirect, NATIVE_RESET_REDIRECT } from "@/lib/auth-redirect";
import { useState } from "react";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { callGateway, gatewayProblem } from "@/lib/auth-gateway";
import { AuthShell, PrimaryButton, TextField } from "@/components/auth-ui";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password — SabZone" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setError("Enter your email or username");
    setError(undefined);
    setLoading(true);

    // The server finds the account(s), sends the link, and answers the same whether or not
    // anything matched, so nobody can use this form to find out who has an account.
    const r = await callGateway("request_reset", {
      identifier: value,
      redirect_to: authRedirect("/reset-password", NATIVE_RESET_REDIRECT),
    });
    setLoading(false);
    if (!r.ok) {
      const msg = gatewayProblem(r, "Couldn't send the reset link. Please try again.");
      setError(msg);
      toast.error(msg);
      return;
    }
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
            reset link is on its way. If that email has more than one account you'll get one link
            per account; enter a username instead to reset just one.
          </p>
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
