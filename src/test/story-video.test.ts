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

  it("splits a 40 second clip into 15 + 15 + 10 second segments, in order", () => {
    const plan = planStorySegments(40, 45);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.segments.map((s) => [s.index, s.start, s.end, s.duration])).toEqual([
      [0, 0, 15, 15],
      [1, 15, 30, 15],
      [2, 30, 40, 10],
    ]);
  });

  it("gives a full 60 second clip four 15 second segments and never more", () => {
    const plan = planStorySegments(60, 60);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.segments).toHaveLength(4);
    expect(plan.segments.at(-1)).toMatchObject({ start: 45, end: 60, duration: 15 });
    expect(plan.segments.every((s) => s.duration <= 15)).toBe(true);
  });

  it("covers the whole clip with no gaps or overlaps", () => {
    for (const d of [1, 14.9, 15, 16, 29.5, 30, 31, 44, 45, 59.9, 60]) {
      const plan = planStorySegments(d, 60);
      if (!plan.ok) throw new Error(`${d}: ${plan.error}`);
      let cursor = 0;
      for (const s of plan.segments) {
        expect(s.start).toBeCloseTo(cursor, 5);
        expect(s.duration).toBeGreaterThan(0.2);
        cursor = s.end;
      }
      expect(cursor).toBeCloseTo(d, 5);
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

  it("uploads once and saves one ordered row per segment, sharing one upload id", async () => {
    const args = { ...base(), durationSeconds: 40, limitSeconds: 45 };
    await expect(createVideoStory(args)).resolves.toBe(3);

    expect(uploadVideoFile).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r["segment_index"])).toEqual([0, 1, 2]);
    expect(rows.map((r) => r["segment_count"])).toEqual([3, 3, 3]);
    expect(rows.map((r) => [r["segment_start"], r["segment_end"], r["duration_seconds"]])).toEqual([
      [0, 15, 15],
      [15, 30, 15],
      [30, 40, 10],
    ]);
    expect(new Set(rows.map((r) => r["upload_id"])).size).toBe(1);
    expect(rows.every((r) => r["author_id"] === "user-1" && r["media_type"] === "video")).toBe(
      true,
    );
    expect(args.onProgress).toHaveBeenLastCalledWith(100);
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
