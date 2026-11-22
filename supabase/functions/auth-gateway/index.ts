// Supabase Edge Function: auth-gateway
//
// The only door for sign-up, log-in by username, email verification and password reset.
// It keeps real email addresses on the server, rate limits every action and locks out
// repeated wrong passwords / codes. The rules live in core.ts (unit tested); this file only
// connects them to Supabase.
//
// Deploy (NOT done by this patch):
//   supabase functions deploy auth-gateway
// The default JWT check can stay ON: the browser sends the public key, which is a valid JWT.
//
// Secrets (supabase secrets set ...):
//   AUTH_HASH_SECRET       a long random string (32+ characters). Keys in the database are
//                          HMACs made with it, so no raw IP, email or username is stored.
//   AUTH_ALLOWED_ORIGINS   comma list of your website addresses, e.g. https://sabzone.onrender.com
//                          (the Android app and localhost are always allowed)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient, type AuthError, type Session } from "npm:@supabase/supabase-js@2";
import { createGateway, LIMITS, type AuthFailure, type Deps, type SignupPlan } from "./core.ts";
import { keyHash, parseOrigins } from "./logic.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const hashSecret = Deno.env.get("AUTH_HASH_SECRET") ?? "";
const allowedOrigins = parseOrigins(Deno.env.get("AUTH_ALLOWED_ORIGINS"));

const configured = !!(url && anonKey && serviceKey && hashSecret.length >= 32);
if (!configured)
  console.error("auth-gateway: SUPABASE_* keys or AUTH_HASH_SECRET (32+ chars) missing");
if (allowedOrigins.length === 0) {
  console.warn(
    "auth-gateway: AUTH_ALLOWED_ORIGINS is empty, only the Android app and localhost work",
  );
}

// Service role: only used to call the database functions in 20261116000000_auth_gateway.sql and
// the sign-in helpers. It never leaves this file.
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// A fresh anon client per call, so no session is ever shared between requests.
const anon = () =>
  createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const failure = (e: AuthError | null): AuthFailure | null =>
  e ? { code: e.code, status: e.status, message: e.message } : null;
const sessionOf = (s: Session | null) =>
  s
    ? {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: s.expires_in,
        expires_at: s.expires_at,
        token_type: s.token_type,
      }
    : null;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const deps: Deps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  hash: (label, value) => keyHash(hashSecret, label, value),
  limiter: {
    async hit(key, limit, windowSec) {
      const rows = await rpc<{ allowed: boolean; retry_after: number }[]>("auth_gw_rate_hit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSec,
      });
      const r = rows[0];
      return { allowed: !!r?.allowed, retryAfter: r?.retry_after ?? windowSec };
    },
  },
  locks: {
    async status(key) {
      const rows = await rpc<{ locked: boolean; retry_after: number }[]>("auth_gw_lock_status", {
        p_key: key,
      });
      return { locked: !!rows[0]?.locked, retryAfter: rows[0]?.retry_after ?? 0 };
    },
    async fail(key, c) {
      const rows = await rpc<{ locked: boolean; retry_after: number }[]>("auth_gw_lock_fail", {
        p_key: key,
        p_threshold: c.threshold,
        p_base_seconds: c.baseSec,
        p_max_seconds: c.maxSec,
        p_window_seconds: c.windowSec,
      });
      return { locked: !!rows[0]?.locked, retryAfter: rows[0]?.retry_after ?? 0 };
    },
    async clear(key) {
      await rpc("auth_gw_lock_clear", { p_key: key });
    },
  },
  directory: {
    loginEmail: async (username) =>
      (await rpc<string | null>("get_login_email", { p_username: username })) ?? null,
    resetTargets: async (identifier) =>
      (await rpc<string[] | null>("get_reset_emails", { p_identifier: identifier })) ?? [],
    planSignup: (email, username) =>
      rpc<SignupPlan>("plan_signup_email", { p_email: email, p_username: username }),
    usernameFree: (username) => rpc<boolean>("is_username_available", { p_username: username }),
  },
  auth: {
    async signIn(email, password, captcha) {
      const { data, error } = await anon().auth.signInWithPassword({
        email,
        password,
        ...(captcha ? { options: { captchaToken: captcha } } : {}),
      });
      return { session: sessionOf(data.session), error: failure(error) };
    },
    async signUp({ email, password, meta, redirectTo, captcha }) {
      const { data, error } = await anon().auth.signUp({
        email,
        password,
        options: {
          data: meta,
          emailRedirectTo: redirectTo,
          ...(captcha ? { captchaToken: captcha } : {}),
        },
      });
      // Supabase hides "email already exists" by returning a user with no identities.
      if (!error && data.user && (data.user.identities?.length ?? 0) === 0) {
        return { session: null, error: { code: "user_already_exists", status: 200 } };
      }
      return { session: sessionOf(data.session), error: failure(error) };
    },
    async verifyOtp(email, code) {
      const { data, error } = await anon().auth.verifyOtp({ email, token: code, type: "signup" });
      return { session: sessionOf(data.session), error: failure(error) };
    },
    async resend(email, redirectTo) {
      const { error } = await anon().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      return { error: failure(error) };
    },
    async resetForEmail(email, redirectTo, captcha) {
      const { error } = await anon().auth.resetPasswordForEmail(email, {
        redirectTo,
        ...(captcha ? { captchaToken: captcha } : {}),
      });
      return { error: failure(error) };
    },
  },
  config: { allowedOrigins, defaultRedirectOrigin: allowedOrigins[0] ?? null },
  // One line of JSON per event. Never contains an email, username, password or address.
  log: (event, data) => console.log(JSON.stringify({ fn: "auth-gateway", event, ...data })),
};

const gateway = createGateway(deps);

Deno.serve(async (req) => {
  if (!configured) {
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  // Refuse oversized bodies before reading them.
  if (Number(req.headers.get("content-length") ?? 0) > LIMITS.maxBodyBytes) {
    return new Response(JSON.stringify({ error: "too_large" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const rawBody = req.method === "POST" ? await req.text() : "";
  const res = await gateway.handle({ method: req.method, headers, rawBody });
  return new Response(res.body === null ? null : JSON.stringify(res.body), {
    status: res.status,
    headers: { "content-type": "application/json", ...res.headers },
  });
});
