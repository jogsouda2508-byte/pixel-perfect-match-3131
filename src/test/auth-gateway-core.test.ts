import { describe, expect, it } from "vitest";
import {
  LIMITS,
  createGateway,
  type AuthResult,
  type Deps,
  type SignupPlan,
} from "../../supabase/functions/auth-gateway/core";
import { keyHash } from "../../supabase/functions/auth-gateway/logic";

// ---------------------------------------------------------------------------------------------
// A tiny in-memory world: counters and lockouts follow the same rules as the SQL functions, the
// "directory" is a few users, and the auth service checks passwords and codes.
// ---------------------------------------------------------------------------------------------
type User = { email: string; password: string; confirmed: boolean };
const SECRET = "test-secret-test-secret-test-secret!";
const SITE = "https://sabzone.onrender.com";
const PW = "blue-Tiger-42";

function makeWorld(
  opts: { limiterFails?: boolean; directoryFails?: boolean; confirmationOff?: boolean } = {},
) {
  let clock = 1_700_000_000_000;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const mails: { kind: string; to: string; redirectTo: string }[] = [];
  const signUps: { email: string; meta: Record<string, string> }[] = [];
  const signInCalls: string[] = [];
  const counters = new Map<string, { start: number; hits: number }>();
  const lockouts = new Map<string, { fails: number; first: number; until: number }>();

  const users = new Map<string, User>([
    ["asha_01", { email: "asha.private@gmail.com", password: PW, confirmed: true }],
    ["newbie_02", { email: "newbie.secret@outlook.com", password: PW, confirmed: false }],
  ]);
  const plans = new Map<string, SignupPlan>(); // "email|username" -> plan override
  let otpCode = "123456";
  let upstream: { status: number; code?: string } | null = null;

  const deps: Deps = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    hash: (label, value) => keyHash(SECRET, label, value),
    limiter: {
      async hit(key, limit, windowSec) {
        if (opts.limiterFails) throw new Error("db down");
        const w = windowSec * 1000;
        const cur = counters.get(key);
        const fresh = !cur || cur.start <= clock - w;
        const next = fresh ? { start: clock, hits: 1 } : { start: cur.start, hits: cur.hits + 1 };
        counters.set(key, next);
        const allowed = next.hits <= limit;
        return {
          allowed,
          retryAfter: allowed ? 0 : Math.max(1, Math.ceil((next.start + w - clock) / 1000)),
        };
      },
    },
    locks: {
      async status(key) {
        if (opts.limiterFails) throw new Error("db down");
        const l = lockouts.get(key);
        const locked = !!l && l.until > clock;
        return { locked, retryAfter: locked ? Math.ceil((l!.until - clock) / 1000) : 0 };
      },
      async fail(key, c) {
        const cur = lockouts.get(key);
        const stale = !cur || cur.first <= clock - c.windowSec * 1000;
        const fails = stale ? 1 : cur.fails + 1;
        const first = stale ? clock : cur.first;
        let until = cur?.until ?? 0;
        let retryAfter = 0;
        if (fails >= c.threshold) {
          retryAfter = Math.min(c.maxSec, c.baseSec * 2 ** Math.min(fails - c.threshold, 20));
          until = clock + retryAfter * 1000;
        }
        lockouts.set(key, { fails, first, until });
        return { locked: retryAfter > 0, retryAfter };
      },
      async clear(key) {
        lockouts.delete(key);
      },
    },
    directory: {
      async loginEmail(username) {
        if (opts.directoryFails) throw new Error("db down");
        return users.get(username)?.email ?? null;
      },
      async resetTargets(identifier) {
        const id = identifier.replace(/^@/, "");
        if (id.includes("@"))
          return [...users.values()].filter((u) => u.email === id).map((u) => u.email);
        const u = users.get(id);
        return u ? [u.email] : [];
      },
      async planSignup(email, username) {
        const override = plans.get(`${email}|${username}`);
        if (override) return override;
        if (users.has(username)) return { ok: false, reason: "username_taken" };
        const existing = [...users.values()].some((u) => u.email === email);
        return { ok: true, auth_email: existing ? email.replace("@", `+${username}@`) : email };
      },
      async usernameFree(username) {
        return !users.has(username);
      },
    },
    auth: {
      async signIn(email, password): Promise<AuthResult> {
        signInCalls.push(email);
        if (upstream) return { session: null, error: upstream };
        const u = [...users.values()].find((x) => x.email === email);
        if (!u || u.password !== password)
          return { session: null, error: { code: "invalid_credentials", status: 400 } };
        if (!u.confirmed)
          return { session: null, error: { code: "email_not_confirmed", status: 400 } };
        return {
          session: { access_token: "AT", refresh_token: "RT", expires_in: 3600 },
          error: null,
        };
      },
      async signUp({ email, meta }) {
        signUps.push({ email, meta });
        if (upstream) return { session: null, error: upstream };
        if (opts.confirmationOff)
          return { session: { access_token: "AT3", refresh_token: "RT3" }, error: null };
        return { session: null, error: null };
      },
      async verifyOtp(email, code): Promise<AuthResult> {
        if (upstream) return { session: null, error: upstream };
        const u = [...users.values()].find((x) => x.email === email);
        if (u && code === otpCode)
          return { session: { access_token: "AT2", refresh_token: "RT2" }, error: null };
        return { session: null, error: { code: "otp_expired", status: 403 } };
      },
      async resend(email, redirectTo) {
        mails.push({ kind: "resend", to: email, redirectTo });
        return { error: null };
      },
      async resetForEmail(email, redirectTo) {
        mails.push({ kind: "reset", to: email, redirectTo });
        return { error: null };
      },
    },
    config: { allowedOrigins: [SITE], defaultRedirectOrigin: SITE },
    log: (event, data) => logs.push(JSON.stringify({ event, ...data })),
  };

  const gateway = createGateway(deps);
  async function call(
    body: unknown,
    o: { ip?: string; origin?: string; method?: string; raw?: string } = {},
  ) {
    const res = await gateway.handle({
      method: o.method ?? "POST",
      headers: {
        "cf-connecting-ip": o.ip ?? "203.0.113.5",
        ...(o.origin ? { origin: o.origin } : {}),
      },
      rawBody: o.raw ?? JSON.stringify(body),
    });
    return res as {
      status: number;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    };
  }
  const login = (username: string, password: string, ip?: string) =>
    call({ action: "login", username, password }, ip ? { ip } : {});
  return {
    call,
    login,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
    sleeps,
    logs,
    mails,
    signUps,
    signInCalls,
    users,
    plans,
    setOtp: (c: string) => (otpCode = c),
    setUpstream: (u: { status: number; code?: string } | null) => (upstream = u),
  };
}

