import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc, maybeSingle } = vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
  return {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      setSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
    rpc: vi.fn(),
    maybeSingle: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth,
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

import { AuthProvider, useAuth } from "@/lib/auth";

const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={testQueryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
);

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string);
const SESSION = { access_token: "a", refresh_token: "r" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } });
  auth.setSession.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

async function ready() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

type Res = { error: string | null };
const newUser = {
  email: "a@b.co",
  password: "Password1",
  fullName: " Basava J ",
  username: "Basava_2005",
};

describe("AuthContext", () => {
  it("finishes loading with no user when logged out", async () => {
    const { result } = await ready();
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it("refuses an email: log-in is by username only", async () => {
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("me@x.com", "pw123456");
    });
    expect(res?.error).toMatch(/username, not your email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs in through the gateway with a username (with or without @) and never touches the email", async () => {
    reply(200, { ok: true, session: SESSION });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("@Basava_2005", "pw123456");
    });
    expect(res?.error).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://x.supabase.co/functions/v1/auth-gateway");
    expect(lastBody()).toEqual({ action: "login", username: "basava_2005", password: "pw123456" });
    expect(auth.setSession).toHaveBeenCalledWith(SESSION);
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows one generic message for wrong credentials", async () => {
    reply(401, { error: "invalid_credentials" });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("susheel_08", "wrongpass");
    });
    expect(res?.error).toBe("Incorrect username or password.");
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("tells the person how long to wait when locked out", async () => {
    reply(429, { error: "too_many_attempts", retry_after: 300 });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("susheel_08", "x");
    });
    expect(res?.error).toMatch(/Too many attempts.*5 minutes/);
  });

  it("sends an unverified account to the code page using only a hidden address", async () => {
    reply(403, { error: "email_not_verified", username: "bas", masked_email: "b***@g***.com" });
    const { result } = await ready();
    let res: { verifyUsername?: string; maskedEmail?: string } | undefined;
    await act(async () => {
      res = await result.current.signIn("bas", "pw123456");
    });
    expect(res).toMatchObject({ verifyUsername: "bas", maskedEmail: "b***@g***.com" });
  });

  it("reports a network failure without leaking anything", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("bas", "pw123456");
    });
    expect(res?.error).toMatch(/Can't reach SabZone/);
  });

  it("sign-up goes through the gateway with a lowercase username and asks for verification", async () => {
    reply(200, {
      ok: true,
      needs_verification: true,
      username: "basava_2005",
      masked_email: "a***@b***.co",
    });
    const { result } = await ready();
    let res: unknown;
    await act(async () => {
      res = await result.current.signUp(newUser);
    });
    expect(lastBody()).toMatchObject({
      action: "signup",
      email: "a@b.co",
      full_name: "Basava J",
      username: "basava_2005",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({
      error: null,
      needsVerification: true,
      verifyUsername: "basava_2005",
      maskedEmail: "a***@b***.co",
    });
  });

  it("sign-up skips verification when the gateway returns a session (confirmation off)", async () => {
    reply(200, { ok: true, session: SESSION });
    const { result } = await ready();
    let res: { needsVerification: boolean } | undefined;
    await act(async () => {
      res = await result.current.signUp(newUser);
    });
    expect(res?.needsVerification).toBe(false);
    expect(auth.setSession).toHaveBeenCalledWith(SESSION);
  });

  it("explains why a sign-up was refused", async () => {
    const { result } = await ready();
    for (const [status, body, text] of [
      [409, { error: "username_taken" }, /already taken/],
      [400, { error: "weak_password", reason: "too_short" }, /at least 8/],
      [400, { error: "invalid_email" }, /valid email/],
      [429, { error: "too_many_attempts", retry_after: 3600 }, /1 hour/],
    ] as const) {
      reply(status, body);
      let res: Res | undefined;
      await act(async () => {
        res = await result.current.signUp(newUser);
      });
      expect(res?.error).toMatch(text);
    }
  });

  it("does not report loaded until the logged-in user's profile has been fetched", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    maybeSingle.mockResolvedValue({
      data: { id: "u1", username: "bas", onboarding_completed: true },
      error: null,
    });
    const { result } = await ready();
    expect(result.current.profile?.username).toBe("bas");
  });
});
