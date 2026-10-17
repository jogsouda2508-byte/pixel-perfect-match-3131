import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Loader2, Smile } from "lucide-react";

// Loaded on first open only: the emoji data is large and most visits never need it.
const EmojiPickerPanel = lazy(() => import("@/components/emoji-picker"));

/**
 * Smiley button + Emoji Mart popover for a single-line text input (used for comments).
 * Inserts the chosen emoji at the caret without touching the rest of the text.
 * The popover is positioned against the nearest `relative` ancestor, so put this inside
 * a `relative` row.
 */
export function EmojiButton({
  inputRef,
  value,
  onChange,
  maxLength,
  disabled = false,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const insert = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (next.length > maxLength) return;
    onChange(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      // Only grab focus on larger screens, so phones don't pop the keyboard over the picker.
      if (window.matchMedia("(min-width: 640px)").matches) el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Add emoji"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary hover:bg-elevated ${open ? "bg-elevated" : ""}`}
      >
        <Smile className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={wrapRef}
          className="absolute bottom-full right-0 z-50 mb-2 w-[min(23rem,calc(100vw-2rem))]"
        >
          <Suspense
            fallback={
              <div className="grid h-40 place-items-center rounded-2xl border border-border bg-card shadow-lg">
                <Loader2
                  className="h-5 w-5 animate-spin text-primary"
                  aria-label="Loading emojis"
                />
              </div>
            }
          >
            <EmojiPickerPanel onSelect={insert} />
          </Suspense>
        </div>
      )}
    </>
  );
}
