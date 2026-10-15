import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { PostCard } from "@/components/post-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fetchPostById } from "@/lib/social";

export const Route = createFileRoute("/post/$id")({
  head: () => ({
    meta: [{ title: "Post — Ediraa" }],
  }),
  validateSearch: (search: Record<string, unknown>): { comments?: boolean } =>
    search["comments"] === true || search["comments"] === "true" ? { comments: true } : {},
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  const { comments } = Route.useSearch();
  const { user } = useAuth();
  const post = useQuery({
    queryKey: ["post", id, user?.id],
    queryFn: () => fetchPostById(id, user!.id),
    enabled: !!user,
  });

  return (
    <PageShell>
      <header className="flex items-center gap-3">
        <Link
          to="/notifications"
          aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Post</h1>
      </header>

      {post.isLoading && (
        <div className="grid place-items-center p-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading post" />
        </div>
      )}

      {post.isError && (
        <section className="glass-card space-y-3 p-5 text-center" role="alert">
          <p className="text-sm text-destructive">Couldn't load this post.</p>
          <Button type="button" variant="outline" onClick={() => post.refetch()}>
            Retry
          </Button>
        </section>
      )}

      {post.isSuccess && !post.data && (
        <section className="glass-card p-6 text-center text-sm text-muted-foreground">
          This post is no longer available.
        </section>
      )}

      {post.isSuccess && post.data && <PostCard post={post.data} openComments={!!comments} />}
    </PageShell>
  );
}
