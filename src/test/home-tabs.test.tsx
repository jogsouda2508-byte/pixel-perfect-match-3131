import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedRow } from "@/integrations/supabase/types";

const h = vi.hoisted(() => ({
  profile: { location: "Bengaluru" as string | null },
  fetchFeed: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // keep router-only props (activeProps etc.) off the DOM element
    Link: ({
      children,
      to,
      className,
      "aria-label": ariaLabel,
    }: {
      children?: ReactNode;
      to?: string;
      className?: string;
      "aria-label"?: string;
    }) => (
      <a href={String(to)} className={className} aria-label={ariaLabel}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    profile: { full_name: "Me", username: "me", avatar_url: null, location: h.profile.location },
  }),
}));
vi.mock("@/lib/social", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social")>();
  return {
    ...actual,
    fetchFeed: h.fetchFeed,
    fetchPeople: async () => [],
    fetchTrending: async () => [],
    fetchUnreadCount: async () => 0,
    fetchStories: async () => [],
    fetchLocalities: async () => [{ locality: "Mumbai", people: 2 }],
  };
});
vi.mock("@/lib/use-chat-unread", () => ({
  useChatUnread: () => 0,
  UnreadBadge: () => null,
}));
vi.mock("@/components/composer", () => ({ ComposerLauncher: () => null }));
vi.mock("@/components/post-card", () => ({
  PostCard: ({ post }: { post: FeedRow }) => <article>{post.content}</article>,
}));

import { Route } from "@/routes/home";

const post = (id: string, content: string): FeedRow =>
  ({
    id,
    author_id: "a",
    content,
    image_url: null,
    audience: "Public",
    created_at: new Date().toISOString(),
    author_name: "A",
    author_username: "a",
    author_avatar: null,
    author_account_type: "personal",
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    media_type: "image",
    video_url: null,
    thumbnail_url: null,
    duration_seconds: null,
  }) as FeedRow;

function renderHome() {
  const HomePage = Route.options.component as () => ReactNode;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.profile.location = "Bengaluru";
  h.fetchFeed.mockImplementation(async ({ tab }: { tab: string }) =>
    tab === "for_you" ? [post("1", "everyone's post")] : [],
  );
});

const tab = (name: string) => screen.getByRole("button", { name });

describe("Gicco chat header", () => {
  it("shows Gicco on the first line and chat directly under it, next to the logo", async () => {
    renderHome();
    const gicco = (await screen.findAllByText("Gicco"))[0]!;
    const chat = gicco.nextElementSibling;
    expect(chat?.textContent).toBe("chat");
    expect(gicco.parentElement?.className).toContain("flex-col");
    expect(document.querySelector('img[alt="Gicco chat logo"]')).toBeInTheDocument();
  });
});

describe("Following tab", () => {
  it("asks for the following feed and shows what comes back", async () => {
    h.fetchFeed.mockImplementation(async ({ tab }: { tab: string }) =>
      tab === "following" ? [post("9", "from someone I follow")] : [post("1", "everyone's post")],
    );
    renderHome();
    await screen.findByText("everyone's post");

    fireEvent.click(tab("Following"));
    await screen.findByText("from someone I follow");
    expect(screen.queryByText("everyone's post")).toBeNull();
    expect(h.fetchFeed).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "following" }));
  });

  it("shows a friendly empty state with a way to find people", async () => {
    renderHome();
    await screen.findByText("everyone's post");
    fireEvent.click(tab("Following"));
    await screen.findByText("Posts from people you follow will appear here.");
    expect(screen.getByRole("link", { name: "Find people to follow" })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(screen.queryByText("everyone's post")).toBeNull();
  });
});

describe("Local tab", () => {
  it("uses the profile location when no locality is picked", async () => {
    h.fetchFeed.mockImplementation(async ({ tab }: { tab: string }) =>
      tab === "local" ? [post("5", "a Bengaluru post")] : [],
    );
    renderHome();
    fireEvent.click(tab("Local"));
    await screen.findByText("a Bengaluru post");
    expect(screen.getByText(/Using the location from your profile/)).toBeInTheDocument();
    expect(h.fetchFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({ tab: "local", location: null }),
    );
  });

  it("never falls back to a global feed: with no location it asks for one and loads nothing", async () => {
    h.profile.location = null;
    renderHome();
    await screen.findByText("everyone's post");
    h.fetchFeed.mockClear();

    fireEvent.click(tab("Local"));
    await screen.findByText("Choose a locality to see local posts");
    expect(screen.getByRole("link", { name: /add a location to your profile/ })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(h.fetchFeed).not.toHaveBeenCalled();
    expect(screen.queryByText("everyone's post")).toBeNull();
  });

  it("loads that locality's posts once one is picked, and remembers it", async () => {
    h.profile.location = null;
    h.fetchFeed.mockImplementation(async ({ tab, location }: { tab: string; location?: string }) =>
      tab === "local" && location === "Pune" ? [post("7", "a Pune post")] : [],
    );
    renderHome();
    fireEvent.click(tab("Local"));
    await screen.findByText("Choose a locality to see local posts");

    fireEvent.change(screen.getByLabelText("Locality"), { target: { value: "Pune" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));

    await screen.findByText("a Pune post");
    expect(h.fetchFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({ tab: "local", location: "Pune" }),
    );
    expect(window.localStorage.getItem("ediraa.local-locality.me")).toBe("Pune");
  });

  it("can switch from the profile location to a suggested locality and back", async () => {
    renderHome();
    fireEvent.click(tab("Local"));
    fireEvent.click(await screen.findByRole("button", { name: "Mumbai" }));
    await waitFor(() =>
      expect(h.fetchFeed).toHaveBeenLastCalledWith(
        expect.objectContaining({ tab: "local", location: "Mumbai" }),
      ),
    );
    expect(screen.getByText(/Only posts shared with everyone/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back to my location \(Bengaluru\)/ }));
    await waitFor(() =>
      expect(h.fetchFeed).toHaveBeenLastCalledWith(
        expect.objectContaining({ tab: "local", location: null }),
      ),
    );
  });

  it("says so plainly when the area has no posts, instead of showing other places", async () => {
    renderHome();
    fireEvent.click(tab("Local"));
    await screen.findByText("No posts from Bengaluru yet.");
    expect(screen.queryByText("everyone's post")).toBeNull();
  });
});
