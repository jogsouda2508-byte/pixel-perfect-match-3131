import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    storyRows: [] as unknown[],
    deleteCalls: [] as [string, string][],
    /** error returned when the FULL (video-column) story select is used */
    fullError: null as null | { code?: string; message: string },
    selects: [] as string[],
    profileLookups: [] as string[][],
  };
  const rpc = vi.fn();
  const remove = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            state.profileLookups.push(ids);
            return Promise.resolve({
              data: ids.map((id) => ({
                id,
                full_name: "Bob B",
                username: "bobby",
                avatar_url: null,
              })),
              error: null,
            });
          },
        }),
      };
    }
    return {
      select: (cols: string) => ({
        gt: () => ({
          order: () => ({
            order: () => {
              state.selects.push(cols);
              if (cols.includes("media_type") && state.fullError)
                return Promise.resolve({ data: null, error: state.fullError });
              return Promise.resolve({ data: state.storyRows, error: null });
            },
          }),
        }),
      }),
      delete: () => ({
        eq: (col: string, val: string) => {
          state.deleteCalls.push([col, val]);
          return Promise.resolve({ error: null });
        },
      }),
    };
  });
  return { state, rpc, remove, from };
});

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: h.rpc, from: h.from, storage: { from: () => ({ remove: h.remove }) } },
}));

import { deleteStory, fetchFeed, fetchLocalities, fetchStories } from "@/lib/social";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.state.storyRows = [];
  h.state.deleteCalls = [];
  h.state.fullError = null;
  h.state.selects = [];
  h.state.profileLookups = [];
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.remove.mockResolvedValue({ error: null });
});

describe("fetchFeed", () => {
  it("asks the database for the Following tab and sends no location", async () => {
    await fetchFeed({ tab: "following", before: null, location: "Mumbai" });
    expect(h.rpc).toHaveBeenCalledWith("get_feed", {
      p_tab: "following",
      p_search: null,
      p_limit: 10,
      p_before: null,
    });
  });

  it("sends the picked locality only for the Local tab", async () => {
    await fetchFeed({ tab: "local", location: "  Pune " });
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_tab: "local", p_location: "Pune" });
  });

  it("leaves p_location out when none was picked (the profile location is used server-side)", async () => {
    await fetchFeed({ tab: "local", location: null });
    expect(h.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_location");
    await fetchFeed({ tab: "local", location: "   " });
    expect(h.rpc.mock.calls[1]?.[1]).not.toHaveProperty("p_location");
  });

  it("surfaces database errors", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(fetchFeed({ tab: "following" })).rejects.toThrow("nope");
  });
});

describe("fetchLocalities", () => {
  it("returns the localities from the database", async () => {
    h.rpc.mockResolvedValue({ data: [{ locality: "Bengaluru", people: 3 }], error: null });
    await expect(fetchLocalities(5)).resolves.toEqual([{ locality: "Bengaluru", people: 3 }]);
    expect(h.rpc).toHaveBeenCalledWith("get_localities", { p_limit: 5 });
  });
});

const author = { full_name: "Bob B", username: "bobby", avatar_url: null };
const row = (over: Record<string, unknown>) => ({
  id: "s",
  author_id: "b",
  image_url: null,
  media_type: "image",
  video_url: null,
  upload_id: null,
  segment_index: 0,
  segment_count: 1,
  segment_start: 0,
  segment_end: null,
  created_at: "2026-10-18T10:00:00Z",
  author,
  ...over,
});

