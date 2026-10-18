import { beforeEach, describe, expect, it, vi } from "vitest";

const { insert, remove, uploadVideoFile } = vi.hoisted(() => ({
  insert: vi.fn(),
  remove: vi.fn(),
  uploadVideoFile: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({ insert }),
    storage: { from: () => ({ remove }) },
  },
}));
vi.mock("@/lib/videos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/videos")>("@/lib/videos");
  return { ...actual, uploadVideoFile };
});

import {
  STORY_DURATION_OPTIONS,
  createVideoStory,
  planStorySegments,
  suggestedLimit,
} from "@/lib/story-video";

const videoFile = (type = "video/mp4", name = "clip.mp4") =>
  new File([new Uint8Array(1024)], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  uploadVideoFile.mockResolvedValue({
    path: "user-1/abc.mp4",
    publicUrl: "https://x.supabase.co/storage/v1/object/public/videos/user-1/abc.mp4",
  });
  insert.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
});

describe("planStorySegments", () => {
  it("offers exactly 15, 30, 45 and 60 seconds", () => {
    expect([...STORY_DURATION_OPTIONS]).toEqual([15, 30, 45, 60]);
  });

  it("keeps a clip of 15 seconds or less as one story", () => {
    const plan = planStorySegments(9.4, 15);
    expect(plan).toEqual({
      ok: true,
      segments: [{ index: 0, start: 0, end: 9.4, duration: 9.4 }],
    });
  });

  it("keeps a 26 second clip on the 30 second limit as ONE 26 second story", () => {
    const plan = planStorySegments(26, 30);
    expect(plan).toEqual({
      ok: true,
      segments: [{ index: 0, start: 0, end: 26, duration: 26 }],
    });
  });

  it("keeps a 40 second clip as ONE story, never split into 15 second parts", () => {
    const plan = planStorySegments(40, 45);
    expect(plan).toEqual({
      ok: true,
      segments: [{ index: 0, start: 0, end: 40, duration: 40 }],
    });
  });

  it("keeps a full 60 second clip as one 60 second story", () => {
    const plan = planStorySegments(60, 60);
    expect(plan).toEqual({
      ok: true,
      segments: [{ index: 0, start: 0, end: 60, duration: 60 }],
    });
  });

  it("always plans exactly one story covering the whole clip", () => {
    for (const d of [1, 14.9, 15, 16, 29.5, 30, 31, 44, 45, 59.9, 60]) {
      const plan = planStorySegments(d, 60);
      if (!plan.ok) throw new Error(`${d}: ${plan.error}`);
      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]?.start).toBe(0);
      expect(plan.segments[0]?.end).toBeCloseTo(d, 5);
    }
  });

  it("does not create a sliver segment for a '15 second' clip that reports 15.03", () => {
    const plan = planStorySegments(15.03, 15);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]?.end).toBe(15);
  });

  it("REJECTS a clip longer than the chosen limit instead of cutting it", () => {
    const plan = planStorySegments(31, 30);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/31 seconds.*30-second limit/);
  });

  it("rejects anything over 60 seconds even at the 60 second limit", () => {
    const plan = planStorySegments(75, 60);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/at most 60 seconds/);
  });

  it("rejects unreadable durations and limits that are not offered", () => {
    expect(planStorySegments(Number.NaN, 15).ok).toBe(false);
    expect(planStorySegments(0, 15).ok).toBe(false);
    expect(planStorySegments(Number.POSITIVE_INFINITY, 60).ok).toBe(false);
    expect(planStorySegments(10, 20).ok).toBe(false);
  });
});

describe("suggestedLimit", () => {
  it("picks the smallest limit that fits, or null above 60 seconds", () => {
    expect(suggestedLimit(10)).toBe(15);
    expect(suggestedLimit(15.1)).toBe(15);
    expect(suggestedLimit(16)).toBe(30);
    expect(suggestedLimit(46)).toBe(60);
    expect(suggestedLimit(61)).toBeNull();
    expect(suggestedLimit(Number.NaN)).toBeNull();
  });
});

