import { UserSafetyMenu } from "@/components/user-safety-menu";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  Eye,
  Heart,
  Loader2,
  MapPin,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Avatar, STORY_RING_CSS } from "@/components/ediraa";
import { CloseFriendsSheet } from "@/components/close-friends-sheet";
import { fetchCloseFriendIds } from "@/lib/close-friends";
import { PollCard, PollSheet } from "@/components/poll-card";
import { StoryEditor } from "@/components/story-editor";
import { StoryMusicPlayer } from "@/components/story-music-player";
import { StoryPhoto } from "@/components/story-gif-layer";
import type { StoryGif } from "@/lib/story-gifs";
import { readMusicSeconds } from "@/lib/story-music";
import { StoryReplyBar } from "@/components/story-reply-bar";
import { StoryVideoDialog } from "@/components/story-video-dialog";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { createPoll, pollKey, usePoll, type PollDraft } from "@/lib/polls";
import { inspectStoryVideo, preloadStoryVideo } from "@/lib/story-video";
import {
  clearStoryLoadingAuthor,
  markStorySeen,
  setStoryLoadingAuthor,
  useLoadingStoryAuthor,
  useSeenStories,
} from "@/lib/story-seen";
import { timeAgo } from "@/lib/time";
import { userMessage } from "@/lib/security";

/** Story circle size: a little bigger on phones, unchanged on larger screens. */
const AVATAR_DESKTOP = 56;
const AVATAR_MOBILE = 64;
/** Photos can be picked together; this keeps one upload batch sensible. */
const MAX_PHOTOS_AT_ONCE = 10;
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov"];

function isVideoFile(file: File): boolean {
  if (file.type) return file.type.startsWith("video/");
  return VIDEO_EXTENSIONS.includes(file.name.split(".").pop()?.toLowerCase() ?? "");
}

