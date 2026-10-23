import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { DOUBLE_TAP_MS, isDoubleTap, withStoryLiked } from "@/lib/story-like";
import { setStoryLike, type StoryGroup, type StoryItem } from "@/lib/social";

const story = (id: string, createdAt: string, liked: boolean): StoryItem => ({
  id,
  media_type: "image",
  image_url: "x",
  video_url: null,
  upload_id: null,
  segment_index: 0,
  segment_count: 1,
  segment_start: 0,
  segment_end: null,
  created_at: createdAt,
  liked_by_me: liked,
});

const group = (liked: boolean): StoryGroup => ({
  authorId: "a",
  name: "Ann",
  username: "ann",
  avatar: null,
  latest: "2026-10-18T00:00:00Z",
  items: [
    story("s1", "2026-10-18T00:00:00Z", liked),
    story("s2", "2026-10-18T00:01:00Z", false),
  ],
});

describe("isDoubleTap", () => {
  it("needs a previous tap, close in time", () => {
    expect(isDoubleTap(null, 1000)).toBe(false);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS)).toBe(true);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    expect(isDoubleTap(1000, 900)).toBe(false);
  });
});

describe("withStoryLiked", () => {
  it("changes only the matching story", () => {
    const [next] = withStoryLiked([group(false)], "s1", true);
    expect(next?.items.map((item) => item.liked_by_me)).toEqual([true, false]);
  });

  it("returns the same array when nothing changes", () => {
    const groups = [group(true)];
    expect(withStoryLiked(groups, "s1", true)).toBe(groups);
    expect(withStoryLiked(groups, "missing", true)).toBe(groups);
  });

  it("does not mutate its input", () => {
    const groups = [group(false)];
    withStoryLiked(groups, "s1", true);
    expect(groups[0]?.items[0]?.liked_by_me).toBe(false);
  });
});

describe("setStoryLike", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("likes through the idempotent set_story_like function", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await setStoryLike("s1", true);
    expect(rpc).toHaveBeenCalledWith("set_story_like", {
      p_story_id: "s1",
      p_liked: true,
    });
  });

  it("unlikes through the same function with liked = false", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await setStoryLike("s1", false);
    expect(rpc).toHaveBeenCalledWith("set_story_like", {
      p_story_id: "s1",
      p_liked: false,
    });
  });

  it("throws a readable error when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(setStoryLike("s1", true)).rejects.toThrow();
  });

  it("throws when the story is no longer available (NULL result)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(setStoryLike("s1", true)).rejects.toThrow();
  });
});
