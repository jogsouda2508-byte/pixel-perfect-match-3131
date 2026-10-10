import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc, maybeSingle } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    signInWithOAuth: vi.fn(),
  },
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth,
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

import { AuthProvider, useAuth } from "@/lib/auth";

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } });
});

async function ready() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

type Res = { error: string | null };

describe("AuthContext", () => {
  it("finishes loading with no user when logged out", async () => {
    const { result } = await ready();
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it("logs in with an email directly", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("  me@x.com ", "pw123456");
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "me@x.com",
      password: "pw123456",
    });
    expect(res?.error).toBeNull();
  });

  it("looks up the email when logging in with a username (with or without @)", async () => {
    rpc.mockResolvedValue({ data: "found@x.com", error: null });
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const { result } = await ready();
    await act(async () => {
      await result.current.signIn("@Basava_2005", "pw123456");
    });
    expect(rpc).toHaveBeenCalledWith("get_login_email", { p_username: "basava_2005" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "found@x.com",
      password: "pw123456",
    });
  });

  it("gives a generic error for an unknown username", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("ghost", "pw123456");
    });
    expect(res?.error).toMatch(/Incorrect/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows a friendly message for wrong credentials", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials", code: "invalid_credentials" },
    });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signIn("me@x.com", "wrongpass");
    });
    expect(res?.error).toBe("Incorrect email/username or password.");
  });

  it("sign-up sends full_name + lowercase username as metadata and asks for verification", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{}] }, session: null },
      error: null,
    });
    const { result } = await ready();
    let res: (Res & { needsVerification: boolean }) | undefined;
    await act(async () => {
      res = await result.current.signUp({
        email: "a@b.co",
        password: "Password1",
        fullName: " Basava J ",
        username: "Basava_2005",
      });
    });
    expect(auth.signUp.mock.calls[0]?.[0].options.data).toEqual({
      full_name: "Basava J",
      username: "basava_2005",
    });
    expect(res).toEqual({ error: null, needsVerification: true });
  });

  it("sign-up skips verification when a session is returned (email confirmation off)", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{}] }, session: { user: { id: "u1" } } },
      error: null,
    });
    const { result } = await ready();
    let res: { needsVerification: boolean } | undefined;
    await act(async () => {
      res = await result.current.signUp({
        email: "a@b.co",
        password: "Password1",
        fullName: "B",
        username: "bas",
      });
    });
    expect(res?.needsVerification).toBe(false);
  });

  it("detects an already-registered email (Supabase returns no identities)", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    const { result } = await ready();
    let res: Res | undefined;
    await act(async () => {
      res = await result.current.signUp({
        email: "a@b.co",
        password: "Password1",
        fullName: "B",
        username: "bas",
      });
    });
    expect(res?.error).toMatch(/already registered/);
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
