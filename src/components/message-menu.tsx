import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Loader2, Pencil, Reply, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { QUICK_REACTIONS } from "@/lib/chat-extras";

const HOLD_MS = 450;
const MOVE_TOLERANCE_PX = 10;
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 84;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 24;

/**
 * A chat bubble that understands WhatsApp-style touches:
 *  - hold (or right-click)  -> `onLongPress` with the bubble's position, for the menu
 *  - swipe right            -> `onReply`
 *  - double tap / click     -> `onDoubleTap` (the heart reaction)
 *  - single tap             -> `onTap` (only when `onDoubleTap` is also used it waits a moment,
 *                              so a double tap never opens the photo first)
 * Taps on buttons / links inside the bubble (play, seek, quoted message...) are left alone, and
 * scrolling the chat keeps working because only a clearly sideways drag starts a swipe.
 */
export function PressableBubble({
  enabled,
  onLongPress,
  onReply,
  onDoubleTap,
  onTap,
  outerClassName = "",
  className,
  overlay,
  children,
}: {
  enabled: boolean;
  onLongPress: (rect: DOMRect) => void;
  onReply?: () => void;
  onDoubleTap?: () => void;
  onTap?: () => void;
  /** classes for the wrapper that sizes the bubble (e.g. spacing for the reaction pill) */
  outerClassName?: string;
  className: string;
  /** drawn on top of the bubble: the reaction pill, the big heart that pops on double tap */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const swiping = useRef(false);
  const moved = useRef(false);
  const swiped = useRef(false);
  // a swipe / hold only counts while a finger or the mouse button is actually down
  const pressed = useRef(false);
  const lastTap = useRef({ at: 0, x: 0, y: 0 });
  const [offset, setOffset] = useState(0);

  const clear = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };
  const trigger = () => {
    clear();
    fired.current = true;
    if (ref.current) onLongPress(ref.current.getBoundingClientRect());
  };
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (tapTimer.current !== undefined) window.clearTimeout(tapTimer.current);
    },
    [],
  );

  if (!enabled)
    return (
      <div className={`relative max-w-[85%] ${outerClassName}`}>
        <div className={`relative ${className}`}>
          {children}
          {overlay}
        </div>
      </div>
    );

  const finishSwipe = (commit: boolean) => {
    const wasSwiping = swiping.current;
    swiping.current = false;
    if (wasSwiping && commit && offset >= SWIPE_TRIGGER_PX) onReply?.();
    setOffset(0);
  };
  const progress = Math.min(1, offset / SWIPE_TRIGGER_PX);

  return (
    <div className={`relative max-w-[85%] ${outerClassName}`} style={{ touchAction: "pan-y" }}>
      {onReply && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 grid h-8 w-8 place-items-center rounded-full bg-black/10 text-[var(--wa-icon)] dark:bg-white/10"
          style={{
            opacity: progress,
            transform: `translate(${Math.min(offset, SWIPE_MAX_PX) * 0.4}px, -50%) scale(${0.6 + 0.4 * progress})`,
          }}
        >
          <Reply className="h-4 w-4" />
        </span>
      )}
      <div
        ref={ref}
        className={`relative select-none ${className}`}
        style={{
          WebkitTouchCallout: "none",
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: swiping.current ? "none" : "transform 180ms ease-out",
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          pressed.current = true;
          fired.current = false;
          swiping.current = false;
          swiped.current = false;
          moved.current = false;
          origin.current = { x: e.clientX, y: e.clientY };
          clear();
          timer.current = window.setTimeout(trigger, HOLD_MS);
        }}
        onPointerMove={(e) => {
          if (!pressed.current) return; // just hovering with the mouse: do nothing
          const dx = e.clientX - origin.current.x;
          const dy = e.clientY - origin.current.y;
          if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
            moved.current = true;
            clear();
          }
          if (!onReply || fired.current) return;
          if (!swiping.current && dx > 14 && dx > Math.abs(dy) * 1.6) {
            swiping.current = true;
            swiped.current = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* capture is only a nicety */
            }
          }
          if (swiping.current) {
            // a little resistance past the trigger point
            const raw = Math.max(0, dx);
            setOffset(
              raw <= SWIPE_TRIGGER_PX ? raw : SWIPE_TRIGGER_PX + (raw - SWIPE_TRIGGER_PX) * 0.3,
            );
          }
        }}
        onPointerUp={(e) => {
          const wasPressed = pressed.current;
          pressed.current = false;
          clear();
          if (swiping.current) {
            finishSwipe(true);
            return;
          }
          if (!wasPressed || fired.current || moved.current) return;
          const target = e.target as HTMLElement;
          if (target.closest("button, a, input, textarea, audio")) return;
          // a plain tap: count it for double-tap / single-tap
          const now = Date.now();
          const prev = lastTap.current;
          const near = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < TAP_SLOP_PX;
          if (onDoubleTap && now - prev.at < DOUBLE_TAP_MS && near) {
            lastTap.current = { at: 0, x: 0, y: 0 };
            if (tapTimer.current !== undefined) window.clearTimeout(tapTimer.current);
            tapTimer.current = undefined;
            onDoubleTap();
            return;
          }
          lastTap.current = { at: now, x: e.clientX, y: e.clientY };
          if (onTap) {
            if (tapTimer.current !== undefined) window.clearTimeout(tapTimer.current);
            if (onDoubleTap) tapTimer.current = window.setTimeout(onTap, DOUBLE_TAP_MS + 20);
            else onTap();
          }
        }}
        onPointerCancel={() => {
          pressed.current = false;
          clear();
          finishSwipe(false);
        }}
        onLostPointerCapture={() => {
          pressed.current = false;
          if (swiping.current) finishSwipe(false);
        }}
        onPointerLeave={() => {
          if (swiping.current) return; // the pointer is captured: keep following it
          pressed.current = false;
          clear();
          if (offset) setOffset(0);
        }}
        onContextMenu={(e) => {
          // right-click, or the phone's own long-press: use our menu instead of the system one
          e.preventDefault();
          if (!fired.current) trigger();
        }}
        onClickCapture={(e) => {
          // the finger lifting after a long press / swipe must not also press play / seek
          if (fired.current || swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            fired.current = false;
            swiped.current = false;
          }
        }}
      >
        {children}
        {overlay}
      </div>
    </div>
  );
}

