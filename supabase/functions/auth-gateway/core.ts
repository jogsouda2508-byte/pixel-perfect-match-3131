// The auth-gateway rules, written against small interfaces so they can be tested without Deno,
// Supabase or a network (src/test/auth-gateway-core.test.ts). index.ts plugs in the real parts.
//
// What it guarantees:
//   * Real email addresses never leave the server. People log in and verify by USERNAME.
//   * Sign-up and password reset answer the same whether or not an email already has accounts.
//   * A wrong username and a wrong password look identical (same text, same time).
//   * Every action is rate limited, and repeated wrong passwords / codes lock the target out.
import {
  checkPassword,
  clientIp,
  maskEmail,
  normalizeEmail,
  normalizeUsername,
  originAllowed,
  redirectAllowed,
} from "./logic.ts";

// --------------------------------------------------------------------------- limits (one place)
export const LIMITS = {
  login: {
    ip: { limit: 60, windowSec: 600 },
    pair: { threshold: 5, baseSec: 30, maxSec: 900, windowSec: 900 }, // this IP + this username
    user: { threshold: 20, baseSec: 300, maxSec: 1800, windowSec: 3600 }, // any IP, this username
  },
  signup: { ip: { limit: 10, windowSec: 3600 }, email: { limit: 5, windowSec: 3600 } },
  verify: {
    ip: { limit: 30, windowSec: 600 },
    user: { threshold: 5, baseSec: 60, maxSec: 3600, windowSec: 3600 },
  },
  resend: { ip: { limit: 20, windowSec: 3600 }, user: { limit: 4, windowSec: 3600 } },
  reset: { ip: { limit: 10, windowSec: 3600 }, target: { limit: 3, windowSec: 3600 } },
  usernameCheck: { ip: { limit: 120, windowSec: 600 } },
  /** Failures answer no faster than this, so timing does not tell "no such user" from "bad password". */
  minFailMs: 600,
  /** Sign-up and reset do real work (sending mail) only sometimes; pad them all to the same time. */
  minSlowMs: 900,
  maxBodyBytes: 4096,
} as const;

export const MESSAGES = {
  badLogin: "Incorrect username or password.",
  tooMany: "Too many attempts. Please wait and try again.",
  badCode: "That code is incorrect or has expired. Request a new one.",
  unavailable: "We couldn't complete that right now. Please try again in a moment.",
} as const;

// --------------------------------------------------------------------------- dependencies
export type Session = {
  access_token: string;
  refresh_token: string;
  expires_in?: number | undefined;
  expires_at?: number | undefined;
  token_type?: string | undefined;
};
export type AuthFailure = {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
};
export type AuthResult = { session: Session | null; error: AuthFailure | null };
export type SignupPlan = {
  ok: boolean;
  reason?: string | undefined;
  auth_email?: string | undefined;
};
type LockCfg = { threshold: number; baseSec: number; maxSec: number; windowSec: number };

export interface Deps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Stable pseudonym for a value (HMAC). Used for every key we store. */
  hash(label: string, value: string): Promise<string>;
  limiter: {
    hit(
      key: string,
      limit: number,
      windowSec: number,
    ): Promise<{ allowed: boolean; retryAfter: number }>;
  };
  locks: {
    status(key: string): Promise<{ locked: boolean; retryAfter: number }>;
    fail(key: string, cfg: LockCfg): Promise<{ locked: boolean; retryAfter: number }>;
    clear(key: string): Promise<void>;
  };
  directory: {
    loginEmail(username: string): Promise<string | null>;
    resetTargets(identifier: string): Promise<string[]>;
    planSignup(email: string, username: string): Promise<SignupPlan>;
    usernameFree(username: string): Promise<boolean>;
  };
  auth: {
    signIn(email: string, password: string, captcha?: string): Promise<AuthResult>;
    signUp(a: {
      email: string;
      password: string;
      meta: Record<string, string>;
      redirectTo: string;
      captcha?: string | undefined;
    }): Promise<AuthResult>;
    verifyOtp(email: string, code: string): Promise<AuthResult>;
    resend(email: string, redirectTo: string): Promise<{ error: AuthFailure | null }>;
    resetForEmail(
      email: string,
      redirectTo: string,
      captcha?: string,
    ): Promise<{ error: AuthFailure | null }>;
  };
  config: { allowedOrigins: string[]; defaultRedirectOrigin: string | null };
  log(event: string, data?: Record<string, unknown>): void;
}

