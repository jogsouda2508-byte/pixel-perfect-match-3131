import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PostCard } from "@/components/post-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fetchPostById } from "@/lib/social";

export const Route = createFileRoute("/post/$id")({
  head: () => ({
    meta: [{ title: "Post — SabZone" }],
  }),
  validateSearch: (search: Record<string, unknown>): { comments?: boolean } =>
    search["comments"] === true || search["comments"] === "true" ? { comments: true } : {},
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  const { comments } = Route.useSearch();
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  // Back to wherever the person came from (their profile grid, a notification...).
  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else void navigate({ to: "/home" });
  };
  const post = useQuery({
    queryKey: ["post", id, user?.id],
    queryFn: () => fetchPostById(id, user!.id),
    enabled: !!user,
  });

  return (
    <PageShell>
      <PageHeader title="Post" onBack={goBack} />

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
