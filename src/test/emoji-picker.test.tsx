import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EmojiPickerPanel from "@/components/emoji-picker";

// jsdom has no IntersectionObserver (every real browser does); Emoji Mart needs one.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  },
);

describe("EmojiPickerPanel", () => {
  it("mounts the Emoji Mart picker without crashing", async () => {
    const onSelect = vi.fn();
    const { container } = render(<EmojiPickerPanel onSelect={onSelect} />);
    await waitFor(() => expect(container.querySelector("em-emoji-picker")).not.toBeNull());
  });
});
