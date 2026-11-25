import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Bell,
  Compass,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  WifiOff,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, BrandLockup, UserRow, Verified } from "@/components/ediraa";
import { CommunityHomeStrip } from "@/components/community-home";
import { LocalityPicker } from "@/components/locality-picker";
import { PageShell } from "@/components/page-shell";
import { PostCard } from "@/components/post-card";
import { Stories } from "@/components/stories";
import { useAuth } from "@/lib/auth";
import { useLocality } from "@/lib/use-locality";
import { dropMuted, useMutedIds } from "@/lib/safety";
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
      { title: "Home Feed — SabZone" },
      {
        name: "description",
        content: "Stories, posts and local updates from your SabZone network.",
      },
      { property: "og:title", content: "Home Feed — SabZone" },
      {
        property: "og:description",
        content: "Stories, posts and local updates from your SabZone network.",
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
    queryFn: ({ pageParam }) => fetchFeed({ tab, before: pageParam, location: pickedLocality }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === FEED_PAGE_SIZE ? (last[last.length - 1]?.created_at ?? null) : undefined,
    enabled: !!meId && !localNeedsSetup,
  });
  // People I muted stay out of my feed. This is done here, not in the fetch, so a page with some
  // muted posts still counts as a full page and "load more" keeps working.
  const mutedIds = useMutedIds();
  const posts = dropMuted(feed.data?.pages.flat() ?? [], new Set(mutedIds.data ?? []));

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

  const unreadCount = unread.data ?? 0;

  return (
    <PageShell
      rowGap="space-y-3 sm:space-y-4"
      aside={
        <aside className="sticky top-6 hidden h-fit space-y-4 lg:block" aria-label="Suggestions">
          <section className="glass-card space-y-4 p-4">
            <h2 className="text-base font-bold">People you may know</h2>
            {people.isLoading && (
              <div className="space-y-3" role="status" aria-label="Loading suggestions">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="sz-skeleton h-10 w-10 rounded-full" />
                    <div className="sz-skeleton h-3 w-28 rounded-full" />
                  </div>
                ))}
              </div>
            )}
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
            <h2 className="mb-3 text-base font-bold">Trending Topics</h2>
            {trending.isSuccess && trending.data.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Hashtags used in posts will trend here.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {trending.data?.map((t) => (
                <span
                  key={t.tag}
                  className="rounded-full border border-border bg-elevated/60 px-3 py-1.5 text-xs font-semibold"
                >
                  <span className="text-primary">#</span>
                  {t.tag}
                </span>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
              SabZone Official <Verified />
            </p>
          </section>
        </aside>
      }
    >
      {/* Sticky, frosted top bar: brand + quick actions, with the feed switcher underneath. */}
      <header className="sz-frost sticky top-0 z-30 -mx-4 space-y-2.5 px-4 pb-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] sm:-mx-6 sm:px-6 md:mx-0 md:rounded-2xl md:border md:border-border md:px-3 md:pb-2.5 md:pt-2.5 md:top-3">
        <div className="flex items-center justify-between gap-3 md:hidden">
          {/* The name lives in the side menu on desktop; keep it on phones, which have no side menu. */}
          <h1>
            <span className="sr-only">SabZone</span>
            <BrandLockup compact artwork />
          </h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <BellLink unread={unreadCount} />
          </div>
        </div>
        {/* The For You / Following / Local / Business switcher is gone from Home (search has the
            Business filter). The Local Hub shortcut still opens the Local feed; this chip shows
            which feed that is and brings you back to For You. */}
        {tab !== "for_you" && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs font-semibold">
              {TABS.find((t) => t.key === tab)?.label}
            </span>
            <button
              type="button"
              onClick={() => setTab("for_you")}
              aria-label="Back to For You"
              className="grid h-6 w-6 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="ml-auto hidden md:block">
              <BellLink unread={unreadCount} />
            </div>
          </div>
        )}
        {tab === "for_you" && (
          <div className="hidden justify-end md:flex">
            <BellLink unread={unreadCount} />
          </div>
        )}
      </header>

      <Stories onLocalHub={() => setTab("local")} />

      <section className="glass-card home-round-card p-3 sm:p-4">
        <Link
          to="/create"
          className="group flex min-h-12 items-center gap-3 rounded-2xl p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar src={me} name={myName} size={40} />
          <span className="flex-1 rounded-full border border-border bg-elevated/60 px-4 py-2.5 text-sm text-muted-foreground transition-colors group-hover:border-primary/40">
            What's on your mind?
          </span>
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-full bg-gradient-brand text-primary-foreground transition-transform group-hover:scale-105"
          >
            <Plus className="h-4 w-4" strokeWidth={2.75} />
          </span>
        </Link>
      </section>

      <CommunityHomeStrip />

      {tab === "local" && (
        <LocalityPicker
          active={activeLocality}
          profileLocation={profileLocation}
          selected={pickedLocality}
          onSelect={setPickedLocality}
        />
      )}

      {feed.isLoading && !localNeedsSetup && <FeedSkeleton />}
      {feed.isError && (
        <FeedMessage
          icon={<WifiOff className="h-6 w-6" aria-hidden="true" />}
          title="Can't reach your feed"
          tone="error"
        >
          <p className="text-muted-foreground">Couldn't load your feed.</p>
          <button
            type="button"
            onClick={() => feed.refetch()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/50 px-5 font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </FeedMessage>
      )}
      {feed.isSuccess && !localNeedsSetup && posts.length === 0 && (
        <FeedMessage
          icon={<Newspaper className="h-6 w-6" aria-hidden="true" />}
          title="Nothing here yet"
        >
          <p className="text-muted-foreground">
            {tab === "local" && activeLocality
              ? `No posts from ${activeLocality} yet.`
              : EMPTY[tab]}
          </p>
          {tab === "following" && (
            <Link
              to="/discover"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/50 px-5 font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              <Compass className="h-4 w-4" aria-hidden="true" />
              Find people to follow
            </Link>
          )}
          {tab === "for_you" && (
            <Link
              to="/create"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-brand px-5 font-bold text-primary-foreground glow"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create a post
            </Link>
          )}
        </FeedMessage>
      )}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="mx-auto flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-sm font-semibold transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {feed.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
          Load more
        </button>
      )}
      {feed.isSuccess && !feed.hasNextPage && posts.length > 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">You're all caught up.</p>
      )}
    </PageShell>
  );
}

