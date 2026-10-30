import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StoryGroup, StoryItem } from "@/lib/social";

const h = vi.hoisted(() => ({
  groups: [] as unknown[],
  gate: Promise.resolve() as Promise<void>,
  createStory: vi.fn(),
  inspect: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createVideoStory: vi.fn(),
  recordView: vi.fn(),
  engagement: vi.fn(),
  viewers: vi.fn(),
  like: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    profile: { full_name: "Me Myself", username: "me", avatar_url: null },
  }),
}));
vi.mock("@/lib/social", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social")>();
  return {
    ...actual,
    fetchStories: async () => {
      await h.gate;
      return h.groups;
    },
    createStory: h.createStory,
    recordStoryView: h.recordView,
    fetchStoryEngagement: h.engagement,
    fetchStoryViewers: h.viewers,
    setStoryLike: h.like,
  };
});
vi.mock("@/lib/story-video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-video")>();
  return { ...actual, inspectStoryVideo: h.inspect, createVideoStory: h.createVideoStory };
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

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
  h.gate = Promise.resolve();
  h.recordView.mockResolvedValue(undefined);
  h.engagement.mockResolvedValue({ views: 0, likes: 0, likedByMe: false });
  h.viewers.mockResolvedValue([]);
  h.like.mockResolvedValue(undefined);
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

  it("does not show the + badge once I have a story", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    await screen.findByRole("button", { name: "View your story" });
    expect(screen.queryByRole("button", { name: "Add to your story" })).toBeNull();
  });
});

/** Taps are ignored for the first moments while stories load; wait until they have. */
const loaded = () =>
  waitFor(() => expect(screen.getByRole("button", { name: "Add to your story" })).toBeEnabled());

