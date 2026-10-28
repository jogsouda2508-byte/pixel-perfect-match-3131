import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  CheckCheck,
  Clock,
  FileText,
  ImageIcon,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { MessageReactionRow, MessageRow } from "@/integrations/supabase/types";
import { formatFileSize, quotePreview, type ReactionGroup } from "@/lib/chat-extras";

export function DayPill({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-lg bg-[var(--wa-day)] px-2.5 py-0.5 text-[11px] font-medium sm:px-3 sm:py-1 sm:text-xs text-[var(--wa-day-fg)] shadow-sm">
        {label}
      </span>
    </div>
  );
}

/** The little time (and ticks) in the corner of a bubble. */
export function MessageMeta({
  iso,
  own,
  edited,
  sending,
  read,
  onImage = false,
}: {
  iso: string;
  own: boolean;
  edited?: boolean;
  sending?: boolean;
  read?: boolean;
  /** on top of a photo: white text so it stays readable */
  onImage?: boolean;
}) {
  const tone = onImage
    ? "text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]"
    : "text-[var(--wa-meta)]";
  return (
    <span
      className={`flex items-center gap-1 whitespace-nowrap text-[10px] leading-none sm:text-[11px] ${tone}`}
    >
      {edited && <span>edited</span>}
      <time dateTime={iso}>
        {new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </time>
      {own &&
        (sending ? (
          <Clock className="h-3 w-3" aria-label="Sending" />
        ) : read ? (
          <CheckCheck className="h-4 w-4 text-[var(--wa-tick)]" aria-label="Read" />
        ) : (
          <Check className="h-4 w-4" aria-label="Sent" />
        ))}
    </span>
  );
}

/** The quoted message shown at the top of a reply. Tap it to jump to the original. */
export function ReplyQuote({
  quoted,
  name,
  color,
  onJump,
}: {
  quoted: MessageRow | undefined;
  name: string;
  color: string;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!quoted}
      aria-label={quoted ? `Go to the message from ${name}` : "Original message was deleted"}
      className="mb-1 flex w-full min-w-0 items-stretch overflow-hidden rounded-md bg-[var(--wa-quote)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 px-2 py-1">
        <span className="block truncate text-xs font-semibold sm:text-[13px]" style={{ color }}>
          {name}
        </span>
        <span
          className={`line-clamp-2 break-words text-xs sm:text-[13px] text-[var(--wa-meta)] ${quoted ? "" : "italic"}`}
        >
          {quoted ? quotePreview(quoted) : "This message was deleted"}
        </span>
      </span>
      {quoted?.image_url && (
        <img
          src={quoted.image_url}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 object-cover"
        />
      )}
    </button>
  );
}

/** The photo in a bubble. Its shape is reserved up front, so the chat doesn't jump while it loads. */
export function ImageBody({
  url,
  width,
  height,
  uploading,
  overlay,
}: {
  url: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  uploading?: boolean;
  /** time + ticks drawn over the bottom-right corner */
  overlay?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const ratio = width && height ? Math.min(1.6, Math.max(0.7, width / height)) : 1;
  return (
    <div
      className="relative w-[min(14.5rem,62vw)] max-w-full overflow-hidden rounded-md bg-black/10 sm:w-[min(16.5rem,70vw)]"
      style={{ aspectRatio: String(ratio) }}
    >
      {broken ? (
        <div className="grid h-full w-full place-items-center text-xs text-[var(--wa-meta)]">
          Photo unavailable
        </div>
      ) : (
        <img
          src={url}
          alt="Photo"
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full select-none object-cover"
        />
      )}
      {uploading && (
        <span className="absolute inset-0 grid place-items-center bg-black/35">
          <Loader2 className="h-7 w-7 animate-spin text-white" aria-label="Uploading" />
        </span>
      )}
      {overlay && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/45 to-transparent px-2 pb-1 pt-5">
          {overlay}
        </span>
      )}
    </div>
  );
}

