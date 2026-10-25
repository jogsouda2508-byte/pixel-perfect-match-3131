import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import {
  createHighlight,
  deleteHighlight,
  fetchHighlights,
  HIGHLIGHT_TITLE_MAX,
  type Highlight,
  type HighlightItem,
} from "@/lib/highlights";
import { fetchStories, type StoryItem } from "@/lib/social";

// Thick solid grey ring (matches the reference: ring ≈ 3px, white gap ≈ 3px around a 64px photo)
const RING = "#E4E7EB";
const SIZE = 64;

/** A photo, or the first frame of a video, filling its box. */
function MediaThumb({
  item,
  className = "",
}: {
  item: Pick<HighlightItem, "media_type" | "image_url" | "video_url" | "segment_start">;
  className?: string;
}) {
  if (item.media_type === "video" && item.video_url) {
    return (
      <video
        src={`${item.video_url}#t=${item.segment_start + 0.1}`}
        muted
        playsInline
        preload="metadata"
        className={`pointer-events-none h-full w-full object-cover ${className}`}
      />
    );
  }
  return (
    <img
      src={item.image_url ?? ""}
      alt=""
      draggable={false}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}

/**
 * The row of story highlights under the profile buttons. Your own profile also gets a "New"
 * circle. Hidden on other people's profiles when they have none.
 */
export function ProfileHighlights({
  profileId,
  name,
  avatar,
  isMe,
}: {
  profileId: string;
  name: string;
  avatar: string | null;
  isMe: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Highlight | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["highlights", profileId],
    queryFn: () => fetchHighlights(profileId),
    retry: false,
  });
  if (data.length === 0 && !isMe) return null;

  return (
    <>
      <div
        role="list"
        aria-label="Story highlights"
        className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isMe && (
          <div role="listitem" className="w-[72px] shrink-0">
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="New highlight"
              className="flex w-full flex-col items-center gap-1.5 focus-visible:outline-none"
            >
              <span
                className="grid place-items-center rounded-full border-2 border-dashed border-border bg-elevated text-muted-foreground"
                style={{ width: SIZE + 4, height: SIZE + 4 }}
              >
                <Plus className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="block w-full truncate text-center text-[11px] font-medium">New</span>
            </button>
          </div>
        )}
        {data.map((h) => (
          <div role="listitem" key={h.id} className="w-[72px] shrink-0">
            <button
              type="button"
              onClick={() => setViewing(h)}
              aria-label={`Open highlight ${h.title}`}
              className="flex w-full flex-col items-center gap-1.5 focus-visible:outline-none"
            >
              <span
                className="rounded-full p-[3px]"
                style={{ backgroundColor: RING }}
              >
                <span
                  className="block overflow-hidden rounded-full border-[3px] border-background bg-elevated"
                  style={{ width: SIZE, height: SIZE }}
                >
                  <MediaThumb item={h.items[0]!} />
                </span>
              </span>
              <span className="block w-full truncate text-center text-[11px] font-medium">
                {h.title}
              </span>
            </button>
          </div>
        ))}
      </div>

      {creating && (
        <NewHighlightSheet ownerId={profileId} onClose={() => setCreating(false)} />
      )}
      {viewing && (
        <HighlightViewer
          highlight={viewing}
          ownerId={profileId}
          name={name}
          avatar={avatar}
          isMe={isMe}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/** Pick some of my current stories and give the highlight a name. */
function NewHighlightSheet({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const stories = useQuery({
    queryKey: ["stories", ownerId],
    queryFn: () => fetchStories(ownerId),
  });
  const mine: StoryItem[] = stories.data?.find((g) => g.authorId === ownerId)?.items ?? [];

  const create = useMutation({
    mutationFn: () =>
      createHighlight(
        ownerId,
        title,
        mine.filter((s) => picked.includes(s.id)),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["highlights", ownerId] });
      toast.success("Highlight added to your profile");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't create the highlight."),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New highlight"
      className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-10 w-10 place-items-center rounded-full hover:bg-elevated"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
        <h2 className="flex-1 text-center text-base font-semibold">New highlight</h2>
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={picked.length === 0 || create.isPending}
          className="min-w-16 rounded-full bg-gradient-brand px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Add"}
        </button>
      </div>

      <div className="px-4 pt-4">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="hl-title">
          Name
        </label>
        <input
          id="hl-title"
          value={title}
          maxLength={HIGHLIGHT_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Highlights"
          className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">
          Choose from your current stories{picked.length > 0 ? ` · ${picked.length} selected` : ""}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {stories.isLoading ? (
          <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-primary" />
        ) : mine.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            You have no stories right now. Add a story first, then save it to a highlight here
            before the 24 hours end.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {mine.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={on}
                  aria-label={on ? "Remove story" : "Select story"}
                  className="relative aspect-[3/4] overflow-hidden rounded-xl bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MediaThumb item={s} />
                  <span
                    className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 ${on ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/30 text-transparent"}`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {on && <span className="absolute inset-0 bg-primary/15" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Full-screen player for one highlight: photos 5 s each, videos play their part, tap sides. */
function HighlightViewer({
  highlight,
  ownerId,
  name,
  avatar,
  isMe,
  onClose,
}: {
  highlight: Highlight;
  ownerId: string;
  name: string;
  avatar: string | null;
  isMe: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [fraction, setFraction] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const items = highlight.items;
  const item = items[i];
  const last = items.length - 1;
  const isVideo = item?.media_type === "video" && !!item.video_url;

  const go = (next: number) => {
    if (next < 0) return;
    if (next > last) {
      onClose();
      return;
    }
    setFraction(0);
    setI(next);
  };
  const goRef = useRef(go);
  goRef.current = go;

  const del = useMutation({
    mutationFn: () => deleteHighlight(highlight.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["highlights", ownerId] });
      toast.success("Highlight deleted");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't delete the highlight."),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goRef.current(i + 1);
      else if (e.key === "ArrowLeft") goRef.current(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, onClose]);

  // photos: fill the bar over 5 seconds, then the next one
  useEffect(() => {
    if (isVideo || confirming) return;
    const DURATION = 5000;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min(1, (now - startedAt) / DURATION);
      setFraction(f);
      if (f >= 1) {
        goRef.current(i + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, isVideo, confirming]);

  // videos: play only [start, end]
  useEffect(() => {
    if (!isVideo || !item) return;
    setLoading(true);
    let raf = 0;
    const start = item.segment_start;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const end = item.segment_end ?? (Number.isFinite(v.duration) ? v.duration : start);
        const span = end - start;
        if (span > 0) setFraction(Math.min(1, Math.max(0, (v.currentTime - start) / span)));
        if (v.currentTime >= end - 0.05 && v.readyState >= 2 && !v.paused) {
          v.pause();
          goRef.current(i + 1);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, isVideo, item]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    if (confirming) v.pause();
    else void v.play().catch(() => undefined);
  }, [confirming, isVideo, i]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Highlight ${highlight.title}`}
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
    >
      <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
        {items.map((it, idx) => (
          <div key={it.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${idx < i ? 100 : idx === i ? fraction * 100 : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 p-4">
        <Avatar src={avatar} name={name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{highlight.title}</p>
          <p className="truncate text-xs text-white/70">{name}</p>
        </div>
        {isMe && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Delete highlight"
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 hover:bg-white/10"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center select-none">
        {isVideo ? (
          <video
            key={item.id}
            ref={videoRef}
            src={`${item.video_url}#t=${item.segment_start}`}
            className="max-h-full max-w-full object-contain"
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (Math.abs(v.currentTime - item.segment_start) > 0.3) v.currentTime = item.segment_start;
              void v.play().catch(() => {
                v.muted = true;
                void v.play().catch(() => setLoading(false));
              });
            }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onError={() => setLoading(false)}
            onEnded={() => goRef.current(i + 1)}
          />
        ) : (
          <img
            src={item.image_url ?? ""}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {isVideo && loading && (
          <Loader2 className="pointer-events-none absolute h-9 w-9 animate-spin text-white/80" />
        )}
        {/* tap the left side for the previous one, the right side for the next one */}
        <button
          type="button"
          aria-label="Previous"
          onClick={() => go(i - 1)}
          className="absolute inset-y-0 left-0 w-1/3 focus-visible:outline-none"
        >
          {i > 0 && (
            <ChevronLeft className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 rounded-full bg-black/40 p-1 sm:block" />
          )}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => go(i + 1)}
          className="absolute inset-y-0 right-0 w-1/3 focus-visible:outline-none"
        >
          <ChevronRight className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 rounded-full bg-black/40 p-1 sm:block" />
        </button>
      </div>

      {confirming && (
        <div className="absolute inset-0 z-10 flex items-end bg-black/60">
          <div className="w-full rounded-t-3xl bg-white p-5 text-neutral-900">
            <p className="text-center text-sm font-semibold">Delete this highlight?</p>
            <p className="mt-1 text-center text-xs text-neutral-500">
              It will be removed from your profile. This can't be undone.
            </p>
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="mt-4 w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="mt-2 w-full rounded-xl py-3 text-sm font-semibold text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
