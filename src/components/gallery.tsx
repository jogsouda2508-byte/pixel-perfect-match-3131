import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { CommentIcon } from "@/components/icons";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type GalleryItem = {
  /** The post id, so "View post" can open it with likes and comments. */
  id: string;
  type: "image" | "video";
  src: string;
  poster?: string | null;
  caption?: string;
};

/**
 * Full-screen, Instagram-style viewer. Open it by passing the index of the tapped item;
 * pass null to close. Arrow buttons, the keyboard arrows and swipe all move between items.
 */
export function Gallery({
  items,
  startIndex,
  onClose,
}: {
  items: GalleryItem[];
  startIndex: number | null;
  onClose: () => void;
}) {
  const open = startIndex !== null && items.length > 0;
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (startIndex !== null) setIndex(Math.max(0, Math.min(startIndex, items.length - 1)));
  }, [startIndex, items.length]);

  const item = items[index];
  const hasMany = items.length > 1;
  const prev = () => setIndex((i) => (i > 0 ? i - 1 : i));
  const next = () => setIndex((i) => (i < items.length - 1 ? i + 1 : i));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") prev();
    if (event.key === "ArrowRight") next();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Media viewer</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Use the left and right arrows to move between photos and videos.
          </DialogPrimitive.Description>

          <div className="flex items-center justify-between px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
            <span
              className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold tabular-nums text-white/85 ring-1 ring-white/10"
              aria-live="polite"
            >
              {hasMany ? `${index + 1} / ${items.length}` : ""}
            </span>
            <DialogPrimitive.Close
              aria-label="Close"
              className="grid h-11 w-11 place-items-center rounded-full bg-white/10 ring-1 ring-white/10 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-6 w-6" />
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              const end = e.changedTouches[0]?.clientX;
              if (start === null || end === undefined) return;
              if (end - start > 50) prev();
              if (start - end > 50) next();
            }}
          >
            {item &&
              (item.type === "video" ? (
                <video
                  key={item.id}
                  src={item.src}
                  poster={item.poster ?? undefined}
                  controls
                  controlsList="nofullscreen"
                  disablePictureInPicture
                  autoPlay
                  playsInline
                  className="max-h-full max-w-full rounded-2xl"
                />
              ) : (
                <img
                  key={item.id}
                  src={item.src}
                  alt={item.caption ?? ""}
                  className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
                />
              ))}

            {hasMany && index > 0 && (
              <button
                type="button"
                onClick={prev}
                aria-label="Previous"
                className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:grid"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {hasMany && index < items.length - 1 && (
              <button
                type="button"
                onClick={next}
                aria-label="Next"
                className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:grid"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>

          {item && (
            <div className="flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-4">
              <p className="line-clamp-2 min-w-0 flex-1 break-words text-sm text-white/90">
                {item.caption}
              </p>
              <Link
                to="/post/$id"
                params={{ id: item.id }}
                search={{ comments: true }}
                onClick={onClose}
                className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-xs font-bold ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <CommentIcon className="h-4 w-4" aria-hidden="true" />
                Likes &amp; comments
              </Link>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
