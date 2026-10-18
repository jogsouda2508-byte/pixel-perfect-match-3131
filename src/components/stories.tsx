import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { StoryVideoDialog } from "@/components/story-video-dialog";
import { useAuth } from "@/lib/auth";
import {
  createStory,
  deleteStory,
  fetchStories,
  validateImage,
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
  return VIDEO_EXTENSIONS.includes(file.name.split(".").pop()?.toLowerCase() ?? "");
}

export function Stories() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [video, setVideo] = useState<{ file: File; durationSeconds: number } | null>(null);
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
        const reason = e instanceof Error && e.message ? e.message : "Couldn't add your story.";
        throw new Error(
          files.length > 1 ? `Added ${done} of ${files.length} stories. ${reason}` : reason,
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
        description: loadError instanceof Error ? loadError.message : "Please try again.",
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
            <Avatar src={profile?.avatar_url} name={myName} size={AVATAR} ring={!!myGroup} />
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
          <div role="listitem" key={g.authorId} className="w-[72px] shrink-0 snap-start">
            <StoryButton
              label={g.username || g.name.split(" ")[0] || "Story"}
              ariaLabel={`View ${g.name || g.username}'s story`}
              onClick={() => setViewing(g)}
            >
              <Avatar src={g.avatar} name={g.name} size={AVATAR} ring />
            </StoryButton>
          </div>
        ))}
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
      <span className="block w-full truncate px-0.5 text-center text-xs leading-4">{label}</span>
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
  const [i, setI] = useState(0);
  const [fraction, setFraction] = useState(0);
  const item = group.items[i];
  const last = group.items.length - 1;
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
    setI(next);
  };
  const advance = () => (i < last ? go(i + 1) : onClose());
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Photo stories run on a timer (like Instagram): fill the bar over 5s, then go to the next one.
  const itemIsPhoto = !!item && !(item.media_type === "video" && !!item.video_url);
  const itemId = item?.id;
  useEffect(() => {
    if (!itemIsPhoto) return;
    const DURATION_MS = 5000;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min(1, (now - startedAt) / DURATION_MS);
      setFraction(f);
      if (f >= 1) {
        advanceRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [itemId, itemIsPhoto]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && i < last) go(i + 1);
      else if (e.key === "ArrowLeft" && i > 0) go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, last]);

  if (!item) return null;
  const isVideo = item.media_type === "video" && !!item.video_url;
  const partOfMany = isVideo && item.segment_count > 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      role="dialog"
      aria-label={`${group.name}'s story`}
    >
      <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
        {group.items.map((s, idx) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
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
        <Avatar src={group.avatar} name={group.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="text-xs text-white/70">{timeAgo(item.created_at)}</p>
        </div>
        {group.authorId === meId && (
          <button
            onClick={onAdd}
            aria-label="Add another to your story"
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
        {group.authorId === meId && (
          <button
            onClick={() => del.mutate(item)}
            disabled={del.isPending}
            aria-label={partOfMany ? "Delete this video story (all parts)" : "Delete story"}
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {isVideo ? (
          <StoryVideo key={item.id} item={item} onProgress={setFraction} onDone={advance} />
        ) : (
          <img src={item.image_url ?? ""} alt="" className="max-h-full max-w-full object-contain" />
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
      </div>
    </div>
  );
}

/** Plays only [segment_start, segment_end] of the uploaded file, then moves on. */
function StoryVideo({
  item,
  onProgress,
  onDone,
}: {
  item: StoryItem;
  onProgress: (fraction: number) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const start = item.segment_start;
  const end = item.segment_end ?? Number.POSITIVE_INFINITY;

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
