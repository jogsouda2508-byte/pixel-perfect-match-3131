import { describe, expect, it } from "vitest";
import {
  clientKey,
  LIMITS,
  looksLikeEmail,
  normalizeIdentifier,
  normalizeUsername,
  parseRequest,
  resetTargets,
  safeRedirect,
} from "../../supabase/functions/auth-lookup/logic";

describe("normalizeUsername", () => {
  it("lower-cases, trims and drops ONE leading @", () => {
    expect(normalizeUsername("  @Alice ")).toBe("alice");
    expect(normalizeUsername("@@alice")).toBe("@alice"); // second @ is not a valid username char
  });
});

describe("parseRequest: login", () => {
  it("accepts a valid username + password", () => {
    expect(parseRequest({ action: "login", username: "@Alice_1", password: "pw" })).toEqual({
      action: "login",
      username: "alice_1",
      password: "pw",
    });
  });
  it.each([
    [{ action: "login", username: "al", password: "pw" }], // too short
    [{ action: "login", username: "a".repeat(21), password: "pw" }],
    [{ action: "login", username: "alice@x.com", password: "pw" }], // emails are not usernames
    [{ action: "login", username: "ali ce", password: "pw" }],
    [{ action: "login", username: "alice", password: "" }],
    [{ action: "login", username: "alice", password: "x".repeat(201) }],
    [{ action: "login", username: "alice" }],
    [{ action: "login", username: 5, password: "pw" }],
  ])("rejects %j", (body) => {
    expect(parseRequest(body)).toBeNull();
  });
  it("never trims the password", () => {
    expect(parseRequest({ action: "login", username: "alice", password: " pw " })).toMatchObject({
      password: " pw ",
    });
  });
});

describe("parseRequest: reset", () => {
  it("accepts an email or username and normalises it", () => {
    expect(parseRequest({ action: "reset", identifier: "  Bob@Mail.COM " })).toEqual({
      action: "reset",
      identifier: "bob@mail.com",
    });
    expect(parseRequest({ action: "reset", identifier: "@bob" })).toMatchObject({
      identifier: "@bob",
    });
  });
  it("keeps a safe redirect and drops an unsafe one", () => {
    expect(
      parseRequest({ action: "reset", identifier: "bob", redirectTo: "https://app.example/reset" }),
    ).toMatchObject({ redirectTo: "https://app.example/reset" });
    const r = parseRequest({
      action: "reset",
      identifier: "bob",
      redirectTo: "javascript:alert(1)",
    });
    expect(r).toEqual({ action: "reset", identifier: "bob" });
  });
  it("rejects junk", () => {
    expect(parseRequest({ action: "reset" })).toBeNull();
    expect(parseRequest({ action: "reset", identifier: "a" })).toBeNull();
    expect(parseRequest({ action: "nope" })).toBeNull();
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest("login")).toBeNull();
    expect(normalizeIdentifier("x".repeat(400))).toHaveLength(254);
  });
});

describe("safeRedirect", () => {
  it("allows web addresses and the app's own scheme", () => {
    expect(safeRedirect("https://a.example/x")).toBe("https://a.example/x");
    expect(safeRedirect("http://localhost:3000/reset")).toBe("http://localhost:3000/reset");
    expect(safeRedirect("sabzone://reset-password")).toBe("sabzone://reset-password");
  });
  it.each(["javascript:alert(1)", "data:text/html,hi", "ftp://x", "not a url", "", 5, undefined])(
    "drops %j",
    (v) => expect(safeRedirect(v)).toBeUndefined(),
  );
  it("drops very long values", () => {
    expect(safeRedirect("https://a.example/" + "x".repeat(600))).toBeUndefined();
  });
});

describe("clientKey", () => {
  const h = (v: Record<string, string>) => ({ get: (k: string) => v[k] ?? null });
  it("uses the first forwarded address", () => {
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to one shared bucket instead of no limit", () => {
    expect(clientKey(h({}))).toBe("unknown");
    expect(clientKey(h({ "x-forwarded-for": "x".repeat(200) }))).toBe("unknown");
  });
});

describe("resetTargets", () => {
  it("uses what the lookup found, de-duplicated, at most 3", () => {
    expect(resetTargets("bob", ["a@x.com", "a@x.com", "b@x.com", "c@x.com", "d@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
  it("falls back to the typed email, never to a typed username", () => {
    expect(resetTargets("me@x.com", [])).toEqual(["me@x.com"]);
    expect(resetTargets("me@x.com", null)).toEqual(["me@x.com"]);
    expect(resetTargets("bob", [])).toEqual([]);
    expect(resetTargets("@bob", [])).toEqual([]);
  });
  it("ignores non-string junk from the database", () => {
    expect(resetTargets("bob", [1, null, "a@x.com"])).toEqual(["a@x.com"]);
  });
  it("looksLikeEmail", () => {
    expect(looksLikeEmail("a@b.c")).toBe(true);
    expect(looksLikeEmail("@name")).toBe(false);
    expect(looksLikeEmail("name")).toBe(false);
  });
});

describe("LIMITS", () => {
  it("guessing a password is limited much harder than a normal visit", () => {
    expect(LIMITS.loginPerName.max).toBeLessThanOrEqual(10);
    expect(LIMITS.resetPerIdentifier.max).toBeLessThanOrEqual(5);
    expect(LIMITS.resetPerIdentifier.windowSeconds).toBeGreaterThanOrEqual(3600);
  });
});
