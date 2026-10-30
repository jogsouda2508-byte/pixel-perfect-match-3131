import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  render: vi.fn(),
  search: vi.fn(),
  gifs: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/story-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-render")>();
  return { ...actual, renderStoryFile: h.render };
});
vi.mock("@/lib/story-music", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-music")>();
  return { ...actual, searchMusic: h.search };
});

vi.mock("@/lib/story-gifs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-gifs")>();
  return { ...actual, searchGifs: h.gifs };
});

import { StoryEditor } from "@/components/story-editor";

const photo = new File([new Uint8Array(10)], "pic.jpg", { type: "image/jpeg" });

beforeEach(() => {
  // jsdom has no object URLs; the editor needs one to show the photo
  URL.createObjectURL = vi.fn(() => "blob:test-photo");
  URL.revokeObjectURL = vi.fn();
  h.render.mockReset();
  h.search.mockReset();
  h.gifs.mockReset();
  h.gifs.mockResolvedValue([
    { id: "abc123XYZ", title: "wave", ratio: 1.5, preview: "https://media.giphy.com/media/abc123XYZ/200w.gif" },
  ]);
  h.search.mockResolvedValue([
    {
      id: "1",
      name: "Kesariya",
      artist: "Arijit Singh",
      title: "Kesariya - Arijit Singh",
      url: "https://p/1.m4a",
      cover: null,
    },
  ]);
});

const setup = () => {
  const onClose = vi.fn();
  const onShare = vi.fn();
  render(<StoryEditor file={photo} onClose={onClose} onShare={onShare} />);
  return { onClose, onShare };
};

describe("story editor", () => {
  it("publishes the original photo untouched when nothing was added", () => {
    const { onShare } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Share story" }));
    expect(onShare).toHaveBeenCalledWith(photo, null);
    expect(h.render).not.toHaveBeenCalled();
  });

  it("asks before closing even when there are no edits", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("asks before throwing away edits", () => {
    const { onClose } = setup();
    fireEvent.change(screen.getByLabelText("Add a caption"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a GIF from the GIF picker and shares it with the story", async () => {
    h.render.mockResolvedValue(new File([new Uint8Array(1)], "out.jpg", { type: "image/jpeg" }));
    const { onShare } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add GIF" }));
    fireEvent.click(await screen.findByRole("button", { name: /Use GIF wave/ }));
    expect(screen.getByTestId("overlay-gif")).toBeInTheDocument();
    expect(screen.queryByTestId("story-gif-picker")).toBeNull();
    // the picture may not be loaded in jsdom, so only check what was asked for
    fireEvent.load(screen.getByAltText("Your photo"));
    fireEvent.click(screen.getByRole("button", { name: "Share story" }));
    await waitFor(() => expect(onShare).toHaveBeenCalled());
    const gifs = onShare.mock.calls[0]?.[2];
    expect(gifs).toHaveLength(1);
    expect(gifs[0]).toMatchObject({ id: "abc123XYZ", ratio: 1.5 });
  });

  it("adds text from the text tool", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    fireEvent.change(screen.getByLabelText("Story text"), { target: { value: "Party tonight" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Party tonight")).toBeInTheDocument();
    expect(screen.getAllByTestId("overlay-text")).toHaveLength(1);
  });

  it("adds a sticker from the sticker sheet", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add sticker" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 🔥" }));
    expect(screen.getAllByTestId("overlay-emoji")).toHaveLength(1);
  });

  it("picks a song, shows it on the story and passes it to Share with the flattened picture", async () => {
    const flattened = new File([new Uint8Array(5)], "story.jpg", { type: "image/jpeg" });
    h.render.mockResolvedValue(flattened);
    const { onShare } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add music" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Kesariya - Arijit Singh" }));
    // step 2: choose how many seconds, then confirm
    fireEvent.click(await screen.findByRole("radio", { name: "10s" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByTestId("overlay-music")).toHaveLength(1);

    // jsdom never loads images by itself, so tell the editor the photo is ready
    const img = screen.getByAltText("Your photo");
    fireEvent.load(img);
    fireEvent.click(screen.getByRole("button", { name: "Share story" }));
    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith(flattened, { title: "Kesariya - Arijit Singh", url: "https://p/1.m4a#len=10" }),
    );
  });

  it("keeps one song only: a new one replaces the old one", async () => {
    setup();
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add music" }));
      fireEvent.click(await screen.findByRole("button", { name: "Use Kesariya - Arijit Singh" }));
      fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    }
    expect(screen.getAllByTestId("overlay-music")).toHaveLength(1);
  });

  it("shows a retry when the photo cannot be opened", () => {
    setup();
    fireEvent.error(screen.getByAltText("Your photo"));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share story" })).toBeDisabled();
  });
});

describe("story editor text fonts", () => {
  it("shows the font styles when adding text and lets you pick one", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    const row = screen.getByTestId("text-font-row");
    expect(row).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Modern font" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Signature font" }));
    expect(screen.getByRole("radio", { name: "Signature font" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Story text"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("story editor photo zoom", () => {
  it("zooms the photo with a double click and resets it", () => {
    setup();
    const layer = screen.getByTestId("photo-zoom-layer");
    expect(screen.queryByRole("button", { name: "Reset photo zoom" })).toBeNull();
    fireEvent.doubleClick(layer);
    expect(screen.getByRole("button", { name: "Reset photo zoom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset photo zoom" }));
    expect(screen.queryByRole("button", { name: "Reset photo zoom" })).toBeNull();
  });
  it("zooms with the mouse wheel", () => {
    setup();
    fireEvent.wheel(screen.getByTestId("photo-zoom-layer"), { deltaY: -200 });
    expect(screen.getByRole("button", { name: "Reset photo zoom" })).toBeInTheDocument();
  });
});

describe("story editor text box focus", () => {
  it("puts the cursor back in the text box after picking a font or colour", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    const box = screen.getByLabelText("Story text");
    (box as HTMLTextAreaElement).blur();
    fireEvent.click(screen.getByRole("radio", { name: "Classic font" }));
    await waitFor(() => expect(document.activeElement).toBe(box));
    (box as HTMLTextAreaElement).blur();
    fireEvent.click(screen.getByRole("button", { name: /Text colour #ff4d6d/ }));
    await waitFor(() => expect(document.activeElement).toBe(box));
  });
});

describe("story editor pinch to resize", () => {
  // jsdom has no PointerEvent: a MouseEvent carries the finger positions the gestures need
  beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: TestPointerEvent, configurable: true });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: () => {}, configurable: true });
  });
  it("two fingers near a sticker make it bigger (and the photo stays unzoomed)", () => {
    // the test browser has no layout, so give every box a size
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 640, width: 360, height: 640, toJSON: () => ({}) });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add sticker" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 🔥" }));
    const sticker = screen.getByTestId("overlay-emoji");
    expect(sticker.style.transform).toContain("scale(1)");
    const layer = screen.getByTestId("photo-zoom-layer");
    const ev = (type: "pointerDown" | "pointerMove" | "pointerUp", id: number, x: number) =>
      fireEvent[type](layer, { pointerId: id, clientX: x, clientY: 0 });
    ev("pointerDown", 1, 0);
    ev("pointerDown", 2, 20);
    ev("pointerMove", 2, 80); // fingers move apart
    expect(sticker.style.transform).not.toContain("scale(1)");
    ev("pointerUp", 2, 80);
    ev("pointerUp", 1, 0);
    expect(screen.queryByRole("button", { name: "Reset photo zoom" })).toBeNull();
    rect.mockRestore();
  });
});
