import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  STORY_DURATION_OPTIONS,
  STORY_SEGMENT_SECONDS,
  createVideoStory,
  planStorySegments,
  suggestedLimit,
} from "@/lib/story-video";

/**
 * Shown after a video is picked for a story: choose the length limit
 * (15 / 30 / 45 / 60 s), see how it will be split into 15 s parts, then publish.
 * A video longer than the chosen limit is rejected with a clear message,
 * never silently cut.
 */
export function StoryVideoDialog({
  file,
  durationSeconds,
  authorId,
  onClose,
}: {
  file: File;
  durationSeconds: number;
  authorId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [limit, setLimit] = useState<number>(suggestedLimit(durationSeconds) ?? 60);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  // leaving mid-upload cancels it
  useEffect(() => () => abortRef.current?.abort(), []);

  const plan = useMemo(() => planStorySegments(durationSeconds, limit), [durationSeconds, limit]);

  const publish = async () => {
    if (!plan.ok || uploading) return;
    setError(null);
    setProgress(0);
    setUploading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const parts = await createVideoStory({
        authorId,
        file,
        durationSeconds,
        limitSeconds: limit,
        signal: controller.signal,
        onProgress: setProgress,
      });
      toast.success(parts > 1 ? `Story added in ${parts} parts` : "Story added");
      void qc.invalidateQueries({ queryKey: ["stories"] });
      onClose();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Couldn't add your story.");
      setUploading(false);
    }
  };

  const requestClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add video story</DialogTitle>
          <DialogDescription className="truncate">
            {file.name} · {Math.round(durationSeconds * 10) / 10}s
          </DialogDescription>
        </DialogHeader>

        <video
          src={previewUrl}
          className="max-h-56 w-full rounded-lg bg-black object-contain"
          controls
          muted
          playsInline
          preload="metadata"
        />

        <div>
          <p id="story-limit-label" className="mb-2 text-sm font-medium">
            Story length
          </p>
          <div
            role="radiogroup"
            aria-labelledby="story-limit-label"
            className="grid grid-cols-4 gap-2"
          >
            {STORY_DURATION_OPTIONS.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={limit === o}
                disabled={uploading}
                onClick={() => setLimit(o)}
                className={`min-h-11 rounded-xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  limit === o
                    ? "border-transparent bg-gradient-brand text-primary-foreground"
                    : "border-border bg-card"
                }`}
              >
                {o}s
              </button>
            ))}
          </div>
          <p
            className={`mt-2 text-xs ${plan.ok ? "text-muted-foreground" : "text-destructive"}`}
            role={plan.ok ? undefined : "alert"}
          >
            {plan.ok
              ? plan.segments.length === 1
                ? "Posted as 1 story."
                : `Posted as ${plan.segments.length} stories of up to ${STORY_SEGMENT_SECONDS}s each, in order.`
              : plan.error}
          </p>
        </div>

        {uploading && (
          <div className="space-y-1" aria-live="polite">
            <Progress value={progress} aria-label="Upload progress" />
            <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={requestClose}
            className="min-h-11 rounded-full border border-border px-5 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={!plan.ok || uploading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-brand px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploading ? "Publishing…" : error ? "Try again" : "Publish"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
