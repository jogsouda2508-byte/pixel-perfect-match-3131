import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, setSession } = vi.hoisted(() => ({ invoke: vi.fn(), setSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, auth: { setSession } },
}));

import { loginWithUsername, requestPasswordReset } from "@/lib/auth-lookup";

const httpError = (status: number, body: unknown = {}) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status }) },
});

beforeEach(() => {
  vi.clearAllMocks();
  setSession.mockResolvedValue({ error: null });
});

describe("loginWithUsername", () => {
  it("sends only the username and password, and stores the returned session", async () => {
    invoke.mockResolvedValue({
      data: { session: { access_token: "a", refresh_token: "r" } },
      error: null,
    });
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "ok" });
    expect(invoke).toHaveBeenCalledWith("auth-lookup", {
      body: { action: "login", username: "alice", password: "pw" },
    });
    expect(setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "r" });
  });
  it("401 -> invalid (same for unknown name and wrong password)", async () => {
    invoke.mockResolvedValue(httpError(401, { error: "invalid_credentials" }));
    expect(await loginWithUsername("alice", "bad")).toEqual({ kind: "invalid" });
    expect(setSession).not.toHaveBeenCalled();
  });
  it("403 not confirmed -> unverified with the email to resend to", async () => {
    invoke.mockResolvedValue(httpError(403, { error: "email_not_confirmed", email: "a@x.com" }));
    expect(await loginWithUsername("alice", "pw")).toEqual({
      kind: "unverified",
      email: "a@x.com",
    });
  });
  it("429 -> limited", async () => {
    invoke.mockResolvedValue(httpError(429, { error: "rate_limited" }));
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "limited" });
  });
  it("404 (function not deployed yet) -> unavailable so the caller can fall back", async () => {
    invoke.mockResolvedValue(httpError(404));
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "unavailable" });
  });
  it("a server error or a network failure is an error, NOT a fallback", async () => {
    invoke.mockResolvedValue(httpError(502, { error: "unavailable" }));
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "error" });
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to send a request") });
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "error" });
    invoke.mockRejectedValue(new Error("boom"));
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "error" });
  });
  it("a 200 without a usable session is an error, and setSession failing is an error", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "error" });
    invoke.mockResolvedValue({
      data: { session: { access_token: "a", refresh_token: "r" } },
      error: null,
    });
    setSession.mockResolvedValue({ error: new Error("bad token") });
    expect(await loginWithUsername("alice", "pw")).toEqual({ kind: "error" });
  });
});

describe("requestPasswordReset", () => {
  it("ok on 200, limited on 429, unavailable on 404, error otherwise", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await requestPasswordReset("bob", "https://a/r")).toEqual({ kind: "ok" });
    expect(invoke).toHaveBeenCalledWith("auth-lookup", {
      body: { action: "reset", identifier: "bob", redirectTo: "https://a/r" },
    });
    invoke.mockResolvedValue(httpError(429));
    expect(await requestPasswordReset("bob", "x")).toEqual({ kind: "limited" });
    invoke.mockResolvedValue(httpError(404));
    expect(await requestPasswordReset("bob", "x")).toEqual({ kind: "unavailable" });
    invoke.mockResolvedValue(httpError(500));
    expect(await requestPasswordReset("bob", "x")).toEqual({ kind: "error" });
  });
});