export function Stories({
  onLocalHub,
  mode = "row",
  onReady,
}: {
  onLocalHub?: () => void;
  /**
   * "row" (Home) draws the story bubbles. "creator" draws nothing visible: it only owns the
   * photo / video picker, the story editor and the upload, so another page (my profile) can
   * start a new story. The page receives the function that opens the picker through `onReady`.
   */
  mode?: "row" | "creator";
  onReady?: (addStory: () => void) => void;
} = {}) {
  const isMobile = useIsMobile();
  const AVATAR = isMobile ? AVATAR_MOBILE : AVATAR_DESKTOP;
  const COLUMN = AVATAR + 16; // 72px on desktop, 80px on phones
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [video, setVideo] = useState<{
    file: File;
    durationSeconds: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  // A single photo opens the story editor (text, stickers, music, drawing, caption) first.
  const [editing, setEditing] = useState<File | null>(null);
  // The Close Friends list picker (opened from the editor, the video dialog or when the list is empty).
  const [friendsSheet, setFriendsSheet] = useState(false);

  const meId = user?.id ?? "";
  // Stories I already watched (their ring part turns grey) and who is loading right now.
  const seenIds = useSeenStories(meId);
  const loadingAuthor = useLoadingStoryAuthor();
  // The person whose heavy video is being prepared: their ring spins before the story opens.
  const [preparing, setPreparing] = useState<string | null>(null);
  const prepAbortRef = useRef<AbortController | null>(null);
  const openGroup = (g: StoryGroup) => {
    prepAbortRef.current?.abort();
    const first = g.items[0];
    if (!first || first.media_type !== "video" || !first.video_url) {
      setPreparing(null);
      setViewing(g);
      return;
    }
    const ctl = new AbortController();
    prepAbortRef.current = ctl;
    setPreparing(g.authorId);
    void preloadStoryVideo(first.video_url, first.segment_start, {
      signal: ctl.signal,
    }).then(() => {
      if (ctl.signal.aborted) return;
      setPreparing(null);
      setViewing(g);
    });
  };
  useEffect(() => () => prepAbortRef.current?.abort(), []);
  // The whole ring is grey only when EVERY story of the person is watched. If they add a new
  // story, the whole ring is coloured again (never half grey, half colour).
  const seenFlags = (g: StoryGroup) => {
    const all = g.items.length > 0 && g.items.every((s) => seenIds.has(s.id));
    return g.items.map(() => all);
  };
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
  // Same order as the row: my story first, then everyone else. Swiping sideways inside a
  // story moves along this list.
  const viewList = myGroup ? [myGroup, ...others] : others;
  const viewIdx = viewing ? viewList.findIndex((g) => g.authorId === viewing.authorId) : -1;
  // Moves to the next / previous person; false when there is nobody in that direction.
  const swipeToPerson = (dir: 1 | -1): boolean => {
    const next = viewList[viewIdx + dir];
    if (viewIdx < 0 || !next) return false;
    setViewing(next);
    return true;
  };

  const upload = useMutation({
    // One story per photo, uploaded in the order picked. If one fails, the ones before it stay.
    mutationFn: async ({
      files,
      music,
      gifs,
      closeFriends,
    }: {
      files: File[];
      music?: { title: string; url: string } | null;
      gifs?: StoryGif[];
      closeFriends?: boolean;
    }) => {
      let done = 0;
      try {
        for (const file of files) {
          if (closeFriends) await createStory(meId, file, music ?? null, gifs ?? null, true);
          else if (gifs && gifs.length > 0) await createStory(meId, file, music ?? null, gifs);
          else if (music) await createStory(meId, file, music);
          else await createStory(meId, file);
          done += 1;
        }
      } catch (e) {
        const reason = userMessage(e, "Couldn't add your story.");
        throw new Error(
          files.length > 1 ? `Added ${done} of ${files.length} stories. ${reason}` : reason,
        );
      }
      return done;
    },
    onSuccess: (count: number, vars) => {
      toast.success(
        vars.closeFriends
          ? "Shared with Close Friends"
          : count > 1
            ? `${count} stories added`
            : "Story added",
      );
    },
    onError: (e: Error) => toast.error(userMessage(e, "Couldn't add your story.")),
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
      toast.error("Add videos one at a time. You can pick several photos together.");
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
    // One still photo: edit it first. An animated GIF skips the editor (it would become a still
    // picture), and several photos at once are added straight away as before.
    if (picked.length === 1 && first && first.type !== "image/gif") {
      setEditing(first);
      return;
    }
    upload.mutate({ files: picked });
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
      openGroup(myGroup);
      return;
    }
    if (busy || syncing) return;
    if (isError) {
      toast.error("Couldn't load your stories.", {
        description: userMessage(loadError, "Please try again."),
      });
      void refetch();
      return;
    }
    pick();
  };

  // Used by the creator mode: always opens the picker (even when I already have a story).
  const addStory = () => {
    if (!busy) pick();
  };
  const addStoryRef = useRef(addStory);
  addStoryRef.current = addStory;
  useEffect(() => {
    onReady?.(() => addStoryRef.current());
  }, [onReady]);

  return (
    <>
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
      {mode === "row" && (
      <div
        role="list"
        aria-label="Stories"
        className="-mx-4 flex snap-x gap-0 overflow-x-auto scroll-px-4 sm:gap-3 px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <div role="listitem" className="relative shrink-0 snap-start" style={{ width: COLUMN }}>
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
              seen={myGroup ? seenFlags(myGroup) : undefined}
              loading={
                !!myGroup && (loadingAuthor === myGroup.authorId || preparing === myGroup.authorId)
              }
              tone={myGroup?.items.some((s) => s.close_friends_only) ? "close" : "default"}
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
              // badge's bottom-right corner = avatar's bottom-right corner (row is COLUMN px wide, avatar centred,
              // 4px button padding on top); follows AVATAR if it is resized
              style={{ right: (COLUMN - AVATAR) / 2 - 4, top: 4 + AVATAR - 24 }}
              className="absolute grid h-6 w-6 place-items-center rounded-full border-2 border-card bg-gradient-brand text-primary-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80"
            >
              {busy || syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={3} />
              )}
            </button>
          )}
        </div>

        {others.map((g) => (
          <div
            role="listitem"
            key={g.authorId}
            className="shrink-0 snap-start"
            style={{ width: COLUMN }}
          >
            <StoryButton
              label={g.username || g.name.split(" ")[0] || "Story"}
              ariaLabel={`View ${g.name || g.username}'s story`}
              onClick={() => openGroup(g)}
            >
              <Avatar
                src={g.avatar}
                name={g.name}
                size={AVATAR}
                ring
                segments={g.items.length}
                seen={seenFlags(g)}
                loading={loadingAuthor === g.authorId || preparing === g.authorId}
                tone={g.items.some((s) => s.close_friends_only) ? "close" : "default"}
              />
            </StoryButton>
          </div>
        ))}

        {/* Optional shortcut to the Local feed tab; only shown when the page passes onLocalHub. */}
        {onLocalHub && (
          <div role="listitem" className="shrink-0 snap-start" style={{ width: COLUMN }}>
            <StoryButton label="Local Hub" ariaLabel="Open the Local feed" onClick={onLocalHub}>
              <div
                className="rounded-full p-[1.5px]"
                style={{ backgroundImage: STORY_RING_CSS }}
              >
                <div
                  className="grid place-items-center rounded-full bg-card"
                  style={{ height: AVATAR - 3, width: AVATAR - 3 }}
                >
                  <MapPin
                    className="text-primary"
                    style={{ height: AVATAR * 0.43, width: AVATAR * 0.43 }}
                  />
                </div>
              </div>
            </StoryButton>
          </div>
        )}
      </div>
      )}

      {editing && (
        <StoryEditor
          file={editing}
          onClose={() => setEditing(null)}
          onShare={(edited, music, gifs, closeFriends) => {
            setEditing(null);
            upload.mutate({
              files: [edited],
              music,
              ...(gifs ? { gifs } : {}),
              ...(closeFriends ? { closeFriends: true } : {}),
            });
          }}
          onPickCloseFriends={async () => {
            try {
              if ((await fetchCloseFriendIds(meId)).length > 0) return true;
              toast("Pick who is on your Close Friends list first.");
            } catch (e) {
              toast.error(userMessage(e, "Couldn't load your Close Friends list."));
              return false;
            }
            setFriendsSheet(true);
            return false;
          }}
        />
      )}

      {video && (
        <StoryVideoDialog
          file={video.file}
          durationSeconds={video.durationSeconds}
          authorId={meId}
          onClose={() => setVideo(null)}
          onEditCloseFriends={() => setFriendsSheet(true)}
        />
      )}
      {friendsSheet && (
        <CloseFriendsSheet open onOpenChange={setFriendsSheet} meId={meId} z={120} />
      )}
      {viewing && (
        <StoryCubeHost
          prev={viewIdx > 0 ? (viewList[viewIdx - 1] ?? null) : null}
          next={viewIdx >= 0 ? (viewList[viewIdx + 1] ?? null) : null}
          onSlide={swipeToPerson}
        >
          {(slide) => (
            <StoryViewer
              key={viewing.authorId}
              group={viewing}
              meId={meId}
              onSwipePerson={slide}
              onClose={() => setViewing(null)}
              onAdd={() => {
                setViewing(null);
                pick();
              }}
            />
          )}
        </StoryCubeHost>
      )}
    </>
  );
}