describe("tapping my own Create Story bubble", () => {
  let pickerOpened: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    pickerOpened = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => pickerOpened.mockRestore());

  it("opens the file picker when I have no story yet", async () => {
    wrap(<Stories />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Create a story" }));
    expect(pickerOpened).toHaveBeenCalledTimes(1);
  });

  it("opens the + badge's picker when I have no story yet", async () => {
    wrap(<Stories />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add to your story" }));
    expect(pickerOpened).toHaveBeenCalledTimes(1);
  });

  it("shows my story, and never the file picker, once I have one", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(pickerOpened).not.toHaveBeenCalled();
  });

  it("does not open the picker while my stories are still loading", async () => {
    let release: () => void = () => {};
    h.gate = new Promise<void>((r) => (release = r));
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a story" }));
    expect(pickerOpened).not.toHaveBeenCalled();

    release();
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(pickerOpened).not.toHaveBeenCalled();
  });

  it("does not open the picker when loading my stories failed", async () => {
    h.gate = Promise.reject(new Error("network"));
    h.gate.catch(() => {});
    wrap(<Stories />);
    await loaded(); // the request has failed by now
    fireEvent.click(screen.getByRole("button", { name: "Create a story" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn't load your stories/),
        expect.objectContaining({ description: "network" }), // the real reason is shown too
      ),
    );
    expect(pickerOpened).not.toHaveBeenCalled();
  });

  it("after adding a photo story, the very next tap shows it instead of the picker", async () => {
    h.createStory.mockImplementation(async () => {
      h.groups = [group("me", "me", [img("new")])];
    });
    const { container } = wrap(<Stories />);
    await screen.findByRole("button", { name: "Create a story" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const photo = new File([new Uint8Array(10)], "pic.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [photo] } });
    // a single photo now opens the story editor first; Share publishes it
    fireEvent.click(await screen.findByRole("button", { name: "Share story" }));

    // the moment the upload finishes my story must already be in the list
    const mine = await screen.findByRole("button", { name: "View your story" });
    fireEvent.click(mine);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(pickerOpened).not.toHaveBeenCalled();
  });

  it("lets me add another story from inside my own story viewer", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    fireEvent.click(screen.getByRole("button", { name: "Add another to your story" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pickerOpened).toHaveBeenCalledTimes(1);
  });

  it("does not offer 'add another' on someone else's story", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    expect(screen.queryByRole("button", { name: "Add another to your story" })).toBeNull();
  });
});

describe("adding several stories", () => {
  const photo = (name: string, type = "image/jpeg") =>
    new File([new Uint8Array(10)], name, { type });
  const pick = async (...files: File[]) => {
    const { container } = wrap(<Stories />);
    await screen.findByText("Create Story");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    fireEvent.change(input, { target: { files } });
  };

  it("adds one story per photo, in the order they were picked", async () => {
    const order: string[] = [];
    h.createStory.mockImplementation(async (_id: string, f: File) => void order.push(f.name));
    await pick(photo("a.jpg"), photo("b.jpg"), photo("c.png", "image/png"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("3 stories added"));
    expect(order).toEqual(["a.jpg", "b.jpg", "c.png"]);
  });

  it("still says 'Story added' for a single photo", async () => {
    h.createStory.mockResolvedValue(undefined);
    await pick(photo("a.jpg"));
    fireEvent.click(await screen.findByRole("button", { name: "Share story" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Story added"));
  });

  it("uploads nothing when any chosen photo is not allowed", async () => {
    await pick(photo("a.jpg"), photo("doc.pdf", "application/pdf"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/doc\.pdf/)),
    );
    expect(h.createStory).not.toHaveBeenCalled();
  });

  it("asks for videos one at a time when photos and a video are mixed", async () => {
    await pick(photo("a.jpg"), photo("clip.mp4", "video/mp4"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/videos one at a time/i)),
    );
    expect(h.createStory).not.toHaveBeenCalled();
  });

  it("limits one batch to 10 photos", async () => {
    await pick(...Array.from({ length: 11 }, (_, i) => photo(`p${i}.jpg`)));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/up to 10/)),
    );
    expect(h.createStory).not.toHaveBeenCalled();
  });

  it("reports how many were added when one fails, and keeps the earlier ones", async () => {
    h.createStory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Storage is full"));
    await pick(photo("a.jpg"), photo("b.jpg"), photo("c.jpg"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Added 1 of 3 stories. Storage is full"),
    );
    expect(h.createStory).toHaveBeenCalledTimes(2); // stopped at the failure
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

  it("shows the 15/30/45/60 selector, preselects the smallest that fits, and says it posts as ONE story", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 40 });
    await pickVideo();
    await screen.findByText("Add video story");

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["15s", "30s", "45s", "60s"]);
    expect(screen.getByRole("radio", { name: "45s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Posted as 1 story.")).toBeInTheDocument();
    expect(screen.queryByText(/stories of up to 15s/)).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("lets a 26 second video be published as one story on the 30 second limit", async () => {
    h.inspect.mockResolvedValue({ ok: true, durationSeconds: 26 });
    h.createVideoStory.mockResolvedValue(1);
    await pickVideo();
    await screen.findByText("Add video story");

    expect(screen.getByRole("radio", { name: "30s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Posted as 1 story.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(h.createVideoStory).toHaveBeenCalledWith(
        expect.objectContaining({ durationSeconds: 26, limitSeconds: 30 }),
      ),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Story added"));
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
    expect(dialog.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(2); // one bar per part

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const second = dialog.querySelector("video")!;
    expect(second.getAttribute("src")).toMatch(/f\.mp4#t=15$/);
    expect(dialog.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(2);
  });

  it("still shows image stories as before", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(
      "https://img/1.jpg",
    );
  });

  it("plays one long story from 0 to its end (a 26 s clip is not split)", async () => {
    h.groups = [
      group("b", "bob", [{ ...seg("s1", 0, 0, 26), segment_count: 1 }]),
    ];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View bob Name's story/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("video")?.getAttribute("src")).toMatch(/f\.mp4#t=0$/);
    expect(dialog.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(1); // one bar
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});

describe("story viewers and likes", () => {
  const person = (id: string, name: string, liked: boolean) => ({
    userId: id,
    name,
    username: name.toLowerCase().replace(/\s+/g, ""),
    avatar: null,
    viewedAt: new Date().toISOString(),
    liked,
    likedAt: liked ? new Date().toISOString() : null,
  });

  it("records a view when I watch someone else's story", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    await waitFor(() => expect(h.recordView).toHaveBeenCalledWith("1"));
  });

  it("does not record a view on my own story", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    await screen.findByRole("button", { name: /^Viewers:/ });
    expect(h.recordView).not.toHaveBeenCalled();
  });

  it("lets me like someone else's story", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Like story" }));
    await waitFor(() => expect(h.like).toHaveBeenCalledWith("1", true));
  });

  it("shows a story I already liked as liked, and unliking sends false", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    h.engagement.mockResolvedValue({ views: 1, likes: 1, likedByMe: true });
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    const unlike = await screen.findByRole("button", { name: "Unlike story" });
    expect(unlike).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(unlike);
    await waitFor(() => expect(h.like).toHaveBeenCalledWith("1", false));
  });

  it("does not offer a like button on my own story", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    await screen.findByRole("button", { name: /^Viewers:/ });
    expect(screen.queryByRole("button", { name: "Like story" })).toBeNull();
  });

  it("shows my story's view and like counts and lists who viewed it, with hearts for likes", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    h.engagement.mockResolvedValue({ views: 2, likes: 1, likedByMe: false });
    h.viewers.mockResolvedValue([person("u1", "Asha K", true), person("u2", "Ravi P", false)]);
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));

    fireEvent.click(await screen.findByRole("button", { name: "Viewers: 2 views, 1 like" }));
    const sheet = await screen.findByRole("dialog", { name: "Story viewers" });
    expect(await within(sheet).findByText("Asha K")).toBeInTheDocument();
    expect(within(sheet).getByText("Ravi P")).toBeInTheDocument();
    expect(within(sheet).getByText("2 viewers")).toBeInTheDocument();
    expect(within(sheet).getByText("1 like")).toBeInTheDocument();
    // only the person who liked it has a heart
    expect(within(sheet).getAllByRole("img", { name: "Liked your story" })).toHaveLength(1);

    fireEvent.click(within(sheet).getByRole("button", { name: "Close viewers" }));
    expect(screen.queryByRole("dialog", { name: "Story viewers" })).toBeNull();
  });

  it("says so when nobody has viewed my story yet", async () => {
    h.groups = [group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Viewers:/ }));
    expect(await screen.findByText("No views yet.")).toBeInTheDocument();
  });
});

describe("holding a story", () => {
  afterEach(() => vi.useRealTimers());
  const barWidth = () =>
    parseFloat(
      (screen.getByRole("dialog").querySelector(".h-1 > div") as HTMLElement).style.width || "0",
    );
  const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

  it("pauses while I hold the photo and carries on from the same point when I let go", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    h.groups = [group("a", "alice", [img("1"), img("2")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    await advance(1000);
    const before = barWidth();
    expect(before).toBeGreaterThan(5);

    const photo = screen.getByRole("dialog").querySelector("img.object-contain") as HTMLElement;
    fireEvent.pointerDown(photo, { button: 0 });
    await advance(3000); // would be the end of the story if it were still running
    expect(barWidth()).toBe(before);

    fireEvent.pointerUp(window);
    await advance(1000);
    expect(barWidth()).toBeGreaterThan(before);
    expect(barWidth()).toBeLessThan(60); // resumed, did not jump ahead
  });

  it("still lets me tap Next while the story is held", async () => {
    h.groups = [group("a", "alice", [img("1"), img("2")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Next" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull(); // now on the last story
  });
});

describe("swiping between people", () => {
  // jsdom has no PointerEvent, so the coordinates are put on the events by hand.
  const pointer = (type: "pointerDown" | "pointerUp", el: HTMLElement, x: number, y: number) => {
    const ev = createEvent[type](el, { button: 0 });
    Object.defineProperty(ev, "clientX", { value: x });
    Object.defineProperty(ev, "clientY", { value: y });
    fireEvent(el, ev);
  };
  const swipe = (from: number, to: number, endY = 100) => {
    const area = screen.getByRole("dialog").querySelector("img.object-contain") as HTMLElement;
    pointer("pointerDown", area, from, 100);
    pointer("pointerUp", area, to, endY);
  };
  const profileOf = (name: string) =>
    screen.queryByRole("button", { name: `Open ${name} Name's profile` });

  it("shows the next person's story when I swipe left, and the previous one when I swipe right", async () => {
    h.groups = [group("a", "alice", [img("1")]), group("b", "bob", [img("2")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    expect(profileOf("alice")).toBeInTheDocument();

    swipe(250, 100); // finger moves left
    expect(profileOf("bob")).toBeInTheDocument();
    expect(profileOf("alice")).toBeNull();

    swipe(100, 250); // finger moves right
    expect(profileOf("alice")).toBeInTheDocument();
    expect(profileOf("bob")).toBeNull();
  });

  it("follows the order of the row, starting with my own story", async () => {
    h.groups = [group("a", "alice", [img("1")]), group("me", "me", [img("m1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: "View your story" }));
    expect(profileOf("me")).toBeInTheDocument();
    swipe(250, 100);
    expect(profileOf("alice")).toBeInTheDocument();
  });

  it("stays on the story when there is nobody further in that direction", async () => {
    h.groups = [group("a", "alice", [img("1")]), group("b", "bob", [img("2")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    swipe(100, 250); // right on the first person
    expect(profileOf("alice")).toBeInTheDocument();
    swipe(250, 100); // left: bob (the last one)
    swipe(250, 100); // left again: nobody after bob
    expect(profileOf("bob")).toBeInTheDocument();
  });

  it("ignores short moves and mostly-vertical drags", async () => {
    h.groups = [group("a", "alice", [img("1")]), group("b", "bob", [img("2")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    swipe(200, 170); // only 30px
    swipe(200, 100, 400); // sideways 100px but 300px down
    expect(profileOf("alice")).toBeInTheDocument();
  });
});

describe("loading a video story", () => {
  // The loader lives on the story ring (avatar at the top of the open story), not on the video.
  const ring = () =>
    screen.getByRole("dialog").querySelector('[data-testid="story-ring-loader"]');
  const open = async () => {
    h.groups = [group("b", "bob", [seg("s1", 0, 0, 15), seg("s2", 1, 15, 22.5)])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View bob Name's story/ }));
    return screen.getByRole("dialog").querySelector("video") as HTMLVideoElement;
  };

  it("shows the ring loader from the start, until the video is playing", async () => {
    const video = await open();
    expect(ring()).toBeInTheDocument();
    expect(ring()).toHaveClass("pointer-events-none"); // never blocks taps / holds / swipes
    fireEvent.playing(video);
    expect(ring()).toBeNull();
  });

  it("shows the ring again when the video stops to buffer, and hides it when it plays on", async () => {
    const video = await open();
    fireEvent.playing(video);
    expect(ring()).toBeNull();
    fireEvent.waiting(video);
    expect(ring()).toBeInTheDocument();
    fireEvent.playing(video);
    expect(ring()).toBeNull();
  });

  it("shows the ring again for the next part of a video story", async () => {
    const video = await open();
    fireEvent.playing(video);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(ring()).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("video")).not.toBe(video);
  });

  it("stops the ring if the video cannot be loaded", async () => {
    const video = await open();
    fireEvent.error(video);
    expect(ring()).toBeNull();
  });

  it("does not show the ring on a photo story", async () => {
    h.groups = [group("a", "alice", [img("1")])];
    wrap(<Stories />);
    fireEvent.click(await screen.findByRole("button", { name: /View alice Name's story/ }));
    expect(ring()).toBeNull();
  });

  it("hides the browser's own play button on story videos", async () => {
    const video = await open();
    expect(video).toHaveClass("story-video");
    expect(
      readFileSync(resolve(__dirname, "../styles.css"), "utf8"),
    ).toMatch(/\.story-video::-webkit-media-controls-start-playback-button/);
  });
});
