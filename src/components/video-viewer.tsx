import { Link } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircle,
  Camera,
  Download,
  Loader2,
  MoreHorizontal,
  Play,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, BottomNav, SideNav } from "@/components/ediraa";
import { ComposerLauncher } from "@/components/composer";
import { EmojiButton } from "@/components/emoji-button";
import { CommentIcon, HeartIcon, ShareIcon } from "@/components/icons";
import { PostMeta } from "@/components/post-meta";
import { followLabel } from "@/lib/follow-state";
import { ShareVideoDialog } from "@/components/share-video-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { formatCount } from "@/lib/format-count";
import { togglePostLike } from "@/lib/post-cache";
import { useShareCount } from "@/lib/post-shares";
import { addComment, fetchComments, type CommentView } from "@/lib/social";
import { timeAgo } from "@/lib/time";
import { useFollow } from "@/lib/use-follow";
import { useSaved } from "@/lib/use-saved";
import { downloadVideo } from "@/lib/video-download";
import {
  deleteVideoPost,
  fetchVideoById,
  fetchVideoFeed,
  truncateCaption,
  VIDEO_PAGE_SIZE,
} from "@/lib/videos";
import type { VideoFeedRow } from "@/integrations/supabase/types";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function VideoViewer({ initialVideoId }: { initialVideoId?: string }) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const follow = useFollow();
  const saved = useSaved();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  // ref blocks a fast double click before any re-render; state lets the button look disabled
  const pendingLikes = useRef(new Set<string>());
  const [likeBusy, setLikeBusy] = useState<Record<string, boolean>>({});
  const lastScrollTarget = useRef("");
  const [activeId, setActiveId] = useState(initialVideoId ?? "");
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("ediraa-videos-muted") !== "false";
  });
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [expandedCaptions, setExpandedCaptions] = useState<
    Record<string, boolean>
  >({});
  const [commentsVideo, setCommentsVideo] = useState<VideoFeedRow | null>(null);
  const [deleteVideo, setDeleteVideo] = useState<VideoFeedRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [shareTarget, setShareTarget] = useState<VideoFeedRow | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ["video-feed", user?.id],
    queryFn: ({ pageParam }) => fetchVideoFeed(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === VIDEO_PAGE_SIZE
        ? pages.length * VIDEO_PAGE_SIZE
        : undefined,
    enabled: !!user,
  });
  const linkedVideo = useQuery({
    queryKey: ["video-by-id", initialVideoId, user?.id],
    queryFn: () => fetchVideoById(initialVideoId!, user!.id),
    enabled: !!initialVideoId && !!user,
  });

  const items = useMemo(() => {
    const rows = feed.data?.pages.flat() ?? [];
    const deepLinked = linkedVideo.data;
    if (deepLinked && !rows.some((row) => row.id === deepLinked.id))
      return [deepLinked, ...rows];
    return rows;
  }, [feed.data?.pages, linkedVideo.data]);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const activeVideo = items[activeIndex] ?? items[0];

  useEffect(() => {
    if (!items.length) return;
    if (initialVideoId && items.some((item) => item.id === initialVideoId)) {
      setActiveId(initialVideoId);
      return;
    }
    if (!activeId || !items.some((item) => item.id === activeId))
      setActiveId(items[0]!.id);
  }, [activeId, initialVideoId, items]);

  useEffect(() => {
    if (!initialVideoId || !items.some((item) => item.id === initialVideoId))
      return;
    const slide = containerRef.current?.querySelector<HTMLElement>(
      `[data-video-id="${CSS.escape(initialVideoId)}"]`,
    );
    if (!slide || lastScrollTarget.current === initialVideoId) return;
    lastScrollTarget.current = initialVideoId;
    slide.scrollIntoView({ block: "start" });
  }, [initialVideoId, items]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !items.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.7,
          )
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = (visible?.target as HTMLElement | undefined)?.dataset[
          "videoId"
        ];
        if (id) setActiveId(id);
      },
      { root, threshold: [0, 0.7, 1] },
    );
    root
      .querySelectorAll<HTMLElement>("[data-video-id]")
      .forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    const pauseAll = () => {
      videoRefs.current.forEach((video) => video.pause());
      setPlaying(false);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") pauseAll();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      pauseAll();
    };
  }, []);

  useEffect(() => {
    videoRefs.current.forEach((video, id) => {
      if (id !== (activeVideo?.id ?? activeId)) video.pause();
    });
    const current = activeVideo
      ? videoRefs.current.get(activeVideo.id)
      : undefined;
    if (!current || document.visibilityState === "hidden") return;
    current.muted = muted;
    if (playing) {
      void current.play().catch((error: unknown) => {
        console.error("Autoplay failed", error);
        setPlaying(false);
      });
    } else {
      current.pause();
    }
  }, [activeId, activeVideo, muted, playing]);

  useEffect(() => {
    if (
      feed.hasNextPage &&
      !feed.isFetchingNextPage &&
      activeIndex >= items.length - 2
    )
      void feed.fetchNextPage();
  }, [activeIndex, feed, items.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)
      )
        return;
      const nextIndex = Math.min(
        Math.max(activeIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
        items.length - 1,
      );
      const next = items[nextIndex];
      if (next)
        containerRef.current
          ?.querySelector<HTMLElement>(
            `[data-video-id="${CSS.escape(next.id)}"]`,
          )
          ?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, items]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    window.localStorage.setItem("ediraa-videos-muted", String(next));
  };

  const seekTo = (post: VideoFeedRow, percent: number) => {
    const video = videoRefs.current.get(post.id);
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0)
      return;
    video.currentTime = (percent / 100) * video.duration;
    setProgress(percent);
    setCurrentTime(video.currentTime);
  };

  const download = async (post: VideoFeedRow) => {
    if (downloading[post.id]) return;
    setDownloading((state) => ({ ...state, [post.id]: true }));
    try {
      const filename = await downloadVideo(post);
      toast.success(`Download started: ${filename}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't download this video.",
      );
    } finally {
      setDownloading((state) => ({ ...state, [post.id]: false }));
    }
  };

  const toggleLike = async (post: VideoFeedRow) => {
    if (!user || pendingLikes.current.has(post.id)) return;
    pendingLikes.current.add(post.id);
    setLikeBusy((state) => ({ ...state, [post.id]: true }));
    try {
      // Updates every cached copy of this video (Videos, Home feed, Saved, deep link)
      // immediately, then writes to the database; rolls all of them back if the write fails.
      await togglePostLike(queryClient, user.id, post, !post.liked_by_me);
    } catch {
      toast.error("Couldn't update your like. Please try again.");
    } finally {
      pendingLikes.current.delete(post.id);
      setLikeBusy((state) => ({ ...state, [post.id]: false }));
    }
  };

  const copyLink = async (post: VideoFeedRow) => {
    const url = `${window.location.origin}/videos?video=${encodeURIComponent(post.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Video link copied");
    } catch {
      toast.error("Couldn't copy the video link.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteVideo || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteVideoPost(deleteVideo);
      setDeleteVideo(null);
      toast.success("Video deleted");
      await queryClient.invalidateQueries({ queryKey: ["video-feed"] });
      await queryClient.invalidateQueries({
        queryKey: ["user-videos", user?.id],
      });
      const next = items[activeIndex + 1] ?? items[activeIndex - 1];
      if (next) {
        setActiveId(next.id);
        containerRef.current
          ?.querySelector<HTMLElement>(
            `[data-video-id="${CSS.escape(next.id)}"]`,
          )
          ?.scrollIntoView({ block: "start" });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete this video.",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  if (
    feed.isLoading ||
    (initialVideoId &&
      linkedVideo.isLoading &&
      !items.some((item) => item.id === initialVideoId))
  ) {
    return <VideoFeedLoading />;
  }
  if (feed.isError && !items.length) {
    return <VideoFeedError onRetry={() => void feed.refetch()} />;
  }
  if (linkedVideo.isError && initialVideoId && !items.length) {
    return <VideoFeedError onRetry={() => void linkedVideo.refetch()} />;
  }
  if (!items.length) return <VideoFeedEmpty />;

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black md:mx-auto md:grid md:max-w-[1480px] md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:bg-background md:px-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <section
        ref={containerRef}
        aria-label="Videos"
        className="h-[100dvh] min-h-0 snap-y snap-mandatory overflow-y-auto overscroll-contain bg-black"
      >
        {items.map((post, index) => {
          const active = activeVideo?.id === post.id;
          const preloadNext = index === activeIndex + 1;
          const state = { liked: post.liked_by_me, count: post.like_count };
          const following = follow.isFollowing(
            post.author_id,
            post.is_following,
          );
          const longCaption = truncateCaption(post.content);
          const caption = expandedCaptions[post.id]
            ? post.content
            : longCaption.text;
          const own = post.author_id === user?.id;

          return (
            <article
              key={post.id}
              data-video-id={post.id}
              className="relative h-[100dvh] min-h-[100dvh] snap-start snap-always overflow-hidden bg-black text-white"
            >
              <div
                className="absolute inset-0 grid place-items-center"
                onClick={() => active && setPlaying((value) => !value)}
              >
                {index === activeIndex || preloadNext ? (
                  <video
                    ref={(element) => {
                      if (element) videoRefs.current.set(post.id, element);
                      else videoRefs.current.delete(post.id);
                    }}
                    src={post.video_url}
                    poster={post.thumbnail_url ?? undefined}
                    muted={muted}
                    playsInline
                    disablePictureInPicture
                    controlsList="nofullscreen"
                    loop
                    preload={active ? "auto" : "metadata"}
                    onTimeUpdate={(event) => {
                      if (!active) return;
                      const el = event.currentTarget;
                      setCurrentTime(el.currentTime);
                      setProgress(
                        el.duration ? (el.currentTime / el.duration) * 100 : 0,
                      );
                    }}
                    onLoadedMetadata={(event) => {
                      if (active)
                        setDuration(event.currentTarget.duration || 0);
                    }}
                    onWaiting={() =>
                      setBuffering((state) => ({ ...state, [post.id]: true }))
                    }
                    onLoadStart={() =>
                      setBuffering((state) => ({ ...state, [post.id]: true }))
                    }
                    onCanPlay={() =>
                      setBuffering((state) => ({ ...state, [post.id]: false }))
                    }
                    onPlaying={() =>
                      setBuffering((state) => ({ ...state, [post.id]: false }))
                    }
                    onError={() => {
                      setBuffering((state) => ({ ...state, [post.id]: false }));
                      setVideoErrors((state) => ({
                        ...state,
                        [post.id]: true,
                      }));
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (active) setPlaying((value) => !value);
                    }}
                    className="h-full w-full object-contain"
                    aria-label={`Video by ${post.author_name || post.author_username}`}
                  />
                ) : (
                  <img
                    src={post.thumbnail_url ?? ""}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                )}
                {videoErrors[post.id] && (
                  <div className="absolute inset-0 grid place-items-center bg-black/75 text-center">
                    <div className="space-y-3">
                      <AlertCircle className="mx-auto h-8 w-8" />
                      <p className="text-sm">Video unavailable</p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => {
                          setVideoErrors((state) => ({
                            ...state,
                            [post.id]: false,
                          }));
                          const video = videoRefs.current.get(post.id);
                          video?.load();
                          if (active) setPlaying(true);
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                )}
                {active && buffering[post.id] && !videoErrors[post.id] && (
                  <span
                    role="status"
                    aria-label="Loading video"
                    className="pointer-events-none absolute grid h-14 w-14 place-items-center rounded-full bg-black/50"
                  >
                    <Loader2
                      className="h-7 w-7 animate-spin"
                      aria-hidden="true"
                    />
                  </span>
                )}
                {active &&
                  !playing &&
                  !buffering[post.id] &&
                  !videoErrors[post.id] && (
                    <span className="pointer-events-none absolute grid h-14 w-14 place-items-center rounded-full bg-black/50">
                      <Play className="h-7 w-7 fill-white" aria-hidden="true" />
                    </span>
                  )}
              </div>

              {active && (
                <div className="absolute inset-x-0 bottom-14 z-20 px-3 md:bottom-0">
                  <div className="flex items-center gap-2 text-xs tabular-nums text-white/85">
                    <span aria-hidden="true">{formatTime(currentTime)}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.1}
                      value={progress}
                      onChange={(event) =>
                        seekTo(post, Number(event.target.value))
                      }
                      aria-label="Seek video"
                      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                      className="h-6 flex-1 cursor-pointer accent-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    />
                    <span aria-hidden="true">{formatTime(duration)}</span>
                  </div>
                </div>
              )}
              <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end bg-gradient-to-b from-black/65 to-transparent p-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
                <div className="flex items-center gap-2">
                  <ComposerLauncher variant="video" />
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={muted ? "Unmute video" : "Mute video"}
                    aria-pressed={!muted}
                    className="grid h-11 w-11 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {muted ? (
                      <VolumeX className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </header>

              <div className="absolute bottom-24 left-3 right-20 z-10 space-y-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent pb-2 pt-8 sm:left-5">
                <div className="flex items-center gap-2.5">
                  <Link
                    to="/u/$username"
                    params={{ username: post.author_username }}
                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Avatar
                      src={post.author_avatar}
                      name={post.author_name}
                      size={36}
                    />
                    <span className="truncate text-sm font-semibold">
                      {post.author_name || `@${post.author_username}`}
                    </span>
                  </Link>
                  {!own && (
                    <button
                      type="button"
                      disabled={follow.isPending(post.author_id)}
                      onClick={() => follow.toggle(post.author_id, following)}
                      className="min-h-11 rounded-full border border-white/80 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                    >
                      {followLabel(
                        following,
                        follow.isRequested(post.author_id),
                      )}
                    </button>
                  )}
                </div>
                {post.content && (
                  <p className="max-w-2xl whitespace-pre-wrap break-words text-sm">
                    {caption}
                    {longCaption.truncated && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCaptions((state) => ({
                            ...state,
                            [post.id]: !state[post.id],
                          }))
                        }
                        className="ml-1 min-h-11 px-1 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        {expandedCaptions[post.id] ? "less" : "more"}
                      </button>
                    )}
                  </p>
                )}
                <PostMeta post={post} tone="overlay" />
                <time
                  className="block text-sm text-white/75"
                  dateTime={post.created_at}
                >
                  {timeAgo(post.created_at)}
                </time>
              </div>

              <div className="absolute bottom-28 right-2 z-10 flex flex-col items-center gap-2 sm:right-4">
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled={!!likeBusy[post.id]}
                    onClick={() => void toggleLike(post)}
                    aria-label={
                      state.liked
                        ? `Unlike, ${state.count} likes`
                        : `Like, ${state.count} likes`
                    }
                    aria-pressed={state.liked}
                    className="grid h-12 w-12 place-items-center rounded-full bg-black/35 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                  >
                    <HeartIcon
                      className={`h-6 w-6 ${state.liked ? "fill-red-500 text-red-500" : ""}`}
                    />
                  </button>
                  <span className="text-sm font-semibold">{formatCount(state.count)}</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCommentsVideo(post)}
                    aria-label={`Comments, ${post.comment_count}`}
                    className="grid h-12 w-12 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <CommentIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <span className="text-sm font-semibold">
                    {formatCount(post.comment_count)}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShareTarget(post)}
                    aria-label="Share video"
                    className="grid h-12 w-12 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <ShareIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <ShareCountLabel postId={post.id} />
                </div>
                <button
                  type="button"
                  onClick={() => void saved.toggle(post.id)}
                  disabled={saved.isPending(post.id)}
                  aria-label={
                    saved.isSaved(post.id)
                      ? "Remove video from saved"
                      : "Save video"
                  }
                  aria-pressed={saved.isSaved(post.id)}
                  className="grid h-12 w-12 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                >
                  <Star
                    className={`h-6 w-6 ${saved.isSaved(post.id) ? "fill-warning text-warning" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void download(post)}
                  disabled={!!downloading[post.id]}
                  aria-label="Download video"
                  className="grid h-12 w-12 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                >
                  {downloading[post.id] ? (
                    <Loader2
                      className="h-6 w-6 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Download className="h-6 w-6" aria-hidden="true" />
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Video options"
                    className="grid h-12 w-12 place-items-center rounded-full bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <MoreHorizontal className="h-6 w-6" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void copyLink(post)}>
                      Copy video link
                    </DropdownMenuItem>
                    {own && (
                      <DropdownMenuItem
                        onClick={() => setDeleteVideo(post)}
                        className="text-destructive focus:text-destructive"
                      >
                        Delete video
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </article>
          );
        })}
        {feed.isFetchingNextPage && (
          <div
            className="grid h-16 place-items-center text-white"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {feed.isError && (
          <div
            className="grid min-h-40 place-items-center bg-black p-5 text-white"
            role="alert"
          >
            <div className="space-y-3 text-center">
              <p className="text-sm">Couldn't load more videos.</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void feed.fetchNextPage()}
              >
                Retry
              </Button>
            </div>
          </div>
        )}
      </section>
      <BottomNav />
      <ShareVideoDialog
        post={shareTarget}
        onClose={() => setShareTarget(null)}
      />
      <VideoComments
        post={commentsVideo}
        onClose={() => setCommentsVideo(null)}
        currentUser={profile}
      />
      <AlertDialog
        open={!!deleteVideo}
        onOpenChange={(open) => !open && setDeleteVideo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              This video and its thumbnail will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function ShareCountLabel({ postId }: { postId: string }) {
  const count = formatCount(useShareCount(postId));
  return count ? <span className="text-sm font-semibold">{count}</span> : null;
}

function VideoFeedLoading() {
  return (
    <div className="mx-auto h-[100dvh] max-w-[1480px] md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:px-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <Skeleton className="h-[100dvh] w-full bg-muted" />
      <BottomNav />
    </div>
  );
}

function VideoFeedError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto h-[100dvh] max-w-[1480px] md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:px-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <section className="grid h-[100dvh] place-items-center bg-background p-6 text-center text-foreground">
        <div className="space-y-4">
          <AlertCircle className="mx-auto h-10 w-10" />
          <p className="text-sm">Couldn't load videos.</p>
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </section>
      <BottomNav />
    </div>
  );
}

function VideoFeedEmpty() {
  return (
    <div className="mx-auto h-[100dvh] max-w-[1480px] md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:px-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <section className="grid h-[100dvh] place-items-center bg-gradient-to-br from-background via-background to-primary/10 p-6 text-center text-foreground">
        <div className="space-y-4">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Camera className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">No videos yet</h1>
          <p className="text-sm text-muted-foreground">
            Be the first to share a short video with your community.
          </p>
          <ComposerLauncher variant="video" videoLabel />
        </div>
      </section>
      <BottomNav />
    </div>
  );
}

function VideoComments({
  post,
  onClose,
  currentUser,
}: {
  post: VideoFeedRow | null;
  onClose: () => void;
  currentUser: { id: string } | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const commentInputRef = useRef<HTMLInputElement>(null);
  const key = ["comments", post?.id];
  const comments = useQuery({
    queryKey: key,
    queryFn: () => fetchComments(post!.id),
    enabled: !!post,
  });
  const add = useMutation({
    mutationFn: (text: string) => addComment(post!.id, currentUser!.id, text),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["video-feed"] });
    },
    onError: () => toast.error("Couldn't post your comment. Please try again."),
  });

  return (
    <Dialog
      open={!!post}
      onOpenChange={(open) => {
        if (!open) {
          setDraft("");
          onClose();
        }
      }}
    >
      <DialogContent className="fixed inset-x-0 bottom-0 top-auto left-0 max-h-[80dvh] w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-t-2xl p-4 sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Comments</DialogTitle>
          <DialogDescription>Comments on this video.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto py-3">
          {comments.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          )}
          {comments.isError && (
            <p className="text-sm text-destructive">Couldn't load comments.</p>
          )}
          {comments.isSuccess && comments.data.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No comments yet.
            </p>
          )}
          {comments.data?.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </div>
        <form
          className="relative flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || !currentUser || add.isPending) return;
            add.mutate(text);
          }}
        >
          <Input
            ref={commentInputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 300))}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            maxLength={300}
            className="min-h-11"
          />
          <EmojiButton
            inputRef={commentInputRef}
            value={draft}
            onChange={setDraft}
            maxLength={300}
          />
          <Button
            type="submit"
            className="min-h-11"
            disabled={!draft.trim() || add.isPending}
          >
            {add.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Send"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommentItem({ comment }: { comment: CommentView }) {
  const author = comment.author;
  const displayName = author?.full_name || author?.username || "Ediraa user";
  return (
    <div className="flex items-start gap-3">
      {author?.username ? (
        <Link
          to="/u/$username"
          params={{ username: author.username }}
          className="shrink-0"
        >
          <Avatar src={author.avatar_url} name={displayName} size={36} />
        </Link>
      ) : (
        <Avatar src={author?.avatar_url} name={displayName} size={36} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {author?.username ? (
            <Link
              to="/u/$username"
              params={{ username: author.username }}
              className="hover:underline"
            >
              {displayName}
            </Link>
          ) : (
            displayName
          )}
        </p>
        <p className="break-words text-sm">{comment.content}</p>
        <time
          className="text-sm text-muted-foreground"
          dateTime={comment.created_at}
        >
          {timeAgo(comment.created_at)}
        </time>
      </div>
    </div>
  );
}
