import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageMenu, PressableBubble } from "@/components/message-menu";
import { MessageMeta, ReactionPill, ReplyQuote } from "@/components/chat-parts";
import { VoiceBubble } from "@/components/voice-recorder";
import {
  applyReaction,
  dayLabel,
  groupReactions,
  mediaCaption,
  quotePreview,
  sameDay,
} from "@/lib/chat-extras";
import { isEditable } from "@/lib/message-actions";
import type { MessageReactionRow, MessageRow } from "@/integrations/supabase/types";

// jsdom has no PointerEvent: a MouseEvent carries the coordinates the gestures need
beforeAll(() => {
  class TestPointerEvent extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "touch";
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: TestPointerEvent, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    value: () => {},
    configurable: true,
  });
});

const msg = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: "m1",
  conversation_id: "c1",
  sender_id: "u1",
  body: "hello",
  created_at: "2026-10-26T10:00:00Z",
  shared_post_id: null,
  ...over,
});
const reaction = (over: Partial<MessageReactionRow> = {}): MessageReactionRow => ({
  message_id: "m1",
  user_id: "u1",
  conversation_id: "c1",
  emoji: "❤️",
  created_at: "2026-10-26T10:00:00Z",
  ...over,
});

describe("reactions", () => {
  it("groups by emoji, most used first, and knows which one is mine", () => {
    const groups = groupReactions(
      [
        reaction({ user_id: "a", emoji: "👍" }),
        reaction({ user_id: "b", emoji: "❤️" }),
        reaction({ user_id: "me", emoji: "❤️" }),
      ],
      "me",
    );
    expect(groups).toEqual([
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "👍", count: 1, mine: false },
    ]);
  });

  it("applyReaction replaces my reaction, or removes it with null", () => {
    const start = [reaction({ user_id: "me", emoji: "👍" }), reaction({ user_id: "a" })];
    const change = { messageId: "m1", conversationId: "c1", userId: "me" };
    const replaced = applyReaction(start, { ...change, emoji: "😂" });
    expect(replaced.filter((r) => r.user_id === "me")).toHaveLength(1);
    expect(replaced.find((r) => r.user_id === "me")?.emoji).toBe("😂");
    const removed = applyReaction(start, { ...change, emoji: null });
    expect(removed.map((r) => r.user_id)).toEqual(["a"]);
  });

  it("shows the heart under a bubble and opens the list when tapped", () => {
    const onClick = vi.fn();
    render(
      <ReactionPill
        groups={[{ emoji: "❤️", count: 1, mine: true }]}
        own={false}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 reaction/i }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("message helpers", () => {
  it("only plain text can be edited", () => {
    expect(isEditable(msg())).toBe(true);
    expect(isEditable(msg({ image_url: "x" }))).toBe(false);
    expect(isEditable(msg({ file_url: "x" }))).toBe(false);
    expect(isEditable(msg({ audio_url: "x" }))).toBe(false);
  });

  it("describes quoted messages", () => {
    expect(quotePreview(msg())).toBe("hello");
    expect(quotePreview(msg({ image_url: "x", body: "📷 Photo" }))).toBe("📷 Photo");
    expect(quotePreview(msg({ image_url: "x", body: "sunset" }))).toBe("sunset");
    expect(quotePreview(msg({ audio_url: "x" }))).toBe("🎤 Voice message");
    expect(quotePreview(msg({ file_url: "x", file_name: "a.pdf" }))).toBe("📄 a.pdf");
  });

  it("hides the automatic label but keeps a typed caption", () => {
    expect(mediaCaption(msg({ image_url: "x", body: "📷 Photo" }))).toBe("");
    expect(mediaCaption(msg({ image_url: "x", body: "sunset" }))).toBe("sunset");
    expect(mediaCaption(msg({ file_url: "x", body: "📄 a.pdf" }))).toBe("");
  });

  it("labels days like WhatsApp", () => {
    const now = new Date("2026-10-26T12:00:00");
    expect(dayLabel("2026-10-26T01:00:00", now)).toBe("Today");
    expect(dayLabel("2026-10-25T23:00:00", now)).toBe("Yesterday");
    expect(sameDay("2026-10-26T01:00:00", "2026-10-26T23:00:00")).toBe(true);
    expect(sameDay("2026-10-26T01:00:00", "2026-10-27T01:00:00")).toBe(false);
  });
});

describe("bubble gestures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (extra: Partial<React.ComponentProps<typeof PressableBubble>> = {}) => {
    const handlers = {
      onLongPress: vi.fn(),
      onReply: vi.fn(),
      onDoubleTap: vi.fn(),
      onTap: vi.fn(),
    };
    render(
      <PressableBubble enabled className="bubble" {...handlers} {...extra}>
        <p>hi there</p>
      </PressableBubble>,
    );
    return { handlers, bubble: screen.getByText("hi there").parentElement as HTMLElement };
  };
  const tap = (el: HTMLElement, x = 10, y = 10) => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y });
    fireEvent.pointerUp(el, { clientX: x, clientY: y });
  };

  it("double tap reacts and never counts as a single tap", () => {
    const { handlers, bubble } = setup();
    tap(bubble);
    act(() => void vi.advanceTimersByTime(100));
    tap(bubble);
    act(() => void vi.advanceTimersByTime(1000));
    expect(handlers.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it("a single tap opens after a short wait", () => {
    const { handlers, bubble } = setup();
    tap(bubble);
    expect(handlers.onTap).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(500));
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onDoubleTap).not.toHaveBeenCalled();
  });

  it("holding opens the menu", () => {
    const { handlers, bubble } = setup();
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    act(() => void vi.advanceTimersByTime(600));
    expect(handlers.onLongPress).toHaveBeenCalledTimes(1);
  });

  it("swiping right far enough replies; a short swipe does not", () => {
    const { handlers, bubble } = setup();
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { clientX: 100, clientY: 12 });
    fireEvent.pointerUp(bubble, { clientX: 100, clientY: 12 });
    expect(handlers.onReply).toHaveBeenCalledTimes(1);

    handlers.onReply.mockClear();
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { clientX: 40, clientY: 10 });
    fireEvent.pointerUp(bubble, { clientX: 40, clientY: 10 });
    expect(handlers.onReply).not.toHaveBeenCalled();
  });

  it("a swipe on a touch screen keeps going when the browser hands the finger over", () => {
    const { handlers, bubble } = setup();
    const text = screen.getByText("hi there");
    fireEvent.pointerDown(text, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(text, { clientX: 40, clientY: 11 });
    // the browser releases its own hold on the inner text when the swipe takes the finger
    fireEvent.lostPointerCapture(text);
    fireEvent.pointerMove(bubble, { clientX: 120, clientY: 12 });
    fireEvent.pointerUp(bubble, { clientX: 120, clientY: 12 });
    expect(handlers.onReply).toHaveBeenCalledTimes(1);
  });

  it("a very long swipe slides the bubble only so far", () => {
    const { bubble } = setup();
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { clientX: 400, clientY: 12 });
    expect(bubble.style.transform).toContain("120px");
  });

  it("moving the mouse over a bubble without pressing does not slide it", () => {
    const { handlers, bubble } = setup();
    fireEvent.pointerMove(bubble, { clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(bubble, { clientX: 200, clientY: 12, pointerType: "mouse" });
    fireEvent.pointerUp(bubble, { clientX: 200, clientY: 12, pointerType: "mouse" });
    expect(bubble.style.transform).toBe("");
    expect(handlers.onReply).not.toHaveBeenCalled();
  });

  it("scrolling up and down never starts a swipe or a long press", () => {
    const { handlers, bubble } = setup();
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { clientX: 14, clientY: 120 });
    act(() => void vi.advanceTimersByTime(900));
    fireEvent.pointerUp(bubble, { clientX: 14, clientY: 120 });
    expect(handlers.onReply).not.toHaveBeenCalled();
    expect(handlers.onLongPress).not.toHaveBeenCalled();
  });

  it("tapping a button inside the bubble is left alone", () => {
    const onTap = vi.fn();
    const onDoubleTap = vi.fn();
    render(
      <PressableBubble
        enabled
        className="b"
        onLongPress={() => {}}
        onTap={onTap}
        onDoubleTap={onDoubleTap}
      >
        <button type="button">play</button>
      </PressableBubble>,
    );
    const button = screen.getByRole("button", { name: "play" });
    tap(button);
    tap(button);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onTap).not.toHaveBeenCalled();
    expect(onDoubleTap).not.toHaveBeenCalled();
  });
});

