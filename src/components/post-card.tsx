import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  MoreHorizontal,
  Play,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { CommentsSheet } from "@/components/comments-sheet";
import { Gallery } from "@/components/gallery";
import { CommentIcon, HeartIcon, ShareIcon } from "@/components/icons";
import { EmojiButton } from "@/components/emoji-button";
import { PollCard } from "@/components/poll-card";
import { PostLikedBy } from "@/components/post-likes";
import { PostMeta } from "@/components/post-meta";
import { ShareVideoDialog } from "@/components/share-video-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { formatCount } from "@/lib/format-count";
import { togglePostLike } from "@/lib/post-cache";
import { useShareCount } from "@/lib/post-shares";
import {
  addComment,
  deleteComment,
  deletePost,
  fetchComments,
  type CommentView,
} from "@/lib/social";
import { timeAgo } from "@/lib/time";
import { useSaved } from "@/lib/use-saved";
import { deleteVideoPost } from "@/lib/videos";
import type { FeedRow } from "@/integrations/supabase/types";

/** Renders #hashtags in the brand colour. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(#[A-Za-z0-9_]+)/g).map((part, i) =>
        /^#[A-Za-z0-9_]+$/.test(part) ? (
          <span key={i} className="text-primary">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** A caption longer than this (or with more than 2 lines) is cut short with a "more" button. */
const CAPTION_PREVIEW_CHARS = 100;

