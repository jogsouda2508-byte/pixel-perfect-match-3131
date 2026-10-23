import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, Bell, Loader2 } from "lucide-react";
import { Avatar, BottomNav, Pill, SideNav, UserRow, Verified } from "@/components/ediraa";
import { PostCard } from "@/components/post-card";
import { Stories } from "@/components/stories";
import { useAuth } from "@/lib/auth";
import {
  FEED_PAGE_SIZE,
  fetchFeed,
  fetchPeople,
  fetchTrending,
  fetchUnreadCount,
  type FeedTab,
} from "@/lib/social";
import { useFollow } from "@/lib/use-follow";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home Feed — Ediraa" },
      {
        name: "description",
        content: "Stories, posts and local updates from your Ediraa network.",
      },
      { property: "og:title", content: "Home Feed — Ediraa" },
      {
        property: "og:description",
        content: "Stories, posts and local updates from your Ediraa network.",
      },
    ],
  }),
  component: HomePage,
});

const TABS: { label: string; key: FeedTab }[] = [
  { label: "For You", key: "for_you" },
  { label: "Following", key: "following" },
  { label: "Local", key: "local" },
  { label: "Business", key: "business" },
];

const EMPTY: Record<FeedTab, string> = {
  for_you: "No posts yet. Be the first to share something!",
  following: "Posts from people you follow will show up here. Follow a few people to get started.",
  local: "No local posts yet. Make sure your profile has a location to see posts from your area.",
  business: "No business posts yet.",
};

function HomePage() {
  const { user, profile } = useAuth();
  const me = profile?.avatar_url ?? null;
  const myName = profile?.full_name || profile?.username || "";
  const [tab, setTab] = useState<FeedTab>("for_you");
  const meId = user?.id ?? "";

  const feed = useInfiniteQuery({
    queryKey: ["feed", tab, meId],
    queryFn: ({ pageParam }) => fetchFeed({ tab, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === FEED_PAGE_SIZE ? (last[last.length - 1]?.created_at ?? null) : undefined,
    enabled: !!meId,
  });
  const posts = feed.data?.pages.flat() ?? [];

  const people = useQuery({
    queryKey: ["people", "suggested", meId],
    queryFn: () => fetchPeople({ excludeFollowed: true, limit: 4 }),
    enabled: !!meId,
  });
  const trending = useQuery({
    queryKey: ["trending", meId],
    queryFn: () => fetchTrending(6),
    enabled: !!meId,
  });
  const unread = useQuery({
    queryKey: ["unread", meId],
    queryFn: fetchUnreadCount,
    enabled: !!meId,
    refetchInterval: 30_000,
  });

  const follow = useFollow();

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)_300px]">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Ediraa</h1>
          <div className="flex items-center gap-4">
            <Link
              to="/discover"
              aria-label="Search"
              className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-6 w-6" />
            </Link>
            <Link
              to="/notifications"
              aria-label={`Notifications${(unread.data ?? 0) > 0 ? `, ${unread.data} unread` : ""}`}
              className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Bell className="h-6 w-6" />
              </span>
              {(unread.data ?? 0) > 0 && (
                <span className="absolute right-0 top-0 grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold leading-none text-brand-accent-foreground">
                  {(unread.data ?? 0) > 99 ? "99+" : unread.data}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
            <Link
              to="/profile"
              aria-label="Profile"
              className="grid h-11 w-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar src={me} name={myName} size={34} />
            </Link>
          </div>
        </header>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <Pill key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Pill>
          ))}
        </div>
        <Stories onLocalHub={() => setTab("local")} />
        <section className="glass-card p-3">
          <Link
            to="/create"
            className="flex items-center gap-3 rounded-xl border border-border bg-elevated/40 p-3"
          >
            <Avatar src={me} name={myName} size={34} />
            <span className="text-sm text-muted-foreground">What's on your mind?</span>
          </Link>
        </section>

        {feed.isLoading && (
          <div className="grid place-items-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {feed.isError && (
          <div className="glass-card space-y-3 p-4 text-center text-sm">
            <p className="text-muted-foreground">Couldn't load your feed.</p>
            <button
              onClick={() => feed.refetch()}
              className="rounded-full border border-primary px-4 py-1.5 font-medium text-primary"
            >
              Try again
            </button>
          </div>
        )}
        {feed.isSuccess && posts.length === 0 && (
          <div className="glass-card p-6 text-center text-sm text-muted-foreground">
            {EMPTY[tab]}
            {tab === "for_you" && (
              <div className="mt-4">
                <Link
                  to="/create"
                  className="rounded-full bg-gradient-brand px-5 py-2 font-semibold text-primary-foreground"
                >
                  Create a post
                </Link>
              </div>
            )}
          </div>
        )}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="mx-auto flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium disabled:opacity-60"
          >
            {feed.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}Load more
          </button>
        )}
      </main>

      <aside className="sticky top-6 hidden h-fit space-y-4 lg:block">
        <section className="glass-card space-y-4 p-4">
          <h2 className="font-semibold">People you may know</h2>
          {people.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {people.isSuccess && people.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No suggestions right now.</p>
          )}
          {people.data?.map((p) => (
            <UserRow
              key={p.id}
              name={p.full_name || p.username}
              username={p.username}
              sub={
                p.mutual_count > 0
                  ? `${p.mutual_count} mutual ${p.mutual_count === 1 ? "friend" : "friends"}`
                  : `@${p.username}`
              }
              img={p.avatar_url}
              following={follow.isFollowing(p.id, p.is_following)}
              requested={follow.isRequested(p.id)}
              pending={follow.isPending(p.id)}
              onToggle={() => follow.toggle(p.id, follow.isFollowing(p.id, p.is_following))}
            />
          ))}
        </section>
        <section className="glass-card p-4">
          <h2 className="mb-3 font-semibold">Trending Topics</h2>
          {trending.isSuccess && trending.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Hashtags used in posts will trend here.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {trending.data?.map((t) => (
              <span
                key={t.tag}
                className="rounded-full bg-elevated px-3 py-1.5 text-xs font-medium"
              >
                #{t.tag}
              </span>
            ))}
          </div>
          <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
            Ediraa Official <Verified />
          </p>
        </section>
      </aside>
      <BottomNav />
    </div>
  );
}