const text = (v: unknown) => JSON.stringify(v);
const EMAILS = [
  "asha.private@gmail.com",
  "newbie.secret@outlook.com",
  "asha.private",
  "newbie.secret",
];
const noEmailIn = (v: unknown) => {
  const s = text(v).toLowerCase();
  for (const e of EMAILS) expect(s).not.toContain(e);
};

// ---------------------------------------------------------------------------------------------
describe("login", () => {
  it("logs in by username and returns the session, never the email", async () => {
    const w = makeWorld();
    const r = await w.login("@Asha_01", PW);
    expect(r.status).toBe(200);
    expect(r.body["session"]).toMatchObject({ access_token: "AT", refresh_token: "RT" });
    noEmailIn(r.body);
  });

  it("answers a wrong password and an unknown username identically, and not faster", async () => {
    const w = makeWorld();
    const wrongPw = await w.login("asha_01", "not-the-password");
    const noUser = await w.login("ghost_99", "not-the-password");
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(noUser.body).toEqual(wrongPw.body);
    expect(wrongPw.body["message"]).toBe("Incorrect username or password.");
    // both waited at least the minimum time
    expect(w.sleeps.filter((ms) => ms > 0).length).toBe(2);
    expect(Math.min(...w.sleeps)).toBeGreaterThan(LIMITS.minFailMs - 100);
    noEmailIn(wrongPw.body);
  });

  it("does not tell an unverified account from a wrong password unless the password is right", async () => {
    const w = makeWorld();
    const wrong = await w.login("newbie_02", "totally-wrong");
    expect(wrong.status).toBe(401);
    expect(wrong.body["error"]).toBe("invalid_credentials");

    const right = await w.login("newbie_02", PW);
    expect(right.status).toBe(403);
    expect(right.body).toEqual({
      error: "email_not_verified",
      username: "newbie_02",
      masked_email: "n***@o***.com",
    });
    noEmailIn(right.body);
  });

  it("locks an IP + username after 5 wrong passwords, even for the right password", async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++)
      expect((await w.login("asha_01", `wrong-${i}-wrong`)).status).toBe(401);
    const locked = await w.login("asha_01", PW);
    expect(locked.status).toBe(429);
    expect(locked.body["retry_after"]).toBeGreaterThan(0);
    expect(locked.headers["retry-after"]).toBeDefined();
    expect(w.signInCalls).toHaveLength(5); // the locked attempt never reached the password check
    // a different username from the same address is not locked by this
    expect((await w.login("newbie_02", "wrong-wrong-1")).status).toBe(401);
  });

  it("lets the person back in once the lock has expired", async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) await w.login("asha_01", `wrong-${i}-wrong`);
    expect((await w.login("asha_01", PW)).status).toBe(429);
    w.advance(31_000);
    expect((await w.login("asha_01", PW)).status).toBe(200);
  });

  it("doubles the lock when the attacker keeps going", async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) await w.login("asha_01", `wrong-${i}-wrong`);
    w.advance(31_000);
    const sixth = await w.login("asha_01", "wrong-again-1");
    expect(sixth.status).toBe(401);
    expect(sixth.body["retry_after"]).toBe(60);
  });

  it("locks a username that is attacked from many addresses", async () => {
    const w = makeWorld();
    for (let i = 0; i < 20; i++)
      await w.login("asha_01", `guess-${i}-guess`, `198.51.100.${i + 1}`);
    const fresh = await w.login("asha_01", PW, "192.0.2.77");
    expect(fresh.status).toBe(429);
  });

  it("forgets earlier failures after a good login", async () => {
    const w = makeWorld();
    for (let i = 0; i < 4; i++) await w.login("asha_01", `wrong-${i}-wrong`);
    expect((await w.login("asha_01", PW)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await w.login("asha_01", `wrong-${i}-wrong`)).status).toBe(401);
  });

  it("rate limits one address across all usernames", async () => {
    const w = makeWorld();
    for (let i = 0; i < LIMITS.login.ip.limit; i++)
      await w.login(`user_${i + 100}`, "wrong-wrong-1");
    const r = await w.login("asha_01", PW);
    expect(r.status).toBe(429);
  });

  it("treats malformed input as a normal failed login", async () => {
    const w = makeWorld();
    for (const body of [
      { action: "login" },
      { action: "login", username: "me@x.com", password: PW },
      { action: "login", username: "asha_01", password: "" },
      { action: "login", username: 5, password: 5 },
      { action: "login", username: "asha_01", password: "x".repeat(300) },
    ]) {
      const r = await w.call(body);
      expect(r.status).toBe(401);
      expect(r.body["message"]).toBe("Incorrect username or password.");
    }
    expect(w.signInCalls).toHaveLength(0);
  });

  it("passes Supabase rate limits on and hides upstream errors", async () => {
    const w = makeWorld();
    w.setUpstream({ status: 429, code: "over_request_rate_limit" });
    expect((await w.login("asha_01", PW)).status).toBe(429);
    w.setUpstream({ status: 500, code: "unexpected_failure" });
    const r = await w.login("asha_01", PW, "198.51.100.9");
    expect(r.status).toBe(502);
    expect(text(r.body)).not.toContain("unexpected_failure");
  });
});

