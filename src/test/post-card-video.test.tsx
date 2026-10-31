import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedRow } from "@/integrations/supabase/types";

const { saveState, followList, shareVideoWithUser } = vi.hoisted(() => ({
  saveState: { saved: false },
  followList: { people: [] as unknown[] },
  shareVideoWithUser: vi.fn(),
}));

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
  useSaved: () => ({
    isSaved: () => saveState.saved,
    isPending: () => false,
    toggle: vi.fn(),
  }),
}));
vi.mock("@/lib/social", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social")>();
  return { ...actual, fetchFollowList: async () => followList.people };
});
vi.mock("@/lib/video-share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/video-share")>();
  return { ...actual, shareVideoWithUser };
});
vi.mock("@/lib/post-shares", () => ({
  shareCountKey: (id: string) => ["post-share-count", id],
  useShareCount: () => 158,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PostCard } from "@/components/post-card";
import { setFeedMuted } from "@/lib/feed-sound";

function post(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: "post-1",
    author_id: "author",
    content: "hello",
    image_url: null,
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
    ...overrides,
  } as FeedRow;
}

const videoPost = () =>
  post({
    media_type: "video",
    video_url: "https://cdn.example/videos/a.mp4",
    thumbnail_url: "https://cdn.example/videos/a.jpg",
    duration_seconds: 12,
  });

function renderCard(row: FeedRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PostCard post={row} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveState.saved = false;
  followList.people = [];
  window.localStorage.removeItem("ediraa-videos-muted");
  setFeedMuted(false, false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostCard action bar", () => {
  it("is icon-only with the like, comment and share numbers beside the icons", () => {
    const { container } = renderCard(post({ like_count: 30_300, comment_count: 223 }));

    const like = screen.getByRole("button", { name: /^Like, 30300 likes/ });
    const comment = screen.getByRole("button", { name: /^Comments, 223/ });
    const share = screen.getByRole("button", { name: /^Share, 158 shares/ });
    expect(like).toHaveTextContent("30.3K");
    expect(comment).toHaveTextContent("223");
    expect(share).toHaveTextContent("158");
    // No text labels any more.
    for (const word of ["Comment", "Share", "Save"]) {
      expect(container.textContent).not.toContain(word);
    }
    // Save keeps its star, at the far end of the row.
    const save = screen.getByRole("button", { name: "Save post" });
    expect(save.className).toMatch(/ml-auto/);
    expect(save.querySelector("svg")).not.toBeNull();
  });

  it("shows no number for zero likes or comments", () => {
    renderCard(post({ like_count: 0, comment_count: 0 }));
    expect(screen.getByRole("button", { name: /^Like, 0 likes/ })).toHaveTextContent(/^$/);
  });
});

describe("PostCard video posts", () => {
  it("autoplays with sound on by default, has no play button and opens the Reels viewer on tap", () => {
    const { container } = renderCard(videoPost());

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://cdn.example/videos/a.mp4");
    expect(video.muted).toBe(false);
    expect(video).toHaveAttribute("loop");
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster", "https://cdn.example/videos/a.jpg");
    // Tapping the video goes to /videos, where the person can keep scrolling.
    expect(container.querySelector('a[href="/videos"] video')).not.toBeNull();
    // The profile name sits on top of the video, inside the same block.
    expect(container.querySelector("article > div.relative")?.textContent).toContain("Ana Author");
  });

  it("has a speaker button that turns the sound off and on, and remembers it", () => {
    const { container } = renderCard(videoPost());
    const video = container.querySelector("video") as HTMLVideoElement;

    const off = screen.getByRole("button", { name: "Turn sound off" });
    expect(video.muted).toBe(false);
    // The button sits next to the video, not inside the link that opens Reels.
    expect(container.querySelector("a button")).toBeNull();

    fireEvent.click(off);
    expect(video.muted).toBe(true);
    expect(window.localStorage.getItem("ediraa-videos-muted")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Turn sound on" }));
    expect(video.muted).toBe(false);
    expect(window.localStorage.getItem("ediraa-videos-muted")).toBe("false");
  });

  it("shows no speaker button on posts without a video", () => {
    renderCard(post());
    expect(screen.queryByRole("button", { name: /Turn sound/ })).toBeNull();
  });

  it("uses a star (not a bookmark) to save videos, and shows it filled when saved", () => {
    const { rerender } = renderCard(videoPost());
    const unsaved = screen.getByRole("button", { name: "Save video" });
    expect(unsaved).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Save post" })).toBeNull();
    expect(unsaved.querySelector("svg")?.getAttribute("class")).not.toMatch(/fill-warning/);

    saveState.saved = true;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PostCard post={videoPost()} />
      </QueryClientProvider>,
    );
    const saved = screen.getByRole("button", { name: "Remove video from saved" });
    expect(saved).toHaveAttribute("aria-pressed", "true");
    expect(saved.querySelector("svg")?.getAttribute("class")).toMatch(/fill-warning/);
  });

  it("keeps the image and uses the same star save button for image posts", () => {
    const { container } = renderCard(post({ image_url: "https://cdn.example/media/i.jpg" }));

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img[src='https://cdn.example/media/i.jpg']")).not.toBeNull();
    const save = screen.getByRole("button", { name: "Save post" });
    expect(save).toBeInTheDocument();
    expect(save.querySelector("svg")?.getAttribute("class")).not.toMatch(/fill-warning/);
    expect(screen.queryByRole("button", { name: "Save video" })).toBeNull();
  });

  it("shows a filled star for a saved image or text post as well", () => {
    saveState.saved = true;
    renderCard(post({ image_url: "https://cdn.example/media/i.jpg" }));
    const saved = screen.getByRole("button", { name: "Remove from saved" });
    expect(saved).toHaveAttribute("aria-pressed", "true");
    expect(saved.querySelector("svg")?.getAttribute("class")).toMatch(/fill-warning/);
  });

  it("uses the star on plain text posts", () => {
    renderCard(post());
    expect(screen.getByRole("button", { name: "Save post" })).toBeInTheDocument();
  });

  it("treats rows without media columns (older database) as plain posts", () => {
    const legacy = post();
    delete (legacy as Partial<FeedRow>).media_type;
    delete (legacy as Partial<FeedRow>).video_url;
    const { container } = renderCard(legacy);

    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Save post" })).toBeInTheDocument();
  });
});

describe("Share for video posts", () => {
  const ana = {
    id: "u2",
    full_name: "Ana Followed",
    username: "anaf",
    avatar_url: null,
    account_type: "personal",
  };

  it("lists only the people returned for the viewer's following list", async () => {
    followList.people = [ana];
    renderCard(videoPost());

    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    expect(await screen.findByText("Ana Followed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Ana Followed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("explains when the viewer follows nobody", async () => {
    renderCard(videoPost());

    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    expect(await screen.findByText(/not following anyone yet/i)).toBeInTheDocument();
  });

  it("sends once to the selected people, then closes the box", async () => {
    followList.people = [ana];
    shareVideoWithUser.mockResolvedValue("conv-1");
    renderCard(videoPost());
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Ana Followed" }));
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() => expect(screen.queryByText("Ana Followed")).not.toBeInTheDocument());
    expect(shareVideoWithUser).toHaveBeenCalledTimes(1);
    expect(shareVideoWithUser).toHaveBeenCalledWith("post-1", "u2");
  });

  it("shows the server's error, keeps the box open and allows a retry", async () => {
    followList.people = [ana];
    shareVideoWithUser.mockRejectedValue(
      new Error("You can only share videos with people you follow."),
    );
    renderCard(videoPost());
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Ana Followed" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText(/only share videos with people you follow/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Ana Followed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});
