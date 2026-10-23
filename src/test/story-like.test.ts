import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, del, from } = vi.hoisted(() => {
  const eq2 = vi.fn();
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  return {
    upsert: vi.fn(),
    del: { eq1, eq2 },
    from: vi.fn(),
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { DOUBLE_TAP_MS, isDoubleTap, withStoryLiked } from "@/lib/story-like";
import { setStoryLike, type StoryGroup } from "@/lib/social";

const group = (liked: boolean): StoryGroup => ({
  authorId: "a",
  name: "Ann",
  username: "ann",
  avatar: null,
  latest: "2026-10-18T00:00:00Z",
  items: [
    { id: "s1", image_url: "x", created_at: "2026-10-18T00:00:00Z", liked_by_me: liked },
    { id: "s2", image_url: "y", created_at: "2026-10-18T00:01:00Z", liked_by_me: false },
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
    upsert.mockReset();
    del.eq1.mockClear();
    del.eq2.mockReset();
    from.mockReset();
    from.mockReturnValue({ upsert, delete: () => ({ eq: del.eq1 }) });
  });

  it("likes with an idempotent upsert on (story, user)", async () => {
    upsert.mockResolvedValue({ error: null });
    await setStoryLike("s1", "u1", true);
    expect(from).toHaveBeenCalledWith("story_likes");
    expect(upsert).toHaveBeenCalledWith(
      { story_id: "s1", user_id: "u1" },
      { onConflict: "story_id,user_id", ignoreDuplicates: true },
    );
  });

  it("unlikes by deleting only my row", async () => {
    del.eq2.mockResolvedValue({ error: null });
    await setStoryLike("s1", "u1", false);
    expect(del.eq1).toHaveBeenCalledWith("story_id", "s1");
    expect(del.eq2).toHaveBeenCalledWith("user_id", "u1");
  });

  it("throws a readable error when the database refuses", async () => {
    upsert.mockResolvedValue({ error: { message: "denied" } });
    await expect(setStoryLike("s1", "u1", true)).rejects.toThrow();
  });
});
