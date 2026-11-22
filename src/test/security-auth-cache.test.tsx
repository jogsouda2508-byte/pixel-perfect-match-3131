import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  getSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: h.getSession,
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        h.listener = fn;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

import { AuthProvider, useAuth } from "@/lib/auth";

const sessionFor = (id: string) => ({
  user: { id, app_metadata: {}, user_metadata: {} },
  access_token: `t-${id}`,
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  queryClient = new QueryClient();
  h.listener = null;
  h.getSession.mockResolvedValue({ data: { session: sessionFor("alice") } });
});

async function mount() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(h.listener).not.toBeNull());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("cached data never leaks from one account to the next", () => {
  it("clears the cache when the signed-in user changes", async () => {
    await mount();
    queryClient.setQueryData(["feed"], ["alice's private feed"]);
    act(() => h.listener!("SIGNED_IN", sessionFor("bob")));
    expect(queryClient.getQueryData(["feed"])).toBeUndefined();
  });
  it("clears the cache on sign-out", async () => {
    await mount();
    queryClient.setQueryData(["chats"], ["alice's chats"]);
    act(() => h.listener!("SIGNED_OUT", null));
    expect(queryClient.getQueryData(["chats"])).toBeUndefined();
  });
  it("keeps the cache for the same user (token refresh, tab focus)", async () => {
    await mount();
    queryClient.setQueryData(["feed"], ["alice's feed"]);
    act(() => h.listener!("TOKEN_REFRESHED", sessionFor("alice")));
    act(() => h.listener!("SIGNED_IN", sessionFor("alice")));
    expect(queryClient.getQueryData(["feed"])).toEqual(["alice's feed"]);
  });
});
