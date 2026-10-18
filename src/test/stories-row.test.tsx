import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryGroup, StoryItem } from "@/lib/social";

const h = vi.hoisted(() => ({
  groups: [] as unknown[],
  inspect: vi.fn(),
  toastError: vi.fn(),
  createVideoStory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    profile: { full_name: "Me Myself", username: "me", avatar_url: null },
  }),
}));
vi.mock("@/lib/social", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social")>();
  return { ...actual, fetchStories: async () => h.groups };
});
vi.mock("@/lib/story-video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-video")>();
  return { ...actual, inspectStoryVideo: h.inspect, createVideoStory: h.createVideoStory };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.toastError } }));

import { Stories } from "@/components/stories";

const img = (id: string): StoryItem => ({
  id,
  media_type: "image",
  image_url: `https://img/${id}.jpg`,
  video_url: null,
  upload_id: null,
  segment_index: 0,
  segment_count: 1,
  segment_start: 0,
  segment_end: null,
  created_at: new Date().toISOString(),
});
const seg = (id: string, i: number, start: number, end: number): StoryItem => ({
  ...img(id),
  media_type: "video",
  image_url: null,
  video_url: "https://x.supabase.co/storage/v1/object/public/videos/bob/f.mp4",
  upload_id: "up",
  segment_index: i,
  segment_count: 2,
  segment_start: start,
  segment_end: end,
});
const group = (authorId: string, username: string, items: StoryItem[]): StoryGroup => ({
  authorId,
  name: `${username} Name`,
  username,
  avatar: null,
  items,
  latest: new Date().toISOString(),
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.groups = [];
});

describe("story row", () => {
  it("is one scrollable row: Create Story first, then other people, no Local Hub", async () => {
    h.groups = [
      group("a", "alice", [img("1")]),
      group("b", "a_really_long_username_that_would_wrap", [img("2")]),
    ];
    wrap(<Stories />);
    await screen.findByText("alice");

    const list = screen.getByRole("list", { name: "Stories" });
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("flex");
    const items = within(list).getAllByRole("listitem");
    // the visible label under each avatar (initials inside the avatar are not labels)
    expect(items.map((li) => li.querySelector("span.truncate")?.textContent)).toEqual([
      "Create Story",
      "alice",
      "a_really_long_username_that_would_wrap",
    ]);
    expect(screen.queryByText("Local Hub")).toBeNull();
  });

  it("gives every item the same fixed width and truncates long usernames to one line", async () => {
    h.groups = [group("b", "a_really_long_username_that_would_wrap", [img("2")])];
    wrap(<Stories />);
    const label = await screen.findByText("a_really_long_username_that_would_wrap");
    expect(label.className).toContain("truncate");
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.className).toContain("w-[72px]");
      expect(li.className).toContain("shrink-0");
    }
  });

  it("shows my own story only on the first item, never a second time", async () => {
    h.groups = [group("me", "me", [img("m1")]), group("a", "alice", [img("1")])];
    wrap(<Stories />);
    await screen.findByText("alice");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Create Story")).toBeInTheDocument();
    expect(screen.queryByText("Your story")).toBeNull();
    // my story opens from the first item
    fireEvent.click(screen.getByRole("button", { name: "View your story" }));
    expect(
      screen.getByRole("dialog", { name: /Me Name's story|me Name's story/i }),
    ).toBeInTheDocument();
  });

  it("still lets me add a story when I already have one", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    await screen.findByRole("button", { name: "Add to your story" });
  });
});

describe("picking a video story", () => {
  const pickVideo = async () => {
    const { container } = wrap(<Stories />);
    await screen.findByText("Create Story");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain("video/mp4");
    const file = new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it("shows a clear error and no dialog when the video is rejected", async () => {
    h.inspect.mockResolvedValue({
      ok: false,
      error: "Stories can be at most 60 seconds. This video is 75 seconds long.",
    });
    await pickVideo();
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/at most 60 seconds/)),
    );
    expect(screen.queryByText("Add video story")).toBeNull();
  });

  it("shows the 15/30/45/60 selector, preselects the smallest that fits, and previews the split", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 40 });
    await pickVideo();
    await screen.findByText("Add video story");

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["15s", "30s", "45s", "60s"]);
    expect(screen.getByRole("radio", { name: "45s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/3 stories of up to 15s each/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("blocks publishing when the chosen limit is shorter than the video", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 40 });
    await pickVideo();
    await screen.findByText("Add video story");

    fireEvent.click(screen.getByRole("radio", { name: "30s" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/over the 30-second limit/);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "60s" }));
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("publishes with the chosen limit and shows upload progress", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 20 });
    let finish: (n: number) => void = () => {};
    h.createVideoStory.mockImplementation(
      (a: { onProgress: (n: number) => void }) =>
        new Promise<number>((resolve) => {
          a.onProgress(37);
          finish = resolve;
        }),
    );
    await pickVideo();
    await screen.findByText("Add video story");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByText(/Uploading… 37%/);
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toBeInTheDocument();
    expect(h.createVideoStory).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "me", durationSeconds: 20, limitSeconds: 30 }),
    );
    finish(2);
    await waitFor(() => expect(screen.queryByText("Add video story")).toBeNull());
  });

  it("shows the failure and lets me try again", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 10 });
    h.createVideoStory.mockRejectedValue(new Error("Video upload failed. Check the file."));
    await pickVideo();
    await screen.findByText("Add video story");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByText("Video upload failed. Check the file.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

describe("viewing a video story", () => {
  it("plays each segment's own time range, in order", async () => {
    h.groups = [group("b", "bob", [seg("s1", 0, 0, 15), seg("s2", 1, 15, 22.5)])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View bob Name's story/ }));

    const dialog = screen.getByRole("dialog");
    const first = dialog.querySelector("video")!;
    expect(first.getAttribute("src")).toMatch(/f\.mp4#t=0$/);
    expect(dialog).toHaveTextContent("1/2");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const second = dialog.querySelector("video")!;
    expect(second.getAttribute("src")).toMatch(/f\.mp4#t=15$/);
    expect(dialog).toHaveTextContent("2/2");
  });

  it("still shows image stories as before", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(
      "https://img/1.jpg",
    );
  });
});