export type GatewayRequest = {
  method: string;
  headers: Record<string, string | undefined>;
  /** Raw request text, so the size limit applies before any parsing. */
  rawBody: string;
};
export type GatewayResponse = { status: number; body: unknown; headers: Record<string, string> };

// --------------------------------------------------------------------------- helpers
const reply = (
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): GatewayResponse => ({ status, body, headers: extra });
const tooMany = (retryAfter: number): GatewayResponse =>
  reply(
    429,
    { error: "too_many_attempts", message: MESSAGES.tooMany, retry_after: retryAfter },
    { "retry-after": String(retryAfter) },
  );
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

class Unavailable extends Error {}

export function createGateway(d: Deps) {
  /** Wait so a response takes at least `minMs` from `started`. */
  async function padTo(started: number, minMs: number) {
    const wait = minMs - (d.now() - started);
    if (wait > 0) await d.sleep(wait);
  }

  /** Fails closed: if the counters cannot be reached we refuse instead of skipping the limit. */
  async function hit(key: string, cfg: { limit: number; windowSec: number }) {
    try {
      return await d.limiter.hit(key, cfg.limit, cfg.windowSec);
    } catch (e) {
      d.log("limiter_error", { message: String(e).slice(0, 120) });
      throw new Unavailable();
    }
  }
  async function lockStatus(key: string) {
    try {
      return await d.locks.status(key);
    } catch (e) {
      d.log("lock_error", { message: String(e).slice(0, 120) });
      throw new Unavailable();
    }
  }
  async function lockFail(key: string, cfg: LockCfg) {
    try {
      return await d.locks.fail(key, cfg);
    } catch (e) {
      d.log("lock_error", { message: String(e).slice(0, 120) });
      throw new Unavailable();
    }
  }

  function redirectFor(body: Record<string, unknown>, fallbackPath: string): string | null {
    const origins = d.config.allowedOrigins;
    if (body["redirect_to"] !== undefined) {
      return redirectAllowed(body["redirect_to"], origins) ? (body["redirect_to"] as string) : null;
    }
    return d.config.defaultRedirectOrigin
      ? `${d.config.defaultRedirectOrigin}${fallbackPath}`
      : null;
  }

  // ------------------------------------------------------------------------- login
  async function login(body: Record<string, unknown>, ip: string): Promise<GatewayResponse> {
    const started = d.now();
    const username = normalizeUsername(body["username"]);
    const password = str(body["password"], 256);
    const captcha = str(body["captcha_token"], 2048) ?? undefined;

    const ipH = await d.hash("ip", ip);
    const ipHit = await hit(`login:ip:${ipH}`, LIMITS.login.ip);
    if (!ipHit.allowed) return tooMany(ipHit.retryAfter);

    // The same keys are used whether or not the username exists, so locks look identical.
    const who = username ?? "invalid";
    const pairKey = `login:pair:${await d.hash("pair", `${ip}|${who}`)}`;
    const userKey = `login:user:${await d.hash("user", who)}`;

    const [pair, user] = await Promise.all([lockStatus(pairKey), lockStatus(userKey)]);
    if (pair.locked || user.locked) {
      d.log("login_locked", { ip: ipH.slice(0, 8) });
      return tooMany(Math.max(pair.retryAfter, user.retryAfter));
    }

    const fail = async (): Promise<GatewayResponse> => {
      const [a, b] = await Promise.all([
        lockFail(pairKey, LIMITS.login.pair),
        lockFail(userKey, LIMITS.login.user),
      ]);
      await padTo(started, LIMITS.minFailMs);
      const retry = Math.max(a.retryAfter, b.retryAfter);
      d.log("login_failed", { ip: ipH.slice(0, 8), locked: a.locked || b.locked });
      return reply(401, {
        error: "invalid_credentials",
        message: MESSAGES.badLogin,
        ...(retry > 0 ? { retry_after: retry } : {}),
      });
    };

    if (!username || !password) return fail();

    let email: string | null;
    try {
      email = await d.directory.loginEmail(username);
    } catch {
      return reply(503, { error: "unavailable", message: MESSAGES.unavailable });
    }
    if (!email) return fail();

    const res = await d.auth.signIn(email, password, captcha);
    if (res.session) {
      await Promise.all([d.locks.clear(pairKey), d.locks.clear(userKey)]);
      d.log("login_ok", { ip: ipH.slice(0, 8) });
      return reply(200, { ok: true, session: res.session });
    }
    const err = res.error;
    if (err?.code === "email_not_confirmed") {
      // Supabase only reports this once the password was right, so it is safe to say so. We show a
      // masked address, never the real one; the code is entered against the username.
      await Promise.all([d.locks.clear(pairKey), d.locks.clear(userKey)]);
      return reply(403, { error: "email_not_verified", username, masked_email: maskEmail(email) });
    }
    if (err?.code === "invalid_credentials" || err?.status === 400) return fail();
    if (err?.status === 429) return tooMany(60);
    d.log("login_upstream_error", { status: err?.status ?? null, code: err?.code ?? null });
    return reply(502, { error: "unavailable", message: MESSAGES.unavailable });
  }

  // ------------------------------------------------------------------------- signup
  async function signup(body: Record<string, unknown>, ip: string): Promise<GatewayResponse> {
    const started = d.now();
    const username = normalizeUsername(body["username"]);
    const email = normalizeEmail(body["email"]);
    const fullName = typeof body["full_name"] === "string" ? body["full_name"].trim() : "";
    const password = body["password"];

    if (!username) return reply(400, { error: "invalid_username" });
    if (!email) return reply(400, { error: "invalid_email" });
    if (fullName.length < 1 || fullName.length > 80) return reply(400, { error: "invalid_name" });
    const problem = checkPassword(password, { username, email });
    if (problem) return reply(400, { error: "weak_password", reason: problem });

    const ipH = await d.hash("ip", ip);
    const emailH = await d.hash("email", email);
    const a = await hit(`signup:ip:${ipH}`, LIMITS.signup.ip);
    if (!a.allowed) return tooMany(a.retryAfter);
    const b = await hit(`signup:email:${emailH}`, LIMITS.signup.email);
    if (!b.allowed) return tooMany(b.retryAfter);

    const redirectTo = redirectFor(body, "/home");
    if (!redirectTo) return reply(400, { error: "invalid_redirect" });

    // Everything below answers with the same shape, so the reply does not reveal whether this
    // mailbox already has accounts, has reached the limit, or uses an unsupported provider.
    const generic = async () => {
      await padTo(started, LIMITS.minSlowMs);
      return reply(200, {
        ok: true,
        needs_verification: true,
        username,
        masked_email: maskEmail(email),
      });
    };

    let plan: SignupPlan;
    try {
      plan = await d.directory.planSignup(email, username);
    } catch {
      return reply(503, { error: "unavailable", message: MESSAGES.unavailable });
    }
    if (!plan.ok) {
      if (plan.reason === "username_taken") return reply(409, { error: "username_taken" });
      if (plan.reason === "invalid_username") return reply(400, { error: "invalid_username" });
      if (plan.reason === "invalid_email") return reply(400, { error: "invalid_email" });
      d.log("signup_refused_quietly", { reason: plan.reason ?? "unknown" });
      return generic();
    }

    const authEmail = normalizeEmail(plan.auth_email) ?? email;
    const res = await d.auth.signUp({
      email: authEmail,
      password: password as string,
      meta: { full_name: fullName, username, contact_email: email },
      redirectTo,
      captcha: str(body["captcha_token"], 2048) ?? undefined,
    });
    if (res.error) {
      const msg = (res.error.message ?? "").toLowerCase();
      if (res.error.status === 429 || (res.error.code ?? "").includes("rate_limit"))
        return tooMany(60);
      if (res.error.code === "weak_password")
        return reply(400, { error: "weak_password", reason: "too_common" });
      if (msg.includes("database error saving new user") || res.error.code === "unexpected_failure")
        return reply(409, { error: "username_taken" });
      if (res.error.code === "user_already_exists") return generic();
      d.log("signup_upstream_error", {
        status: res.error.status ?? null,
        code: res.error.code ?? null,
      });
      return reply(502, { error: "unavailable", message: MESSAGES.unavailable });
    }
    if (res.session) {
      // Email confirmation is switched off in this project: the account is ready now.
      return reply(200, { ok: true, needs_verification: false, username, session: res.session });
    }
    return generic();
  }

  // ------------------------------------------------------------------------- verify / resend
  async function verify(body: Record<string, unknown>, ip: string): Promise<GatewayResponse> {
    const started = d.now();
    const username = normalizeUsername(body["username"]);
    const code = typeof body["code"] === "string" ? body["code"].trim() : "";
    if (!username || !/^\d{6}$/.test(code))
      return reply(400, { error: "invalid_code", message: MESSAGES.badCode });

    const ipH = await d.hash("ip", ip);
    const a = await hit(`verify:ip:${ipH}`, LIMITS.verify.ip);
    if (!a.allowed) return tooMany(a.retryAfter);
    const userKey = `verify:user:${await d.hash("user", username)}`;
    const st = await lockStatus(userKey);
    if (st.locked) return tooMany(st.retryAfter);

    const fail = async () => {
      const f = await lockFail(userKey, LIMITS.verify.user);
      await padTo(started, LIMITS.minFailMs);
      d.log("verify_failed", { ip: ipH.slice(0, 8), locked: f.locked });
      return reply(400, {
        error: "invalid_code",
        message: MESSAGES.badCode,
        ...(f.retryAfter > 0 ? { retry_after: f.retryAfter } : {}),
      });
    };

    let email: string | null;
    try {
      email = await d.directory.loginEmail(username);
    } catch {
      return reply(503, { error: "unavailable", message: MESSAGES.unavailable });
    }
    if (!email) return fail();
    const res = await d.auth.verifyOtp(email, code);
    if (res.session) {
      await d.locks.clear(userKey);
      return reply(200, { ok: true, session: res.session });
    }
    if (res.error?.status === 429) return tooMany(60);
    return fail();
  }

  async function resend(body: Record<string, unknown>, ip: string): Promise<GatewayResponse> {
    const started = d.now();
    const username = normalizeUsername(body["username"]);
    if (!username) return reply(400, { error: "invalid_username" });
    const ipH = await d.hash("ip", ip);
    const a = await hit(`resend:ip:${ipH}`, LIMITS.resend.ip);
    if (!a.allowed) return tooMany(a.retryAfter);
    const b = await hit(`resend:user:${await d.hash("user", username)}`, LIMITS.resend.user);
    if (!b.allowed) return tooMany(b.retryAfter);

    const redirectTo = redirectFor(body, "/home");
    if (!redirectTo) return reply(400, { error: "invalid_redirect" });
    try {
      const email = await d.directory.loginEmail(username);
      if (email) await d.auth.resend(email, redirectTo);
    } catch (e) {
      d.log("resend_error", { message: String(e).slice(0, 120) });
    }
    await padTo(started, LIMITS.minSlowMs);
    return reply(200, { ok: true });
  }

  // ------------------------------------------------------------------------- password reset
  async function requestReset(body: Record<string, unknown>, ip: string): Promise<GatewayResponse> {
    const started = d.now();
    const identifier = str(body["identifier"], 254)?.trim().toLowerCase();
    if (!identifier) return reply(400, { error: "invalid_identifier" });
    const redirectTo = redirectFor(body, "/reset-password");
    if (!redirectTo) return reply(400, { error: "invalid_redirect" });

    const ipH = await d.hash("ip", ip);
    const a = await hit(`reset:ip:${ipH}`, LIMITS.reset.ip);
    if (!a.allowed) return tooMany(a.retryAfter);
    const b = await hit(`reset:target:${await d.hash("target", identifier)}`, LIMITS.reset.target);
    if (!b.allowed) return tooMany(b.retryAfter);

    // Always the same answer: no hint about whether the username or email has an account.
    try {
      const targets = (await d.directory.resetTargets(identifier)).slice(0, 3);
      for (const t of targets) {
        const r = await d.auth.resetForEmail(
          t,
          redirectTo,
          str(body["captcha_token"], 2048) ?? undefined,
        );
        if (r.error) d.log("reset_send_error", { status: r.error.status ?? null });
      }
    } catch (e) {
      d.log("reset_error", { message: String(e).slice(0, 120) });
    }
    await padTo(started, LIMITS.minSlowMs);
    return reply(200, { ok: true });
  }

  async function usernameAvailable(
    body: Record<string, unknown>,
    ip: string,
  ): Promise<GatewayResponse> {
    const username = normalizeUsername(body["username"]);
    const ipH = await d.hash("ip", ip);
    const a = await hit(`uname:ip:${ipH}`, LIMITS.usernameCheck.ip);
    if (!a.allowed) return tooMany(a.retryAfter);
    if (!username) return reply(200, { available: false });
    try {
      return reply(200, { available: await d.directory.usernameFree(username) });
    } catch {
      return reply(503, { error: "unavailable", message: MESSAGES.unavailable });
    }
  }

  // ------------------------------------------------------------------------- entry point
  async function handle(req: GatewayRequest): Promise<GatewayResponse> {
    const origin = req.headers["origin"];
    const cors: Record<string, string> = {
      vary: "Origin",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (origin) {
      if (!originAllowed(origin, d.config.allowedOrigins)) {
        // The browser cannot read this 403 (no CORS header, on purpose), so the app just shows
        // "Can't reach SabZone". Log the origin here so the function logs say what to allow.
        d.log("forbidden_origin", { origin: origin.slice(0, 120) });
        return reply(403, { error: "forbidden_origin" }, cors);
      }
      cors["access-control-allow-origin"] = origin;
      cors["access-control-allow-headers"] = "authorization, apikey, content-type, x-client-info";
      cors["access-control-allow-methods"] = "POST, OPTIONS";
      cors["access-control-max-age"] = "600";
    }
    const done = (r: GatewayResponse): GatewayResponse => ({
      ...r,
      headers: { ...cors, ...r.headers },
    });

    if (req.method === "OPTIONS") return done(reply(204, null));
    if (req.method !== "POST") return done(reply(405, { error: "method_not_allowed" }));
    if (new TextEncoder().encode(req.rawBody).length > LIMITS.maxBodyBytes)
      return done(reply(413, { error: "too_large" }));

    let parsed: unknown;
    try {
      parsed = JSON.parse(req.rawBody);
    } catch {
      return done(reply(400, { error: "invalid_json" }));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return done(reply(400, { error: "invalid_json" }));
    const body = parsed as Record<string, unknown>;
    const ip = clientIp(req.headers);

    try {
      switch (body["action"]) {
        case "login":
          return done(await login(body, ip));
        case "signup":
          return done(await signup(body, ip));
        case "verify":
          return done(await verify(body, ip));
        case "resend":
          return done(await resend(body, ip));
        case "request_reset":
          return done(await requestReset(body, ip));
        case "username_available":
          return done(await usernameAvailable(body, ip));
        default:
          return done(reply(400, { error: "unknown_action" }));
      }
    } catch (e) {
      if (!(e instanceof Unavailable))
        d.log("unhandled_error", { message: String(e).slice(0, 160) });
      return done(reply(503, { error: "unavailable", message: MESSAGES.unavailable }));
    }
  }

  return { handle };
}
