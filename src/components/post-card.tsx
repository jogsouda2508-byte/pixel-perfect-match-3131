import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Send,
  Share2,
  Star,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { Gallery } from "@/components/gallery";
import { EmojiButton } from "@/components/emoji-button";
import { PostMeta } from "@/components/post-meta";
import { ShareVideoDialog } from "@/components/share-video-dialog";
import { VideoPlayer } from "@/components/video-player";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { togglePostLike } from "@/lib/post-cache";
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

  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [showComments, setShowComments] = useState(openComments);
  const [draft, setDraft] = useState("");
  const [likeBusy, setLikeBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Keep in sync when the feed refetches.
  useEffect(() => {
    setLiked(post.liked_by_me);
    setLikes(post.like_count);
    setCommentCount(post.comment_count);
  }, [post.liked_by_me, post.like_count, post.comment_count]);

  const toggleLike = async () => {
    if (!user || likeBusy) return;
    const next = !liked;
    setLikeBusy(true);
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      await togglePostLike(
        qc,
        user.id,
        { id: post.id, liked_by_me: liked, like_count: likes },
        next,
      );
    } catch {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
      toast.error("Couldn't update your like. Please try again.");
    } finally {
      setLikeBusy(false);
    }
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
        {/* Every post (video, image or text) is saved with a five-point star:
            outline = not saved, filled = saved. One code path, so any future post type gets it too. */}
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
          className={`grid h-9 w-9 place-items-center rounded-full hover:bg-elevated disabled:opacity-60 ${isSaved ? "text-warning" : "text-muted-foreground"}`}
        >
          <Star
            className={`h-5 w-5 ${isSaved ? "fill-warning" : ""}`}
            aria-hidden="true"
          />
        </button>
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

      {post.content && (
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed">
          <RichText text={post.content} />
        </p>
      )}
      {isVideo && post.video_url ? (
        <VideoPlayer
          src={post.video_url}
          poster={post.thumbnail_url}
          label={`Video by ${name}`}
        />
      ) : (
        post.image_url && (
          <>
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              aria-label="Open photo"
              className="mt-3 block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={post.image_url}
                alt=""
                loading="lazy"
                className="max-h-[480px] w-full object-cover"
              />
            </button>
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

      {(likes > 0 || commentCount > 0) && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            {likes > 0 && (
              <>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary">
                  <ThumbsUp className="h-3 w-3 fill-primary-foreground text-primary-foreground" />
                </span>
                {likes}
              </>
            )}
          </span>
          {commentCount > 0 && (
            <button
              type="button"
              onClick={() => setShowComments((v) => !v)}
              aria-expanded={showComments}
              className={`rounded-full px-2.5 py-1 text-sm font-semibold text-primary transition hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showComments ? "bg-primary/10" : ""}`}
            >
              {commentCount} {commentCount === 1 ? "comment" : "comments"}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 border-t border-border pt-2 text-sm">
        <button
          onClick={toggleLike}
          disabled={likeBusy}
          aria-pressed={liked}
          className={`flex items-center justify-center gap-2 py-2 disabled:opacity-60 ${liked ? "text-primary" : ""}`}
        >
          <ThumbsUp className={`h-5 w-5 ${liked ? "fill-primary" : ""}`} />
          Like
        </button>
        <button
          onClick={() => setShowComments((v) => !v)}
          className={`flex items-center justify-center gap-2 py-2 ${showComments ? "font-semibold text-primary" : ""}`}
        >
          <MessageSquare className="h-5 w-5" />
          Comment
        </button>
        <button
          onClick={() => setShareOpen(true)}
          className="flex items-center justify-center gap-2 py-2"
        >
          <Share2 className="h-5 w-5" />
          Share
        </button>
      </div>

      <ShareVideoDialog
        post={shareOpen ? { id: post.id } : null}
        kind={isVideo ? "video" : "post"}
        onClose={() => setShareOpen(false)}
      />

      {showComments && (
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
