import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { StoryVideoDialog } from "@/components/story-video-dialog";
import { useAuth } from "@/lib/auth";
import {
  createStory,
  deleteStory,
  fetchStories,
  fetchStoryEngagement,
  fetchStoryViewers,
  recordStoryView,
  setStoryLike,
  validateImage,
  type StoryEngagement,
  type StoryGroup,
  type StoryItem,
} from "@/lib/social";
import { inspectStoryVideo } from "@/lib/story-video";
import { timeAgo } from "@/lib/time";

const AVATAR = 64;
/** Photos can be picked together; this keeps one upload batch sensible. */
const MAX_PHOTOS_AT_ONCE = 10;
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov"];

function isVideoFile(file: File): boolean {
  if (file.type) return file.type.startsWith("video/");
  return VIDEO_EXTENSIONS.includes(
    file.name.split(".").pop()?.toLowerCase() ?? "",
  );
}

export function Stories({ onLocalHub }: { onLocalHub?: () => void } = {}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [video, setVideo] = useState<{
    file: File;
    durationSeconds: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  const meId = user?.id ?? "";
  const myName = profile?.full_name || profile?.username || "";
  const {
    data: groups = [],
    isFetching,
    isError,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["stories", meId],
    queryFn: () => fetchStories(meId),
    enabled: !!meId,
  });
  // Your own story lives on the first "Create Story" item, so it is never listed twice.
  const myGroup = groups.find((g) => g.authorId === meId) ?? null;
  const others = groups.filter((g) => g.authorId !== meId);

  const upload = useMutation({
    // One story per photo, uploaded in the order picked. If one fails, the ones before it stay.
    mutationFn: async (files: File[]) => {
      let done = 0;
      try {
        for (const file of files) {
          await createStory(meId, file);
          done += 1;
        }
      } catch (e) {
        const reason =
          e instanceof Error && e.message
            ? e.message
            : "Couldn't add your story.";
        throw new Error(
          files.length > 1
            ? `Added ${done} of ${files.length} stories. ${reason}`
            : reason,
        );
      }
      return done;
    },
    onSuccess: (count: number) => {
      toast.success(count > 1 ? `${count} stories added` : "Story added");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't add your story."),
    // Returned (not fire-and-forget) so the upload stays "busy" until your new stories are in
    // the list. Otherwise a quick second tap would find no story yet and open the picker again.
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["stories"] });
    },
  });

  const onPick = async (picked: File[]) => {
    if (picked.length === 0) return;
    if (picked.length > MAX_PHOTOS_AT_ONCE) {
      toast.error(`Choose up to ${MAX_PHOTOS_AT_ONCE} photos at a time.`);
      return;
    }
    const videos = picked.filter(isVideoFile);
    if (picked.length > 1 && videos.length > 0) {
      toast.error(
        "Add videos one at a time. You can pick several photos together.",
      );
      return;
    }
    const [first] = picked;
    if (picked.length === 1 && first && isVideoFile(first)) {
      setChecking(true);
      const result = await inspectStoryVideo(first);
      setChecking(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setVideo({ file: first, durationSeconds: result.durationSeconds });
      return;
    }
    for (const file of picked) {
      const problem = validateImage(file);
      if (problem) {
        toast.error(picked.length > 1 ? `${file.name}: ${problem}` : problem);
        return;
      }
    }
    upload.mutate(picked);
  };

  const busy = upload.isPending || checking;
  const pick = () => fileRef.current?.click();
  // The list is still loading or refreshing and I have no story in it yet: don't guess.
  const syncing = !myGroup && isFetching;

  /**
   * Tapping my own bubble:
   *  - I already have a story  -> watch it (never the file picker)
   *  - I have none yet         -> choose a photo / video to add
   *  - still loading / uploading, or the list failed to load -> do NOT open the picker
   */
  const onOwnBubble = () => {
    if (myGroup) {
      setViewing(myGroup);
      return;
    }
    if (busy || syncing) return;
    if (isError) {
      toast.error("Couldn't load your stories.", {
        description:
          loadError instanceof Error ? loadError.message : "Please try again.",
      });
      void refetch();
      return;
    }
    pick();
  };

  return (
    <>
      <div
        role="list"
        aria-label="Stories"
        className="-mx-4 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          multiple
          hidden
          onChange={(e) => {
            void onPick(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <div role="listitem" className="relative w-[72px] shrink-0 snap-start">
          <StoryButton
            label="Create Story"
            ariaLabel={myGroup ? "View your story" : "Create a story"}
            onClick={onOwnBubble}
          >
            <Avatar
              src={profile?.avatar_url}
              name={myName}
              size={AVATAR}
              ring={!!myGroup}
              segments={myGroup?.items.length ?? 1}
            />
          </StoryButton>
          {/* The "+" only exists while I have NO story. Once I have one, the bubble opens it;
              adding another one is done from inside the story viewer. */}
          {!myGroup && (
            <button
              type="button"
              onClick={onOwnBubble}
              disabled={busy || syncing}
              aria-label="Add to your story"
              className="absolute right-0 top-[44px] grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80"
            >
              {busy || syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={3} />
              )}
            </button>
          )}
        </div>

        {others.map((g) => (
          <div
            role="listitem"
            key={g.authorId}
            className="w-[72px] shrink-0 snap-start"
          >
            <StoryButton
              label={g.username || g.name.split(" ")[0] || "Story"}
              ariaLabel={`View ${g.name || g.username}'s story`}
              onClick={() => setViewing(g)}
            >
              <Avatar
                src={g.avatar}
                name={g.name}
                size={AVATAR}
                ring
                segments={g.items.length}
              />
            </StoryButton>
          </div>
        ))}

        {/* Optional shortcut to the Local feed tab; only shown when the page passes onLocalHub. */}
        {onLocalHub && (
          <div role="listitem" className="w-[72px] shrink-0 snap-start">
            <StoryButton
              label="Local Hub"
              ariaLabel="Open the Local feed"
              onClick={onLocalHub}
            >
              <div className="rounded-full bg-gradient-brand p-[2px]">
                <div
                  className="grid place-items-center rounded-full bg-background"
                  style={{ height: AVATAR - 4, width: AVATAR - 4 }}
                >
                  <MapPin className="h-6 w-6 text-success" />
                </div>
              </div>
            </StoryButton>
          </div>
        )}
      </div>

      {video && (
        <StoryVideoDialog
          file={video.file}
          durationSeconds={video.durationSeconds}
          authorId={meId}
          onClose={() => setVideo(null)}
        />
      )}
      {viewing && (
        <StoryViewer
          group={viewing}
          meId={meId}
          onClose={() => setViewing(null)}
          onAdd={() => {
            setViewing(null);
            pick();
          }}
        />
      )}
    </>
  );
}

function StoryButton({
  label,
  ariaLabel,
  children,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full flex-col items-center gap-1.5 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <span className="block w-full truncate px-0.5 text-center text-xs leading-4">
        {label}
      </span>
    </button>
  );
}

function StoryViewer({
  group,
  meId,
  onClose,
  onAdd,
}: {
  group: StoryGroup;
  meId: string;
  onClose: () => void;
  /** add another photo / video to my own story */
  onAdd: () => void;
}) {
  const qc = useQueryClient();
  // No warning without a router (e.g. in isolated tests); the profile tap is simply a no-op there.
  const router = useRouter({ warn: false });
  const [i, setI] = useState(0);
  const [fraction, setFraction] = useState(0);
  // The owner's "who viewed" list. The story is paused while it is open.
  const [viewersOpen, setViewersOpen] = useState(false);
  const viewersOpenRef = useRef(false);
  viewersOpenRef.current = viewersOpen;
  // The big heart in the middle of the story. Every new number restarts the animation
  // (0 = nothing showing), so liking another story, or double-tapping again, plays it again.
  const [burst, setBurst] = useState(0);
  // The previous tap on the story, to recognise a double tap.
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  // Stories whose like request is still on its way: a second request is ignored, so a
  // double tap (or tapping fast) can never send the same like twice.
  const likeInFlightRef = useRef<Set<string>>(new Set());
  const item = group.items[i];
  const last = group.items.length - 1;
  const isMine = group.authorId === meId;
  const del = useMutation({
    mutationFn: (s: StoryItem) => deleteStory(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stories"] });
      onClose();
    },
    onError: () => toast.error("Couldn't delete the story."),
  });

  const go = (next: number) => {
    setFraction(0);
    setViewersOpen(false);
    setBurst(0);
    lastTapRef.current = null;
    setI(next);
  };
  const advance = () => (i < last ? go(i + 1) : onClose());
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Photo stories run on a timer (like Instagram): fill the bar over 5s, then go to the next one.
  // The elapsed time is kept in a ref so pausing (viewers list open) resumes where it stopped.
  const itemIsPhoto =
    !!item && !(item.media_type === "video" && !!item.video_url);
  const itemId = item?.id;
  const elapsedRef = useRef(0);
  useEffect(() => {
    elapsedRef.current = 0;
  }, [itemId]);
  useEffect(() => {
    if (!itemIsPhoto || viewersOpen) return;
    const DURATION_MS = 5000;
    const startedAt = performance.now() - elapsedRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      elapsedRef.current = elapsed;
      const f = Math.min(1, elapsed / DURATION_MS);
      setFraction(f);
      if (f >= 1) {
        advanceRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [itemId, itemIsPhoto, viewersOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewersOpenRef.current) setViewersOpen(false);
        else onClose();
      } else if (e.key === "ArrowRight" && i < last) go(i + 1);
      else if (e.key === "ArrowLeft" && i > 0) go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, last]);

  // Someone else's story: remember that I viewed it (once per story; failures are silent).
  useEffect(() => {
    if (!itemId || isMine) return;
    void recordStoryView(itemId);
  }, [itemId, isMine]);

  // Views / likes for the story on screen. Resolves to null when the database update
  // for story likes hasn't been run yet, in which case the buttons below stay hidden.
  const engagementKey = ["story-engagement", itemId] as const;
  const engagement = useQuery({
    queryKey: engagementKey,
    queryFn: () => fetchStoryEngagement(itemId ?? ""),
    enabled: !!itemId,
    retry: false,
    // my own story: keep the counts fresh while I watch it
    refetchInterval: isMine ? 10_000 : false,
  });
  const like = useMutation({
    mutationFn: (args: { storyId: string; liked: boolean }) =>
      setStoryLike(args.storyId, args.liked),
    onMutate: async (args) => {
      const key = ["story-engagement", args.storyId] as const;
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<StoryEngagement | null>(key);
      if (before) {
        const optimistic: StoryEngagement = {
          ...before,
          likedByMe: args.liked,
          likes: Math.max(0, before.likes + (args.liked ? 1 : -1)),
        };
        qc.setQueryData(key, optimistic);
      }
      return { key, before };
    },
    onError: (_e, _args, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.before);
      toast.error("Couldn't update your like.");
    },
    onSettled: (_d, _e, args) => {
      likeInFlightRef.current.delete(args.storyId);
      void qc.invalidateQueries({
        queryKey: ["story-engagement", args.storyId],
      });
      void qc.invalidateQueries({ queryKey: ["story-viewers", args.storyId] });
    },
  });

  if (!item) return null;
  const isVideo = item.media_type === "video" && !!item.video_url;
  const partOfMany = isVideo && item.segment_count > 1;
  const stats = engagement.data ?? null;

  // The heart button updates at once (optimistic) and is saved in the background; if saving
  // fails the heart goes back and a message is shown (see the mutation above).
  const requestLike = (liked: boolean) => {
    if (likeInFlightRef.current.has(item.id)) return;
    likeInFlightRef.current.add(item.id);
    like.mutate({ storyId: item.id, liked });
  };
  const onHeartButton = () => {
    if (!stats || likeInFlightRef.current.has(item.id)) return;
    const liked = !stats.likedByMe;
    if (liked) setBurst((n) => n + 1);
    requestLike(liked);
  };
  // Double tap on the story itself: like it (never unlike) and show the heart. On a story I
  // already liked it only shows the heart again, so no second like is sent. Taps on the
  // buttons over the story don't count. There are no swipe / tap-to-navigate zones here.
  const onStoryTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMine || !stats || viewersOpen) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const now = performance.now();
    const prev = lastTapRef.current;
    if (
      prev &&
      now - prev.t < 300 &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 48
    ) {
      lastTapRef.current = null;
      setBurst((n) => n + 1);
      if (!stats.likedByMe) requestLike(true);
      return;
    }
    lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      role="dialog"
      aria-label={`${group.name}'s story`}
    >
      <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
        {group.items.map((s, idx) => (
          <div
            key={s.id}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/25"
          >
            <div
              className="h-full rounded-full bg-white"
              style={{
                width: `${idx < i ? 100 : idx === i ? fraction * 100 : 0}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 p-4">
        {/* Tapping the author opens their profile (and closes the story). */}
        {group.username ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              void router?.navigate({
                to: "/u/$username",
                params: { username: group.username },
              });
            }}
            aria-label={`Open ${group.name || group.username}'s profile`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Avatar src={group.avatar} name={group.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="text-xs text-white/70">
                {timeAgo(item.created_at)}
              </p>
            </div>
          </button>
        ) : (
          <>
            <Avatar src={group.avatar} name={group.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="text-xs text-white/70">
                {timeAgo(item.created_at)}
              </p>
            </div>
          </>
        )}
        {isMine && (
          <button
            onClick={onAdd}
            aria-label="Add another to your story"
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
        {isMine && (
          <button
            onClick={() => del.mutate(item)}
            disabled={del.isPending}
            aria-label={
              partOfMany
                ? "Delete this video story (all parts)"
                : "Delete story"
            }
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 hover:bg-white/10"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center select-none"
        // no browser zoom on double tap, so a double tap can mean "like"
        style={{ touchAction: "manipulation" }}
        onClick={onStoryTap}
      >
        {isVideo ? (
          <StoryVideo
            key={item.id}
            item={item}
            paused={viewersOpen}
            onProgress={setFraction}
            onDone={advance}
          />
        ) : (
          <img
            src={item.image_url ?? ""}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        )}
        {i > 0 && (
          <button
            onClick={() => go(i - 1)}
            aria-label="Previous"
            className="absolute left-2 rounded-full bg-black/50 p-2"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {i < last && (
          <button
            onClick={() => go(i + 1)}
            aria-label="Next"
            className="absolute right-2 rounded-full bg-black/50 p-2"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
        {burst > 0 && (
          <StoryHeartBurst key={burst} onDone={() => setBurst(0)} />
        )}
      </div>

      {/* Bottom bar: my story shows who viewed / liked it; someone else's has a like button. */}
      {stats && (
        <div className="flex items-center gap-3 px-4 pb-4 pt-3">
          {isMine ? (
            <button
              type="button"
              onClick={() => setViewersOpen(true)}
              aria-label={`Viewers: ${stats.views} ${stats.views === 1 ? "view" : "views"}, ${stats.likes} ${stats.likes === 1 ? "like" : "likes"}`}
              className="flex min-h-11 items-center gap-4 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span className="flex items-center gap-1.5">
                <Eye className="h-5 w-5" aria-hidden="true" />
                {stats.views}
              </span>
              <span className="flex items-center gap-1.5">
                <Heart className="h-5 w-5" aria-hidden="true" />
                {stats.likes}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onHeartButton}
              aria-pressed={stats.likedByMe}
              aria-label={stats.likedByMe ? "Unlike story" : "Like story"}
              className="ml-auto grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Heart
                className={`h-6 w-6 ${stats.likedByMe ? "fill-red-500 text-red-500" : ""}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      )}

      {isMine && viewersOpen && (
        <StoryViewersSheet
          storyId={item.id}
          onClose={() => setViewersOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The big heart that pops in the middle of a story when it is liked (animation in styles.css,
 * ~900 ms; just a fade when the person prefers reduced motion). It never takes taps, so the
 * story controls stay usable, and its removal timer is cleared if it goes away early.
 */
function StoryHeartBurst({ onDone }: { onDone: () => void }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      aria-hidden="true"
      data-testid="story-heart-burst"
      className="pointer-events-none absolute inset-0 z-[5] grid place-items-center"
    >
      <span className="story-heart-pop select-none text-[96px] leading-none drop-shadow-[0_6px_24px_rgba(0,0,0,0.45)] sm:text-[128px]">
        ❤️
      </span>
    </div>
  );
}

/** My own story: everyone who viewed it, newest first, with a heart on the ones who liked it. */
function StoryViewersSheet({
  storyId,
  onClose,
}: {
  storyId: string;
  onClose: () => void;
}) {
  const {
    data: viewers = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["story-viewers", storyId],
    queryFn: () => fetchStoryViewers(storyId),
    refetchInterval: 10_000,
  });
  const likes = viewers.filter((v) => v.liked).length;

  return (
    <div
      role="dialog"
      aria-label="Story viewers"
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-2xl bg-neutral-900 text-white shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {viewers.length} {viewers.length === 1 ? "viewer" : "viewers"}
          </p>
          <p className="text-xs text-white/70">
            {likes} {likes === 1 ? "like" : "likes"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewers"
          className="rounded-full p-2 hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-6 text-center text-sm text-white/70">Loading…</p>
        ) : isError ? (
          <p role="alert" className="p-6 text-center text-sm text-white/70">
            Couldn't load your viewers.
          </p>
        ) : viewers.length === 0 ? (
          <p className="p-6 text-center text-sm text-white/70">No views yet.</p>
        ) : (
          <ul>
            {viewers.map((v) => (
              <li
                key={v.userId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Avatar src={v.avatar} name={v.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{v.name}</p>
                  <p className="truncate text-xs text-white/70">
                    @{v.username} · {timeAgo(v.viewedAt)}
                  </p>
                </div>
                {v.liked && (
                  <span
                    role="img"
                    aria-label="Liked your story"
                    className="shrink-0"
                  >
                    <Heart
                      className="h-5 w-5 fill-red-500 text-red-500"
                      aria-hidden="true"
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Plays only [segment_start, segment_end] of the uploaded file, then moves on. */
function StoryVideo({
  item,
  paused,
  onProgress,
  onDone,
}: {
  item: StoryItem;
  /** true while the owner's viewers list is open */
  paused: boolean;
  onProgress: (fraction: number) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const start = item.segment_start;
  const end = item.segment_end ?? Number.POSITIVE_INFINITY;

  // Pause while the viewers list is open, resume when it closes.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) {
      v.pause();
    } else if (!doneRef.current && v.paused && v.readyState >= 1) {
      const p = v.play() as Promise<void> | undefined;
      p?.catch(() => {});
    }
  }, [paused]);

  // Frame-accurate stop: `timeupdate` is too coarse (about 4 times a second).
  useEffect(() => {
    let raf = 0;
    let lastFraction = -1;
    const tick = () => {
      const v = ref.current;
      if (v && !doneRef.current) {
        const span = Number.isFinite(end) ? end - start : v.duration - start;
        const f =
          span > 0
            ? Math.min(1, Math.max(0, (v.currentTime - start) / span))
            : 0;
        if (Math.abs(f - lastFraction) >= 0.01) {
          lastFraction = f;
          onProgress(f);
        }
        if (v.currentTime >= end - 0.03) {
          doneRef.current = true;
          v.pause();
          onProgress(1);
          onDone();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  return (
    <video
      ref={ref}
      src={`${item.video_url}#t=${start}`}
      className="max-h-full max-w-full object-contain"
      autoPlay
      playsInline
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (Math.abs(v.currentTime - start) > 0.3) v.currentTime = start;
        // browsers may block autoplay with sound; fall back to muted rather than not playing
        void v.play().catch(() => {
          v.muted = true;
          void v.play().catch(() => {});
        });
      }}
      onEnded={() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone();
        }
      }}
    />
  );
}
