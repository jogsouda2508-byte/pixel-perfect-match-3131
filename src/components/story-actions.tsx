import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, Loader2, MessageCircle, Send, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import {
  MAX_STORY_COMMENT,
  addStoryComment,
  deleteStoryComment,
  fetchStoryComments,
  fetchStoryLikes,
  replyToStory,
  searchUsernames,
  setStoryLike,
} from "@/lib/story-social";
import { timeAgo } from "@/lib/time";

const MENTION_AT_END = /(^|\s)@([a-z0-9_]*)$/i;

/** Text input that suggests usernames after the person types "@". */
function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  maxLength,
  onFocusChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  maxLength: number;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  const token = MENTION_AT_END.exec(value);
  const query = token ? token[2]! : null;
  const suggestions = useQuery({
    queryKey: ["mention-search", query],
    queryFn: () => searchUsernames(query ?? ""),
    enabled: query !== null,
    staleTime: 30_000,
  });

  const pickMention = (username: string) => {
    onChange(value.replace(MENTION_AT_END, (_m, lead: string) => `${lead}@${username} `));
  };

  return (
    <div className="relative min-w-0 flex-1">
      {query !== null && (suggestions.data?.length ?? 0) > 0 && (
        <ul
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-xl border border-white/15 bg-neutral-900 shadow-lg"
        >
          {suggestions.data!.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(p.username)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10"
              >
                <Avatar src={p.avatar_url} name={p.full_name || p.username} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">@{p.username}</span>
                  {p.full_name && (
                    <span className="block truncate text-xs text-white/60">{p.full_name}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={maxLength}
        disabled={disabled}
        className="w-full rounded-full border border-white/30 bg-transparent px-4 py-2.5 text-sm text-white placeholder:text-white/60 focus:border-white focus:outline-none"
      />
    </div>
  );
}

/** Turns @username into a link to that profile. */
function WithMentions({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9_]{3,20})/gi);
  return (
    <>
      {parts.map((part, i): ReactNode =>
        /^@[a-z0-9_]{3,20}$/i.test(part) ? (
          <Link
            key={i}
            to="/u/$username"
            params={{ username: part.slice(1).toLowerCase() }}
            className="font-semibold text-sky-300 hover:underline"
          >
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function StoryActions({
  storyId,
  authorId,
  authorName,
  meId,
  onPausedChange,
}: {
  storyId: string;
  authorId: string;
  authorName: string;
  meId: string;
  /** The viewer pauses the story while you type or read comments. */
  onPausedChange: (paused: boolean) => void;
}) {
  const qc = useQueryClient();
  const isOwner = authorId === meId;
  const [reply, setReply] = useState("");
  const [replyFocused, setReplyFocused] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [commentFocused, setCommentFocused] = useState(false);

  const paused = replyFocused || sheetOpen || commentFocused;
  useEffect(() => {
    onPausedChange(paused);
    return () => onPausedChange(false);
  }, [paused, onPausedChange]);

  // Close the comments sheet when the story changes.
  useEffect(() => {
    setSheetOpen(false);
    setReply("");
    setComment("");
  }, [storyId]);

  const likes = useQuery({
    queryKey: ["story-likes", storyId, meId],
    queryFn: () => fetchStoryLikes(storyId),
  });
  const comments = useQuery({
    queryKey: ["story-comments", storyId],
    queryFn: () => fetchStoryComments(storyId),
  });
  const liked = (likes.data ?? []).some((l) => l.user_id === meId);
  const likeCount = likes.data?.length ?? 0;
  const commentCount = comments.data?.length ?? 0;

  const toggleLike = useMutation({
    mutationFn: () => setStoryLike(storyId, meId, !liked),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["story-likes", storyId] }),
    onError: (e: Error) => toast.error(e.message || "Couldn't update your like."),
  });

  const sendReply = useMutation({
    mutationFn: () => replyToStory(authorId, reply),
    onSuccess: () => {
      setReply("");
      toast.success(`Reply sent to ${authorName}`);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't send your reply."),
  });

  const postComment = useMutation({
    mutationFn: () => addStoryComment(storyId, meId, comment),
    onSuccess: () => {
      setComment("");
      void qc.invalidateQueries({ queryKey: ["story-comments", storyId] });
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't post your comment."),
  });

  const removeComment = useMutation({
    mutationFn: (id: string) => deleteStoryComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["story-comments", storyId] }),
    onError: (e: Error) => toast.error(e.message || "Couldn't delete the comment."),
  });

  const submitReply = () => {
    if (reply.trim() && !sendReply.isPending) sendReply.mutate();
  };
  const submitComment = () => {
    if (comment.trim() && !postComment.isPending) postComment.mutate();
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {isOwner ? (
          <>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-2 rounded-full border border-white/30 px-4 py-2.5 text-sm hover:bg-white/10"
              aria-label={`${likeCount} likes and ${commentCount} comments. Open details`}
            >
              <Heart className="h-5 w-5" aria-hidden="true" />
              {likeCount}
              <MessageCircle className="ml-2 h-5 w-5" aria-hidden="true" />
              {commentCount}
            </button>
          </>
        ) : (
          <>
            <MentionInput
              value={reply}
              onChange={setReply}
              onSubmit={submitReply}
              placeholder={`Reply to ${authorName}…`}
              maxLength={500}
              onFocusChange={setReplyFocused}
              disabled={sendReply.isPending}
              label={`Reply to ${authorName}'s story`}
            />
            {reply.trim() ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={submitReply}
                disabled={sendReply.isPending}
                aria-label="Send reply"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
              >
                {sendReply.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleLike.mutate()}
                  disabled={toggleLike.isPending}
                  aria-pressed={liked}
                  aria-label={liked ? "Unlike story" : "Like story"}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/10"
                >
                  <Heart
                    className={`h-6 w-6 ${liked ? "fill-red-500 text-red-500" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  aria-label={`Comments (${commentCount})`}
                  className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/10"
                >
                  <MessageCircle className="h-6 w-6" aria-hidden="true" />
                  {commentCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {commentCount}
                    </span>
                  )}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-[110] flex max-h-[75vh] flex-col rounded-t-2xl border-t border-white/15 bg-neutral-900 text-white shadow-2xl"
          role="dialog"
          aria-label="Story comments"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="font-semibold">
              {isOwner ? "Likes and comments" : "Comments"}
            </h2>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close comments"
              className="rounded-full p-2 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
            {isOwner && (
              <section aria-label="Likes">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white/80">
                  <Heart className="h-4 w-4" aria-hidden="true" /> {likeCount}{" "}
                  {likeCount === 1 ? "like" : "likes"}
                </h3>
                {likeCount === 0 && <p className="text-sm text-white/60">No likes yet.</p>}
                <ul className="space-y-2">
                  {likes.data?.map((l) => (
                    <li key={l.user_id} className="flex items-center gap-3">
                      <Avatar
                        src={l.person?.avatar_url}
                        name={l.person?.full_name || l.person?.username}
                        size={32}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {l.person?.username ? (
                          <Link
                            to="/u/$username"
                            params={{ username: l.person.username }}
                            className="font-medium hover:underline"
                          >
                            @{l.person.username}
                          </Link>
                        ) : (
                          "Someone"
                        )}
                      </span>
                      <span className="text-xs text-white/50">{timeAgo(l.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-label="Comments">
              {isOwner && (
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white/80">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> {commentCount}{" "}
                  {commentCount === 1 ? "comment" : "comments"}
                </h3>
              )}
              {comments.isLoading && <Loader2 className="h-5 w-5 animate-spin text-white/60" />}
              {comments.isError && (
                <p className="text-sm text-red-300">Couldn't load comments.</p>
              )}
              {comments.isSuccess && commentCount === 0 && (
                <p className="text-sm text-white/60">No comments yet. Be the first!</p>
              )}
              <ul className="space-y-3">
                {comments.data?.map((c) => (
                  <li key={c.id} className="flex items-start gap-3">
                    <Avatar
                      src={c.person?.avatar_url}
                      name={c.person?.full_name || c.person?.username}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">
                        <span className="font-semibold">
                          {c.person?.username ? `@${c.person.username}` : "Someone"}
                        </span>{" "}
                        <WithMentions text={c.content} />
                      </p>
                      <p className="text-xs text-white/50">{timeAgo(c.created_at)}</p>
                    </div>
                    {(isOwner || c.author_id === meId) && (
                      <button
                        type="button"
                        onClick={() => removeComment.mutate(c.id)}
                        disabled={removeComment.isPending}
                        aria-label="Delete comment"
                        className="rounded-full p-2 text-white/70 hover:bg-white/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <MentionInput
              value={comment}
              onChange={setComment}
              onSubmit={submitComment}
              placeholder="Add a comment… use @ to mention"
              maxLength={MAX_STORY_COMMENT}
              onFocusChange={setCommentFocused}
              disabled={postComment.isPending}
              label="Add a comment"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={submitComment}
              disabled={!comment.trim() || postComment.isPending}
              aria-label="Post comment"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            >
              {postComment.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
