import { describe, expect, it } from "vitest";
import { forcedDownloadUrl, videoExtension, videoFilename } from "@/lib/video-download";

const url = "https://x.supabase.co/storage/v1/object/public/videos/u1/abc.webm";

describe("video download helpers", () => {
  it("uses the real extension from the file URL", () => {
    expect(videoExtension(url)).toBe("webm");
    expect(videoExtension(`${url}?token=1`)).toBe("webm");
  });
  it("falls back to the MIME type, then mp4", () => {
    expect(videoExtension("https://x.test/file", "video/quicktime")).toBe("mov");
    expect(videoExtension("https://x.test/file")).toBe("mp4");
  });
  it("builds a sensible, safe filename", () => {
    expect(videoFilename("123-abc", url)).toBe("gicco-chat-video-123-abc.webm");
    expect(videoFilename("../evil/id", "https://x.test/a.mp4")).toBe("gicco-chat-video-evilid.mp4");
  });
  it("adds the download parameter without dropping the path", () => {
    const result = forcedDownloadUrl(url, "gicco-chat-video-1.webm");
    expect(result).toContain("/videos/u1/abc.webm");
    expect(new URL(result).searchParams.get("download")).toBe("gicco-chat-video-1.webm");
  });
});