describe("createVideoStory", () => {
  const base = () => ({
    authorId: "user-1",
    file: videoFile(),
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });

  it("uploads once and saves ONE story row for the whole clip", async () => {
    const args = { ...base(), durationSeconds: 26, limitSeconds: 30 };
    await expect(createVideoStory(args)).resolves.toBe(1);

    expect(uploadVideoFile).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      author_id: "user-1",
      media_type: "video",
      segment_index: 0,
      segment_count: 1,
      segment_start: 0,
      segment_end: 26,
      duration_seconds: 26,
    });
    expect(args.onProgress).toHaveBeenLastCalledWith(100);
  });

  it("saves a 40 second clip as one 40 second row, not 15 second parts", async () => {
    await expect(
      createVideoStory({ ...base(), durationSeconds: 40, limitSeconds: 45 }),
    ).resolves.toBe(1);
    const rows = insert.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect([rows[0]?.["segment_start"], rows[0]?.["segment_end"]]).toEqual([0, 40]);
  });

  it("explains the missing database update when the story length rule still says 15 seconds", async () => {
    insert.mockResolvedValue({
      error: {
        code: "23514",
        message: 'new row for relation "stories" violates check constraint "stories_media_check"',
      },
    });
    await expect(
      createVideoStory({ ...base(), durationSeconds: 26, limitSeconds: 30 }),
    ).rejects.toThrow(/20261020000000_story_single_video_views_likes\.sql/);
    expect(remove).toHaveBeenCalledWith(["user-1/abc.mp4"]);
  });

  it("explains the missing database update (and removes the uploaded file) when the video columns don't exist", async () => {
    insert.mockResolvedValue({
      error: { code: "42703", message: "column stories.upload_id does not exist" },
    });
    await expect(
      createVideoStory({ ...base(), durationSeconds: 10, limitSeconds: 15 }),
    ).rejects.toThrow(/20261019000000_story_videos_local_feed\.sql/);
    expect(remove).toHaveBeenCalledWith(["user-1/abc.mp4"]);
  });

  it("rejects a too-long clip BEFORE uploading anything", async () => {
    await expect(
      createVideoStory({ ...base(), durationSeconds: 50, limitSeconds: 30 }),
    ).rejects.toThrow(/over the 30-second limit/);
    expect(uploadVideoFile).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects unsupported and oversized files before uploading", async () => {
    await expect(
      createVideoStory({
        ...base(),
        file: videoFile("video/x-msvideo", "clip.avi"),
        durationSeconds: 10,
        limitSeconds: 15,
      }),
    ).rejects.toThrow(/MP4, WebM, or MOV/);

    const big = videoFile();
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    await expect(
      createVideoStory({ ...base(), file: big, durationSeconds: 10, limitSeconds: 15 }),
    ).rejects.toThrow(/50 MB/);
    expect(uploadVideoFile).not.toHaveBeenCalled();
  });

  it("removes the uploaded file again if saving the rows fails", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      createVideoStory({ ...base(), durationSeconds: 20, limitSeconds: 30 }),
    ).rejects.toThrow(/Couldn't save your story/);
    expect(remove).toHaveBeenCalledWith(["user-1/abc.mp4"]);
  });

  it("reports upload progress", async () => {
    uploadVideoFile.mockImplementation(
      async (_f: File, _u: string, _s: AbortSignal, onProgress: (n: number) => void) => {
        onProgress(40);
        onProgress(100);
        return { path: "user-1/abc.mp4", publicUrl: "https://x/y.mp4" };
      },
    );
    const args = { ...base(), durationSeconds: 10, limitSeconds: 15 };
    await createVideoStory(args);
    const seen = args.onProgress.mock.calls.map((c) => c[0] as number);
    expect(seen).toContain(40);
    expect(seen.at(-1)).toBe(100);
  });
});
