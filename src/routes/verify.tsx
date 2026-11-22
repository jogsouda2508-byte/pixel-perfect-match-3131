import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { authRedirect } from "@/lib/auth-redirect";
import { callGateway, gatewayProblem, startSession, tokensFrom } from "@/lib/auth-gateway";
import { friendlyAuthError } from "@/lib/auth-errors";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { AuthShell, PrimaryButton } from "@/components/auth-ui";

export const Route = createFileRoute("/verify")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { username?: string; masked?: string; phone?: string } => {
    const out: { username?: string; masked?: string; phone?: string } = {};
    if (typeof search["username"] === "string" && search["username"])
      out.username = search["username"];
    if (typeof search["masked"] === "string" && search["masked"]) out.masked = search["masked"];
    if (typeof search["phone"] === "string" && search["phone"]) out.phone = search["phone"];
    return out;
  },
  head: () => ({ meta: [{ title: "Verify — SabZone" }] }),
  component: VerifyPage,
});

const RESEND_SECONDS = 30;

function VerifyPage() {
  const { username, masked, phone } = Route.useSearch();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  const target = username ? masked || `@${username}` : phone;

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async (value = code) => {
    if (value.length !== 6) return setError("Enter the 6-digit code");
    setError(undefined);
    setLoading(true);
    let failure: string | undefined;
    if (username) {
      // The server checks the code (rate limited) and starts the session.
      const r = await callGateway("verify", { username, code: value });
      const tokens = r.ok ? tokensFrom(r) : null;
      if (tokens) failure = (await startSession(tokens)).error ?? undefined;
      else failure = gatewayProblem(r, "That code is wrong or has expired. Request a new one.");
    } else {
      const { error: err } = await supabase.auth.verifyOtp({
        phone: phone!,
        token: value,
        type: "sms",
      });
      if (err) failure = friendlyAuthError(err);
    }
    setLoading(false);
    if (failure) {
      setError(failure);
      setCode("");
      return;
    }
    toast.success("Verified!");
    // <AuthGate /> routes to /onboarding or /home depending on the profile.
    navigate({ to: "/onboarding" });
  };

  const resend = async () => {
    setResending(true);
    let failure: string | undefined;
    if (username) {
      const r = await callGateway("resend", { username, redirect_to: authRedirect("/home") });
      if (!r.ok) failure = gatewayProblem(r, "Couldn't send a new code. Please try again.");
    } else {
      const { error: err } = await supabase.auth.signInWithOtp({
        phone: phone!,
        options: { shouldCreateUser: true },
      });
      if (err) failure = friendlyAuthError(err);
    }
    setResending(false);
    if (failure) {
      toast.error(failure);
      return;
    }
    toast.success("A new code is on its way.");
    setSeconds(RESEND_SECONDS);
    setCode("");
    setError(undefined);
  };

  if (!target) {
    return (
      <AuthShell
        title="Nothing to verify"
        footer={
          <Link to="/signup" className="font-semibold text-primary">
            Back to sign up
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Start from the sign-up screen and we'll send you a code.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Enter verification code"
      subtitle={`We sent a 6-digit code to ${target}`}
      footer={
        <Link to={username ? "/signup" : "/login"} className="font-semibold text-primary">
          Use a different {username ? "email" : "number"}
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(v) => {
            setCode(v.replace(/\D/g, ""));
            setError(undefined);
          }}
          onComplete={(v) => verify(v)}
          autoFocus
          inputMode="numeric"
          disabled={loading}
          aria-label="6-digit verification code"
        >
          <InputOTPGroup className="gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="h-12 w-11 rounded-xl border border-border bg-elevated/40 text-lg"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="mt-6 space-y-4">
        <PrimaryButton
          type="button"
          onClick={() => verify()}
          loading={loading}
          disabled={code.length !== 6}
        >
          Verify
        </PrimaryButton>
        <p className="text-center text-sm text-muted-foreground">
          {seconds > 0 ? (
            <>
              Resend code in{" "}
              <span className="font-semibold text-foreground">
                0:{String(seconds).padStart(2, "0")}
              </span>
            </>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resending}
              className="font-semibold text-primary disabled:opacity-60"
            >
              {resending ? "Sending…" : "Resend code"}
            </button>
          )}
        </p>
        {username && (
          <p className="text-center text-xs text-muted-foreground">
            Tip: you can also click the link in the email instead.
          </p>
        )}
      </div>
    </AuthShell>
  );
}
