import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, Flag, Loader2, MessageCircle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Drawer as DrawerPrimitive } from "vaul";
import { Avatar } from "@/components/ediraa";
import { ReportButton } from "@/components/report-sheet";
import { useAuth } from "@/lib/auth";
import { addComment, deleteComment, fetchComments, type CommentView } from "@/lib/social";
import { timeAgo } from "@/lib/time";

const QUICK_EMOJIS = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"];
const MAX_LENGTH = 300;

/** The text to put in the comment box when someone taps "Reply" on a comment. */
export function replyDraft(current: string, username: string | null | undefined): string {
  if (!username) return current;
  const mention = `@${username} `;
  if (current.startsWith(mention)) return current;
  return (mention + current.replace(/^@[\w.]+\s+/, "")).slice(0, MAX_LENGTH);
}

/**
 * Comment text with a leading @mention picked out in the brand colour. Replies are written as
 * "@name text", so a reply reads as a reply. Everything else renders as plain text (never HTML).
 */
export function CommentBody({ text, className = "" }: { text: string; className?: string }) {
  const match = /^(@[\w.]+?)(\s[\s\S]*)?$/.exec(text);
  return (
    <p className={`whitespace-pre-line break-words text-sm leading-relaxed ${className}`}>
      {match ? (
        <>
          <span className="sz-mention">{match[1]}</span>
          {match[2] ?? ""}
        </>
      ) : (
        text
      )}
    </p>
  );
}

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
  const inputRef = useRef<HTMLInputElement>(null);
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
        <DrawerPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]" />
        <DrawerPrimitive.Content className="fixed inset-x-0 bottom-0 z-[60] flex h-[72dvh] max-h-[88dvh] flex-col rounded-t-[32px] border border-b-0 border-border bg-popover/95 text-foreground shadow-[0_-24px_70px_-20px_rgba(0,0,0,0.8)] outline-none backdrop-blur-xl sm:mx-auto sm:max-w-xl">
          <div
            aria-hidden="true"
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40"
          />
          <DrawerPrimitive.Title className="shrink-0 py-3 text-center font-display text-base font-bold">
            Comments
          </DrawerPrimitive.Title>
          <DrawerPrimitive.Description className="sr-only">
            Comments on this post.
          </DrawerPrimitive.Description>

          {/* List / empty state */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {list.isLoading && (
              <div className="space-y-5 pt-2" role="status" aria-label="Loading comments">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-start gap-3" aria-hidden="true">
                    <div className="sz-skeleton h-9 w-9 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="sz-skeleton h-3 w-24 rounded-full" />
                      <div className="sz-skeleton h-3 w-4/5 rounded-full" />
                    </div>
                  </div>
                ))}
                <span className="sr-only">Loading comments…</span>
              </div>
            )}
            {list.isError && (
              <div className="py-10 text-center">
                <p className="text-sm text-destructive">Couldn't load comments.</p>
                <button
                  type="button"
                  onClick={() => void list.refetch()}
                  className="mt-3 rounded-full border border-primary/50 px-4 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  Try again
                </button>
              </div>
            )}
            {list.isSuccess && list.data.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="mb-1 grid h-14 w-14 place-items-center rounded-2xl bg-primary/12 text-primary">
                  <MessageCircle className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="font-display text-2xl font-bold">No comments yet</p>
                <p className="text-sm text-muted-foreground">Start the conversation.</p>
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
                    onReply={() => {
                      setDraft((d) => replyDraft(d, c.author?.username));
                      inputRef.current?.focus();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Quick emojis */}
          <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border px-3 py-2">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Add ${emoji}`}
                onClick={() => setDraft((d) => (d + emoji).slice(0, MAX_LENGTH))}
                className="grid h-10 w-10 place-items-center rounded-full text-[21px] leading-none transition-transform hover:bg-elevated active:scale-90"
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
            <div className="flex min-w-0 flex-1 items-center rounded-full border border-border bg-elevated/50 pl-4 pr-1.5 transition-colors focus-within:border-primary/60">
              <input
                ref={inputRef}
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
                  className="rounded-full bg-gradient-brand px-4 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
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
  onReply,
}: {
  comment: CommentView;
  mine: boolean;
  onDelete: () => void;
  onNavigate: () => void;
  onReply: () => void;
}) {
  const author = comment.author;
  const name = author?.full_name || author?.username || "SabZone user";
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
        <p className="text-[13px] font-bold">
          {name}{" "}
          <span className="font-normal text-muted-foreground">{timeAgo(comment.created_at)}</span>
        </p>
        <CommentBody text={comment.content} />
        {!!author?.username && (
          <button
            type="button"
            onClick={onReply}
            aria-label={`Reply to ${name}`}
            className="mt-1 inline-flex items-center gap-1 rounded-md py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CornerDownRight className="h-3 w-3" aria-hidden="true" />
            Reply
          </button>
        )}
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
      {!mine && (
        <ReportButton
          targetType="comment"
          targetId={comment.id}
          targetUserId={comment.author_id}
          label="Report comment"
          className="mt-1 text-muted-foreground active:text-destructive"
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
        </ReportButton>
      )}
    </li>
  );
}
