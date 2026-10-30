import { describe, expect, it } from "vitest";
import { embedGifs, readEmbeddedGifs, type StoryGif } from "@/lib/story-gifs";
import { embedMusic, readEmbeddedMusic } from "@/lib/story-music";

const gif: StoryGif = {
  id: "xT9IgzoKnwFNmISR8I",
  ratio: 1.5,
  x: 0.4,
  y: 0.6,
  scale: 1.2,
  rot: 0.3,
};
const url = "https://x.supabase.co/storage/v1/object/public/stories/a.jpg";

describe("story gifs", () => {
  it("round-trips through the picture address", () => {
    const out = readEmbeddedGifs(embedGifs(url, [gif]));
    expect(out.image_url).toBe(url);
    expect(out.gifs).toEqual([gif]);
  });

  it("leaves old stories (no gifs) untouched", () => {
    expect(readEmbeddedGifs(url)).toEqual({ image_url: url, gifs: [] });
    expect(readEmbeddedGifs(null)).toEqual({ image_url: null, gifs: [] });
  });

  it("works together with an embedded song", () => {
    const music = { title: "Song - Artist", url: "https://p/1.m4a#len=15" };
    const saved = embedGifs(embedMusic(url, music), [gif]);
    const g = readEmbeddedGifs(saved);
    const m = readEmbeddedMusic(g.image_url);
    expect(g.gifs).toHaveLength(1);
    expect(m.image_url).toBe(url);
    expect(m.music_url).toBe(music.url);
  });

  it("ignores damaged or unsafe data instead of breaking the story", () => {
    expect(readEmbeddedGifs(`${url}#gifs=%7Bnot-json`).gifs).toEqual([]);
    const bad = `${url}#gifs=${encodeURIComponent(JSON.stringify([["../evil", 1, 0.5, 0.5, 1, 0]]))}`;
    expect(readEmbeddedGifs(bad).gifs).toEqual([]);
  });
});
