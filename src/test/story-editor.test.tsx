import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  render: vi.fn(),
  search: vi.fn(),
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

import { StoryEditor } from "@/components/story-editor";

const photo = new File([new Uint8Array(10)], "pic.jpg", { type: "image/jpeg" });

beforeEach(() => {
  // jsdom has no object URLs; the editor needs one to show the photo
  URL.createObjectURL = vi.fn(() => "blob:test-photo");
  URL.revokeObjectURL = vi.fn();
  h.render.mockReset();
  h.search.mockReset();
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

  it("closes straight away when there are no edits", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
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
    expect(screen.getAllByTestId("overlay-music")).toHaveLength(1);

    // jsdom never loads images by itself, so tell the editor the photo is ready
    const img = screen.getByAltText("Your photo");
    fireEvent.load(img);
    fireEvent.click(screen.getByRole("button", { name: "Share story" }));
    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith(flattened, { title: "Kesariya - Arijit Singh", url: "https://p/1.m4a" }),
    );
  });

  it("keeps one song only: a new one replaces the old one", async () => {
    setup();
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add music" }));
      fireEvent.click(await screen.findByRole("button", { name: "Use Kesariya - Arijit Singh" }));
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
