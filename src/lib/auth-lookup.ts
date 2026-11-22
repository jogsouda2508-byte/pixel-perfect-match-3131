import { supabase } from "@/integrations/supabase/client";

/**
 * Username log-in and password-reset go through the `auth-lookup` edge function, which turns a
 * username into an email on the SERVER. The browser never receives anyone's email address (the
 * old get_login_email / get_reset_emails database functions handed it to anyone who asked).
 *
 * "unavailable" means the function isn't deployed yet (HTTP 404). Callers then fall back to the
 * old database functions, so the app keeps working during the rollout described in
 * docs/SECURITY-PATCH.md. TODO: delete those fallbacks once 20261118000001_revoke_email_lookup.sql
 * has been applied.
 */

export type LoginOutcome =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "unverified"; email: string }
  | { kind: "limited" }
  | { kind: "unavailable" }
  | { kind: "error" };

export type ResetOutcome =
  { kind: "ok" } | { kind: "limited" } | { kind: "unavailable" } | { kind: "error" };

type ReplyData = {
  error?: unknown;
  email?: unknown;
  session?: { access_token?: string; refresh_token?: string };
};
type Reply = { status: number; data: ReplyData };

async function callAuthLookup(body: Record<string, unknown>): Promise<Reply> {
  try {
    const fns = (supabase as unknown as { functions?: typeof supabase.functions }).functions;
    if (!fns) return { status: 404, data: {} };
    const { data, error } = await fns.invoke("auth-lookup", { body });
    if (!error) return { status: 200, data: (data ?? {}) as ReplyData };
    const response = (error as { context?: Response }).context;
    if (response && typeof response.status === "number") {
      let parsed: ReplyData = {};
      try {
        parsed = (await response.clone().json()) as ReplyData;
      } catch {
        /* no JSON body */
      }
      return { status: response.status, data: parsed };
    }
    return { status: 0, data: {} }; // the request never reached the function (offline, DNS...)
  } catch {
    return { status: 0, data: {} };
  }
}

export async function loginWithUsername(username: string, password: string): Promise<LoginOutcome> {
  const { status, data } = await callAuthLookup({ action: "login", username, password });
  if (status === 404) return { kind: "unavailable" };
  if (status === 429) return { kind: "limited" };
  if (status === 401) return { kind: "invalid" };
  if (status === 403 && data.error === "email_not_confirmed" && typeof data.email === "string")
    return { kind: "unverified", email: data.email };
  const session = data.session;
  if (status === 200 && session?.access_token && session.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    return error ? { kind: "error" } : { kind: "ok" };
  }
  return { kind: "error" };
}

export async function requestPasswordReset(
  identifier: string,
  redirectTo: string,
): Promise<ResetOutcome> {
  const { status } = await callAuthLookup({ action: "reset", identifier, redirectTo });
  if (status === 404) return { kind: "unavailable" };
  if (status === 429) return { kind: "limited" };
  return status === 200 ? { kind: "ok" } : { kind: "error" };
}
