import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const HOLD_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * A chat bubble that can be long-pressed (hold a finger, hold the mouse button, or right-click).
 * `onLongPress` gets the bubble's position so the menu can sit beside it. A normal tap, the
 * play button of a voice message and scrolling keep working exactly as before.
 */
export function PressableBubble({
  enabled,
  onLongPress,
  className,
  children,
}: {
  enabled: boolean;
  onLongPress: (rect: DOMRect) => void;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

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
    },
    [],
  );

  if (!enabled) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      className={`${className} select-none`}
      style={{ WebkitTouchCallout: "none" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = window.setTimeout(trigger, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (
          timer.current !== undefined &&
          Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) >
            MOVE_TOLERANCE_PX
        )
          clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        // right-click, or the phone's own long-press: use our menu instead of the system one
        e.preventDefault();
        if (!fired.current) trigger();
      }}
      onClickCapture={(e) => {
        // the finger lifting after a long press must not also press play / seek
        if (fired.current) {
          e.preventDefault();
          e.stopPropagation();
          fired.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}

/** The small list that appears beside a long-pressed message: Edit (text only) and Delete. */
export function MessageMenu({
  rect,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  rect: DOMRect;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // beside the bubble when there is room, otherwise just under (or over) it
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (rect.left - gap - w >= gap) {
      left = rect.left - gap - w;
      top = rect.top;
    } else {
      left = rect.right - w;
      top = rect.bottom + gap;
      if (top + h > vh - gap) top = rect.top - gap - h;
    }
    left = Math.min(Math.max(gap, left), vw - w - gap);
    top = Math.min(Math.max(gap, top), vh - h - gap);
    setPos({ top, left });
  }, [rect]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const close = () => closeRef.current();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  const item =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Message options"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
      className="fixed z-50 min-w-[9.5rem] overflow-hidden rounded-xl border border-border bg-card py-1 text-card-foreground shadow-lg"
    >
      {canEdit && (
        <button type="button" role="menuitem" onClick={onEdit} className={item}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </button>
      )}
      <button type="button" role="menuitem" onClick={onDelete} className={`${item} text-destructive`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </button>
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
          className="rounded-full bg-black/15 px-3 py-1 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(trimmed)}
          disabled={!canSave}
          className="inline-flex items-center gap-1 rounded-full bg-primary-foreground px-3 py-1 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Save
        </button>
      </div>
    </div>
  );
}
