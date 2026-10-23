import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, Bell, Loader2 } from "lucide-react";
import {
  Avatar,
  BottomNav,
  BrandLockup,
  Pill,
  SideNav,
  UserRow,
  Verified,
} from "@/components/ediraa";
import { LocalityPicker } from "@/components/locality-picker";
import { PostCard } from "@/components/post-card";
import { Stories } from "@/components/stories";
import { useAuth } from "@/lib/auth";
import { useLocality } from "@/lib/use-locality";
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
      { title: "Home Feed — Gicco chat" },
      {
        name: "description",
        content:
          "Stories, posts and local updates from your Gicco chat network.",
      },
      { property: "og:title", content: "Home Feed — Gicco chat" },
      {
        property: "og:description",
        content:
          "Stories, posts and local updates from your Gicco chat network.",
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
  following: "Posts from people you follow will appear here.",
  local: "No posts from this area yet.",
  business: "No business posts yet.",
};

function HomePage() {
  const { user, profile } = useAuth();
  const me = profile?.avatar_url ?? null;
  const myName = profile?.full_name || profile?.username || "";
  const [tab, setTab] = useState<FeedTab>("for_you");
  const meId = user?.id ?? "";
  // Local tab: the picked locality, else the profile's own. Never a global feed.
  const [pickedLocality, setPickedLocality] = useLocality(meId);
  const profileLocation = profile?.location?.trim() || null;
  const activeLocality = pickedLocality ?? profileLocation;
  const localNeedsSetup = tab === "local" && !activeLocality;

  const feed = useInfiniteQuery({
    queryKey: ["feed", tab, meId, tab === "local" ? (pickedLocality ?? "") : ""],
    queryFn: ({ pageParam }) =>
      fetchFeed({ tab, before: pageParam, location: pickedLocality }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === FEED_PAGE_SIZE
        ? (last[last.length - 1]?.created_at ?? null)
        : undefined,
    enabled: !!meId && !localNeedsSetup,
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
    <div className="mx-auto max-w-[1480px] px-4 sm:px-6 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-y-3 md:flex-nowrap md:gap-4 lg:min-h-16 2xl:min-h-[4.5rem]">
          {/* The name lives in the side menu on desktop; keep it on phones, which have no side menu. */}
          <h1 className="order-1 md:hidden">
            <span className="sr-only">Gicco chat</span>
            <BrandLockup compact />
          </h1>
          <div className="scrollbar-white order-3 flex w-full gap-2 overflow-x-auto md:order-1 md:w-auto md:min-w-0 md:flex-1">
            {TABS.map((t) => (
              <Pill
                key={t.key}
                active={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </Pill>
            ))}
          </div>
          <div className="order-2 flex shrink-0 items-center gap-4 md:order-2">
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
        <Stories onLocalHub={() => setTab("local")} />
        <section className="glass-card p-3">
          <Link
            to="/create"
            className="flex items-center gap-3 rounded-xl border border-border bg-elevated/40 p-3"
          >
            <Avatar src={me} name={myName} size={34} />
            <span className="text-sm text-muted-foreground">
              What's on your mind?
            </span>
          </Link>
        </section>

        {tab === "local" && (
          <LocalityPicker
            active={activeLocality}
            profileLocation={profileLocation}
            selected={pickedLocality}
            onSelect={setPickedLocality}
          />
        )}

        {feed.isLoading && !localNeedsSetup && (
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
        {feed.isSuccess && !localNeedsSetup && posts.length === 0 && (
          <div className="glass-card p-6 text-center text-sm text-muted-foreground">
            {tab === "local" && activeLocality
              ? `No posts from ${activeLocality} yet.`
              : EMPTY[tab]}
            {tab === "following" && (
              <div className="mt-4">
                <Link
                  to="/discover"
                  className="rounded-full border border-primary px-5 py-2 font-semibold text-primary"
                >
                  Find people to follow
                </Link>
              </div>
            )}
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
            {feed.isFetchingNextPage && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Load more
          </button>
        )}
      </main>

      <aside className="sticky top-6 hidden h-fit space-y-4 lg:block">
        <section className="glass-card space-y-4 p-4">
          <h2 className="font-semibold">People you may know</h2>
          {people.isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {people.isSuccess && people.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No suggestions right now.
            </p>
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
              onToggle={() =>
                follow.toggle(p.id, follow.isFollowing(p.id, p.is_following))
              }
            />
          ))}
        </section>
        <section className="glass-card p-4">
          <h2 className="mb-3 font-semibold">Trending Topics</h2>
          {trending.isSuccess && trending.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Hashtags used in posts will trend here.
            </p>
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
            Gicco chat Official <Verified />
          </p>
        </section>
      </aside>
      <BottomNav />
    </div>
  );
}
