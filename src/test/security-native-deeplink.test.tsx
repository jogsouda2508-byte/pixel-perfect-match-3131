import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  urlListener: null as null | ((e: { url: string }) => Promise<void>),
  setSession: vi.fn(),
  exchange: vi.fn(),
  closeBrowser: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (event: string, fn: (e: { url: string }) => Promise<void>) => {
      if (event === "appUrlOpen") h.urlListener = fn;
      return { remove: () => {} };
    },
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: h.closeBrowser, open: vi.fn() } }));
vi.mock("@/lib/push", () => ({ removePushOnLogout: async () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      setSession: h.setSession,
      exchangeCodeForSession: h.exchange,
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

import { AuthProvider, useAuth } from "@/lib/auth";
import { markNativeAuthPending } from "@/lib/auth-redirect";

const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";
const REFRESH = "attackerRefreshToken1";
const CALLBACK = `sabzone://auth-callback#access_token=${ACCESS}&refresh_token=${REFRESH}`;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

async function mount() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(h.urlListener).not.toBeNull());
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  h.urlListener = null;
  vi.clearAllMocks();
  h.setSession.mockResolvedValue({ error: null });
  h.exchange.mockResolvedValue({ error: null });
});

describe("sabzone:// callbacks cannot sign the victim in to someone else's account", () => {
  it("ignores a perfectly formed callback the app never asked for (login CSRF)", async () => {
    await mount();
    await h.urlListener!({ url: CALLBACK });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.closeBrowser).not.toHaveBeenCalled();
  });

  it("accepts the callback of a Google sign-in the app started, exactly once", async () => {
    await mount();
    markNativeAuthPending("auth");
    await h.urlListener!({ url: CALLBACK });
    expect(h.setSession).toHaveBeenCalledWith({ access_token: ACCESS, refresh_token: REFRESH });
    await h.urlListener!({ url: CALLBACK }); // replayed
    expect(h.setSession).toHaveBeenCalledTimes(1);
  });

  it("a pending Google sign-in does not authorise a password-reset callback, or the reverse", async () => {
    await mount();
    markNativeAuthPending("auth");
    await h.urlListener!({
      url: `sabzone://reset-password#access_token=${ACCESS}&refresh_token=${REFRESH}`,
    });
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE code only while a sign-in is pending", async () => {
    await mount();
    await h.urlListener!({ url: "sabzone://auth-callback?code=abcdef123456" });
    expect(h.exchange).not.toHaveBeenCalled();
    markNativeAuthPending("auth");
    await h.urlListener!({ url: "sabzone://auth-callback?code=abcdef123456" });
    expect(h.exchange).toHaveBeenCalledWith("abcdef123456");
  });

  it("does not even consume the pending flag for a malformed or look-alike link", async () => {
    await mount();
    markNativeAuthPending("auth");
    for (const url of [
      `sabzone://auth-callback.evil.example#access_token=${ACCESS}&refresh_token=${REFRESH}`,
      "sabzone://auth-callback#access_token=<script>&refresh_token=x",
      "https://evil.example/#access_token=a&refresh_token=b",
      "sabzone://other",
    ])
      await h.urlListener!({ url });
    expect(h.setSession).not.toHaveBeenCalled();
    // the real callback still works afterwards
    await h.urlListener!({ url: CALLBACK });
    expect(h.setSession).toHaveBeenCalledTimes(1);
  });
});
