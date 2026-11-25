import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import type { PostRow } from "@/integrations/supabase/types";
import { userMessage } from "@/lib/security";
import {
  deleteComment,
  fetchLikedPosts,
  fetchMyComments,
  fetchTaggedPosts,
} from "@/lib/social";
import { timeAgo } from "@/lib/time";

type Tab = "comments" | "tags" | "likes";
const TABS: { key: Tab; label: string }[] = [
  { key: "comments", label: "Comments" },
  { key: "tags", label: "Tags" },
  { key: "likes", label: "Likes" },
];

export const Route = createFileRoute("/my-activity")({
  head: () => ({ meta: [{ title: "Your activity — SabZone" }] }),
  validateSearch: (search: Record<string, unknown>): { tab: Tab } => ({
    tab: search["tab"] === "tags" || search["tab"] === "likes" ? search["tab"] : "comments",
  }),
  component: MyActivityPage,
});

function Loading() {
  return (
    <div className="grid place-items-center py-10">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="glass-card p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function Failed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="glass-card space-y-3 p-4 text-center text-sm">
      <p className="text-muted-foreground">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-primary px-4 py-1.5 font-medium text-primary"
      >
        Try again
      </button>
    </div>
  );
}

/** Photos and videos in a 3-column grid; each one opens its post page. */
function PostGrid({ posts }: { posts: PostRow[] }) {
  return (
    <div className="-mx-4 grid grid-cols-3 gap-0.5 bg-card sm:mx-0">
      {posts.map((p) => {
        const cover = p.media_type === "video" ? p.thumbnail_url : p.image_url;
        return (
          <Link
            key={p.id}
            to="/post/$id"
            params={{ id: p.id }}
            aria-label={`Open post${p.content ? `: ${p.content.slice(0, 60)}` : ""}`}
            className="relative block aspect-square w-full overflow-hidden bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {cover ? (
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <p className="line-clamp-5 break-words p-3 text-xs font-medium leading-snug">
                {p.content}
              </p>
            )}
            {p.media_type === "video" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-[5px] bg-white shadow-sm"
              >
                <Play className="h-2 w-2 fill-black text-black" />
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function MyComments({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["my-comments", meId],
    queryFn: () => fetchMyComments(meId),
    enabled: !!meId,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      toast.success("Comment deleted");
      void qc.invalidateQueries({ queryKey: ["my-comments", meId] });
    },
    onError: (e) => toast.error(userMessage(e, "Couldn't delete the comment.")),
  });
  if (list.isLoading) return <Loading />;
  if (list.isError) return <Failed text="Couldn't load your comments." onRetry={() => list.refetch()} />;
  if (!list.data?.length) return <Empty text="You haven't commented on anything yet." />;
  return (
    <ul className="glass-card divide-y divide-border">
      {list.data.map((c) => (
        <li key={c.id} className="flex items-start gap-3 px-4 py-3">
          <Link
            to="/post/$id"
            params={{ id: c.post_id }}
            search={{ comments: true }}
            className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="break-words text-sm">{c.content}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(c.created_at)}</p>
          </Link>
          <button
            type="button"
            onClick={() => remove.mutate(c.id)}
            disabled={remove.isPending}
            aria-label="Delete comment"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PostsTab({ kind, meId }: { kind: "tags" | "likes"; meId: string }) {
  const list = useQuery({
    queryKey: [kind === "tags" ? "my-tagged-posts" : "my-liked-posts", meId],
    queryFn: () => (kind === "tags" ? fetchTaggedPosts(meId) : fetchLikedPosts(meId)),
    enabled: !!meId,
  });
  if (list.isLoading) return <Loading />;
  if (list.isError)
    return (
      <Failed
        text={kind === "tags" ? "Couldn't load tagged posts." : "Couldn't load liked posts."}
        onRetry={() => list.refetch()}
      />
    );
  if (!list.data?.length)
    return (
      <Empty
        text={
          kind === "tags"
            ? "No posts you're tagged in yet."
            : "No likes yet. Posts you like will show up here."
        }
      />
    );
  return <PostGrid posts={list.data} />;
}

function MyActivityPage() {
  const { tab } = Route.useSearch();
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const title = TABS.find((t) => t.key === tab)?.label ?? "Comments";
  // Only the section that was tapped on My Profile is shown.
  return (
    <PageShell>
      <PageHeader title={title} smartBack />
      {tab === "comments" ? <MyComments meId={meId} /> : <PostsTab kind={tab} meId={meId} />}
    </PageShell>
  );
}
