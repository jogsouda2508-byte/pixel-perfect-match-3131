import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

type Point = { x: number; y: number };

/**
 * Full-screen profile photo shown as a circle. Pinch (two fingers), mouse wheel or double-tap to
 * zoom, and drag to move the photo around in any direction; the photo always fills the circle.
 * Tapping outside the circle (or the close button) closes it.
 */
export function CirclePhotoViewer({
  open,
  onOpenChange,
  src,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  name: string;
}) {
  const circleRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    if (open) setView({ scale: 1, x: 0, y: 0 });
  }, [open]);

  // keep the photo covering the whole circle: it can only move as far as the zoom allows
  const clamp = useCallback((scale: number, x: number, y: number) => {
    const size = circleRef.current?.clientWidth ?? 0;
    const max = ((scale - 1) * size) / 2;
    return {
      scale,
      x: Math.min(max, Math.max(-max, x)),
      y: Math.min(max, Math.max(-max, y)),
    };
  }, []);

  const zoomTo = useCallback(
    (next: number) => {
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        const ratio = scale / v.scale;
        return clamp(scale, v.x * ratio, v.y * ratio);
      });
    },
    [clamp],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.dist > 0) zoomTo(gesture.current.scale * (dist / gesture.current.dist));
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    setView((v) => clamp(v.scale, v.x + dx, v.y + dy));
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    // a quick second tap toggles between normal and 2.5x
    if (e.type === "pointerup" && pointers.current.size === 0) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setView((v) => (v.scale > 1.05 ? { scale: 1, x: 0, y: 0 } : clamp(2.5, 0, 0)));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{name}'s profile photo</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Profile photo in a circle. Pinch or scroll to zoom, drag to move it. Tap outside the
            circle or press close to return.
          </DialogPrimitive.Description>
          <div className="flex justify-end px-3 py-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
            <DialogPrimitive.Close
              aria-label="Close"
              className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-6 w-6" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            <div
              ref={circleRef}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onWheel={(e) => zoomTo(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
              className="aspect-square w-[min(88vw,70dvh)] cursor-grab touch-none select-none overflow-hidden rounded-full bg-black shadow-[0_0_0_3px_rgba(255,255,255,0.85)] active:cursor-grabbing"
            >
              <img
                src={src}
                alt={name}
                draggable={false}
                style={{
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                }}
                className="h-full w-full object-cover will-change-transform"
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
