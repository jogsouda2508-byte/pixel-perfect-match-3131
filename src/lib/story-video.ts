import { supabase } from "@/integrations/supabase/client";
import { STORY_VIDEO_MIGRATION_HINT, isMissingColumnError } from "@/lib/db-errors";
import { storagePathFromPublicUrl, uploadVideoFile, validateVideoFile } from "@/lib/videos";

/** One story segment is never longer than this. */
export const STORY_SEGMENT_SECONDS = 15;
/** A story upload (all its segments together) is never longer than this. */
export const STORY_MAX_SECONDS = 60;
/** The limits the person can pick before publishing. */
export const STORY_DURATION_OPTIONS = [15, 30, 45, 60] as const;
export type StoryDurationOption = (typeof STORY_DURATION_OPTIONS)[number];

/**
 * Containers often report a hair more than the nominal length (a "15 second"
 * clip is frequently 15.03 s). Anything within this many seconds of the limit,
 * or of a whole number of segments, is treated as that length instead of
 * creating a useless 0.03 s segment or rejecting the clip.
 */
export const DURATION_TOLERANCE_SECONDS = 0.25;

export type StorySegment = {
  index: number;
  /** seconds into the video where this segment starts */
  start: number;
  /** seconds into the video where this segment ends */
  end: number;
  duration: number;
};

export type SegmentPlan = { ok: true; segments: StorySegment[] } | { ok: false; error: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The smallest selectable limit that fits the video (null when it is over 60 s). */
export function suggestedLimit(durationSeconds: number): StoryDurationOption | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return (
    STORY_DURATION_OPTIONS.find((o) => durationSeconds <= o + DURATION_TOLERANCE_SECONDS) ?? null
  );
}

/**
 * Splits a video into sequential 15-second segments (max 4 = 60 s).
 * A video longer than the chosen limit is REJECTED, never silently cut short.
 */
export function planStorySegments(durationSeconds: number, limitSeconds: number): SegmentPlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, error: "Couldn't read this video's length. Try a different file." };
  }
  if (!(STORY_DURATION_OPTIONS as readonly number[]).includes(limitSeconds)) {
    return { ok: false, error: "Choose a story length of 15, 30, 45 or 60 seconds." };
  }
  if (durationSeconds > STORY_MAX_SECONDS + DURATION_TOLERANCE_SECONDS) {
    return {
      ok: false,
      error: `Stories can be at most ${STORY_MAX_SECONDS} seconds. This video is ${Math.ceil(durationSeconds)} seconds long.`,
    };
  }
  if (durationSeconds > limitSeconds + DURATION_TOLERANCE_SECONDS) {
    return {
      ok: false,
      error: `This video is ${Math.ceil(durationSeconds)} seconds long, which is over the ${limitSeconds}-second limit you chose. Pick a longer limit or a shorter video.`,
    };
  }

  const total = Math.min(durationSeconds, STORY_MAX_SECONDS);
  const count = Math.max(
    1,
    Math.ceil((total - DURATION_TOLERANCE_SECONDS) / STORY_SEGMENT_SECONDS),
  );
  const segments: StorySegment[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * STORY_SEGMENT_SECONDS;
    const end = Math.min(start + STORY_SEGMENT_SECONDS, total);
    segments.push({
      index: i,
      start: round3(start),
      end: round3(end),
      duration: round3(end - start),
    });
  }
  return { ok: true, segments };
}

/** Reads a video file's length in the browser, without uploading anything. */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("Couldn't read this video. Try a different file."))),
      10_000,
    );
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const d = video.duration;
      // Some recordings report Infinity until the end is reached.
      if (!Number.isFinite(d)) {
        finish(() => reject(new Error("Couldn't read this video's length. Try a different file.")));
        return;
      }
      finish(() => resolve(d));
    };
    video.onerror = () =>
      finish(() =>
        reject(new Error("This video format isn't supported by your browser. Try an MP4 or WebM.")),
      );
    video.src = url;
  });
}

/** Everything wrong with a picked story video before anything is uploaded. */
export async function inspectStoryVideo(
  file: File,
): Promise<{ ok: true; durationSeconds: number } | { ok: false; error: string }> {
  const problem = validateVideoFile(file);
  if (problem) return { ok: false, error: problem };
  try {
    const durationSeconds = await readVideoDuration(file);
    if (durationSeconds > STORY_MAX_SECONDS + DURATION_TOLERANCE_SECONDS) {
      return {
        ok: false,
        error: `Stories can be at most ${STORY_MAX_SECONDS} seconds. This video is ${Math.ceil(durationSeconds)} seconds long.`,
      };
    }
    return { ok: true, durationSeconds };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read this video." };
  }
}

/**
 * Uploads the video once and creates one story row per 15 s segment.
 * Returns how many segments were created. Cleans the file up if saving fails.
 */
export async function createVideoStory(args: {
  authorId: string;
  file: File;
  durationSeconds: number;
  limitSeconds: number;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}): Promise<number> {
  const fileProblem = validateVideoFile(args.file);
  if (fileProblem) throw new Error(fileProblem);
  const plan = planStorySegments(args.durationSeconds, args.limitSeconds);
  if (!plan.ok) throw new Error(plan.error);

  const uploaded = await uploadVideoFile(args.file, args.authorId, args.signal, (p) =>
    args.onProgress(Math.min(99, p)),
  );
  try {
    if (args.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const uploadId = crypto.randomUUID();
    const { error } = await supabase.from("stories").insert(
      plan.segments.map((s) => ({
        author_id: args.authorId,
        media_type: "video" as const,
        video_url: uploaded.publicUrl,
        upload_id: uploadId,
        segment_index: s.index,
        segment_count: plan.segments.length,
        segment_start: s.start,
        segment_end: s.end,
        duration_seconds: s.duration,
      })),
    );
    if (error) {
      console.error("Saving the story failed", error);
      throw new Error(
        isMissingColumnError(error) ? STORY_VIDEO_MIGRATION_HINT : "Couldn't save your story. Please try again.",
      );
    }
    args.onProgress(100);
    return plan.segments.length;
  } catch (e) {
    const { error: cleanupError } = await supabase.storage.from("videos").remove([uploaded.path]);
    if (cleanupError) console.error("Failed to clean up an unpublished story video", cleanupError);
    throw e;
  }
}

/** Best-effort removal of a story video's file once all its segments are gone. */
export async function removeStoryVideoFile(videoUrl: string): Promise<void> {
  const path = storagePathFromPublicUrl(videoUrl, "videos");
  if (!path) return;
  const { error } = await supabase.storage.from("videos").remove([path]);
  if (error) console.error("Failed to remove a story video file", error);
}