// ---------------------------------------------------------------------------------------------
describe("sign-up", () => {
  const base = { action: "signup", full_name: "Test Person", password: PW };

  it("answers the same whether the mailbox is new, used, full or unsupported", async () => {
    const w = makeWorld();
    w.plans.set("full@x.com|u_full", { ok: false, reason: "limit_reached" });
    w.plans.set("yahoo@yahoo.in|u_yahoo", { ok: false, reason: "unsupported_domain" });
    const cases: [string, string][] = [
      ["brand.new@x.com", "u_new"],
      ["asha.private@gmail.com", "u_alias"], // an existing mailbox becomes an inbox alias
      ["full@x.com", "u_full"],
      ["yahoo@yahoo.in", "u_yahoo"],
    ];
    const shapes: string[] = [];
    for (const [i, [email, username]] of cases.entries()) {
      const r = await w.call({ ...base, email, username }, { ip: `198.51.100.${i + 1}` });
      expect(r.status).toBe(200);
      expect(r.body["ok"]).toBe(true);
      expect(r.body["needs_verification"]).toBe(true);
      expect(r.body["session"]).toBeUndefined();
      shapes.push(Object.keys(r.body).sort().join(","));
    }
    expect(new Set(shapes).size).toBe(1);
    // accounts were created only where the plan allowed it
    expect(w.signUps.map((s) => s.meta["username"])).toEqual(["u_new", "u_alias"]);
  });

  it("never reveals the alias address or any stored email", async () => {
    const w = makeWorld();
    const r = await w.call({ ...base, email: "asha.private@gmail.com", username: "u_alias" });
    expect(text(r.body)).not.toContain("+u_alias");
    noEmailIn(r.body);
    expect(r.body["masked_email"]).toBe("a***@g***.com");
    // the alias is used server-side only
    expect(w.signUps[0]?.email).toBe("asha.private+u_alias@gmail.com");
    expect(w.signUps[0]?.meta["contact_email"]).toBe("asha.private@gmail.com");
  });

  it("says plainly when the username is taken (usernames are public)", async () => {
    const w = makeWorld();
    const r = await w.call({ ...base, email: "x@x.com", username: "asha_01" });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "username_taken" });
  });

  it("rejects bad input before touching anything", async () => {
    const w = makeWorld();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, email: "x@x.com", username: "ab" }, "invalid_username"],
      [{ ...base, email: "nope", username: "okname" }, "invalid_email"],
      [{ ...base, email: "x@x.com", username: "okname", full_name: "  " }, "invalid_name"],
      [{ ...base, email: "x@x.com", username: "okname", password: "short" }, "weak_password"],
      [{ ...base, email: "x@x.com", username: "okname", password: "Password123" }, "weak_password"],
      [
        { ...base, email: "x@x.com", username: "okname", redirect_to: "https://evil.example/" },
        "invalid_redirect",
      ],
    ];
    for (const [body, error] of cases) {
      const r = await w.call(body);
      expect(r.status).toBe(400);
      expect(r.body["error"]).toBe(error);
    }
    expect(w.signUps).toHaveLength(0);
  });

  it("rate limits per address and per mailbox", async () => {
    const w = makeWorld();
    const same = { ...base, email: "spam@x.com", username: "spam_user" };
    for (let i = 0; i < LIMITS.signup.email.limit; i++) {
      expect((await w.call(same, { ip: `198.51.100.${i + 1}` })).status).toBe(200);
    }
    expect((await w.call(same, { ip: "198.51.100.200" })).status).toBe(429);

    const w2 = makeWorld();
    for (let i = 0; i < LIMITS.signup.ip.limit; i++) {
      await w2.call({ ...base, email: `p${i}@x.com`, username: `person_${i + 10}` });
    }
    expect((await w2.call({ ...base, email: "late@x.com", username: "late_one" })).status).toBe(
      429,
    );
  });

  it("returns the session when the project has email confirmation switched off", async () => {
    const w = makeWorld({ confirmationOff: true });
    const r = await w.call({ ...base, email: "ok@x.com", username: "ok_user" });
    expect(r.status).toBe(200);
    expect(r.body["needs_verification"]).toBe(false);
    expect(r.body["session"]).toMatchObject({ access_token: "AT3" });
  });

  it("maps upstream trouble to safe answers", async () => {
    const w = makeWorld();
    w.setUpstream({ status: 429, code: "over_email_send_rate_limit" });
    expect((await w.call({ ...base, email: "a@x.com", username: "user_aa" })).status).toBe(429);
    w.setUpstream({ status: 500, code: "unexpected_failure" });
    const r = await w.call(
      { ...base, email: "b@x.com", username: "user_bb" },
      { ip: "198.51.100.8" },
    );
    expect(r.status).toBe(409); // the database refused the name (it was just taken)
  });
});

