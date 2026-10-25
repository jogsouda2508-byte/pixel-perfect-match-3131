import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Drawer as DrawerPrimitive } from "vaul";
import { Avatar } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import {
  addComment,
  deleteComment,
  fetchComments,
  type CommentView,
} from "@/lib/social";
import { timeAgo } from "@/lib/time";

const QUICK_EMOJIS = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"];
const MAX_LENGTH = 300;

/**
 * Phone-only comments bottom sheet (Instagram style): a handle, a centred "Comments" title,
 * the comment list (or "No comments yet"), a row of quick emojis, and the comment box.
 * Used for photo posts, video posts and reels. Desktop keeps its existing comment UI.
 */
export function CommentsSheet({
  postId,
  open,
  onOpenChange,
  onAdded,
  onRemoved,
}: {
  postId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
  onRemoved?: () => void;
}) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const key = ["comments", postId];

  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchComments(postId!),
    enabled: !!postId && open,
  });

  const add = useMutation({
    mutationFn: (text: string) => addComment(postId!, user!.id, text),
    onSuccess: () => {
      setDraft("");
      onAdded?.();
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => toast.error("Couldn't post your comment. Please try again."),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      onRemoved?.();
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error("Couldn't delete the comment."),
  });

  const text = draft.trim();
  const submit = () => {
    if (!text || !user || add.isPending) return;
    add.mutate(text);
  };

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setDraft("");
        onOpenChange(next);
      }}
      shouldScaleBackground={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-[60] flex h-[72dvh] max-h-[88dvh] flex-col rounded-t-[28px] bg-background text-foreground outline-none"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 h-[3px] w-9 shrink-0 rounded-full bg-muted-foreground/60"
          />
          <DrawerPrimitive.Title className="shrink-0 py-3 text-center text-base font-medium">
            Comments
          </DrawerPrimitive.Title>
          <DrawerPrimitive.Description className="sr-only">
            Comments on this post.
          </DrawerPrimitive.Description>

          {/* List / empty state */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {list.isLoading && (
              <div className="grid h-full place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {list.isError && (
              <p className="py-8 text-center text-sm text-destructive">
                Couldn't load comments.
              </p>
            )}
            {list.isSuccess && list.data.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-2xl font-bold">No comments yet</p>
                <p className="text-sm text-muted-foreground">
                  Start the conversation.
                </p>
              </div>
            )}
            {list.isSuccess && list.data.length > 0 && (
              <ul className="space-y-4 pb-3 pt-1">
                {list.data.map((c) => (
                  <SheetComment
                    key={c.id}
                    comment={c}
                    mine={c.author_id === user?.id}
                    onDelete={() => del.mutate(c.id)}
                    onNavigate={() => onOpenChange(false)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Quick emojis */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Add ${emoji}`}
                onClick={() => setDraft((d) => (d + emoji).slice(0, MAX_LENGTH))}
                className="grid h-9 w-9 place-items-center text-[21px] leading-none active:scale-90"
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Comment box */}
          <form
            className="flex shrink-0 items-center gap-3 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-1"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Avatar
              src={profile?.avatar_url}
              name={profile?.full_name || profile?.username}
              size={40}
            />
            <div className="flex min-w-0 flex-1 items-center rounded-full border border-border pl-4 pr-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                placeholder="Start the conversation…"
                aria-label="Add a comment"
                maxLength={MAX_LENGTH}
                enterKeyHint="send"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-muted-foreground"
              />
              {text && (
                <button
                  type="submit"
                  disabled={add.isPending}
                  aria-label="Send comment"
                  className="px-3 py-1.5 text-sm font-semibold text-primary disabled:opacity-50"
                >
                  {add.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Post"
                  )}
                </button>
              )}
            </div>
          </form>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}

function SheetComment({
  comment,
  mine,
  onDelete,
  onNavigate,
}: {
  comment: CommentView;
  mine: boolean;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const author = comment.author;
  const name = author?.full_name || author?.username || "Ediraa user";
  const avatar = <Avatar src={author?.avatar_url} name={name} size={36} />;
  return (
    <li className="flex items-start gap-3">
      {author?.username ? (
        <Link
          to="/u/$username"
          params={{ username: author.username }}
          onClick={onNavigate}
          className="shrink-0"
        >
          {avatar}
        </Link>
      ) : (
        <span className="shrink-0">{avatar}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">
          {name}{" "}
          <span className="font-normal text-muted-foreground">
            {timeAgo(comment.created_at)}
          </span>
        </p>
        <p className="whitespace-pre-line break-words text-sm">{comment.content}</p>
      </div>
      {mine && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete comment"
          className="mt-1 text-muted-foreground active:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