function BellLink({ unread }: { unread: number }) {
  return (
    <Link
      to="/notifications"
      aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
      className="relative grid h-11 w-11 place-items-center rounded-full border border-border bg-card/70 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-gradient-brand px-1 text-[10px] font-extrabold leading-none text-primary-foreground ring-2 ring-background">
          {unread > 99 ? "99+" : unread}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}

/** Placeholder cards that mirror a real post while the feed loads. */
function FeedSkeleton() {
  return (
    <div className="space-y-3 sm:space-y-4" role="status" aria-label="Loading your feed">
      {[0, 1].map((i) => (
        <div key={i} className="glass-card overflow-hidden" aria-hidden="true">
          <div className="flex items-center gap-3 p-4">
            <div className="sz-skeleton h-11 w-11 rounded-full" />
            <div className="space-y-2">
              <div className="sz-skeleton h-3 w-32 rounded-full" />
              <div className="sz-skeleton h-2.5 w-20 rounded-full" />
            </div>
          </div>
          <div className="sz-skeleton aspect-[4/3] w-full" />
          <div className="space-y-2 p-4">
            <div className="sz-skeleton h-3 w-3/4 rounded-full" />
            <div className="sz-skeleton h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading your feed…</span>
    </div>
  );
}

/** Shared empty / error card: an icon, a short title, then whatever message and action the caller adds. */
function FeedMessage({
  icon,
  title,
  tone = "default",
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: "default" | "error";
  children: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center px-6 py-10 text-center text-sm">
      <span
        className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl ${
          tone === "error" ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary"
        }`}
      >
        {icon}
      </span>
      <h2 className="mb-1 text-lg font-bold">{title}</h2>
      {children}
    </div>
  );
}