// ---------------------------------------------------------------------------------------------
describe("verify and resend", () => {
  it("verifies by username and returns a session, never the email", async () => {
    const w = makeWorld();
    const r = await w.call({ action: "verify", username: "newbie_02", code: "123456" });
    expect(r.status).toBe(200);
    expect(r.body["session"]).toMatchObject({ access_token: "AT2" });
    noEmailIn(r.body);
  });

  it("answers a wrong code and an unknown username the same way", async () => {
    const w = makeWorld();
    const wrong = await w.call({ action: "verify", username: "newbie_02", code: "000000" });
    const ghost = await w.call({ action: "verify", username: "ghost_99", code: "000000" });
    expect(wrong.status).toBe(400);
    expect(ghost.body).toEqual(wrong.body);
  });

  it("locks guessing after 5 wrong codes, even for the right one", async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) {
      expect(
        (await w.call({ action: "verify", username: "newbie_02", code: `00000${i}` })).status,
      ).toBe(400);
    }
    const r = await w.call({ action: "verify", username: "newbie_02", code: "123456" });
    expect(r.status).toBe(429);
    w.advance(61_000);
    expect((await w.call({ action: "verify", username: "newbie_02", code: "123456" })).status).toBe(
      200,
    );
  });

  it("refuses codes that are not six digits", async () => {
    const w = makeWorld();
    for (const code of ["12345", "1234567", "abcdef", "", "12 456"]) {
      expect((await w.call({ action: "verify", username: "newbie_02", code })).status).toBe(400);
    }
  });

  it("resends silently and says the same thing for unknown usernames", async () => {
    const w = makeWorld();
    const known = await w.call({ action: "resend", username: "newbie_02" });
    const unknown = await w.call({ action: "resend", username: "ghost_99" });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(w.mails.map((m) => m.to)).toEqual(["newbie.secret@outlook.com"]);
    noEmailIn(known.body);
  });

  it("limits resends per account", async () => {
    const w = makeWorld();
    for (let i = 0; i < LIMITS.resend.user.limit; i++) {
      expect(
        (await w.call({ action: "resend", username: "newbie_02" }, { ip: `198.51.100.${i + 1}` }))
          .status,
      ).toBe(200);
    }
    expect(
      (await w.call({ action: "resend", username: "newbie_02" }, { ip: "198.51.100.99" })).status,
    ).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------
describe("password reset", () => {
  const reset = (identifier: string, extra: Record<string, unknown> = {}, ip?: string) =>
    makeWorldCall(identifier, extra, ip);
  let world: ReturnType<typeof makeWorld>;
  function makeWorldCall(identifier: string, extra: Record<string, unknown>, ip?: string) {
    return world.call({ action: "request_reset", identifier, ...extra }, ip ? { ip } : {});
  }

  it("gives the same answer for known, unknown, username and email identifiers", async () => {
    world = makeWorld();
    const answers = [
      await reset("asha_01"),
      await reset("@ghost_99"),
      await reset("asha.private@gmail.com"),
      await reset("nobody@nowhere.com"),
    ];
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ ok: true });
    }
    // mail goes only to real accounts
    expect(world.mails.map((m) => m.to)).toEqual([
      "asha.private@gmail.com",
      "asha.private@gmail.com",
    ]);
    for (const a of answers) noEmailIn(a.body);
  });

  it("points the emailed link at our own site by default", async () => {
    world = makeWorld();
    await reset("asha_01");
    expect(world.mails[0]?.redirectTo).toBe(`${SITE}/reset-password`);
    await reset("newbie_02", { redirect_to: "sabzone://reset-password" });
    expect(world.mails[1]?.redirectTo).toBe("sabzone://reset-password");
  });

  it("refuses a link that points anywhere else, and sends nothing", async () => {
    world = makeWorld();
    for (const evil of [
      "https://evil.example/reset-password",
      "https://sabzone.onrender.com@evil.example/",
      "javascript:alert(1)",
    ]) {
      const r = await reset("asha_01", { redirect_to: evil });
      expect(r.status).toBe(400);
    }
    expect(world.mails).toHaveLength(0);
  });

  it("limits how often one account can be mailed, without saying whether it exists", async () => {
    world = makeWorld();
    for (let i = 0; i < LIMITS.reset.target.limit; i++) {
      expect((await reset("asha_01", {}, `198.51.100.${i + 1}`)).status).toBe(200);
    }
    const blocked = await reset("asha_01", {}, "198.51.100.99");
    const blockedUnknown = await world.call(
      { action: "request_reset", identifier: "ghost_77" },
      { ip: "198.51.100.98" },
    );
    expect(blocked.status).toBe(429);
    expect(blockedUnknown.status).toBe(200); // unknown targets are not special: first request is fine
    expect(world.mails).toHaveLength(LIMITS.reset.target.limit);
  });

  it("limits one address", async () => {
    world = makeWorld();
    for (let i = 0; i < LIMITS.reset.ip.limit; i++) await reset(`person_${i + 10}`);
    expect((await reset("asha_01")).status).toBe(429);
  });

  it("never mails more than three accounts from one request", async () => {
    world = makeWorld();
    const many = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
    const original = world.users;
    original.clear();
    // five accounts on one mailbox cannot exist in practice; the cap is a safety net
    const gw = createGateway({
      ...(makeWorldDeps(many) as Deps),
    });
    const r = await gw.handle({
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.5" },
      rawBody: JSON.stringify({ action: "request_reset", identifier: "box@x.com" }),
    });
    expect(r.status).toBe(200);
    expect(sentTo).toHaveLength(3);
  });
});

