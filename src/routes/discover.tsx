import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { BottomNav, Pill, SideNav, UserRow } from "@/components/ediraa";
import { GroupsPanel } from "@/components/groups-panel";
import { PostCard } from "@/components/post-card";
import { useAuth } from "@/lib/auth";
import { fetchFeed, fetchPeople, fetchTrending } from "@/lib/social";
import { useFollow } from "@/lib/use-follow";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Discover — Gicco chat" },
      {
        name: "description",
        content: "Find people, businesses and trending topics on Gicco chat.",
      },
      { property: "og:title", content: "Discover — Gicco chat" },
      {
        property: "og:description",
        content: "Find people, businesses and trending topics on Gicco chat.",
      },
    ],
  }),
  component: DiscoverPage,
});

const filters = ["All", "People", "Business", "Groups"] as const;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function DiscoverPage() {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const follow = useFollow();

  const showPeople =
    filter === "All" || filter === "People" || filter === "Business";
  const people = useQuery({
    queryKey: ["people", "discover", q, filter, meId],
    queryFn: () =>
      fetchPeople({ query: q, businessOnly: filter === "Business", limit: 20 }),
    enabled: !!meId && showPeople,
  });

  // Posts only show up when searching (the home feed is for browsing).
  const showPosts = filter === "All" && q.length > 0;
  const posts = useQuery({
    queryKey: ["feed", "search", q, meId],
    queryFn: () => fetchFeed({ tab: "for_you", search: q }),
    enabled: !!meId && showPosts,
  });

  const trending = useQuery({
    queryKey: ["trending", meId],
    queryFn: () => fetchTrending(12),
    enabled: !!meId,
  });

  return (
    <div className="mx-auto max-w-[1480px] px-4 sm:px-6 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <main className="min-w-0 space-y-4 lg:col-span-2 lg:max-w-[820px] 2xl:max-w-[900px]">
        <h1 className="text-2xl font-bold">Discover</h1>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users, posts, business..."
            className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((f) => (
            <Pill
              key={f}
              large
              active={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </Pill>
          ))}
        </div>

        {filter === "Groups" ? (
          <GroupsPanel query={q} />
        ) : (
          <section className="glass-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {q
                  ? "People"
                  : filter === "Business"
                    ? "Businesses"
                    : "People you may know"}
              </h2>
            </div>
            <div className="space-y-5">
              {people.isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {people.isError && (
                <p className="text-sm text-destructive">
                  Couldn't load people.
                </p>
              )}
              {people.isSuccess && people.data.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {q ? "No people match your search." : "No one to show yet."}
                </p>
              )}
              {people.data?.map((p) => (
                <UserRow
                  large
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
                    follow.toggle(
                      p.id,
                      follow.isFollowing(p.id, p.is_following),
                    )
                  }
                />
              ))}
            </div>
          </section>
        )}

        {showPosts && (
          <section className="space-y-4">
            <h2 className="px-1 text-lg font-semibold">Posts</h2>
            {posts.isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {posts.isSuccess && posts.data.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                No posts match your search.
              </p>
            )}
            {posts.data?.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </section>
        )}

        <section className="glass-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trending Topics</h2>
          </div>
          {trending.isSuccess && trending.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Hashtags used in posts will trend here.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {trending.data?.map((t) => (
              <button
                key={t.tag}
                onClick={() => {
                  setFilter("All");
                  setQuery(`#${t.tag}`);
                }}
                className="rounded-full bg-elevated px-3.5 py-1.5 text-sm font-medium"
              >
                #{t.tag}
              </button>
            ))}
          </div>
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
