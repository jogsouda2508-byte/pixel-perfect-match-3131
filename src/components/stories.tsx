import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Heart, Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import {
  createStory,
  deleteStory,
  fetchStories,
  setStoryLike,
  validateImage,
  type StoryGroup,
} from "@/lib/social";
import { DOUBLE_TAP_MS, HEART_ANIMATION_MS, isDoubleTap, withStoryLiked } from "@/lib/story-like";
import { timeAgo } from "@/lib/time";

export function Stories({ onLocalHub }: { onLocalHub: () => void }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);

  const meId = user?.id ?? "";
  const myName = profile?.full_name || profile?.username || "";
  const { data: groups = [] } = useQuery({
    queryKey: ["stories", meId],
    queryFn: () => fetchStories(meId),
    enabled: !!meId,
  });

  const upload = useMutation({
    mutationFn: (file: File) => createStory(meId, file),
    onSuccess: () => {
      toast.success("Story added");
      void qc.invalidateQueries({ queryKey: ["stories"] });
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't add your story."),
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    const problem = validateImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    upload.mutate(file);
  };

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <StoryBubble label="Create Story" onClick={() => fileRef.current?.click()}>
          <div className="relative">
            <Avatar src={profile?.avatar_url} name={myName} size={60} ring />
            <span className="absolute -bottom-0.5 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-primary">
              {upload.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </span>
          </div>
        </StoryBubble>
        {groups.map((g) => (
          <StoryBubble
            key={g.authorId}
            label={g.authorId === meId ? "Your story" : g.name.split(" ")[0] || g.username}
            onClick={() => setViewing(g)}
          >
            <Avatar src={g.avatar} name={g.name} size={60} ring />
          </StoryBubble>
        ))}
        <StoryBubble label="Local Hub" onClick={onLocalHub}>
          <div className="rounded-full bg-gradient-brand p-[2px]">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-background">
              <MapPin className="h-6 w-6 text-success" />
            </div>
          </div>
        </StoryBubble>
      </div>
      {viewing && <StoryViewer group={viewing} meId={meId} onClose={() => setViewing(null)} />}
    </>
  );
}

function StoryBubble({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex shrink-0 flex-col items-center gap-1.5">
      {children}
      <span className="max-w-[72px] truncate text-xs">{label}</span>
    </button>
  );
}

function StoryViewer({
  group,
  meId,
  onClose,
}: {
  group: StoryGroup;
  meId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const item = group.items[i];
  // Optimistic like state per story (falls back to what the server told us).
  const [likedOverride, setLikedOverride] = useState<Record<string, boolean>>({});
  // The big heart overlay. A new `key` restarts the CSS animation, so it can replay on every like.
  const [heart, setHeart] = useState<{ key: number } | null>(null);
  const heartCount = useRef(0);
  const heartTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef<number | null>(null);
  // Stories with a like/unlike request in flight: stops double-taps from sending duplicates.
  const pendingLikes = useRef(new Set<string>());
  const itemId = item?.id;
  const isLiked = item ? (likedOverride[item.id] ?? item.liked_by_me) : false;

  useEffect(() => {
    // A tap on the previous story must not pair with a tap on this one.
    lastTap.current = null;
  }, [itemId]);
  useEffect(() => () => window.clearTimeout(heartTimer.current), []);

  const playHeart = () => {
    window.clearTimeout(heartTimer.current);
    heartCount.current += 1;
    setHeart({ key: heartCount.current });
    heartTimer.current = window.setTimeout(() => setHeart(null), HEART_ANIMATION_MS + 100);
  };

  const applyLike = async (storyId: string, want: boolean, previous: boolean) => {
    if (pendingLikes.current.has(storyId)) return;
    pendingLikes.current.add(storyId);
    setLikedOverride((current) => ({ ...current, [storyId]: want }));
    try {
      await setStoryLike(storyId, meId, want);
      // Keep the cached stories in step, so reopening the story shows the right heart.
      qc.setQueriesData<StoryGroup[]>({ queryKey: ["stories"] }, (old) =>
        old ? withStoryLiked(old, storyId, want) : old,
      );
    } catch {
      setLikedOverride((current) => ({ ...current, [storyId]: previous }));
      toast.error(want ? "Couldn't like the story. Try again." : "Couldn't remove your like.");
    } finally {
      pendingLikes.current.delete(storyId);
    }
  };

  const onHeartButton = () => {
    if (!item) return;
    if (isLiked) {
      void applyLike(item.id, false, true);
    } else {
      playHeart();
      void applyLike(item.id, true, false);
    }
  };

  // Double-tap the picture to like (never to unlike). The second tap only replays the heart when
  // the story is already liked, and the in-flight guard above prevents duplicate requests.
  const onMediaTap = () => {
    if (!item) return;
    const now = Date.now();
    if (!isDoubleTap(lastTap.current, now, DOUBLE_TAP_MS)) {
      lastTap.current = now;
      return;
    }
    lastTap.current = null;
    playHeart();
    if (!isLiked) void applyLike(item.id, true, false);
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stories"] });
      onClose();
    },
    onError: () => toast.error("Couldn't delete the story."),
  });
  if (!item) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      role="dialog"
      aria-label={`${group.name}'s story`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* Tapping the author opens their profile (and closes the story). */}
        {group.username ? (
          <Link
            to="/u/$username"
            params={{ username: group.username }}
            onClick={onClose}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar src={group.avatar} name={group.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                {timeAgo(item.created_at)} • {i + 1}/{group.items.length}
              </p>
            </div>
          </Link>
        ) : (
          <>
            <Avatar src={group.avatar} name={group.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                {timeAgo(item.created_at)} • {i + 1}/{group.items.length}
              </p>
            </div>
          </>
        )}
        {group.authorId === meId && (
          <button
            onClick={() => del.mutate(item.id)}
            aria-label="Delete story"
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
        <div
          onClick={onMediaTap}
          className="flex max-h-full max-w-full select-none items-center justify-center [touch-action:manipulation]"
        >
          <img
            src={item.image_url}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        </div>
        {heart && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          >
            <span key={heart.key} className="story-heart-burst">
              ❤️
            </span>
          </div>
        )}
        {i > 0 && (
          <button
            onClick={() => setI(i - 1)}
            aria-label="Previous"
            className="absolute left-2 rounded-full bg-black/50 p-2"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {i < group.items.length - 1 && (
          <button
            onClick={() => setI(i + 1)}
            aria-label="Next"
            className="absolute right-2 rounded-full bg-black/50 p-2"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-center p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <button
          type="button"
          onClick={onHeartButton}
          aria-pressed={isLiked}
          aria-label={isLiked ? "Unlike story" : "Like story"}
          className="grid h-12 w-12 place-items-center rounded-full transition-transform hover:bg-white/10 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Heart
            className={`h-7 w-7 transition-colors ${isLiked ? "fill-destructive text-destructive" : "text-white"}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
