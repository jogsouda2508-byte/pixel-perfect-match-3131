import { supabase } from "@/integrations/supabase/client";

/**
 * Client for the `auth-gateway` Edge Function (supabase/functions/auth-gateway).
 * Log-in, sign-up, email verification, password reset and the username check go through it, so
 * the browser never learns anyone's email address and every action is rate limited server-side.
 */
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

export type GatewayAction =
  "login" | "signup" | "verify" | "resend" | "request_reset" | "username_available";

export type GatewayReply = {
  ok: boolean;
  /** HTTP status; 0 means the request never reached the server (offline, blocked). */
  status: number;
  data: Record<string, unknown>;
};

export type SessionTokens = { access_token: string; refresh_token: string };

export async function callGateway(
  action: GatewayAction,
  payload: Record<string, unknown> = {},
): Promise<GatewayReply> {
  if (!url || !key) return { ok: false, status: 0, data: { error: "not_configured" } };
  try {
    const res = await fetch(`${url}/functions/v1/auth-gateway`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ action, ...payload }),
    });
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      /* an empty or non-JSON body is treated as no data */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    // The request never got an answer the browser was allowed to read. That is NOT always the
    // person's internet: a function that is not deployed, or a website address missing from the
    // server's AUTH_ALLOWED_ORIGINS, fails in exactly the same way. Say so in the console so the
    // real cause can be found (the screen only shows a friendly message).
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (typeof console !== "undefined") {
      console.warn(
        offline
          ? "[auth-gateway] request failed: this device is offline."
          : "[auth-gateway] request failed while online. Check that the auth-gateway function is " +
              "deployed and that this site's address is in AUTH_ALLOWED_ORIGINS " +
              "(supabase secrets set AUTH_ALLOWED_ORIGINS=...). Origin: " +
              (typeof location !== "undefined" ? location.origin : "unknown"),
      );
    }
    return { ok: false, status: 0, data: { error: "network", offline } };
  }
}

/** "30 seconds", "2 minutes", "1 hour" */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** Friendly text for the answers every action can give (rate limit, offline, server trouble). */
export function gatewayProblem(r: GatewayReply, fallback: string): string {
  if (r.status === 0) {
    // Only blame the internet when the device really is offline. Online, the problem is on our
    // side (service not reachable / not set up), so do not tell the person to fix their network.
    if (r.data["offline"] === true) return "Can't reach SabZone. Check your internet and try again.";
    if (r.data["error"] === "not_configured")
      return "Can't reach SabZone: this version of the app isn't set up correctly. Please update the app.";
    return "Can't reach SabZone's sign-in service right now. Please try again in a moment.";
  }
  if (r.status === 429) {
    const wait = typeof r.data["retry_after"] === "number" ? r.data["retry_after"] : 60;
    return `Too many attempts. Please try again in ${waitText(wait)}.`;
  }
  if (r.status >= 500) return "We couldn't complete that right now. Please try again in a moment.";
  return fallback;
}

/** Reads the session tokens out of a successful gateway answer. */
export function tokensFrom(r: GatewayReply): SessionTokens | null {
  const s = r.data["session"];
  if (!s || typeof s !== "object") return null;
  const { access_token, refresh_token } = s as Record<string, unknown>;
  return typeof access_token === "string" && typeof refresh_token === "string"
    ? { access_token, refresh_token }
    : null;
}

/** Makes the browser/app use the session the gateway created. */
export async function startSession(tokens: SessionTokens): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.setSession(tokens);
  return { error: error ? "Couldn't start your session. Please try again." : null };
}

/** Live "is this username free?" check. 'error' means we could not tell. */
export async function checkUsernameAvailable(
  username: string,
): Promise<"available" | "taken" | "error"> {
  const r = await callGateway("username_available", { username });
  if (!r.ok) return "error";
  return r.data["available"] === true ? "available" : "taken";
}
