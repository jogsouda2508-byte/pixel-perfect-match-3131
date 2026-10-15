import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_BYTES,
  validateVideoDuration,
  validateVideoFile,
  truncateCaption,
} from "@/lib/videos";

describe("validateVideoFile", () => {
  it("accepts supported video MIME types and extension fallback", () => {
    expect(
      validateVideoFile({ name: "clip.mp4", size: 1_000, type: "video/mp4" }),
    ).toBeNull();
    expect(
      validateVideoFile({ name: "clip.webm", size: 1_000, type: "video/webm" }),
    ).toBeNull();
    expect(validateVideoFile({ name: "clip.mov", size: 1_000, type: "" })).toBeNull();
  });

  it("rejects unsupported formats, empty files, and files over 50 MB", () => {
    expect(validateVideoFile({ name: "clip.avi", size: 1_000, type: "video/x-msvideo" }))
      .toMatch(/MP4, WebM, or MOV/);
    expect(validateVideoFile({ name: "clip.mp4", size: 0, type: "video/mp4" }))
      .toMatch(/empty/);
    expect(
      validateVideoFile({ name: "clip.mp4", size: MAX_VIDEO_BYTES + 1, type: "video/mp4" }),
    ).toMatch(/50 MB/);
    expect(
      validateVideoFile({ name: "clip.mp4", size: MAX_VIDEO_BYTES, type: "video/mp4" }),
    ).toBeNull();
  });
});

describe("validateVideoDuration", () => {
  it("accepts durations up to 60 seconds and rejects invalid or longer values", () => {
    expect(validateVideoDuration(60)).toBeNull();
    expect(validateVideoDuration(60.01)).toMatch(/60 seconds/);
    expect(validateVideoDuration(0)).toMatch(/duration/);
    expect(validateVideoDuration(Number.NaN)).toMatch(/duration/);
  });
});

describe("truncateCaption", () => {
  it("keeps short captions and truncates long captions at the configured limit", () => {
    expect(truncateCaption("short")).toEqual({ text: "short", truncated: false });
    expect(truncateCaption("a".repeat(121))).toEqual({
      text: `${"a".repeat(120)}…`,
      truncated: true,
    });
  });
});
