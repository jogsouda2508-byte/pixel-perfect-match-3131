import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bookmark, Loader2 } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PostCard } from "@/components/post-card";
import { useAuth } from "@/lib/auth";
import { FEED_PAGE_SIZE, fetchSavedPosts } from "@/lib/social";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved Posts — Ediraa" },
      { name: "description", content: "Posts you've saved on Ediraa." },
    ],
  }),
  component: SavedPage,
});

function SavedPage() {
  const { user } = useAuth();
  const meId = user?.id ?? "";

  const saved = useInfiniteQuery({
    queryKey: ["saved-posts", meId],
    queryFn: ({ pageParam }) => fetchSavedPosts(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === FEED_PAGE_SIZE ? (last[last.length - 1]?.saved_at ?? null) : undefined,
    enabled: !!meId,
  });
  const posts = saved.data?.pages.flat() ?? [];

  return (
    <PageShell>
      <PageHeader title="Saved Posts" />
      {saved.isLoading && (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {saved.isError && (
        <div className="glass-card space-y-3 p-4 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load your saved posts.</p>
          <button
            onClick={() => saved.refetch()}
            className="rounded-full border border-primary px-4 py-1.5 font-medium text-primary"
          >
            Try again
          </button>
        </div>
      )}
      {saved.isSuccess && posts.length === 0 && (
        <div className="glass-card space-y-3 p-8 text-center">
          <Bookmark className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Tap the bookmark on any post to keep it here.
          </p>
          <Link
            to="/home"
            className="inline-block rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary"
          >
            Browse your feed
          </Link>
        </div>
      )}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {saved.hasNextPage && (
        <button
          onClick={() => saved.fetchNextPage()}
          disabled={saved.isFetchingNextPage}
          className="mx-auto flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium disabled:opacity-60"
        >
          {saved.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}Load more
        </button>
      )}
    </PageShell>
  );
}
