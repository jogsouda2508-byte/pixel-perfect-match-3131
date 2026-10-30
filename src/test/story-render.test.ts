import { describe, expect, it } from "vitest";
import { contrastColor, fitText, layoutCaption, layoutText, splitMusicTitle, wrapLines } from "@/lib/story-render";
import { bigCover, embedMusic, musicTitle, readEmbeddedMusic, searchMusic } from "@/lib/story-music";

describe("story text layout", () => {
  it("wraps long text into several lines and keeps short text on one", () => {
    expect(layoutText("Hi").lines).toEqual(["Hi"]);
    const long = layoutText("this is a much longer sentence that has to wrap onto more lines");
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.lines.join(" ")).toBe("this is a much longer sentence that has to wrap onto more lines");
  });

  it("keeps explicit line breaks", () => {
    expect(wrapLines(null, "one\ntwo", 34, 10_000)).toEqual(["one", "two"]);
  });

  it("splits one very long word instead of overflowing", () => {
    const lines = wrapLines(null, "x".repeat(200), 34, 300);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("x".repeat(200));
  });

  it("shortens a caption to three lines with an ellipsis", () => {
    const l = layoutCaption("word ".repeat(120));
    expect(l.lines.length).toBeLessThanOrEqual(3);
    expect(l.lines[l.lines.length - 1]).toMatch(/…$/);
  });

  it("cuts a string to fit with an ellipsis", () => {
    expect(fitText(null, "short", 20, 1000)).toBe("short");
    expect(fitText(null, "a very long song title indeed", 20, 100)).toMatch(/…$/);
  });
});

describe("story helpers", () => {
  it("picks a readable text colour on a box", () => {
    expect(contrastColor("#ffffff")).toBe("#111111");
    expect(contrastColor("#111111")).toBe("#ffffff");
    expect(contrastColor("#ff4d6d")).toBe("#ffffff");
  });

  it("splits 'Song - Artist' for the music label", () => {
    expect(splitMusicTitle("Kesariya - Arijit Singh")).toEqual({ name: "Kesariya", artist: "Arijit Singh" });
    expect(splitMusicTitle("Only a title")).toEqual({ name: "Only a title", artist: "" });
    expect(musicTitle("A", "B")).toBe("A - B");
    expect(musicTitle("A", "")).toBe("A");
  });

  it("asks for a sharper cover", () => {
    expect(bigCover("https://x/y/100x100bb.jpg")).toBe("https://x/y/300x300bb.jpg");
    expect(bigCover(null)).toBeNull();
  });
});

describe("searchMusic", () => {
  const withFetch = (impl: () => Promise<Response>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };

  it("keeps only songs with a preview, forces https and removes duplicates", async () => {
    const restore = withFetch(async () =>
      new Response(
        JSON.stringify({
          results: [
            { trackId: 1, trackName: "One", artistName: "A", previewUrl: "http://p/1.m4a", artworkUrl100: "https://c/100x100bb.jpg" },
            { trackId: 1, trackName: "One", artistName: "A", previewUrl: "http://p/1.m4a" },
            { trackId: 2, trackName: "No preview", artistName: "B" },
          ],
        }),
      ),
    );
    try {
      const r = await searchMusic("one");
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ title: "One - A", url: "https://p/1.m4a", cover: "https://c/300x300bb.jpg" });
    } finally {
      restore();
    }
  });

  it("returns nothing for an empty search and a clear error when the request fails", async () => {
    expect(await searchMusic("   ")).toEqual([]);
    const restore = withFetch(async () => new Response("no", { status: 500 }));
    try {
      await expect(searchMusic("x")).rejects.toThrow(/Couldn't load songs/);
    } finally {
      restore();
    }
  });
});

describe("song kept with the picture address", () => {
  const song = { title: "Kesariya - Arijit Singh", url: "https://p/1.m4a?x=1&y=2" };

  it("round-trips and gives back the clean picture address", () => {
    const stored = embedMusic("https://img/a.jpg", song);
    expect(stored.startsWith("https://img/a.jpg#song=")).toBe(true);
    expect(readEmbeddedMusic(stored)).toEqual({
      image_url: "https://img/a.jpg",
      music_title: song.title,
      music_url: song.url,
    });
  });

  it("leaves ordinary pictures alone and ignores a non-https song", () => {
    expect(readEmbeddedMusic("https://img/a.jpg")).toEqual({
      image_url: "https://img/a.jpg",
      music_title: null,
      music_url: null,
    });
    const bad = embedMusic("https://img/a.jpg", { title: "x", url: "http://p/1.m4a" });
    expect(readEmbeddedMusic(bad).music_url).toBeNull();
    expect(readEmbeddedMusic(null).image_url).toBeNull();
  });
});