/**
 * Swiping sideways between people (like WhatsApp status / Instagram stories): the story follows
 * your finger as a turning cube, and the next / previous person's story shows on the side face.
 *
 * It only wraps the viewer: the viewer itself (timers, music, likes, views) is untouched. The side
 * faces are light, still previews that are mounted only while a swipe is happening. Idle, there is
 * no transform at all, so the story behaves exactly as before.
 */
const CUBE_MS = 280;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function StoryCubeHost({
  prev,
  next,
  onSlide,
  children,
}: {
  prev: StoryGroup | null;
  next: StoryGroup | null;
  /** called once the cube has turned: 1 = next person, -1 = previous person */
  onSlide: (dir: 1 | -1) => void;
  children: (slide: (dir: 1 | -1) => boolean) => React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  // true only while a swipe / turn is happening: then the side faces and the 3D look exist
  const [active, setActive] = useState(false);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gestureRef = useRef<{
    id: number;
    x: number;
    y: number;
    t: number;
    locked: boolean;
    cancelled: boolean;
    dx: number;
  } | null>(null);
  const prevRef = useRef(prev);
  const nextRef = useRef(next);
  const onSlideRef = useRef(onSlide);
  prevRef.current = prev;
  nextRef.current = next;
  onSlideRef.current = onSlide;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Warm up the first picture of the neighbours so the side face is not empty while swiping.
  useEffect(() => {
    for (const g of [prev, next]) {
      const first = g?.items[0];
      if (first?.image_url && first.media_type !== "video") new Image().src = first.image_url;
    }
  }, [prev, next]);

  const widthOf = () => hostRef.current?.clientWidth || window.innerWidth || 1;

  // Turn the cube by `dx` pixels of finger movement (negative = towards the next person).
  const apply = (dx: number, animate: boolean) => {
    const cube = cubeRef.current;
    const host = hostRef.current;
    if (!cube || !host) return;
    const w = widthOf();
    const clamped = Math.max(-w, Math.min(w, dx));
    host.style.perspective = `${Math.max(w * 2, 900)}px`;
    cube.style.transition = animate
      ? `transform ${CUBE_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)`
      : "none";
    cube.style.transform = `translateZ(${-w / 2}px) rotateY(${(clamped / w) * 90}deg)`;
  };
  const clearStyles = () => {
    const cube = cubeRef.current;
    const host = hostRef.current;
    if (cube) {
      cube.style.transform = "";
      cube.style.transition = "";
    }
    if (host) host.style.perspective = "";
  };

  const finish = (dir: 1 | -1 | 0) => {
    clearTimeout(timerRef.current);
    flushSync(() => {
      setActive(false);
      if (dir !== 0) onSlideRef.current(dir);
    });
    clearStyles();
    busyRef.current = false;
  };

  // Finish a turn: dir 1 / -1 = go to that person, 0 = spring back. `from` = where the finger left it.
  const settle = (dir: 1 | -1 | 0, from?: number) => {
    busyRef.current = true;
    if (prefersReducedMotion()) {
      finish(dir);
      return;
    }
    flushSync(() => setActive(true));
    const cube = cubeRef.current;
    if (from === undefined && cube) {
      apply(0, false);
      void cube.offsetWidth; // start the animation from the resting position
    }
    apply(dir === 0 ? 0 : -dir * widthOf(), true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => finish(dir), CUBE_MS + 30);
  };

  // Used by taps on the edges of a story (back on the first / forward on the last one).
  const slide = (dir: 1 | -1): boolean => {
    const neighbour = dir === 1 ? nextRef.current : prevRef.current;
    if (!neighbour) return false;
    if (!busyRef.current) settle(dir);
    return true;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busyRef.current || gestureRef.current) return;
    if (e.button > 0) return;
    const el = e.target as HTMLElement;
    if (!el.closest("[data-story-swipe]") || el.closest("button, input, textarea, [data-no-swipe]"))
      return;
    gestureRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      locked: false,
      cancelled: false,
      dx: 0,
    };
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.id !== e.pointerId || g.cancelled) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        g.cancelled = true; // up / down: not a swipe between people
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      g.locked = true;
      if (prefersReducedMotion()) return;
      flushSync(() => setActive(true));
    }
    g.dx = dx;
    if (prefersReducedMotion()) return;
    // nobody on that side: the story only gives a little, like a rubber band
    const neighbour = dx < 0 ? nextRef.current : prevRef.current;
    apply(neighbour ? dx : dx * 0.2, false);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    gestureRef.current = null;
    if (g.cancelled) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = Math.max(1, performance.now() - g.t);
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    const neighbour = dir === 1 ? nextRef.current : prevRef.current;
    const sideways = Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5;
    // far enough (a quarter of the screen) or a quick flick
    const far = Math.abs(dx) >= widthOf() * 0.25 || Math.abs(dx) / dt >= 0.4;
    const from = g.locked && !prefersReducedMotion() ? g.dx : undefined;
    if (sideways && far && neighbour) settle(dir, from);
    else if (g.locked && !prefersReducedMotion()) settle(0, g.dx);
  };

  const onCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    gestureRef.current = null;
    if (g.locked && !g.cancelled && !prefersReducedMotion()) settle(0, g.dx);
  };

  const faceBase: React.CSSProperties = {
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 z-[100] overflow-hidden bg-black"
      onPointerDownCapture={onDown}
      onPointerMoveCapture={onMove}
      onPointerUpCapture={onUp}
      onPointerCancelCapture={onCancel}
    >
      <div
        ref={cubeRef}
        className="absolute inset-0"
        style={active ? { transformStyle: "preserve-3d", willChange: "transform" } : undefined}
      >
        {active && prev && (
          <div
            className="absolute inset-0"
            style={{
              ...faceBase,
              transform: `rotateY(-90deg) translateZ(${widthOf() / 2}px)`,
            }}
          >
            <StoryPeek group={prev} />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={active ? { ...faceBase, transform: `translateZ(${widthOf() / 2}px)` } : undefined}
        >
          {children(slide)}
        </div>
        {active && next && (
          <div
            className="absolute inset-0"
            style={{
              ...faceBase,
              transform: `rotateY(90deg) translateZ(${widthOf() / 2}px)`,
            }}
          >
            <StoryPeek group={next} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A still look at someone's first story, shown on the side of the cube while swiping. */
function StoryPeek({ group }: { group: StoryGroup }) {
  const first = group.items[0];
  const photo = first && !(first.media_type === "video" && !!first.video_url) ? first : null;
  return (
    <div
      aria-hidden="true"
      className="sz-story-root pointer-events-none absolute inset-0 flex flex-col text-white"
    >
      <div className="flex gap-1 px-3 pt-3">
        {group.items.map((s) => (
          <div key={s.id} className="h-[2px] flex-1 rounded-full bg-white/20" />
        ))}
      </div>
      <div className="sz-story-scrim-top flex items-center gap-3 p-4">
        <Avatar src={group.avatar} name={group.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold">{group.name}</p>
          {first && <p className="text-xs text-white/70">{timeAgo(first.created_at)}</p>}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {photo && <StoryPhoto src={photo.image_url ?? ""} gifs={photo.gifs} />}
      </div>
      <div className="h-[76px] shrink-0" />
    </div>
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
      className="group flex w-full flex-col items-center gap-1.5 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <span className="block w-full truncate px-0.5 text-center text-[11px] font-medium leading-4 text-muted-foreground transition-colors group-hover:text-foreground">
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
  onSwipePerson,
}: {
  group: StoryGroup;
  meId: string;
  onClose: () => void;
  /** swipe sideways: 1 = next person's story (swipe left), -1 = previous person's (swipe right) */
  onSwipePerson?: (dir: 1 | -1) => boolean;
  /** add another photo / video to my own story */
  onAdd: () => void;
}) {
  const qc = useQueryClient();
  // No warning without a router (e.g. in isolated tests); the profile tap is simply a no-op there.
  const router = useRouter({ warn: false });
  const [i, setI] = useState(0);
  const [fraction, setFraction] = useState(0);
  // True while the current video story loads / buffers: the author's ring shows the loader.
  const [videoLoading, setVideoLoading] = useState(false);
  // The owner's "who viewed" list. The story is paused while it is open.
  const [viewersOpen, setViewersOpen] = useState(false);
  const viewersOpenRef = useRef(false);
  viewersOpenRef.current = viewersOpen;
  // Press and hold on the story to pause it; letting go resumes from the same point.
  const [held, setHeld] = useState(false);
  // Typing a reply, or writing a poll, also pauses the story.
  const [replying, setReplying] = useState(false);
  const [pollSheetOpen, setPollSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = pollSheetOpen;
  // Pauses while the report / block menu is open (see UserSafetyMenu below).
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const paused = viewersOpen || held || replying || pollSheetOpen || safetyOpen || confirmDel;
  // The song of a photo story: the speaker button in the header mutes it for this viewing.
  const [musicMuted, setMusicMuted] = useState(false);
  // The browser may refuse to start sound on its own: then the speaker button starts it.
  const [musicBlocked, setMusicBlocked] = useState(false);
  const [musicRetry, setMusicRetry] = useState(0);
  // When the current press started, so a long press is never counted as a tap (double-tap like).
  const pressStartRef = useRef<number | null>(null);
  // Where the current press began, to tell a sideways swipe from a tap or a hold.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  // True when the press moved: that was a drag / swipe, never a tap (double-tap like).
  const draggedRef = useRef(false);
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

  const tapNavRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapNavRef.current), []);
  const go = (next: number) => {
    setFraction(0);
    setViewersOpen(false);
    setBurst(0);
    setHeld(false);
    lastTapRef.current = null;
    clearTimeout(tapNavRef.current);
    setI(next);
  };
  const advance = () => (i < last ? go(i + 1) : onClose());
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Photo stories run on a timer (like Instagram): fill the bar over 5s, then go to the next one.
  // The elapsed time is kept in a ref so pausing (viewers list open) resumes where it stopped.
  const itemIsPhoto = !!item && !(item.media_type === "video" && !!item.video_url);
  const itemId = item?.id;
  // a song picked with a length ("15s") also sets how long the photo stays on screen
  const song = item?.music_url ? readMusicSeconds(item.music_url) : null;
  const songSeconds = song?.seconds ?? null;
  const elapsedRef = useRef(0);
  useEffect(() => {
    elapsedRef.current = 0;
  }, [itemId]);
  useEffect(() => {
    if (!itemIsPhoto || paused) return;
    const DURATION_MS = songSeconds ? songSeconds * 1000 : 5000;
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
  }, [itemId, itemIsPhoto, paused, songSeconds]);

  // Releasing anywhere (even outside the story, or if the browser cancels the touch) resumes it.
  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [held]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // keys belong to the message box / poll sheet while they are in use
      if (sheetOpenRef.current || (e.target as HTMLElement | null)?.closest?.("input, textarea"))
        return;
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

  // Grey ring: remember (on this device) every story I have watched, mine included.
  useEffect(() => {
    if (itemId) markStorySeen(meId, itemId);
  }, [itemId, meId]);

  // Tell the story row which person is loading, so their ring animates there as well.
  useEffect(() => {
    if (videoLoading) setStoryLoadingAuthor(group.authorId);
    else clearStoryLoadingAuthor(group.authorId);
    return () => clearStoryLoadingAuthor(group.authorId);
  }, [videoLoading, group.authorId]);

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
  // The poll on the story on screen (null when there is none).
  const poll = usePoll({ storyId: itemId });
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

  const addPoll = async (draft: PollDraft) => {
    await createPoll({ storyId: item.id }, draft.question, draft.options);
    await qc.invalidateQueries({ queryKey: pollKey("story", item.id) });
    toast.success("Poll added to your story");
  };

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
  const heartButton = stats ? (
    <button
      type="button"
      onClick={onHeartButton}
      aria-pressed={stats.likedByMe}
      aria-label={stats.likedByMe ? "Unlike story" : "Like story"}
      className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <Heart
        className={`sz-spring h-6 w-6 ${stats.likedByMe ? "fill-red-500 text-red-500" : ""}`}
        aria-hidden="true"
      />
    </button>
  ) : null;
  // Tapping the story works like Instagram: the left third goes back, the rest goes forward
  // (back on the first story = the previous person, forward on the last = the next person, then
  // close). On someone else's story a quick double tap still likes it (never unlikes) and shows
  // the heart; to tell the two apart, their single tap waits a moment. Taps on the buttons over
  // the story don't count, and neither does a press-and-hold (pause) or a swipe.
  const onStoryTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (viewersOpen) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const now = performance.now();
    const pressedAt = pressStartRef.current;
    pressStartRef.current = null;
    if (draggedRef.current) {
      draggedRef.current = false;
      lastTapRef.current = null;
      return;
    }
    if (pressedAt !== null && now - pressedAt > 300) {
      // This was a press-and-hold (pause), not a tap.
      lastTapRef.current = null;
      return;
    }
    const canLike = !isMine && !!stats;
    const prev = lastTapRef.current;
    if (
      canLike &&
      prev &&
      now - prev.t < 300 &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 48
    ) {
      clearTimeout(tapNavRef.current);
      lastTapRef.current = null;
      setBurst((n) => n + 1);
      if (!stats.likedByMe) requestLike(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const goBack = e.clientX - rect.left < rect.width * 0.3;
    const move = () => {
      lastTapRef.current = null;
      if (goBack) {
        if (i > 0) go(i - 1);
        else onSwipePerson?.(-1);
      } else if (i < last) go(i + 1);
      else if (!onSwipePerson?.(1)) onClose();
    };
    clearTimeout(tapNavRef.current);
    if (canLike) {
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      tapNavRef.current = setTimeout(move, 300);
    } else move();
  };

  return (
    <div
      className="sz-story-root fixed inset-0 z-[100] flex flex-col text-white"
      role="dialog"
      aria-label={`${group.name}'s story`}
    >
      {confirmDel && (
        <div
          className="fixed inset-0 z-[130] grid place-items-center bg-black/70 px-6 backdrop-blur-sm"
          onClick={() => setConfirmDel(false)}
        >
          <div
            role="alertdialog"
            aria-label="Delete story"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl border border-white/10 bg-[#14141f] p-5 text-center shadow-2xl"
          >
            <p className="text-base font-semibold">
              {partOfMany ? "Delete this video story?" : "Delete this story?"}
            </p>
            <p className="mt-1.5 text-sm text-white/65">
              It will be removed for good and can't be brought back.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="min-h-11 flex-1 rounded-xl bg-white/10 text-sm font-semibold hover:bg-white/15"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={del.isPending}
                onClick={() => {
                  setConfirmDel(false);
                  del.mutate(item);
                }}
                className="min-h-11 flex-1 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
        {group.items.map((s, idx) => (
          <div key={s.id} className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="sz-story-bar h-full rounded-full"
              style={{
                width: `${idx < i ? 100 : idx === i ? fraction * 100 : 0}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="sz-story-scrim-top flex items-center gap-3 p-4">
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
            <Avatar src={group.avatar} name={group.name} size={36} loading={videoLoading} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold">{group.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/70">
                {timeAgo(item.created_at)}
                {item.close_friends_only && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-success-foreground">
                    <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                    Close Friends
                  </span>
                )}
              </p>
            </div>
          </button>
        ) : (
          <>
            <Avatar src={group.avatar} name={group.name} size={36} loading={videoLoading} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold">{group.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/70">
                {timeAgo(item.created_at)}
                {item.close_friends_only && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-success-foreground">
                    <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                    Close Friends
                  </span>
                )}
              </p>
            </div>
          </>
        )}
        {item.music_url && itemIsPhoto && (
          <button
            type="button"
            onClick={() => {
              if (musicBlocked) {
                setMusicMuted(false);
                setMusicRetry((n) => n + 1);
              } else setMusicMuted((m) => !m);
            }}
            aria-label={
              musicBlocked ? "Play the song" : musicMuted ? "Turn the song on" : "Mute the song"
            }
            className={`rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${musicBlocked ? "animate-pulse bg-white/20" : ""}`}
          >
            {musicMuted || musicBlocked ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>
        )}
        {isMine && (
          <button
            onClick={onAdd}
            aria-label="Add another to your story"
            className="rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
        {!isMine && !!group.username && (
          <UserSafetyMenu
            userId={group.authorId}
            username={group.username}
            report={{ type: "story", id: item.id, label: "Report story" }}
            trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
            triggerClassName="rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            z={120}
            onOpenChange={setSafetyOpen}
            onDone={(a) => {
              if (a === "blocked") onClose();
            }}
          />
        )}
        {isMine && (
          <button
            onClick={() => setConfirmDel(true)}
            disabled={del.isPending}
            aria-label={partOfMany ? "Delete this video story (all parts)" : "Delete story"}
            className="rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden select-none [-webkit-touch-callout:none]"
        // no browser zoom on double tap, so a double tap can mean "like"; sideways movement is
        // left to us (pan-y only), so a swipe between people is not taken over by the browser
        style={{ touchAction: "pan-y" }}
        data-story-swipe=""
        onClick={onStoryTap}
        onPointerDown={(e) => {
          // left mouse button or touch; the previous / next buttons keep working as taps
          if (e.button > 0 || (e.target as HTMLElement).closest("button")) return;
          pressStartRef.current = performance.now();
          swipeStartRef.current = { x: e.clientX, y: e.clientY };
          draggedRef.current = false;
          setHeld(true);
        }}
        onPointerUp={(e) => {
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) draggedRef.current = true;
          // The sideways swipe between people (cube turn) is handled by StoryCubeHost.
        }}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isVideo ? (
          <StoryVideo
            key={item.id}
            item={item}
            paused={paused}
            onProgress={setFraction}
            onLoadingChange={setVideoLoading}
            onDone={advance}
          />
        ) : (
          <StoryPhoto src={item.image_url ?? ""} gifs={item.gifs} />
        )}
        {item.music_url && itemIsPhoto && (
          <StoryMusicPlayer
            key={item.id}
            url={song?.url ?? item.music_url}
            seconds={songSeconds}
            paused={paused}
            muted={musicMuted}
            retry={musicRetry}
            onBlocked={setMusicBlocked}
          />
        )}
        {burst > 0 && <StoryHeartBurst key={burst} onDone={() => setBurst(0)} />}
        {poll.query.data && (
          // taps on the poll are for voting, never for pausing or double-tap liking
          <div
            className="absolute inset-x-3 bottom-3 z-[6] mx-auto w-[min(100%,17rem)]"
            data-no-swipe=""
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <PollCard storyId={item.id} variant="story" />
          </div>
        )}
      </div>

      {/* Bottom bar: my story shows who viewed / liked it and can get a poll; someone else's
          has six quick reactions, a message box and the like button. */}
      {isMine ? (
        <div className="flex items-center gap-3 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
          {stats && (
            <button
              type="button"
              onClick={() => setViewersOpen(true)}
              aria-label={`Viewers: ${stats.views} ${stats.views === 1 ? "view" : "views"}, ${stats.likes} ${stats.likes === 1 ? "like" : "likes"}`}
              className="flex min-h-8 items-center gap-3 rounded-full bg-white/10 px-3 text-xs font-semibold ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" aria-hidden="true" />
                {stats.views}
              </span>
              <span className="flex items-center gap-1">
                <Heart className="h-4 w-4" aria-hidden="true" />
                {stats.likes}
              </span>
            </button>
          )}
          {poll.query.isSuccess && !poll.query.data && (
            <button
              type="button"
              onClick={() => setPollSheetOpen(true)}
              aria-label="Add a poll to this story"
              className="ml-auto flex min-h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Poll
            </button>
          )}
        </div>
      ) : (
        <StoryReplyBar
          key={item.id}
          storyId={item.id}
          authorName={group.name || group.username || "them"}
          onFocusChange={setReplying}
          trailing={heartButton}
        />
      )}

      {isMine && (
        <PollSheet
          open={pollSheetOpen}
          onOpenChange={setPollSheetOpen}
          submitLabel="Add to story"
          onSubmit={addPoll}
          z={130}
          compact
        />
      )}

      {isMine && viewersOpen && (
        <StoryViewersSheet storyId={item.id} onClose={() => setViewersOpen(false)} />
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
function StoryViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
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
          className="rounded-full p-2.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
              <li key={v.userId} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar src={v.avatar} name={v.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{v.name}</p>
                  <p className="truncate text-xs text-white/70">
                    @{v.username} · {timeAgo(v.viewedAt)}
                  </p>
                </div>
                {v.liked && (
                  <span role="img" aria-label="Liked your story" className="shrink-0">
                    <Heart className="h-5 w-5 fill-red-500 text-red-500" aria-hidden="true" />
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
  onLoadingChange,
  onDone,
}: {
  item: StoryItem;
  /** true while the viewers list is open or the person is holding the story */
  paused: boolean;
  onProgress: (fraction: number) => void;
  /** true while the video loads or buffers (drives the loader on the author's ring) */
  onLoadingChange?: (loading: boolean) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  // True until the video is really playing, and again whenever it stalls to buffer.
  const [loading, setLoading] = useState(true);
  const start = item.segment_start;
  const end = item.segment_end ?? Number.POSITIVE_INFINITY;

  const loadingCbRef = useRef(onLoadingChange);
  loadingCbRef.current = onLoadingChange;
  useEffect(() => {
    loadingCbRef.current?.(loading);
  }, [loading]);
  useEffect(() => () => loadingCbRef.current?.(false), []);

  // Pause while the viewers list is open or the story is held, resume when released.
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
        const f = span > 0 ? Math.min(1, Math.max(0, (v.currentTime - start) / span)) : 0;
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
    <>
      <video
        ref={ref}
        src={`${item.video_url}#t=${start}`}
        className="story-video block h-auto w-full max-w-none"
        autoPlay
        playsInline
        onLoadStart={() => setLoading(true)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => setLoading(false)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Math.abs(v.currentTime - start) > 0.3) v.currentTime = start;
          // browsers may block autoplay with sound; fall back to muted rather than not playing
          void v.play().catch(() => {
            v.muted = true;
            void v.play().catch(() => setLoading(false));
          });
        }}
        onEnded={() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onDone();
          }
        }}
      />
    </>
  );
}