let sentTo: string[] = [];
function makeWorldDeps(targets: string[]): Deps {
  sentTo = [];
  const w = makeWorld();
  // reuse a fresh world's plumbing but override the reset behaviour
  const base = createGatewayDeps(w);
  return {
    ...base,
    directory: { ...base.directory, resetTargets: async () => targets },
    auth: {
      ...base.auth,
      resetForEmail: async (email) => {
        sentTo.push(email);
        return { error: null };
      },
    },
  };
}
function createGatewayDeps(w: ReturnType<typeof makeWorld>): Deps {
  // A minimal, independent set of dependencies (always-allow limiter) for the cap test.
  void w;
  return {
    now: () => 0,
    sleep: async () => {},
    hash: (l, v) => keyHash(SECRET, l, v),
    limiter: { hit: async () => ({ allowed: true, retryAfter: 0 }) },
    locks: {
      status: async () => ({ locked: false, retryAfter: 0 }),
      fail: async () => ({ locked: false, retryAfter: 0 }),
      clear: async () => {},
    },
    directory: {
      loginEmail: async () => null,
      resetTargets: async () => [],
      planSignup: async () => ({ ok: true }),
      usernameFree: async () => true,
    },
    auth: {
      signIn: async () => ({ session: null, error: null }),
      signUp: async () => ({ session: null, error: null }),
      verifyOtp: async () => ({ session: null, error: null }),
      resend: async () => ({ error: null }),
      resetForEmail: async () => ({ error: null }),
    },
    config: { allowedOrigins: [SITE], defaultRedirectOrigin: SITE },
    log: () => {},
  };
}

