import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSavedIds, setSaved } = vi.hoisted(() => ({
  fetchSavedIds: vi.fn(),
  setSaved: vi.fn(),
}));

vi.mock("@/lib/social", () => ({ fetchSavedIds, setSaved }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useSaved } from "@/lib/use-saved";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSaved(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSavedIds.mockResolvedValue([]);
  setSaved.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10)));
});

describe("useSaved", () => {
  it("saves a post and marks it saved", async () => {
    const { result } = setup();
    await waitFor(() => expect(fetchSavedIds).toHaveBeenCalled());
    await act(async () => {});

    await act(async () => {
      await result.current.toggle("post-1");
    });

    expect(setSaved).toHaveBeenCalledWith("me", "post-1", true);
    expect(result.current.isSaved("post-1")).toBe(true);
  });

  it("ignores a second click while the first request is still running", async () => {
    const { result } = setup();
    await waitFor(() => expect(fetchSavedIds).toHaveBeenCalled());
    await act(async () => {});

    await act(async () => {
      const first = result.current.toggle("post-1");
      const second = result.current.toggle("post-1");
      await Promise.all([first, second]);
    });

    expect(setSaved).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("post-1")).toBe(false);
  });

  it("rolls back when saving fails", async () => {
    setSaved.mockRejectedValue(new Error("network"));
    const { result } = setup();
    await waitFor(() => expect(fetchSavedIds).toHaveBeenCalled());
    await act(async () => {});

    await act(async () => {
      await result.current.toggle("post-1");
    });

    expect(result.current.isSaved("post-1")).toBe(false);
  });
});