/**
 * The menu that appears over a long-pressed message, like WhatsApp: a row of quick reactions,
 * then Reply / Copy and (my own messages only) Edit / Delete.
 */
export function MessageMenu({
  rect,
  own,
  myReaction,
  canEdit,
  canCopy,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onClose,
}: {
  rect: DOMRect;
  own: boolean;
  myReaction?: string | undefined;
  canEdit: boolean;
  canCopy: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  /** omitted for messages that aren't mine: they can't be edited or deleted */
  onEdit?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // sits under the bubble when there is room, otherwise over it; lined up with the bubble's side
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + gap;
    if (top + h > vh - gap) top = rect.top - gap - h;
    let left = own ? rect.right - w : rect.left;
    left = Math.min(Math.max(gap, left), vw - w - gap);
    top = Math.min(Math.max(gap, top), vh - h - gap);
    setPos({ top, left });
  }, [rect, own]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const close = () => closeRef.current();
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  const item =
    "flex w-full items-center gap-3 px-4 py-2 text-left text-sm sm:py-2.5 sm:text-[15px] text-[var(--wa-text)] hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10";

  return createPortal(
    <div className="wa-chat fixed inset-0 z-50 !bg-transparent">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
        onPointerDown={() => closeRef.current()}
      />
      <div
        ref={ref}
        role="menu"
        aria-label="Message options"
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
        className="wa-menu-in absolute flex w-56 flex-col gap-2 sm:w-60"
      >
        <div
          role="group"
          aria-label="React"
          className="flex items-center justify-between rounded-full bg-[var(--wa-menu)] px-2 py-1.5 shadow-xl"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              aria-label={`React ${emoji}`}
              onClick={() => onReact(emoji)}
              className={`grid h-8 w-8 place-items-center rounded-full text-xl sm:h-9 sm:w-9 sm:text-[22px] leading-none transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                myReaction === emoji
                  ? "bg-black/10 dark:bg-white/15"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl bg-[var(--wa-menu)] py-1 shadow-xl">
          <button type="button" role="menuitem" onClick={onReply} className={item}>
            <Reply className="h-[18px] w-[18px] text-[var(--wa-icon)]" aria-hidden="true" />
            Reply
          </button>
          {canCopy && (
            <button type="button" role="menuitem" onClick={onCopy} className={item}>
              <Copy className="h-[18px] w-[18px] text-[var(--wa-icon)]" aria-hidden="true" />
              Copy
            </button>
          )}
          {canEdit && onEdit && (
            <button type="button" role="menuitem" onClick={onEdit} className={item}>
              <Pencil className="h-[18px] w-[18px] text-[var(--wa-icon)]" aria-hidden="true" />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={onDelete}
              className={`${item} !text-destructive`}
            >
              <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Replaces a text message's words while it is being edited. */
export function InlineEdit({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const trimmed = text.trim();
  const canSave = !busy && trimmed.length > 0 && trimmed !== initial.trim();
  return (
    <div className="w-[min(16rem,68vw)] max-w-full">
      <Textarea
        autoFocus
        value={text}
        maxLength={2000}
        rows={3}
        disabled={busy}
        aria-label="Edit your message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) onSave(trimmed);
        }}
        className="min-h-16 resize-none bg-background text-foreground"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full bg-black/10 px-3 py-1 text-xs font-semibold text-[var(--wa-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 dark:bg-white/15"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(trimmed)}
          disabled={!canSave}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--wa-accent)] px-3 py-1 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Save
        </button>
      </div>
    </div>
  );
}
