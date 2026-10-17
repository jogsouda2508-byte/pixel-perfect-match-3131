import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

export type PickedEmoji = { native: string };

/**
 * Emoji Mart picker styled to match Ediraa (purple accent, rounded, light/dark aware).
 * Free and open source: the emoji data ships with the app, so there is no API key or
 * network call. Loaded lazily by the chat screen, so it only costs bytes when opened.
 */
export default function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const isDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const isWide = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;

  return (
    <div className="ediraa-emoji">
      <Picker
        data={data}
        theme={isDark ? "dark" : "light"}
        onEmojiSelect={(emoji: PickedEmoji) => onSelect(emoji.native)}
        previewPosition="none"
        skinTonePosition="search"
        navPosition="top"
        searchPosition="sticky"
        perLine={isWide ? 9 : 8}
        maxFrequentRows={2}
        emojiButtonSize={isWide ? 38 : 36}
        emojiSize={isWide ? 24 : 22}
        autoFocus={isWide}
        dynamicWidth={false}
      />
    </div>
  );
}