export function FileBody({
  url,
  name,
  size,
}: {
  url: string;
  name: string | null | undefined;
  size: number | null | undefined;
}) {
  const label = name || "Document";
  const ext = label.includes(".") ? (label.split(".").pop() ?? "").toUpperCase().slice(0, 5) : "";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={label}
      aria-label={`Open ${label}`}
      className="flex w-[min(14.5rem,62vw)] max-w-full items-center gap-2.5 rounded-md sm:w-[min(16.5rem,70vw)] sm:gap-3 bg-[var(--wa-quote)] p-2.5 text-[var(--wa-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#f15c6d] text-white">
        <FileText className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium sm:text-sm">{label}</span>
        <span className="block text-[11px] text-[var(--wa-meta)] sm:text-xs">
          {[formatFileSize(size), ext].filter(Boolean).join(" · ") || "Tap to open"}
        </span>
      </span>
    </a>
  );
}

/** The reaction under a bubble, like the heart under the photo in WhatsApp. Tap to see who reacted. */
export function ReactionPill({
  groups,
  own,
  onClick,
}: {
  groups: ReactionGroup[];
  own: boolean;
  onClick: () => void;
}) {
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + g.count, 0);
  const shown = groups.slice(0, 3).map((g) => g.emoji);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${total} reaction${total === 1 ? "" : "s"}: ${shown.join(" ")}. See who reacted`}
      className={`absolute -bottom-3.5 z-10 flex items-center gap-0.5 rounded-full border border-[var(--wa-pill-border)] bg-[var(--wa-pill)] px-1.5 py-[3px] text-[13px] leading-none shadow-sm sm:text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        own ? "right-2" : "left-2"
      }`}
    >
      <span key={shown.join("")} className="wa-react-in inline-flex">
        {shown.join("")}
      </span>
      {total > 1 && <span className="ml-0.5 text-[11px] text-[var(--wa-meta)]">{total}</span>}
    </button>
  );
}

/** Who reacted with what. Tapping my own row takes my reaction back. */
export function ReactionsSheet({
  open,
  onOpenChange,
  list,
  me,
  nameOf,
  onRemoveMine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: MessageReactionRow[];
  me: string | undefined;
  nameOf: (userId: string) => string;
  onRemoveMine: () => void;
}) {
  const sorted = [...list].sort((a, b) => (a.user_id === me ? -1 : b.user_id === me ? 1 : 0));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Reactions</DialogTitle>
        <DialogDescription className="sr-only">Who reacted to this message</DialogDescription>
        <ul className="-mx-1 max-h-72 overflow-y-auto">
          {sorted.map((r) => {
            const mine = r.user_id === me;
            return (
              <li key={r.user_id}>
                <button
                  type="button"
                  disabled={!mine}
                  onClick={() => {
                    onRemoveMine();
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {mine ? "You" : nameOf(r.user_id)}
                    </span>
                    {mine && (
                      <span className="block text-xs text-muted-foreground">Tap to remove</span>
                    )}
                  </span>
                  <span className="text-2xl leading-none">{r.emoji}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Full-screen photo. Tap anywhere, press Escape or use the X to close. */
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-6 w-6" aria-hidden="true" />
      </button>
      <img src={url} alt="Photo" className="max-h-full max-w-full object-contain" />
    </div>,
    document.body,
  );
}

export type AttachKind = "document" | "camera" | "gallery";

/** The little card above the composer: Document, Camera, Gallery. */
export function AttachMenu({
  onPick,
  onClose,
  ignore,
}: {
  onPick: (kind: AttachKind) => void;
  onClose: () => void;
  /** the paperclip button: pressing it must not count as an outside click */
  ignore: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose, ignore]);

  const items: { kind: AttachKind; label: string; color: string; icon: ReactNode }[] = [
    {
      kind: "document",
      label: "Document",
      color: "#7f66ff",
      icon: <FileText className="h-[18px] w-[18px] sm:h-6 sm:w-6" />,
    },
    {
      kind: "camera",
      label: "Camera",
      color: "#ff2e74",
      icon: <Camera className="h-[18px] w-[18px] sm:h-6 sm:w-6" />,
    },
    {
      kind: "gallery",
      label: "Gallery",
      color: "#bf59cf",
      icon: <ImageIcon className="h-[18px] w-[18px] sm:h-6 sm:w-6" />,
    },
  ];
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Attach"
      className="wa-menu-in absolute bottom-full left-3 z-30 mb-2 grid w-[min(15.5rem,calc(100vw-1.5rem))] grid-cols-3 gap-1 rounded-2xl bg-[var(--wa-menu)] p-2.5 shadow-xl ring-1 ring-black/5 sm:w-[min(20rem,calc(100vw-1.5rem))] sm:gap-2 sm:p-4"
    >
      {items.map((it) => (
        <button
          key={it.kind}
          type="button"
          role="menuitem"
          onClick={() => onPick(it.kind)}
          className="flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-medium text-[var(--wa-icon)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-1.5 sm:text-xs"
        >
          <span
            className="grid h-10 w-10 place-items-center rounded-full text-white shadow-sm sm:h-12 sm:w-12"
            style={{ backgroundColor: it.color }}
          >
            {it.icon}
          </span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export type PreviewItem = { file: File; caption: string };

/** Look at the photos (and add captions) before they are sent, like WhatsApp. */
export function MediaPreview({
  files,
  toName,
  onClose,
  onSend,
}: {
  files: File[];
  toName: string;
  onClose: () => void;
  onSend: (items: PreviewItem[]) => void;
}) {
  const [list, setList] = useState<PreviewItem[]>(() =>
    files.map((file) => ({ file, caption: "" })),
  );
  const [index, setIndex] = useState(0);
  const urls = useMemo(() => list.map((i) => URL.createObjectURL(i.file)), [list]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const current = list[Math.min(index, list.length - 1)];
  const at = Math.min(index, list.length - 1);
  if (!current) return null;

  const setCaption = (caption: string) =>
    setList((l) => l.map((it, i) => (i === at ? { ...it, caption } : it)));
  const remove = (i: number) => {
    if (list.length === 1) {
      onClose();
      return;
    }
    setList((l) => l.filter((_, k) => k !== i));
    setIndex((x) => Math.max(0, x > i ? x - 1 : Math.min(x, list.length - 2)));
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send photos"
      className="wa-chat fixed inset-0 z-[65] flex flex-col !bg-[#0b141a] text-white"
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className="truncate text-sm text-white/80">To {toName}</span>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-2">
        <img
          src={urls[at]}
          alt={`Photo ${at + 1} of ${list.length}`}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      {list.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2">
          {list.map((it, i) => (
            <div key={`${it.file.name}-${i}`} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                className={`block h-14 w-14 overflow-hidden rounded-lg border-2 ${
                  i === at ? "border-[var(--wa-accent)]" : "border-transparent opacity-70"
                }`}
              >
                <img src={urls[i]} alt="" className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(list);
        }}
      >
        <input
          value={current.caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={1000}
          placeholder="Add a caption…"
          aria-label="Add a caption"
          className="h-12 min-w-0 flex-1 rounded-full bg-[#2a3942] px-4 text-[15px] text-white outline-none placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-white/40"
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--wa-accent)] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>
    </div>,
    document.body,
  );
}

/** "Replying to ..." above the text box. */
export function ReplyBar({
  name,
  color,
  quoted,
  onClose,
}: {
  name: string;
  color: string;
  quoted: MessageRow;
  onClose: () => void;
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-t-3xl bg-[var(--wa-input)] pr-1 text-[var(--wa-input-fg)] shadow-sm">
      <div className="m-1.5 flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg bg-[var(--wa-quote)]">
        <span className="w-1 shrink-0" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 px-2 py-1">
          <span className="block truncate text-xs font-semibold sm:text-[13px]" style={{ color }}>
            {name}
          </span>
          <span className="block truncate text-xs text-[var(--wa-meta)] sm:text-[13px]">
            {quotePreview(quoted)}
          </span>
        </span>
        {quoted.image_url && (
          <img src={quoted.image_url} alt="" className="h-11 w-11 shrink-0 object-cover" />
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cancel reply"
        className="grid h-10 w-10 shrink-0 self-center place-items-center rounded-full text-[var(--wa-icon)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
