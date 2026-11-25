// Supabase Edge Function: auth-lookup
//
// Replaces two database functions that used to be callable by anyone holding the public anon key
// and that returned real email addresses: get_login_email(username) and get_reset_emails(text).
// Those lookups now happen HERE, as the service role, and no email address is ever sent to the
// browser (except back to someone who just proved they know the password but has not verified it).
//
//   POST { action: "login", username, password }
//        200 { session: { access_token, refresh_token } }
//        401 { error: "invalid_credentials" }        (unknown name and wrong password look the same)
//        403 { error: "email_not_confirmed", email }
//        429 { error: "rate_limited" }
//   POST { action: "reset", identifier, redirectTo? }
//        200 { ok: true }                            (always, whether or not the account exists)
//        429 { error: "rate_limited" }
//
// Deploy with --no-verify-jwt (supabase/config.toml sets it): the app's `sb_publishable_...` key is
// not a JWT, so Supabase would refuse every call before this code runs. Needs no extra secrets:
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Needs migration 20261118000000_security_hardening.sql (auth_throttle_hit).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clientKey,
  LIMITS,
  parseRequest,
  resetTargets,
  type LoginRequest,
  type ResetRequest,
} from "./logic.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// A throwaway client for the actual password check / reset mail: it must never keep a session.
const publicClient = () =>
  createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function allowed(key: string, limit: { max: number; windowSeconds: number }) {
  const { data, error } = await admin.rpc("auth_throttle_hit", {
    p_key: key,
    p_max: limit.max,
    p_window: `${limit.windowSeconds} seconds`,
  });
  // If the throttle itself is broken, fail CLOSED: refusing a login is better than no limit.
  return !error && data === true;
}

async function login(req: LoginRequest, ip: string) {
  if (
    !(await allowed(`login:ip:${ip}`, LIMITS.loginPerIp)) ||
    !(await allowed(`login:name:${req.username}`, LIMITS.loginPerName))
  )
    return json(429, { error: "rate_limited" });

  const { data: email, error: lookupError } = await admin.rpc("get_login_email", {
    p_username: req.username,
  });
  if (lookupError) {
    console.error("auth-lookup: get_login_email failed", lookupError.message);
    return json(502, { error: "unavailable" });
  }
  if (typeof email !== "string" || !email) return json(401, { error: "invalid_credentials" });

  const { data, error } = await publicClient().auth.signInWithPassword({
    email,
    password: req.password,
  });
  if (error || !data.session) {
    if (error?.code === "email_not_confirmed")
      return json(403, { error: "email_not_confirmed", email });
    if (error && (error.status ?? 0) >= 500) return json(502, { error: "unavailable" });
    return json(401, { error: "invalid_credentials" });
  }
  return json(200, {
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
  });
}

async function reset(req: ResetRequest, ip: string) {
  if (
    !(await allowed(`reset:ip:${ip}`, LIMITS.resetPerIp)) ||
    !(await allowed(`reset:id:${req.identifier}`, LIMITS.resetPerIdentifier))
  )
    return json(429, { error: "rate_limited" });

  const { data: found, error } = await admin.rpc("get_reset_emails", {
    p_identifier: req.identifier,
  });
  if (error) console.error("auth-lookup: get_reset_emails failed", error.message);
  const client = publicClient();
  for (const target of resetTargets(req.identifier, found)) {
    const { error: sendError } = await client.auth.resetPasswordForEmail(
      target,
      req.redirectTo ? { redirectTo: req.redirectTo } : undefined,
    );
    if (sendError) console.error("auth-lookup: reset mail failed", sendError.status);
  }
  // Same answer whether or not anything was sent: this endpoint must not reveal which accounts exist.
  return json(200, { ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const parsed = parseRequest(body);
  if (!parsed) return json(400, { error: "bad_request" });
  const ip = clientKey(request.headers);
  try {
    return parsed.action === "login" ? await login(parsed, ip) : await reset(parsed, ip);
  } catch (e) {
    console.error("auth-lookup: unexpected", e instanceof Error ? e.message : e);
    return json(500, { error: "unavailable" });
  }
});
