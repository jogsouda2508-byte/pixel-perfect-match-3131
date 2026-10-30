import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, Loader2, Music2, Pencil, Send, Smile, Trash2, Type, Undo2, X } from "lucide-react";
import { StoryMusicPicker } from "@/components/story-music-picker";
import type { StoryMusic } from "@/lib/story-music";
import {
  BRUSH_COLORS,
  BRUSH_SIZES,
  CAPTION_MAX_CHARS,
  CAPTION_Y,
  DESIGN_W,
  FONT_STACK,
  K,
  MUSIC_ARTIST_FONT,
  MUSIC_H,
  MUSIC_NAME_FONT,
  MUSIC_TEXT_W,
  MUSIC_W,
  TEXT_COLORS,
  W,
  contrastColor,
  drawStrokes,
  layoutCaption,
  layoutText,
  renderStoryFile,
  splitMusicTitle,
  type Stroke,
  type StoryOverlay,
} from "@/lib/story-render";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: "Smileys", items: "😀 😂 🥹 😍 🥰 😎 🤩 😘 😇 🤗 🤭 😴 🥳 😭 😡 🤯 🥺 😏 🙃 😜 🤔 😅 😬 🫠".split(" ") },
  { label: "Love & hands", items: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💕 💖 🔥 ✨ 👍 👏 🙌 🙏 💪 👀 🤝 ✌️ 🤞 👌 🫶 💯".split(" ") },
  { label: "Party", items: "🎉 🎊 🎂 🎁 🎈 🥂 🍾 🎶 🎵 🎤 🎧 🎸 🪩 🏆 🥇 🎯 🎮 🎬 📸 💃 🕺 🪅 🎆 🎇".split(" ") },
  { label: "Nature", items: "🌹 🌸 🌻 🌈 ☀️ 🌙 ⭐ ⚡ ❄️ 🌊 🌴 🍀 🦋 🐶 🐱 🦁 🐼 🦄 🐯 🐬 🌍 🌅 ☁️ 🪐".split(" ") },
  { label: "Food", items: "🍕 🍔 🍟 🌮 🍿 🍩 🍦 🍫 🍓 🍉 🥭 ☕ 🧋 🍜 🍣 🍰 🍪 🥤 🍺 🍷 🥑 🍌 🍒 🌶️".split(" ") },
  { label: "Travel", items: "✈️ 🚗 🏍️ 🚀 🏖️ 🏝️ ⛰️ 🏠 🗼 🌆 🎡 🧳 📍 🗺️ ⛵ 🚲 🛫 🚂 🏕️ 🌃 🧭 🏔️ 🚁 🛶".split(" ") },
];

type Tool = "none" | "draw";
type Sheet = "none" | "emoji" | "music";
type TextDraft = { id: string | null; text: string; color: string; box: boolean };

type Gesture = {
  id: string;
  pts: Map<number, { x: number; y: number }>;
  base: { x: number; y: number; scale: number; rot: number };
  startMid: { x: number; y: number };
  startDist: number;
  startAngle: number;
  moved: boolean;
  downAt: number;
};

