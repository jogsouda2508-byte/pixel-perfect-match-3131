import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const { setLike } = vi.hoisted(() => ({ setLike: vi.fn() }));
vi.mock("@/lib/social", () => ({ setLike }));

import { patchPostData, togglePostLike } from "@/lib/post-cache";

const row = (id: string, liked: boolean, count: number) => ({
  id,
  liked_by_me: liked,
  like_count: count,
});

beforeEach(() => vi.clearAllMocks());

describe("patchPostData", () => {
  it("patches the matching post inside infinite-query pages and leaves the rest alone", () => {
    const data = {
      pages: [[row("a", false, 1), row("b", false, 5)], [row("c", true, 2)]],
      pageParams: [],
    };
    const next = patchPostData(data, "b", { liked_by_me: true, like_count: 6 }) as typeof data;
    expect(next.pages[0]![1]).toMatchObject({ id: "b", liked_by_me: true, like_count: 6 });
    expect(next.pages[0]![0]).toBe(data.pages[0]![0]);
    expect(next.pages[1]).toBe(data.pages[1]);
  });

  it("patches a single cached row, and returns other data unchanged", () => {
    expect(patchPostData(row("x", false, 0), "x", { like_count: 1 })).toMatchObject({
      like_count: 1,
    });
    const untouched = row("y", false, 0);
    expect(patchPostData(untouched, "x", { like_count: 9 })).toBe(untouched);
    expect(patchPostData(undefined, "x", {})).toBeUndefined();
    expect(patchPostData(null, "x", {})).toBeNull();
  });
});

describe("togglePostLike", () => {
  const seed = () => {
    const qc = new QueryClient();
    qc.setQueryData(["feed", "for_you"], { pages: [[row("p", false, 2)]], pageParams: [] });
    qc.setQueryData(["video-feed", "u1"], { pages: [[row("p", false, 2)]], pageParams: [] });
    qc.setQueryData(["video-by-id", "p", "u1"], row("p", false, 2));
    return qc;
  };
  const read = (qc: QueryClient) => ({
    feed: (qc.getQueryData(["feed", "for_you"]) as { pages: unknown[][] }).pages[0]![0],
    videos: (qc.getQueryData(["video-feed", "u1"]) as { pages: unknown[][] }).pages[0]![0],
    byId: qc.getQueryData(["video-by-id", "p", "u1"]),
  });

  it("updates every cached copy and writes to the database", async () => {
    setLike.mockResolvedValue(undefined);
    const qc = seed();
    await togglePostLike(qc, "u1", row("p", false, 2), true);
    expect(setLike).toHaveBeenCalledWith("p", "u1", true);
    for (const copy of Object.values(read(qc))) {
      expect(copy).toMatchObject({ liked_by_me: true, like_count: 3 });
    }
  });

  it("restores every cached copy and re-throws when the write fails", async () => {
    setLike.mockRejectedValue(new Error("boom"));
    const qc = seed();
    await expect(togglePostLike(qc, "u1", row("p", false, 2), true)).rejects.toThrow("boom");
    for (const copy of Object.values(read(qc))) {
      expect(copy).toMatchObject({ liked_by_me: false, like_count: 2 });
    }
  });

  it("never lets the count go below zero when unliking", async () => {
    setLike.mockResolvedValue(undefined);
    const qc = new QueryClient();
    qc.setQueryData(["feed"], { pages: [[row("p", true, 0)]], pageParams: [] });
    await togglePostLike(qc, "u1", row("p", true, 0), false);
    const data = qc.getQueryData(["feed"]) as { pages: Array<Array<{ like_count: number }>> };
    expect(data.pages[0]![0]!.like_count).toBe(0);
  });
});
