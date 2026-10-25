import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedRow } from "@/integrations/supabase/types";

const { togglePostLike } = vi.hoisted(() => ({ togglePostLike: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
      <a href={String(to)}>{children}</a>
    ),
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "viewer" }, profile: null }),
}));
vi.mock("@/lib/use-saved", () => ({
  useSaved: () => ({ isSaved: () => false, isPending: () => false, toggle: vi.fn() }),
}));
vi.mock("@/lib/post-shares", () => ({
  shareCountKey: (id: string) => ["post-share-count", id],
  useShareCount: () => 0,
}));
vi.mock("@/lib/post-cache", () => ({ togglePostLike }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PostCard } from "@/components/post-card";

const photoPost = (): FeedRow =>
  ({
    id: "post-1",
    author_id: "author",
    content: "a photo",
    image_url: "https://cdn.example/p.jpg",
    audience: "Public",
    created_at: new Date().toISOString(),
    author_name: "Ana Author",
    author_username: "ana",
    author_avatar: null,
    author_account_type: "personal",
    like_count: 2,
    comment_count: 0,
    liked_by_me: false,
    media_type: "image",
    video_url: null,
    thumbnail_url: null,
    duration_seconds: null,
  }) as FeedRow;

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PostCard post={photoPost()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  togglePostLike.mockResolvedValue(undefined);
});

describe("PostCard likes", () => {
  it("double-clicking the photo likes it once and raises the counter", async () => {
    renderCard();
    const photo = screen.getByRole("button", { name: "Open photo" });
    fireEvent.click(photo);
    fireEvent.click(photo);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unlike, 3 likes" })).toBeInTheDocument(),
    );
    expect(togglePostLike).toHaveBeenCalledTimes(1);
    expect(togglePostLike.mock.calls[0]![3]).toBe(true);
    // a third quick double-click on an already liked photo keeps it liked
    fireEvent.click(photo);
    fireEvent.click(photo);
    expect(screen.getByRole("button", { name: "Unlike, 3 likes" })).toBeInTheDocument();
  });

  it("single click on the heart toggles; double-click on the heart ends up liked", async () => {
    renderCard();
    const heart = screen.getByRole("button", { name: "Like, 2 likes" });
    fireEvent.click(heart);
    fireEvent.click(heart);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unlike, 3 likes" })).toBeInTheDocument(),
    );
    const icon = screen.getByRole("button", { name: "Unlike, 3 likes" }).querySelector("svg");
    expect(icon?.getAttribute("class")).toMatch(/fill-red-500/);
  });
});