// ---------------------------------------------------------------------------------------------
describe("username check", () => {
  it("reports availability and limits probing", async () => {
    const w = makeWorld();
    expect((await w.call({ action: "username_available", username: "asha_01" })).body).toEqual({
      available: false,
    });
    expect((await w.call({ action: "username_available", username: "free_one" })).body).toEqual({
      available: true,
    });
    expect((await w.call({ action: "username_available", username: "no" })).body).toEqual({
      available: false,
    });
    for (let i = 0; i < LIMITS.usernameCheck.ip.limit; i++)
      await w.call({ action: "username_available", username: "free_one" });
    expect((await w.call({ action: "username_available", username: "free_one" })).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the front door", () => {
  it("answers browser preflights only for our own origins", async () => {
    const w = makeWorld();
    const ok = await w.call(null, { method: "OPTIONS", origin: SITE, raw: "" });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(SITE);
    const app = await w.call(null, { method: "OPTIONS", origin: "https://localhost", raw: "" });
    expect(app.status).toBe(204);
    const evil = await w.call(
      { action: "login", username: "asha_01", password: PW },
      { origin: "https://evil.example" },
    );
    expect(evil.status).toBe(403);
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("only accepts POST, small JSON objects and known actions", async () => {
    const w = makeWorld();
    expect((await w.call(null, { method: "GET", raw: "" })).status).toBe(405);
    expect((await w.call(null, { raw: "{not json" })).status).toBe(400);
    expect((await w.call(null, { raw: "[1,2]" })).status).toBe(400);
    expect(
      (await w.call(null, { raw: JSON.stringify({ action: "login", pad: "x".repeat(5000) }) }))
        .status,
    ).toBe(413);
    expect((await w.call({ action: "delete_everything" })).status).toBe(400);
    expect((await w.call({})).status).toBe(400);
  });

  it("marks every answer as not cacheable", async () => {
    const w = makeWorld();
    const r = await w.login("asha_01", PW);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("refuses to work when the counters are unreachable (fails closed)", async () => {
    const w = makeWorld({ limiterFails: true });
    const r = await w.login("asha_01", PW);
    expect(r.status).toBe(503);
    expect(w.signInCalls).toHaveLength(0);
    expect((await w.call({ action: "request_reset", identifier: "asha_01" })).status).toBe(503);
    expect(w.mails).toHaveLength(0);
  });

  it("reports a failed lookup as a temporary problem, not as a wrong password", async () => {
    const w = makeWorld({ directoryFails: true });
    expect((await w.login("asha_01", PW)).status).toBe(503);
  });

  it("writes no emails, usernames, passwords or codes to the logs", async () => {
    const w = makeWorld();
    await w.login("asha_01", "wrong-password-1");
    await w.login("asha_01", PW);
    await w.call({ action: "verify", username: "newbie_02", code: "999999" });
    await w.call({ action: "request_reset", identifier: "asha.private@gmail.com" });
    await w.call({
      action: "signup",
      email: "z@x.com",
      username: "zeta_one",
      full_name: "Z",
      password: "blue-Tiger-42",
    });
    const all = w.logs.join("\n").toLowerCase();
    expect(w.logs.length).toBeGreaterThan(0);
    for (const secret of [
      "asha_01",
      "newbie_02",
      "zeta_one",
      "asha.private",
      "z@x.com",
      "wrong-password-1",
      "blue-tiger-42",
      "999999",
      "203.0.113.5",
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});
