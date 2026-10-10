import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { phoneSchema } from "@/lib/validation";
import { OutlineButton, PrimaryButton, TextField } from "@/components/auth-ui";

/** "Continue with Phone": asks for a number, sends an SMS code, continues on /verify. */
export function PhoneAuth() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (!open) {
    return (
      <OutlineButton type="button" onClick={() => setOpen(true)}>
        <Phone className="h-4 w-4" />
        Continue with Phone
      </OutlineButton>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: parsed.data,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (err) return setError(friendlyAuthError(err));
    navigate({ to: "/verify", search: { phone: parsed.data } });
  };

  return (
    <form
      onSubmit={send}
      className="space-y-3 rounded-2xl border border-border bg-elevated/30 p-4"
      noValidate
    >
      <TextField
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        placeholder="+919876543210"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={error}
        hint={
          <span className="text-muted-foreground">
            Include the country code. We'll text you a 6-digit code.
          </span>
        }
      />
      <PrimaryButton type="submit" loading={loading}>
        Send code
      </PrimaryButton>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </form>
  );
}
