import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import {
  clampCrop,
  cropRegion,
  coverScale,
  MAX_ZOOM,
  MIN_ZOOM,
  pointDistance,
  renderCrop,
  zoomAround,
  type CropState,
} from "@/lib/image-crop";

type Pt = { x: number; y: number };

/**
 * Full-screen "move and zoom your photo" step, like Instagram: a round window over the picture.
 * Drag to move, pinch (or use the slider, the buttons, the mouse wheel or the arrow keys) to zoom.
 * "Save photo" hands back a square 512 px JPEG as a File. Nothing is uploaded here.
 */
export function AvatarCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [state, setState] = useState<CropState>({ zoom: 1, x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // The window is as wide as fits on the screen, at most 320 px.
  const [view, setView] = useState(280);
  useEffect(() => {
    const fit = () => setView(Math.max(200, Math.min(320, window.innerWidth - 48)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setNatural(null);
    setLoadError(false);
    setState({ zoom: 1, x: 0, y: 0 });
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Keep the picture covering the window if the window is resized (e.g. phone turned sideways).
  useEffect(() => {
    if (natural) setState((s) => clampCrop(s, natural.w, natural.h, view));
  }, [view, natural]);

  const apply = useCallback(
    (next: CropState | ((s: CropState) => CropState)) => {
      if (!natural) return;
      setState((s) =>
        clampCrop(typeof next === "function" ? next(s) : next, natural.w, natural.h, view),
      );
    },
    [natural, view],
  );

  // ---- touch / mouse: one pointer drags, two pointers pinch -------------------------------
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ startDist: number; startZoom: number } | null>(null);

  const centre = (p: Pt): Pt => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: p.x - (r ? r.left + r.width / 2 : 0), y: p.y - (r ? r.top + r.height / 2 : 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt];
      gesture.current = { startDist: Math.max(1, pointDistance(a, b)), startZoom: state.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!natural) return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);

    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt];
      const mid = centre({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const g = gesture.current;
      const nextZoom = g.startZoom * (pointDistance(a, b) / g.startDist);
      setState((s) => zoomAround(s, nextZoom, mid.x, mid.y, natural.w, natural.h, view));
    } else if (pointers.current.size === 1) {
      const dx = now.x - prev.x;
      const dy = now.y - prev.y;
      apply((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const setZoom = (zoom: number, at: Pt = { x: 0, y: 0 }) => {
    if (!natural) return;
    setState((s) => zoomAround(s, zoom, at.x, at.y, natural.w, natural.h, view));
  };

  // The mouse wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
      setState((s) =>
        natural
          ? zoomAround(
              s,
              s.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08),
              at.x,
              at.y,
              natural.w,
              natural.h,
              view,
            )
          : s,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [natural, view]);

  // Escape closes; arrow keys nudge the picture; + and - zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCancel();
      const step = 12;
      if (e.key === "ArrowLeft") apply((s) => ({ ...s, x: s.x + step }));
      else if (e.key === "ArrowRight") apply((s) => ({ ...s, x: s.x - step }));
      else if (e.key === "ArrowUp") apply((s) => ({ ...s, y: s.y + step }));
      else if (e.key === "ArrowDown") apply((s) => ({ ...s, y: s.y - step }));
      else if (e.key === "+" || e.key === "=") setZoom(state.zoom * 1.1);
      else if (e.key === "-") setZoom(state.zoom / 1.1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, onCancel, state.zoom, natural, view]);

  // ---- layout of the picture inside the window --------------------------------------------
  const layout = useMemo(() => {
    if (!natural) return null;
    const scale = coverScale(natural.w, natural.h, view) * state.zoom;
    const w = natural.w * scale;
    const h = natural.h * scale;
    return { w, h, left: view / 2 + state.x - w / 2, top: view / 2 + state.y - h / 2 };
  }, [natural, state, view]);

  const save = async () => {
    if (!natural || !imgRef.current || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const blob = await renderCrop(imgRef.current, cropRegion(state, natural.w, natural.h, view));
      onDone(new File([blob], "avatar.jpg", { type: "image/jpeg", lastModified: Date.now() }));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save the cropped photo.");
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move and zoom your photo"
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-5 bg-black/90 p-4 text-white"
    >
      <h2 className="text-base font-semibold">Move and zoom</h2>

      <div
        ref={stageRef}
        data-testid="crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative cursor-grab touch-none select-none overflow-hidden bg-neutral-900 active:cursor-grabbing"
        style={{ width: view, height: view }}
      >
        {url && !loadError && (
          <img
            ref={imgRef}
            src={url}
            alt="Your photo"
            draggable={false}
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth > 0 && i.naturalHeight > 0)
                setNatural({ w: i.naturalWidth, h: i.naturalHeight });
              else setLoadError(true);
            }}
            onError={() => setLoadError(true)}
            className="pointer-events-none absolute max-w-none"
            style={
              layout
                ? { width: layout.w, height: layout.h, left: layout.left, top: layout.top }
                : { opacity: 0, width: view, height: view }
            }
          />
        )}
        {/* the round window: everything outside the circle is dimmed */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.62), inset 0 0 0 2px rgba(255,255,255,0.85)",
          }}
        />
        {!natural && !loadError && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading photo" />
          </div>
        )}
        {loadError && (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center p-6 text-center text-sm"
          >
            Couldn't open this photo. Please choose a different one.
          </p>
        )}
      </div>

      <div className="flex w-full max-w-xs items-center gap-3">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(state.zoom / 1.15)}
          disabled={!natural}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-40"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={state.zoom}
          disabled={!natural}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-2 w-full flex-1 accent-[var(--primary)]"
        />
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(state.zoom * 1.15)}
          disabled={!natural}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {saveError && (
        <p role="alert" className="text-center text-sm text-red-300">
          {saveError}
        </p>
      )}

      <div className="flex w-full max-w-xs gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-12 flex-1 rounded-full border border-white/30 text-sm font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!natural || saving}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save photo
        </button>
      </div>
    </div>
  );
}