const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function midOf(pts: Map<number, { x: number; y: number }>) {
  const list = [...pts.values()];
  const n = list.length || 1;
  return { x: list.reduce((a, p) => a + p.x, 0) / n, y: list.reduce((a, p) => a + p.y, 0) / n };
}
function spanOf(pts: Map<number, { x: number; y: number }>) {
  const [a, b] = [...pts.values()];
  if (!a || !b) return { dist: 0, angle: 0 };
  return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * Full-screen story editor shown after a photo is picked: add text, stickers, a song or a
 * drawing, write a caption, then share. Everything is flattened into one picture on Share.
 * With no edits at all the original photo is published untouched.
 */
export function StoryEditor({
  file,
  onClose,
  onShare,
}: {
  file: File;
  onClose: () => void;
  onShare: (file: File, music: { title: string; url: string } | null) => void;
}) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  const [items, setItems] = useState<StoryOverlay[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [caption, setCaption] = useState("");
  const [tool, setTool] = useState<Tool>("none");
  const [sheet, setSheet] = useState<Sheet>("none");
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [brushColor, setBrushColor] = useState(BRUSH_COLORS[2] ?? "#ff4d6d");
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1] ?? 8);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);

  // ------------------------------------------------------------ photo preview
  useEffect(() => {
    let url = "";
    try {
      url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
    } catch {
      url = "";
    }
    setPhotoUrl(url);
    setLoad("loading");
    return () => {
      if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [file, attempt]);

  // The page behind must not scroll while the editor is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ------------------------------------------------------------ stage sizing
  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const w = Math.max(0, Math.min(cw, (ch * 9) / 16));
      setStage({ w, h: (w * 16) / 9 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // screen pixels per export pixel
  const f = (stage.w || DESIGN_W) / W;

  const hasEdits = items.length > 0 || strokes.length > 0 || caption.trim().length > 0;
  const music: StoryMusic | null = useMemo(
    () => items.find((i) => i.kind === "music")?.music ?? null,
    [items],
  );

  // -------------------------------------------------------------- closing
  const requestClose = useCallback(() => {
    if (sharing) return;
    if (hasEdits) setConfirmDiscard(true);
    else onClose();
  }, [sharing, hasEdits, onClose]);

  const commitText = useCallback(
    (draft: TextDraft | null) => {
      if (!draft) return;
      const text = draft.text.trim();
      setTextDraft(null);
      if (!text) {
        if (draft.id) setItems((list) => list.filter((i) => i.id !== draft.id));
        return;
      }
      if (draft.id) {
        setItems((list) =>
          list.map((i) => (i.id === draft.id ? { ...i, text, color: draft.color, box: draft.box } : i)),
        );
      } else {
        setItems((list) => [
          ...list,
          { id: newId(), kind: "text", x: 0.5, y: 0.46, scale: 1, rot: 0, text, color: draft.color, box: draft.box },
        ]);
      }
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (confirmDiscard) setConfirmDiscard(false);
      else if (textDraft) commitText(textDraft);
      else if (sheet !== "none") setSheet("none");
      else if (tool === "draw") setTool("none");
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDiscard, textDraft, sheet, tool, requestClose, commitText]);

  // ---------------------------------------------------------- items + gestures
  const gestRef = useRef<Gesture | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patchItem = (id: string, patch: Partial<StoryOverlay>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const rebase = (g: Gesture) => {
    const it = itemsRef.current.find((i) => i.id === g.id);
    if (!it) return;
    g.base = { x: it.x, y: it.y, scale: it.scale, rot: it.rot };
    g.startMid = midOf(g.pts);
    const s = spanOf(g.pts);
    g.startDist = s.dist || 1;
    g.startAngle = s.angle;
  };

  const trashHit = (mid: { x: number; y: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return false;
    return mid.y > r.bottom - 96 && Math.abs(mid.x - (r.left + r.width / 2)) < 56;
  };

  const onItemDown = (e: React.PointerEvent, it: StoryOverlay) => {
    if (tool === "draw") return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    let g = gestRef.current;
    if (g && g.id === it.id) {
      g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      rebase(g);
      return;
    }
    // pick it up: bring it to the front
    setItems((list) => [...list.filter((i) => i.id !== it.id), ...list.filter((i) => i.id === it.id)]);
    g = {
      id: it.id,
      pts: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
      base: { x: it.x, y: it.y, scale: it.scale, rot: it.rot },
      startMid: { x: e.clientX, y: e.clientY },
      startDist: 1,
      startAngle: 0,
      moved: false,
      downAt: performance.now(),
    };
    gestRef.current = g;
  };

  const onItemMove = (e: React.PointerEvent) => {
    const g = gestRef.current;
    if (!g || !g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const mid = midOf(g.pts);
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const dx = mid.x - g.startMid.x;
    const dy = mid.y - g.startMid.y;
    if (!g.moved && Math.hypot(dx, dy) > 6) {
      g.moved = true;
      setDragging(true);
    }
    if (!g.moved && g.pts.size < 2) return;
    const patch: Partial<StoryOverlay> = {
      x: clamp(g.base.x + dx / r.width, -0.1, 1.1),
      y: clamp(g.base.y + dy / r.height, -0.1, 1.1),
    };
    if (g.pts.size >= 2) {
      g.moved = true;
      setDragging(true);
      const s = spanOf(g.pts);
      patch.scale = clamp(g.base.scale * (s.dist / g.startDist), 0.35, 4);
      patch.rot = g.base.rot + (s.angle - g.startAngle);
    }
    patchItem(g.id, patch);
    setOverTrash(g.pts.size === 1 && trashHit(mid));
  };

  const onItemUp = (e: React.PointerEvent, it: StoryOverlay) => {
    const g = gestRef.current;
    if (!g || !g.pts.has(e.pointerId)) return;
    const mid = midOf(g.pts);
    g.pts.delete(e.pointerId);
    if (g.pts.size > 0) {
      rebase(g);
      return;
    }
    gestRef.current = null;
    const deleted = g.moved && trashHit(mid);
    setDragging(false);
    setOverTrash(false);
    if (deleted) {
      setItems((list) => list.filter((i) => i.id !== g.id));
      return;
    }
    // a quick tap on text opens it for editing
    if (!g.moved && performance.now() - g.downAt < 350 && it.kind === "text") {
      setTextDraft({ id: it.id, text: it.text ?? "", color: it.color ?? "#ffffff", box: !!it.box });
    }
  };

  const onItemCancel = (e: React.PointerEvent) => {
    const g = gestRef.current;
    if (!g) return;
    g.pts.delete(e.pointerId);
    if (g.pts.size === 0) {
      gestRef.current = null;
      setDragging(false);
      setOverTrash(false);
    } else rebase(g);
  };

  // ----------------------------------------------------------------- drawing
  const drawRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const drawingRef = useRef(false);

  useEffect(() => {
    const c = drawRef.current;
    if (!c || stage.w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(stage.w * dpr);
    c.height = Math.round(stage.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawStrokes(ctx, strokes, c.width, c.height);
  }, [strokes, stage.w, stage.h]);

  const pointFrom = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  const onDrawDown = (e: React.PointerEvent) => {
    if (tool !== "draw") return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = pointFrom(e);
    setStrokes((list) => [...list, { color: brushColor, width: brushSize / DESIGN_W, pts: [p] }]);
  };
  const onDrawMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = pointFrom(e);
    setStrokes((list) => {
      const last = list[list.length - 1];
      if (!last) return list;
      return [...list.slice(0, -1), { ...last, pts: [...last.pts, p] }];
    });
  };
  const onDrawEnd = () => {
    drawingRef.current = false;
  };

  // -------------------------------------------------------------------- share
  const share = async () => {
    if (sharing || load === "error") return;
    const chosen = music ? { title: music.title, url: music.url } : null;
    if (!hasEdits) {
      onShare(file, null);
      return;
    }
    const photo = imgRef.current;
    if (!photo || load !== "ready") {
      toast.error("Your photo is still loading. Try again in a moment.");
      return;
    }
    setSharing(true);
    try {
      const out = await renderStoryFile({ photo, strokes, items, caption });
      onShare(out, chosen);
    } catch (err) {
      setSharing(false);
      toast.error(err instanceof Error ? err.message : "Couldn't prepare your story.");
    }
  };

  const addEmoji = (emoji: string) => {
    setItems((list) => [...list, { id: newId(), kind: "emoji", x: 0.5, y: 0.52, scale: 1, rot: 0, emoji }]);
    setSheet("none");
  };
  const addMusic = (m: StoryMusic) => {
    setItems((list) => [
      ...list.filter((i) => i.kind !== "music"),
      { id: newId(), kind: "music", x: 0.5, y: 0.3, scale: 1, rot: 0, music: m },
    ]);
    setSheet("none");
  };

  // ----------------------------------------------------------------- render bits
  const chromeHidden = dragging || tool === "draw" || textDraft !== null;
  const captionLayout = useMemo(() => (caption.trim() ? layoutCaption(caption) : null), [caption]);

  const renderOverlay = (it: StoryOverlay): ReactNode => {
    if (it.kind === "text" && it.text) {
      const l = layoutText(it.text);
      const color = it.color ?? "#ffffff";
      const style: CSSProperties = {
        font: `800 ${l.fontPx * f}px/${l.lineH * f}px ${FONT_STACK}`,
        color: it.box ? contrastColor(color) : color,
        textAlign: "center",
        whiteSpace: "pre",
        ...(it.box
          ? {
              background: color,
              borderRadius: 12 * K * f,
              padding: `${l.padY * f}px ${l.padX * f}px`,
            }
          : { textShadow: `0 ${2 * K * f}px ${10 * K * f}px rgba(0,0,0,.45)` }),
      };
      return (
        <div style={style}>
          {l.lines.map((line, i) => (
            <div key={i}>{line || " "}</div>
          ))}
        </div>
      );
    }
    if (it.kind === "emoji" && it.emoji) {
      return <div style={{ font: `${64 * K * f}px/1 ${FONT_STACK}` }}>{it.emoji}</div>;
    }
    if (it.kind === "music" && it.music) {
      const { name, artist } = splitMusicTitle(it.music.title);
      const cover = 40 * K * f;
      return (
        <div
          className="flex items-center bg-white/95 shadow-[0_6px_20px_rgba(0,0,0,.35)]"
          style={{
            width: MUSIC_W * f,
            height: MUSIC_H * f,
            borderRadius: (MUSIC_H * f) / 2,
            paddingLeft: 6 * K * f,
            gap: 10 * K * f,
          }}
        >
          {it.music.cover ? (
            <img
              src={it.music.cover}
              alt=""
              draggable={false}
              className="shrink-0 rounded-full object-cover"
              style={{ width: cover, height: cover }}
            />
          ) : (
            <div
              className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6c63ff] to-[#c04dff] text-white"
              style={{ width: cover, height: cover, fontSize: 22 * K * f }}
            >
              ♪
            </div>
          )}
          <div className="min-w-0" style={{ width: MUSIC_TEXT_W * f }}>
            <div
              className="truncate font-bold text-[#111]"
              style={{ fontSize: MUSIC_NAME_FONT * f, lineHeight: 1.25 }}
            >
              {name}
            </div>
            {artist && (
              <div
                className="truncate font-medium text-[#6b6b78]"
                style={{ fontSize: MUSIC_ARTIST_FONT * f, lineHeight: 1.25 }}
              >
                {artist}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const rail: { key: string; label: string; icon: ReactNode; onClick: () => void; active?: boolean }[] = [
    { key: "text", label: "Add text", icon: <Type className="h-5 w-5" />, onClick: () => setTextDraft({ id: null, text: "", color: "#ffffff", box: false }) },
    { key: "emoji", label: "Add sticker", icon: <Smile className="h-5 w-5" />, onClick: () => setSheet("emoji") },
    { key: "music", label: "Add music", icon: <Music2 className="h-5 w-5" />, onClick: () => setSheet("music"), active: !!music },
    { key: "draw", label: "Draw", icon: <Pencil className="h-5 w-5" />, onClick: () => setTool("draw") },
  ];

  const root = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story editor"
      data-state="open"
      className="fixed inset-0 z-[70] flex h-[100dvh] animate-in flex-col bg-black text-white duration-200 fade-in"
    >
      {/* stage */}
      <div ref={areaRef} className="relative min-h-0 flex-1 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="absolute inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),0.5rem)] flex items-center justify-center">
          <div
            ref={stageRef}
            className="relative animate-in overflow-hidden rounded-[26px] bg-zinc-950 shadow-[0_20px_60px_rgba(0,0,0,.6)] ring-1 ring-white/10 duration-300 zoom-in-95 slide-in-from-bottom-4"
            style={{ width: stage.w, height: stage.h, touchAction: "none" }}
          >
            {photoUrl && load !== "error" && (
              <>
                <img
                  src={photoUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
                />
                <img
                  ref={imgRef}
                  key={attempt}
                  src={photoUrl}
                  alt="Your photo"
                  draggable={false}
                  onLoad={() => setLoad("ready")}
                  onError={() => setLoad("error")}
                  className={cn(
                    "absolute inset-0 h-full w-full object-contain transition-opacity duration-500",
                    load === "ready" ? "opacity-100" : "opacity-0",
                  )}
                />
              </>
            )}
            {load === "loading" && photoUrl && (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/70" />
              </div>
            )}
            {load === "error" && (
              <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 px-8 text-center">
                <p className="text-sm text-white/75">We couldn't open this photo.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAttempt((n) => n + 1)}
                    className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition active:scale-95"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full bg-white/15 px-5 py-2 text-sm font-semibold transition active:scale-95"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* drawing layer */}
            <canvas
              ref={drawRef}
              aria-label="Drawing"
              className={cn("absolute inset-0 h-full w-full", tool === "draw" ? "cursor-crosshair" : "pointer-events-none")}
              style={{ touchAction: "none" }}
              onPointerDown={onDrawDown}
              onPointerMove={onDrawMove}
              onPointerUp={onDrawEnd}
              onPointerCancel={onDrawEnd}
            />

            {/* text, stickers and song */}
            {items.map((it) => (
              <div
                key={it.id}
                data-testid={`overlay-${it.kind}`}
                onPointerDown={(e) => onItemDown(e, it)}
                onPointerMove={onItemMove}
                onPointerUp={(e) => onItemUp(e, it)}
                onPointerCancel={onItemCancel}
                className={cn(
                  "absolute cursor-grab select-none active:cursor-grabbing",
                  tool === "draw" && "pointer-events-none",
                )}
                style={{
                  left: `${it.x * 100}%`,
                  top: `${it.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${it.rot}rad) scale(${it.scale})`,
                  touchAction: "none",
                  willChange: "transform",
                }}
              >
                {renderOverlay(it)}
              </div>
            ))}

            {/* caption preview (same layout as the published picture) */}
            {captionLayout && (
              <div
                className="pointer-events-none absolute left-1/2 animate-in text-center duration-200 fade-in"
                style={{
                  top: `${CAPTION_Y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  background: "rgba(0,0,0,.55)",
                  borderRadius: 14 * K * f,
                  padding: `${captionLayout.padY * f}px ${captionLayout.padX * f}px`,
                  font: `600 ${captionLayout.fontPx * f}px/${captionLayout.lineH * f}px ${FONT_STACK}`,
                  whiteSpace: "pre",
                }}
              >
                {captionLayout.lines.map((line, i) => (
                  <div key={i}>{line || " "}</div>
                ))}
              </div>
            )}

            {/* trash, shown while an item is being moved */}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bottom-5 left-1/2 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full ring-1 ring-white/25 backdrop-blur-md transition-all duration-200",
                dragging ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                overTrash ? "scale-125 bg-red-500" : "bg-black/50",
              )}
            >
              <Trash2 className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* top-left: close / draw actions */}
        <div
          className={cn(
            "absolute left-3 top-[max(env(safe-area-inset-top),0.5rem)] z-10 flex items-center gap-2 transition-all duration-200",
            dragging || textDraft ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          {tool === "draw" ? (
            <button
              type="button"
              onClick={() => setStrokes((l) => l.slice(0, -1))}
              disabled={strokes.length === 0}
              aria-label="Undo last stroke"
              className="grid h-11 w-11 place-items-center rounded-full bg-black/40 ring-1 ring-white/15 backdrop-blur-md transition active:scale-90 disabled:opacity-40"
            >
              <Undo2 className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close editor"
              className="grid h-11 w-11 place-items-center rounded-full bg-black/40 ring-1 ring-white/15 backdrop-blur-md transition active:scale-90 hover:bg-black/55"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* right rail */}
        {tool === "none" && (
          <div
            className={cn(
              "absolute right-3 top-[max(env(safe-area-inset-top),0.5rem)] z-10 flex flex-col gap-2.5 transition-all duration-200",
              chromeHidden ? "pointer-events-none translate-x-2 opacity-0" : "opacity-100",
            )}
          >
            {rail.map((b, i) => (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                aria-label={b.label}
                title={b.label}
                style={{ animationDelay: `${120 + i * 55}ms` }}
                className={cn(
                  "grid h-11 w-11 animate-in place-items-center rounded-full ring-1 backdrop-blur-md transition fill-mode-backwards duration-300 fade-in slide-in-from-right-3 active:scale-90",
                  b.active ? "bg-white text-black ring-white" : "bg-black/40 text-white ring-white/15 hover:bg-black/55",
                )}
              >
                {b.icon}
              </button>
            ))}
          </div>
        )}

        {/* drawing toolbar */}
        {tool === "draw" && (
          <>
            <button
              type="button"
              onClick={() => setTool("none")}
              className="absolute right-3 top-[max(env(safe-area-inset-top),0.5rem)] z-10 flex h-11 animate-in items-center gap-1.5 rounded-full bg-white px-5 text-sm font-bold text-black duration-200 fade-in active:scale-95"
            >
              <Check className="h-4 w-4" /> Done
            </button>
            <div className="absolute inset-x-0 bottom-3 z-10 flex animate-in flex-col items-center gap-3 duration-300 fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 rounded-full bg-black/45 px-3 py-2 ring-1 ring-white/15 backdrop-blur-md">
                {BRUSH_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBrushSize(s)}
                    aria-label={`Brush size ${s}`}
                    aria-pressed={brushSize === s}
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full transition active:scale-90",
                      brushSize === s ? "bg-white/25" : "bg-transparent",
                    )}
                  >
                    <span className="rounded-full bg-white" style={{ width: s + 4, height: s + 4 }} />
                  </button>
                ))}
              </div>
              <div className="flex max-w-full gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {BRUSH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBrushColor(c)}
                    aria-label={`Brush colour ${c}`}
                    aria-pressed={brushColor === c}
                    className={cn(
                      "h-8 w-8 shrink-0 rounded-full ring-2 transition active:scale-90",
                      brushColor === c ? "scale-110 ring-white" : "ring-white/30",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* bottom bar: caption + share */}
      {tool === "none" && (
        <div
          className={cn(
            "flex animate-in items-center gap-2.5 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 transition-opacity duration-200 fade-in slide-in-from-bottom-4",
            dragging && "opacity-0",
          )}
        >
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Add a caption…"
            aria-label="Add a caption"
            enterKeyHint="done"
            className="h-12 min-w-0 flex-1 rounded-full bg-white/10 px-5 text-[15px] text-white outline-none ring-1 ring-white/10 transition placeholder:text-white/50 focus:bg-white/15 focus:ring-white/30"
          />
          <button
            type="button"
            onClick={() => void share()}
            disabled={sharing || load === "error"}
            aria-label="Share story"
            className="flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-[15px] font-bold text-white shadow-lg shadow-primary/30 transition active:scale-95 disabled:opacity-60"
            style={{ background: "var(--gradient-primary)" }}
          >
            {sharing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {sharing ? "Preparing…" : "Share"}
          </button>
        </div>
      )}

      {/* text editing */}
      {textDraft && (
        <div className="absolute inset-0 z-[65] flex animate-in flex-col bg-black/75 backdrop-blur-md duration-200 fade-in">
          <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <button
              type="button"
              onClick={() => setTextDraft(null)}
              className="h-11 rounded-full px-4 text-[15px] font-semibold text-white/85 transition active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setTextDraft((d) => (d ? { ...d, box: !d.box } : d))}
              aria-label="Toggle text background"
              aria-pressed={textDraft.box}
              className={cn(
                "grid h-11 w-11 place-items-center rounded-full text-lg font-extrabold ring-1 transition active:scale-90",
                textDraft.box ? "bg-white text-black ring-white" : "bg-white/10 text-white ring-white/20",
              )}
            >
              A
            </button>
            <button
              type="button"
              onClick={() => commitText(textDraft)}
              className="h-11 rounded-full bg-white px-5 text-[15px] font-bold text-black transition active:scale-95"
            >
              Done
            </button>
          </div>
          <div className="flex gap-2.5 overflow-x-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTextDraft((d) => (d ? { ...d, color: c } : d))}
                aria-label={`Text colour ${c}`}
                aria-pressed={textDraft.color === c}
                className={cn(
                  "h-8 w-8 shrink-0 rounded-full ring-2 transition active:scale-90",
                  textDraft.color === c ? "scale-110 ring-white" : "ring-white/30",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="grid min-h-0 flex-1 place-items-center px-6">
            <textarea
              autoFocus
              value={textDraft.text}
              onChange={(e) => setTextDraft((d) => (d ? { ...d, text: e.target.value.slice(0, 120) } : d))}
              placeholder="Type something"
              aria-label="Story text"
              rows={3}
              className={cn(
                "w-full max-w-sm resize-none rounded-2xl border-0 bg-transparent p-3 text-center text-[30px] font-extrabold leading-tight outline-none placeholder:text-white/35",
              )}
              style={{
                color: textDraft.box ? contrastColor(textDraft.color) : textDraft.color,
                background: textDraft.box ? textDraft.color : "transparent",
                fontFamily: FONT_STACK,
              }}
            />
          </div>
        </div>
      )}

      {/* emoji sheet */}
      {sheet === "emoji" && (
        <div className="absolute inset-0 z-[60] flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close stickers"
            onClick={() => setSheet("none")}
            className="absolute inset-0 animate-in bg-black/55 backdrop-blur-[3px] duration-200 fade-in"
          />
          <div className="relative flex h-[62%] animate-in flex-col rounded-t-[28px] bg-zinc-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-300 slide-in-from-bottom">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
            <div className="flex items-center justify-between px-5 pb-1 pt-3">
              <h2 className="text-lg font-bold tracking-tight">Stickers</h2>
              <button
                type="button"
                onClick={() => setSheet("none")}
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
              {EMOJI_GROUPS.map((g) => (
                <section key={g.label} className="pb-3">
                  <h3 className="py-2 text-xs font-semibold uppercase tracking-wider text-white/45">{g.label}</h3>
                  <div className="grid grid-cols-6 gap-1">
                    {g.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => addEmoji(e)}
                        aria-label={`Add ${e}`}
                        className="grid aspect-square place-items-center rounded-2xl text-[32px] transition active:scale-75 hover:bg-white/10"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet === "music" && <StoryMusicPicker onPick={addMusic} onClose={() => setSheet("none")} />}

      {/* discard confirmation */}
      {confirmDiscard && (
        <div className="absolute inset-0 z-[80] grid place-items-center px-8">
          <button
            type="button"
            aria-label="Keep editing"
            onClick={() => setConfirmDiscard(false)}
            className="absolute inset-0 animate-in bg-black/60 backdrop-blur-[3px] duration-200 fade-in"
          />
          <div
            role="alertdialog"
            aria-label="Discard story"
            className="relative w-full max-w-xs animate-in rounded-3xl bg-zinc-900 p-5 text-center shadow-2xl ring-1 ring-white/10 duration-200 zoom-in-95 fade-in"
          >
            <h2 className="text-lg font-bold">Discard this story?</h2>
            <p className="mt-1 text-sm text-white/60">Your edits will be lost.</p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full bg-red-500 text-[15px] font-bold transition active:scale-95"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="h-11 rounded-full bg-white/10 text-[15px] font-semibold transition active:scale-95"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(root, document.body);
}
