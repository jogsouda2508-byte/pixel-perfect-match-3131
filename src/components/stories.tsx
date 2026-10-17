import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import {
  createStory,
  deleteStory,
  fetchStories,
  validateImage,
  type StoryGroup,
} from "@/lib/social";
import { timeAgo } from "@/lib/time";

/** Every story circle (yours, friends', Local Hub) is exactly this many px, so they all match. */
const STORY_SIZE = 72;

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
      <div className="flex items-start gap-4 overflow-x-auto pb-1 pt-1">
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
            <Avatar src={profile?.avatar_url} name={myName} size={STORY_SIZE} ring />
            <span className="absolute -bottom-1 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground">
              {upload.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
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
            <Avatar src={g.avatar} name={g.name} size={STORY_SIZE} ring />
          </StoryBubble>
        ))}
        <StoryBubble label="Local Hub" onClick={onLocalHub}>
          <div
            className="rounded-full bg-gradient-brand p-[2px]"
            style={{ width: STORY_SIZE, height: STORY_SIZE }}
          >
            <div className="grid h-full w-full place-items-center rounded-full border-2 border-background bg-background">
              <MapPin className="h-7 w-7 text-success" />
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
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 flex-col items-center gap-1.5"
      style={{ width: STORY_SIZE + 12 }}
    >
      {children}
      <span className="w-full truncate text-center text-xs">{label}</span>
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
        <Avatar src={group.avatar} name={group.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="text-xs text-muted-foreground">
            {timeAgo(item.created_at)} • {i + 1}/{group.items.length}
          </p>
        </div>
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
        <img src={item.image_url} alt="" className="max-h-full max-w-full object-contain" />
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
    </div>
  );
}