describe("message menu", () => {
  const rect = {
    x: 20,
    y: 100,
    left: 20,
    top: 100,
    right: 220,
    bottom: 140,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  } as DOMRect;
  const base = {
    rect,
    own: true,
    canEdit: true,
    canCopy: true,
    onReact: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn(),
    onClose: vi.fn(),
  };

  it("offers reactions and reply on anyone's message, but no delete on someone else's", () => {
    const onReact = vi.fn();
    render(<MessageMenu {...base} own={false} onReact={onReact} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "React 😂" }));
    expect(onReact).toHaveBeenCalledWith("😂");
    expect(screen.getByRole("menuitem", { name: /reply/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("my own message also gets edit and delete", () => {
    render(<MessageMenu {...base} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });
});

describe("bubble parts", () => {
  it("a reply quote shows who said it and what, and jumps to the original", () => {
    const onJump = vi.fn();
    render(
      <ReplyQuote
        quoted={msg({ body: "see you at 5" })}
        name="Asha"
        color="#00a884"
        onJump={onJump}
      />,
    );
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("see you at 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onJump).toHaveBeenCalled();
  });

  it("a quote of a deleted message says so", () => {
    render(<ReplyQuote quoted={undefined} name="Message" color="#888" onJump={() => {}} />);
    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
  });

  it("blue double ticks only once read", () => {
    const { rerender } = render(<MessageMeta iso="2026-10-26T10:00:00Z" own read={false} />);
    expect(screen.getByLabelText("Sent")).toBeInTheDocument();
    rerender(<MessageMeta iso="2026-10-26T10:00:00Z" own read />);
    expect(screen.getByLabelText("Read")).toBeInTheDocument();
  });

  it("a voice message shows its length, the time and a play button", () => {
    render(
      <VoiceBubble url="https://x/y.webm" seconds={4} own={false} footer={<span>8:15 pm</span>} />,
    );
    expect(screen.getByText("0:04")).toBeInTheDocument();
    expect(screen.getByText("8:15 pm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play voice message" })).toBeInTheDocument();
  });
});