describe("fetchStories", () => {
  it("puts my story first, then newest first, with one group per person", async () => {
    h.state.storyRows = [
      row({ id: "1", author_id: "b", image_url: "u1", created_at: "2026-10-18T08:00:00Z" }),
      row({ id: "2", author_id: "c", image_url: "u2", created_at: "2026-10-18T09:00:00Z" }),
      row({ id: "3", author_id: "me", image_url: "u3", created_at: "2026-10-18T07:00:00Z" }),
      row({ id: "4", author_id: "b", image_url: "u4", created_at: "2026-10-18T10:00:00Z" }),
    ];
    const groups = await fetchStories("me");
    expect(groups.map((g) => g.authorId)).toEqual(["me", "b", "c"]);
    expect(groups.find((g) => g.authorId === "b")?.items.map((i) => i.id)).toEqual(["1", "4"]);
  });

  it("keeps old image stories (rows without video columns) working", async () => {
    h.state.storyRows = [row({ id: "old", image_url: "https://img", media_type: null })];
    const [g] = await fetchStories("me");
    expect(g?.items[0]).toMatchObject({
      media_type: "image",
      image_url: "https://img",
      segment_count: 1,
      segment_start: 0,
    });
  });

  it("returns video segments with their time ranges, in order", async () => {
    const common = {
      media_type: "video",
      video_url: "https://v/x.mp4",
      upload_id: "u",
      segment_count: 2,
    };
    h.state.storyRows = [
      row({ ...common, id: "a", segment_index: 0, segment_start: 0, segment_end: 15 }),
      row({ ...common, id: "b", segment_index: 1, segment_start: 15, segment_end: 22.5 }),
    ];
    const [g] = await fetchStories("me");
    expect(g?.items.map((i) => [i.segment_index, i.segment_start, i.segment_end])).toEqual([
      [0, 0, 15],
      [1, 15, 22.5],
    ]);
  });
});

describe("fetchStories author lookup", () => {
  it("never embeds profiles in the stories query (an embed breaks when the database has two relationships)", async () => {
    h.state.storyRows = [
      row({ id: "1", author_id: "b", image_url: "u1" }),
      row({ id: "2", author_id: "c", image_url: "u2" }),
      row({ id: "3", author_id: "b", image_url: "u3" }),
    ];
    const groups = await fetchStories("me");
    expect(h.state.selects[0]).not.toContain("profiles");
    expect(h.state.profileLookups).toEqual([["b", "c"]]); // each author once, in a separate query
    expect(groups[0]).toMatchObject({ name: "Bob B", username: "bobby" });
  });

  it("does not ask for authors when there are no stories", async () => {
    await expect(fetchStories("me")).resolves.toEqual([]);
    expect(h.state.profileLookups).toEqual([]);
  });
});

describe("fetchStories before the video-story migration was run", () => {
  it("falls back to photo stories instead of failing (Postgres: column does not exist)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.state.fullError = { code: "42703", message: "column stories.media_type does not exist" };
    h.state.storyRows = [
      {
        id: "p1",
        author_id: "me",
        image_url: "https://img/1",
        created_at: "2026-10-18T10:00:00Z",
        author,
      },
    ];
    const [g] = await fetchStories("me");
    expect(g?.items[0]).toMatchObject({
      id: "p1",
      media_type: "image",
      image_url: "https://img/1",
    });
    expect(h.state.selects).toHaveLength(2);
    expect(h.state.selects[1]).not.toContain("media_type");
  });

  it("also recognises PostgREST's schema-cache message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.state.fullError = {
      code: "PGRST204",
      message: "Could not find the 'media_type' column of 'stories'",
    };
    await expect(fetchStories("me")).resolves.toEqual([]);
  });

  it("does NOT hide other failures (permissions, network...)", async () => {
    h.state.fullError = { code: "42501", message: "permission denied for table stories" };
    await expect(fetchStories("me")).rejects.toThrow(/permission denied/);
    expect(h.state.selects).toHaveLength(1);
  });
});

describe("deleteStory", () => {
  it("deletes a single image story by id", async () => {
    await deleteStory({ id: "s1", upload_id: null, video_url: null });
    expect(h.state.deleteCalls).toEqual([["id", "s1"]]);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("deletes every segment of a video together and removes the file", async () => {
    await deleteStory({
      id: "s1",
      upload_id: "up-1",
      video_url: "https://x.supabase.co/storage/v1/object/public/videos/user-1/f.mp4",
    });
    expect(h.state.deleteCalls).toEqual([["upload_id", "up-1"]]);
    expect(h.remove).toHaveBeenCalledWith(["user-1/f.mp4"]);
  });
});
