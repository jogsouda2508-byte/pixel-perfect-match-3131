import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { setSession: vi.fn() } } }));

import {
  callGateway,
  checkUsernameAvailable,
  gatewayProblem,
  tokensFrom,
  waitText,
} from "@/lib/auth-gateway";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("auth-gateway client", () => {
  it("posts the action with the public key only", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await callGateway("resend", { username: "bas" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ action: "resend", username: "bas" });
    expect(init.headers.authorization).toBe("Bearer anon-key");
  });

  it("treats a thrown fetch as status 0 and a non-JSON body as empty", async () => {
    fetchMock.mockRejectedValueOnce(new Error("x"));
    expect((await callGateway("login")).status).toBe(0);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("html");
      },
    });
    expect(await callGateway("login")).toEqual({ ok: false, status: 502, data: {} });
  });

  it("maps availability answers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ available: true }),
    });
    expect(await checkUsernameAvailable("a")).toBe("available");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ available: false }),
    });
    expect(await checkUsernameAvailable("a")).toBe("taken");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    expect(await checkUsernameAvailable("a")).toBe("error");
  });

  it("only accepts a session made of two strings", () => {
    const mk = (session: unknown) => ({ ok: true, status: 200, data: { session } });
    expect(tokensFrom(mk({ access_token: "a", refresh_token: "r" }))).toEqual({
      access_token: "a",
      refresh_token: "r",
    });
    expect(tokensFrom(mk({ access_token: "a" }))).toBeNull();
    expect(tokensFrom(mk(null))).toBeNull();
  });

  it("words problems and waits clearly", () => {
    expect(gatewayProblem({ ok: false, status: 429, data: { retry_after: 120 } }, "f")).toMatch(
      /2 minutes/,
    );
    expect(gatewayProblem({ ok: false, status: 500, data: {} }, "f")).toMatch(/moment/);
    expect(gatewayProblem({ ok: false, status: 400, data: {} }, "fallback")).toBe("fallback");
    expect(waitText(1)).toBe("1 second");
    expect(waitText(3600)).toBe("1 hour");
  });
});
