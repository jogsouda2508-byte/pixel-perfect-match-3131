import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  sendStoryReply,
  STORY_REACTIONS,
  STORY_REPLY_MAX,
  type StoryReplyKind,
} from "@/lib/story-reply";

type Floater = { id: number; emoji: string; x: number };

/**
 * The bottom of someone else's story: six quick emoji reactions and a "Send message" box. Both
 * land in your normal chat with the author. While you type the story is paused (`onFocusChange`).
 */
export function StoryReplyBar({
  storyId,
  authorName,
  onFocusChange,
  trailing,
}: {
  storyId: string;
  authorName: string;
  onFocusChange: (focused: boolean) => void;
  /** e.g. the like button, shown to the right of the message box */
  trailing?: ReactNode;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusCb = useRef(onFocusChange);
  focusCb.current = onFocusChange;
  // never leave the story paused if this bar goes away while the keyboard is open
  useEffect(() => () => focusCb.current(false), []);

  const send = useMutation({
    mutationFn: (a: { body: string; kind: StoryReplyKind }) =>
      sendStoryReply(storyId, a.body, a.kind),
    onSuccess: (_c, a) => {
      void qc.invalidateQueries({ queryKey: ["chat-conversations", user?.id] });
      if (a.kind === "reply") {
        setText("");
        inputRef.current?.blur();
        toast.success(`Sent to ${authorName}`);
      }
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't send. Please try again."),
  });

  const react = (emoji: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (send.isPending) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = nextId.current++;
    setFloaters((f) => [...f, { id, emoji, x: rect.left + rect.width / 2 }]);
    window.setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1300);
    send.mutate({ body: emoji, kind: "reaction" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate({ body, kind: "reply" });
  };

  return (
    <div className="relative px-3 pt-1 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      {floaters.map((f) => (
        <span
          key={f.id}
          aria-hidden="true"
          className="story-react-float pointer-events-none fixed bottom-28 z-[110] select-none text-5xl leading-none"
          style={{ left: f.x - 24 }}
        >
          {f.emoji}
        </span>
      ))}

      <div
        role="group"
        aria-label="Quick reactions"
        className="mb-1 flex items-center justify-center gap-1"
      >
        {STORY_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={(e) => react(emoji, e)}
            aria-label={`React ${emoji}`}
            className="story-react-btn grid h-11 w-11 place-items-center rounded-full text-[26px] leading-none transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-90"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <form
          onSubmit={submit}
          className="flex min-h-12 min-w-0 flex-1 items-center rounded-full border border-white/30 bg-white/10 pl-4 pr-1.5 backdrop-blur-md transition focus-within:border-white/70 focus-within:bg-white/15"
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, STORY_REPLY_MAX))}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            placeholder="Send message"
            aria-label={`Send ${authorName} a message`}
            maxLength={STORY_REPLY_MAX}
            enterKeyHint="send"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-white outline-none placeholder:text-white/70"
          />
          {text.trim() && (
            <button
              type="submit"
              disabled={send.isPending}
              aria-label="Send message"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
            >
              {send.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </form>
        {trailing}
      </div>
    </div>
  );
}
