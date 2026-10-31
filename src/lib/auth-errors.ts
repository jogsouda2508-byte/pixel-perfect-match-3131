// Turns raw Supabase / network errors into friendly messages.
type ErrLike =
  | {
      message?: string | undefined;
      code?: string | undefined;
      status?: number | undefined;
      name?: string | undefined;
    }
  | null
  | undefined;

export function friendlyAuthError(
  err: ErrLike,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!err) return fallback;
  const msg = (err.message ?? "").toLowerCase();
  const code = (err.code ?? "").toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials"))
    return "Incorrect email/username or password.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed"))
    return "Please verify your email first. Check your inbox for the code.";
  if (
    code === "user_already_exists" ||
    msg.includes("already registered") ||
    msg.includes("already been registered")
  )
    return "This email is already registered. Try logging in instead.";
  if (msg.includes("email_limit"))
    return "This email already has 3 accounts. Use a different email.";
  if (
    msg.includes("username_taken") ||
    msg.includes("database error saving new user") ||
    code === "unexpected_failure"
  )
    return "That username was just taken. Please choose another one.";
  if (msg.includes("invalid_username"))
    return "Username can only use letters, numbers and underscores (3–20 characters).";
  if (
    code.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    err.status === 429
  )
    return "Too many attempts. Please wait a minute and try again.";
  if (
    code === "otp_expired" ||
    msg.includes("token has expired") ||
    msg.includes("invalid token") ||
    msg.includes("otp")
  )
    return "That code is incorrect or has expired. Request a new one.";
  if (code === "weak_password" || msg.includes("password should be"))
    return "Password is too weak. Use at least 8 characters.";
  if (code === "same_password" || msg.includes("different from the old password"))
    return "Your new password must be different from the old one.";
  if (
    code === "phone_provider_disabled" ||
    msg.includes("unsupported phone provider") ||
    msg.includes("phone provider")
  )
    return "Phone sign-in isn't enabled yet.";
  if (
    code === "provider_disabled" ||
    msg.includes("provider is not enabled") ||
    msg.includes("unsupported provider")
  )
    return "This sign-in method isn't enabled yet.";
  if (code === "validation_failed" && msg.includes("phone"))
    return "Enter a valid phone number with country code, e.g. +919876543210.";
  if (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    err.name === "AuthRetryableFetchError" ||
    err.status === 0
  )
    return "Network error. Check your connection and try again.";
  return err.message && err.message.length < 140 ? err.message : fallback;
}