export function PostCard({
  post,
  openComments = false,
}: {
  post: FeedRow;
  openComments?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const saved = useSaved();
  const mine = user?.id === post.author_id;
  const isSaved = saved.isSaved(post.id);
  // Rows from a database without the video migration have no media_type: treat as image/text.
  const isVideo = post.media_type === "video" && !!post.video_url;
  const savePending = saved.isPending(post.id);
  const shareCount = useShareCount(post.id);

  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [showComments, setShowComments] = useState(openComments);
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);

  // Keep in sync when the feed refetches.
  useEffect(() => {
    setLiked(post.liked_by_me);
    setLikes(post.like_count);
    setCommentCount(post.comment_count);
  }, [post.liked_by_me, post.like_count, post.comment_count]);

  // Refs mirror the state so a quick second tap (double-click) always sees the latest value.
  const likedRef = useRef(post.liked_by_me);
  const likesRef = useRef(post.like_count);
  const likeBusyRef = useRef(false);
  const wantedLike = useRef<boolean | null>(null);
  useEffect(() => {
    likedRef.current = post.liked_by_me;
    likesRef.current = post.like_count;
  }, [post.liked_by_me, post.like_count]);

  /** Sets the like to an exact state (true = liked). Taps that arrive mid-request are queued. */
  const setLike = async (next: boolean): Promise<void> => {
    if (!user) return;
    if (likeBusyRef.current) {
      wantedLike.current = next;
      return;
    }
    if (likedRef.current === next) return;
    const before = likesRef.current;
    const after = Math.max(0, before + (next ? 1 : -1));
    likeBusyRef.current = true;
    likedRef.current = next;
    likesRef.current = after;
    setLiked(next);
    setLikes(after);
    try {
      await togglePostLike(
        qc,
        user.id,
        { id: post.id, liked_by_me: !next, like_count: before },
        next,
      );
    } catch {
      likedRef.current = !next;
      likesRef.current = before;
      setLiked(!next);
      setLikes(before);
      toast.error("Couldn't update your like. Please try again.");
    } finally {
      likeBusyRef.current = false;
      const wanted = wantedLike.current;
      wantedLike.current = null;
      if (wanted !== null) void setLike(wanted);
    }
  };

  // Heart icon: one click toggles; a double-click always ends up liked (red).
  const lastLikeClick = useRef(0);
  const onLikeClick = () => {
    const now = Date.now();
    const isDouble = now - lastLikeClick.current < 400;
    lastLikeClick.current = isDouble ? 0 : now;
    void setLike(isDouble ? true : !likedRef.current);
  };

  // Photo: double-click / double-tap likes it and pops a big heart on the picture.
  // A single click still opens the photo, after a short wait to see if a second click follows.
  const heartPop = useRef<HTMLSpanElement>(null);
  const lastPhotoClick = useRef(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(openTimer.current), []);
  const onPhotoClick = () => {
    const now = Date.now();
    if (now - lastPhotoClick.current < 300) {
      lastPhotoClick.current = 0;
      clearTimeout(openTimer.current);
      heartPop.current?.animate?.(
        [
          { opacity: 0, transform: "scale(0.3)" },
          { opacity: 1, transform: "scale(1.15)", offset: 0.25 },
          { opacity: 1, transform: "scale(1)", offset: 0.6 },
          { opacity: 0, transform: "scale(1.05)" },
        ],
        { duration: 850, easing: "ease-out" },
      );
      void setLike(true);
      return;
    }
    lastPhotoClick.current = now;
    openTimer.current = setTimeout(() => {
      lastPhotoClick.current = 0;
      setGalleryOpen(true);
    }, 300);
  };

  const remove = useMutation({
    // Video posts also remove their video + thumbnail files from storage.
    mutationFn: () =>
      isVideo
        ? deleteVideoPost({
            id: post.id,
            video_url: post.video_url ?? "",
            thumbnail_url: post.thumbnail_url,
          })
        : deletePost(post.id),
    onSuccess: () => {
      toast.success(isVideo ? "Video deleted" : "Post deleted");
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["video-feed"] });
      void qc.invalidateQueries({ queryKey: ["user-videos"] });
      void qc.invalidateQueries({ queryKey: ["saved-posts"] });
      void qc.invalidateQueries({ queryKey: ["user-posts"] });
      void qc.invalidateQueries({ queryKey: ["follow-counts"] });
      void qc.invalidateQueries({ queryKey: ["trending"] });
    },
    onError: () => toast.error("Couldn't delete the post."),
  });

  const name = post.author_name || post.author_username;

  // Caption sits under the photo / video. Long ones show a short preview and a "more" button.
  const hasMedia = (isVideo && !!post.video_url) || !!post.image_url;
  const captionText = post.content ?? "";
  const captionLines = captionText.split("\n");
  const longCaption = captionText.length > CAPTION_PREVIEW_CHARS || captionLines.length > 2;
  const captionPreview = captionLines.slice(0, 2).join("\n").slice(0, CAPTION_PREVIEW_CHARS).trimEnd();

  return (
    <article className="glass-card p-3">
      <div className="flex items-center gap-3">
        <Link
          to="/u/$username"
          params={{ username: post.author_username }}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar src={post.author_avatar} name={name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              @{post.author_username} • {timeAgo(post.created_at)} •{" "}
              {post.audience}
            </p>
          </div>
        </Link>
        {mine && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Post options"
              className="rounded-full p-1 text-muted-foreground outline-none hover:bg-elevated"
            >
              <MoreHorizontal className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => remove.mutate()}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete post
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <PostMeta post={post} />

      {/* A text-only post keeps its text on top; with a photo or video the caption goes underneath. */}
      {post.content && !hasMedia && (
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed">
          <RichText text={post.content} />
        </p>
      )}
      <PollCard postId={post.id} />
      {isVideo && post.video_url ? (
        // Tapping a video opens the Reels viewer on it, so the person can keep scrolling
        // down to the next videos instead of being stuck on this one.
        <Link
          to="/videos"
          search={{ video: post.id }}
          aria-label={`Watch video by ${name}`}
          className="group relative mt-3 grid max-h-[50dvh] min-h-48 w-full place-items-center overflow-hidden rounded-xl bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-h-[70dvh]"
        >
          {post.thumbnail_url && (
            <img
              src={post.thumbnail_url}
              alt=""
              loading="lazy"
              className="max-h-[50dvh] w-full object-contain sm:max-h-[70dvh]"
            />
          )}
          <span className="pointer-events-none absolute grid h-14 w-14 place-items-center rounded-full bg-black/50 text-white transition group-hover:bg-black/65">
            <Play className="h-7 w-7 fill-white" aria-hidden="true" />
          </span>
        </Link>
      ) : (
        post.image_url && (
          <>
            <div className="relative mt-3">
              <button
                type="button"
                onClick={onPhotoClick}
                aria-label="Open photo"
                className="block w-full touch-manipulation select-none overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={post.image_url}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="max-h-[300px] w-full object-cover sm:max-h-[480px]"
                />
              </button>
              <span
                ref={heartPop}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 grid place-items-center opacity-0"
              >
                <HeartIcon className="h-24 w-24 fill-red-500 text-red-500 drop-shadow-[0_4px_14px_rgba(0,0,0,0.35)]" />
              </span>
            </div>
            <Gallery
              items={[
                {
                  id: post.id,
                  type: "image",
                  src: post.image_url,
                  caption: post.content,
                },
              ]}
              startIndex={galleryOpen ? 0 : null}
              onClose={() => setGalleryOpen(false)}
            />
          </>
        )
      )}

      {/* Instagram-style action bar: icons only, each with its number beside it; Save sits at the far end. */}
      <div className="mt-3 flex items-center gap-1 border-t border-border pt-2 text-sm font-semibold max-sm:mt-1.5 max-sm:pt-0.5">
        <button
          type="button"
          onClick={onLikeClick}
          aria-pressed={liked}
          aria-label={liked ? `Unlike, ${likes} likes` : `Like, ${likes} likes`}
          className="flex min-h-10 touch-manipulation items-center gap-1.5 rounded-full px-2.5"
        >
          <HeartIcon
            className={`h-6 w-6 ${liked ? "fill-red-500 text-red-500" : ""}`}
          />
          {formatCount(likes) && <span>{formatCount(likes)}</span>}
        </button>
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-label={`Comments, ${commentCount}`}
          className="flex min-h-10 items-center gap-1.5 rounded-full px-2.5"
        >
          <CommentIcon
            className={`h-6 w-6 ${showComments ? "text-primary" : ""}`}
            aria-hidden="true"
          />
          {formatCount(commentCount) && <span>{formatCount(commentCount)}</span>}
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label={`Share, ${shareCount} shares`}
          className="flex min-h-10 items-center gap-1.5 rounded-full px-2.5"
        >
          <ShareIcon className="h-6 w-6" aria-hidden="true" />
          {formatCount(shareCount) && <span>{formatCount(shareCount)}</span>}
        </button>
        <button
          type="button"
          onClick={() => void saved.toggle(post.id)}
          disabled={savePending}
          aria-label={
            isSaved
              ? isVideo
                ? "Remove video from saved"
                : "Remove from saved"
              : isVideo
                ? "Save video"
                : "Save post"
          }
          aria-pressed={isSaved}
          className={`ml-auto grid min-h-10 min-w-10 place-items-center rounded-full disabled:opacity-60 ${isSaved ? "text-warning" : ""}`}
        >
          <Star
            className={`h-6 w-6 ${isSaved ? "fill-warning" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {user && <PostLikedBy postId={post.id} likes={likes} meId={user.id} authorId={post.author_id} />}

      {captionText && hasMedia && (
        <p className="mt-0 whitespace-pre-line break-words px-1 pb-0.5 text-sm leading-snug">
          <Link
            to="/u/$username"
            params={{ username: post.author_username }}
            className="mr-1.5 font-semibold hover:underline"
          >
            {post.author_username}
          </Link>
          <RichText text={longCaption && !captionOpen ? captionPreview : captionText} />
          {longCaption && !captionOpen && <span className="text-muted-foreground">… </span>}
          {longCaption && (
            <button
              type="button"
              onClick={() => setCaptionOpen((v) => !v)}
              aria-expanded={captionOpen}
              className="ml-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {captionOpen ? "less" : "more"}
            </button>
          )}
        </p>
      )}

      <ShareVideoDialog
        post={shareOpen ? { id: post.id } : null}
        kind={isVideo ? "video" : "post"}
        onClose={() => setShareOpen(false)}
      />

      {isMobile && (
        <CommentsSheet
          postId={post.id}
          open={showComments}
          onOpenChange={setShowComments}
          onAdded={() => setCommentCount((n) => n + 1)}
          onRemoved={() => setCommentCount((n) => Math.max(0, n - 1))}
        />
      )}
      {!isMobile && showComments && (
        <Comments
          postId={post.id}
          draft={draft}
          setDraft={setDraft}
          onAdded={() => setCommentCount((n) => n + 1)}
          onRemoved={() => setCommentCount((n) => Math.max(0, n - 1))}
        />
      )}
    </article>
  );
}

function Comments({
  postId,
  draft,
  setDraft,
  onAdded,
  onRemoved,
}: {
  postId: string;
  draft: string;
  setDraft: (v: string) => void;
  onAdded: () => void;
  onRemoved: () => void;
}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const commentInputRef = useRef<HTMLInputElement>(null);
  const key = ["comments", postId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchComments(postId),
  });

  const add = useMutation({
    mutationFn: (text: string) => addComment(postId, user!.id, text),
    onSuccess: () => {
      setDraft("");
      onAdded();
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => toast.error("Couldn't post your comment."),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      onRemoved();
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error("Couldn't delete the comment."),
  });

  const text = draft.trim();

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {list.isLoading && (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {list.isError && (
        <p className="text-xs text-destructive">Couldn't load comments.</p>
      )}
      {list.data?.map((c) => (
        <div key={c.id} className="flex items-start gap-2">
          <CommentAuthorLink author={c.author} className="shrink-0">
            <Avatar
              src={c.author?.avatar_url}
              name={c.author?.full_name || c.author?.username}
              size={30}
            />
          </CommentAuthorLink>
          <div className="min-w-0 flex-1 rounded-xl bg-elevated/60 px-3 py-2">
            <p className="text-xs font-semibold">
              <CommentAuthorLink author={c.author} className="hover:underline">
                {c.author?.full_name || c.author?.username}
              </CommentAuthorLink>{" "}
              <span className="font-normal text-muted-foreground">
                • {timeAgo(c.created_at)}
              </span>
            </p>
            <p className="mt-0.5 whitespace-pre-line break-words text-sm">
              {c.content}
            </p>
          </div>
          {c.author_id === user?.id && (
            <button
              onClick={() => del.mutate(c.id)}
              aria-label="Delete comment"
              className="mt-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <div className="relative flex items-center gap-2">
        <Avatar
          src={profile?.avatar_url}
          name={profile?.full_name || profile?.username}
          size={30}
        />
        <input
          ref={commentInputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 300))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text && !add.isPending) add.mutate(text);
          }}
          placeholder="Write a comment…"
          className="min-w-0 flex-1 rounded-full border border-border bg-elevated/40 px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <EmojiButton
          inputRef={commentInputRef}
          value={draft}
          onChange={setDraft}
          maxLength={300}
        />
        <button
          onClick={() => text && add.mutate(text)}
          disabled={!text || add.isPending}
          aria-label="Send comment"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground disabled:opacity-50"
        >
          {add.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Links a commenter's avatar / name to their profile (plain text if the author is gone). */
function CommentAuthorLink({
  author,
  className,
  children,
}: {
  author: CommentView["author"];
  className?: string;
  children: ReactNode;
}) {
  if (!author?.username) return <span className={className}>{children}</span>;
  return (
    <Link
      to="/u/$username"
      params={{ username: author.username }}
      className={className}
    >
      {children}
    </Link>
  );
}
