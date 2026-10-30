import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, ImagePlay, Loader2, Music2, Pencil, Send, Smile, Trash2, Type, Undo2, X } from "lucide-react";
import { StoryGifPicker } from "@/components/story-gif-picker";
import { StoryMusicPicker } from "@/components/story-music-picker";
import { GIF_BASE_W, MAX_STORY_GIFS, gifUrl, type GifResult, type StoryGif } from "@/lib/story-gifs";
import { withMusicSeconds, type StoryMusic } from "@/lib/story-music";
import {
  BRUSH_COLORS,
  BRUSH_SIZES,
  CAPTION_MAX_CHARS,
  CAPTION_Y,
  DESIGN_W,
  DEFAULT_TEXT_FONT,
  EMOJI_PX,
  FRAME_RATIO,
  MUSIC_COVER,
  MUSIC_PAD,
  clampView,
  type PhotoView,
  FONT_STACK,
  TEXT_FONTS,
  loadTextFonts,
  textFont,
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
type Sheet = "none" | "emoji" | "music" | "gif";
type TextDraft = { id: string | null; text: string; color: string; box: boolean; font: string };

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
  /** `gifs` is only passed when the story has GIFs on it */
  onShare: (file: File, music: { title: string; url: string } | null, gifs?: StoryGif[]) => void;
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
  const textBoxRef = useRef<HTMLTextAreaElement>(null);
  // Put the cursor back in the text box (after picking a font or colour) so no extra tap is needed.
  const focusTextBox = () => window.requestAnimationFrame(() => textBoxRef.current?.focus());
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
  // the photo's own shape (width / height). The stage is always the full 9:16 canvas, and the
  // photo sits inside it whole and unchanged, so things can be placed anywhere, not only on it.
  const [photoRatio, setPhotoRatio] = useState(FRAME_RATIO);
  const ratio = FRAME_RATIO;
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const w = Math.max(0, Math.min(cw, ch * ratio));
      setStage({ w, h: w / ratio });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  // the photo's box inside the stage: as large as fits, centred, same shape
  const photoBox =
    photoRatio > FRAME_RATIO
      ? { w: stage.w, h: stage.w / photoRatio }
      : { w: stage.h * photoRatio, h: stage.h };
  // screen pixels per export pixel
  const f = (stage.w || DESIGN_W) / W;

  const [view, setView] = useState<PhotoView>({ zoom: 1, x: 0, y: 0 });
  const viewChanged = view.zoom > 1.001;
  const hasEdits = items.length > 0 || strokes.length > 0 || caption.trim().length > 0 || viewChanged;
  const music: StoryMusic | null = useMemo(
    () => items.find((i) => i.kind === "music")?.music ?? null,
    [items],
  );

  // Download the text font styles once, then redraw so text appears in the right font.
  const [, setFontsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadTextFonts().then(() => {
      if (alive) setFontsTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The editor keeps the screen height it had when it opened, so the picture never squeezes when
  // the keyboard comes up. The keyboard just covers the bottom, and the caption bar rides above it.
  const baseWidth = useRef(typeof window === "undefined" ? 0 : window.innerWidth);
  const [baseH, setBaseH] = useState(typeof window === "undefined" ? 0 : window.innerHeight);
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth !== baseWidth.current) {
        // turned the phone sideways (or back): measure again
        baseWidth.current = window.innerWidth;
        setBaseH(window.innerHeight);
      } else {
        setBaseH((h) => Math.max(h, window.innerHeight));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // some phones slide the page up when a field is focused: put it back
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
      const pinched = Math.abs(vv.scale - 1) > 0.01;
      const covered = Math.round(baseH - vv.height - vv.offsetTop);
      // small differences are just the browser's address bar, not a keyboard
      setKeyboard(!pinched && covered > 120 ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [baseH]);

  // -------------------------------------------------------------- closing
  const requestClose = useCallback(() => {
    if (sharing) return;
    // Always ask first, so a stray tap on X never throws the story away.
    setConfirmDiscard(true);
  }, [sharing]);

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
          list.map((i) => (i.id === draft.id ? { ...i, text, color: draft.color, box: draft.box, font: draft.font } : i)),
        );
      } else {
        setItems((list) => [
          ...list,
          { id: newId(), kind: "text", x: 0.5, y: 0.46, scale: 1, rot: 0, text, color: draft.color, box: draft.box, font: draft.font },
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

  // ------------------------------------------------------- photo zoom + move
  const zoomed = view.zoom > 1.001 || Math.abs(view.x) > 0.001 || Math.abs(view.y) > 0.001;
  const viewGest = useRef<{
    pts: Map<number, { x: number; y: number }>;
    base: PhotoView;
    startMid: { x: number; y: number };
    startDist: number;
  } | null>(null);

  const startViewGesture = () => {
    const g = viewGest.current;
    if (!g) return;
    g.base = view;
    g.startMid = midOf(g.pts);
    g.startDist = spanOf(g.pts).dist || 1;
  };
  // The item (text, sticker, song) closest to a point on the screen, within `pad` pixels.
  const itemNear = (pt: { x: number; y: number }, pad = 56): string | null => {
    const nodes = stageRef.current?.querySelectorAll<HTMLElement>("[data-item-id]");
    if (!nodes) return null;
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i];
      if (!n) continue;
      const r = n.getBoundingClientRect();
      if (pt.x >= r.left - pad && pt.x <= r.right + pad && pt.y >= r.top - pad && pt.y <= r.bottom + pad) {
        return n.getAttribute("data-item-id");
      }
    }
    return null;
  };

  const onBgDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = { x: e.clientX, y: e.clientY };
    // an item is already being held: a second finger anywhere joins it, so two fingers resize it
    const held = gestRef.current;
    if (held) {
      held.pts.set(e.pointerId, pt);
      rebase(held);
      return;
    }
    if (!viewGest.current) {
      viewGest.current = { pts: new Map(), base: view, startMid: pt, startDist: 1 };
    }
    viewGest.current.pts.set(e.pointerId, pt);
    startViewGesture();

    // two fingers close to an item: they resize / turn that item instead of zooming the photo
    const vg = viewGest.current;
    if (vg.pts.size === 2) {
      const id = itemNear(midOf(vg.pts));
      const it = id ? itemsRef.current.find((i) => i.id === id) : undefined;
      if (it) {
        const pts = new Map(vg.pts);
        viewGest.current = null;
        setView(viewRef.current);
        setItems((list) => [...list.filter((i) => i.id !== it.id), ...list.filter((i) => i.id === it.id)]);
        const sp = spanOf(pts);
        gestRef.current = {
          id: it.id,
          pts,
          base: { x: it.x, y: it.y, scale: it.scale, rot: it.rot },
          startMid: midOf(pts),
          startDist: sp.dist || 1,
          startAngle: sp.angle,
          moved: true,
          downAt: performance.now(),
        };
        setDragging(true);
      }
    }
  };
  const onBgMove = (e: React.PointerEvent) => {
    if (gestRef.current?.pts.has(e.pointerId)) {
      onItemMove(e);
      return;
    }
    const g = viewGest.current;
    const r = stageRef.current?.getBoundingClientRect();
    if (!g || !r || r.width === 0 || !g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const mid = midOf(g.pts);
    const pinching = g.pts.size >= 2;
    const zoom = pinching ? g.base.zoom * (spanOf(g.pts).dist / g.startDist) : g.base.zoom;
    // one finger moves a zoomed photo; two fingers zoom it (and move it with the middle point)
    if (!pinching && g.base.zoom <= 1.001) return;
    setView(
      clampView({
        zoom,
        x: g.base.x + (mid.x - g.startMid.x) / r.width,
        y: g.base.y + (mid.y - g.startMid.y) / r.height,
      }),
    );
  };
  const onBgUp = (e: React.PointerEvent) => {
    const held = gestRef.current;
    if (held?.pts.has(e.pointerId)) {
      const it = itemsRef.current.find((i) => i.id === held.id);
      if (it) onItemUp(e, it);
      return;
    }
    const g = viewGest.current;
    if (!g) return;
    g.pts.delete(e.pointerId);
    if (g.pts.size === 0) viewGest.current = null;
    else {
      // keep what the photo shows now as the new start point for the finger that is left
      g.base = viewRef.current;
      g.startMid = midOf(g.pts);
      g.startDist = spanOf(g.pts).dist || 1;
    }
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  // mouse wheel / trackpad pinch on a computer
  const onBgWheel = (e: React.WheelEvent) => {
    setView((v) => clampView({ ...v, zoom: v.zoom * Math.exp(-e.deltaY * 0.0025) }));
  };
  const onBgDoubleClick = () =>
    setView((v) => (v.zoom > 1.001 ? { zoom: 1, x: 0, y: 0 } : clampView({ zoom: 2, x: 0, y: 0 })));

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
      x: clamp(g.base.x + dx / r.width, 0, 1),
      y: clamp(g.base.y + dy / r.height, 0, 1),
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
      setTextDraft({ id: it.id, text: it.text ?? "", color: it.color ?? "#ffffff", box: !!it.box, font: it.font ?? DEFAULT_TEXT_FONT });
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
    const chosen = music
      ? {
          title: music.title,
          url: music.seconds ? withMusicSeconds(music.url, music.seconds) : music.url,
        }
      : null;
    const gifs: StoryGif[] = items
      .filter((i) => i.kind === "gif" && i.gif)
      .slice(0, MAX_STORY_GIFS)
      .map((i) => ({ id: i.gif!.id, ratio: i.gif!.ratio, x: i.x, y: i.y, scale: i.scale, rot: i.rot }));
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
      const out = await renderStoryFile({ photo, strokes, items, caption, view });
      if (gifs.length > 0) onShare(out, chosen, gifs);
      else onShare(out, chosen);
    } catch (err) {
      setSharing(false);
      toast.error(err instanceof Error ? err.message : "Couldn't prepare your story.");
    }
  };

  const addEmoji = (emoji: string) => {
    setItems((list) => [...list, { id: newId(), kind: "emoji", x: 0.5, y: 0.52, scale: 1, rot: 0, emoji }]);
    setSheet("none");
  };
  const addGif = (g: GifResult) => {
    if (items.filter((i) => i.kind === "gif").length >= MAX_STORY_GIFS) {
      toast.error(`You can add up to ${MAX_STORY_GIFS} GIFs.`);
      return;
    }
    setItems((list) => [
      ...list,
      { id: newId(), kind: "gif", x: 0.5, y: 0.5, scale: 1, rot: 0, gif: { id: g.id, ratio: g.ratio } },
    ]);
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
      const l = layoutText(it.text, it.font);
      const color = it.color ?? "#ffffff";
      const style: CSSProperties = {
        font: `${l.fontStyle} ${l.weight} ${l.fontPx * f}px/${l.lineH * f}px ${l.family}`,
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
      return <div style={{ font: `${EMOJI_PX * f}px/1 ${FONT_STACK}` }}>{it.emoji}</div>;
    }
    if (it.kind === "gif" && it.gif) {
      const w = GIF_BASE_W * stage.w;
      return (
        <img
          src={gifUrl(it.gif.id)}
          alt="GIF"
          draggable={false}
          className="pointer-events-none block select-none rounded-lg"
          style={{ width: w, height: w / (it.gif.ratio || 1) }}
        />
      );
    }
    if (it.kind === "music" && it.music) {
      const { name, artist } = splitMusicTitle(it.music.title);
      const cover = MUSIC_COVER * f;
      return (
        <div
          className="flex items-center bg-white/95 shadow-[0_6px_20px_rgba(0,0,0,.35)]"
          style={{
            width: MUSIC_W * f,
            height: MUSIC_H * f,
            borderRadius: (MUSIC_H * f) / 2,
            paddingLeft: MUSIC_PAD * f,
            gap: 8 * K * f,
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
              style={{ width: cover, height: cover, fontSize: 16 * K * f }}
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
    { key: "text", label: "Add text", icon: <Type className="h-4 w-4 sm:h-5 sm:w-5" />, onClick: () => setTextDraft({ id: null, text: "", color: "#ffffff", box: false, font: DEFAULT_TEXT_FONT }) },
    { key: "emoji", label: "Add sticker", icon: <Smile className="h-4 w-4 sm:h-5 sm:w-5" />, onClick: () => setSheet("emoji") },
    { key: "gif", label: "Add GIF", icon: <ImagePlay className="h-4 w-4 sm:h-5 sm:w-5" />, onClick: () => setSheet("gif") },
    { key: "music", label: "Add music", icon: <Music2 className="h-4 w-4 sm:h-5 sm:w-5" />, onClick: () => setSheet("music"), active: !!music },
    { key: "draw", label: "Draw", icon: <Pencil className="h-4 w-4 sm:h-5 sm:w-5" />, onClick: () => setTool("draw") },
  ];

  const root = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story editor"
      data-state="open"
      className="fixed inset-x-0 top-0 z-[70] flex animate-in flex-col overflow-hidden bg-black text-white duration-200 fade-in"
      style={{ height: baseH > 0 ? baseH : "100dvh" }}
    >
      {/* stage */}
      <div ref={areaRef} className="relative min-h-0 flex-1 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="absolute inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),0.5rem)] flex items-center justify-center">
          <div
            ref={stageRef}
            className="relative animate-in overflow-hidden bg-black duration-300 fade-in"
            style={{ width: stage.w, height: stage.h, touchAction: "none" }}
          >
            {photoUrl && load !== "error" && (
              <>
                <img
                  ref={imgRef}
                  key={attempt}
                  src={photoUrl}
                  alt="Your photo"
                  draggable={false}
                  onLoad={(e) => {
                    const im = e.currentTarget;
                    if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                      setPhotoRatio(im.naturalWidth / im.naturalHeight);
                    }
                    setLoad("ready");
                  }}
                  onError={() => setLoad("error")}
                  className={cn(
                    "pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none object-fill transition-opacity duration-500",
                    load === "ready" ? "opacity-100" : "opacity-0",
                  )}
                  style={{
                    width: photoBox.w,
                    height: photoBox.h,
                    marginLeft: -photoBox.w / 2,
                    marginTop: -photoBox.h / 2,
                    transform: `translate(${view.x * stage.w}px, ${view.y * stage.h}px) scale(${view.zoom})`,
                    transformOrigin: "center",
                  }}
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

            {/* pinch to zoom the photo, drag to move it, double-tap to zoom in / back */}
            <div
              data-testid="photo-zoom-layer"
              aria-label="Photo: pinch to zoom, drag to move"
              className={cn("absolute inset-0", tool === "draw" || textDraft ? "pointer-events-none" : "")}
              style={{ touchAction: "none" }}
              onPointerDown={onBgDown}
              onPointerMove={onBgMove}
              onPointerUp={onBgUp}
              onPointerCancel={onBgUp}
              onWheel={onBgWheel}
              onDoubleClick={onBgDoubleClick}
            />

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

            {zoomed && !dragging && tool !== "draw" && (
              <button
                type="button"
                onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
                aria-label="Reset photo zoom"
                className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur-md transition active:scale-95"
              >
                {view.zoom.toFixed(1)}× · Reset
              </button>
            )}

            {/* text, stickers and song */}
            {items.map((it) => (
              <div
                key={it.id}
                data-testid={`overlay-${it.kind}`}
                data-item-id={it.id}
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
              className="grid h-9 w-9 place-items-center rounded-full bg-black/40 ring-1 ring-white/15 backdrop-blur-md transition active:scale-90 disabled:opacity-40 sm:h-11 sm:w-11"
            >
              <Undo2 className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close editor"
              className="grid h-9 w-9 place-items-center rounded-full bg-black/40 ring-1 ring-white/15 backdrop-blur-md transition active:scale-90 hover:bg-black/55 sm:h-11 sm:w-11"
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          )}
        </div>

        {/* right rail */}
        {tool === "none" && (
          <div
            className={cn(
              "absolute right-3 top-[max(env(safe-area-inset-top),0.5rem)] z-10 flex flex-col gap-2 sm:gap-2.5 transition-all duration-200",
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
                  "grid h-9 w-9 animate-in place-items-center rounded-full ring-1 sm:h-11 sm:w-11 backdrop-blur-md transition fill-mode-backwards duration-300 fade-in slide-in-from-right-3 active:scale-90",
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
              className="absolute right-3 top-[max(env(safe-area-inset-top),0.5rem)] z-10 flex h-9 animate-in items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold sm:h-11 sm:px-5 sm:text-sm text-black duration-200 fade-in active:scale-95"
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
                      "grid h-7 w-7 place-items-center rounded-full transition active:scale-90 sm:h-8 sm:w-8",
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
                      "h-5 w-5 shrink-0 rounded-full ring-2 transition active:scale-90 sm:h-8 sm:w-8",
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
            "relative z-20 flex animate-in items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-2 transition-opacity duration-200 fade-in slide-in-from-bottom-4 sm:gap-2.5 sm:pt-3",
            keyboard > 0 ? "pb-2" : "pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:pb-[max(env(safe-area-inset-bottom),0.75rem)]",
            dragging && "opacity-0",
          )}
          style={keyboard > 0 ? { transform: `translateY(-${keyboard}px)` } : undefined}
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
            className="h-10 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-[14px] text-white outline-none sm:h-12 sm:px-5 sm:text-[15px] ring-1 ring-white/10 transition placeholder:text-white/50 focus:bg-white/15 focus:ring-white/30"
          />
          <button
            type="button"
            onClick={() => void share()}
            disabled={sharing || load === "error"}
            aria-label="Share story"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold text-white shadow-lg sm:h-12 sm:gap-2 sm:px-5 sm:text-[15px] shadow-primary/30 transition active:scale-95 disabled:opacity-60"
            style={{ background: "var(--gradient-primary)" }}
          >
            {sharing ? <Loader2 className="h-4 w-4 animate-spin sm:h-5 sm:w-5" /> : <Send className="h-4 w-4 sm:h-5 sm:w-5" />}
            {sharing ? "Preparing…" : "Share"}
          </button>
        </div>
      )}

      {/* text editing */}
      {textDraft && (
        <div
          className="absolute inset-0 z-[65] flex animate-in flex-col bg-black/75 backdrop-blur-md duration-200 fade-in"
          style={{ paddingBottom: keyboard }}
        >
          <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <button
              type="button"
              onClick={() => setTextDraft(null)}
              className="h-9 rounded-full px-3 text-[13px] font-semibold text-white/85 sm:h-11 sm:px-4 sm:text-[15px] transition active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setTextDraft((d) => (d ? { ...d, box: !d.box } : d))}
              aria-label="Toggle text background"
              aria-pressed={textDraft.box}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full text-base font-extrabold ring-1 sm:h-11 sm:w-11 sm:text-lg transition active:scale-90",
                textDraft.box ? "bg-white text-black ring-white" : "bg-white/10 text-white ring-white/20",
              )}
            >
              A
            </button>
            <button
              type="button"
              onClick={() => commitText(textDraft)}
              className="h-9 rounded-full bg-white px-4 text-[13px] font-bold text-black sm:h-11 sm:px-5 sm:text-[15px] transition active:scale-95"
            >
              Done
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-2.5 sm:py-4">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                // keep the keyboard open, then put the cursor back in the text box
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTextDraft((d) => (d ? { ...d, color: c } : d));
                  focusTextBox();
                }}
                aria-label={`Text colour ${c}`}
                aria-pressed={textDraft.color === c}
                className={cn(
                  "h-6 w-6 shrink-0 rounded-full ring-2 transition active:scale-90 sm:h-8 sm:w-8",
                  textDraft.color === c ? "scale-110 ring-white" : "ring-white/30",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="grid min-h-0 flex-1 place-items-center px-6">
            <textarea
              ref={textBoxRef}
              autoFocus
              value={textDraft.text}
              onChange={(e) => setTextDraft((d) => (d ? { ...d, text: e.target.value.slice(0, 120) } : d))}
              placeholder="Type something"
              aria-label="Story text"
              rows={3}
              className={cn(
                "w-full max-w-sm resize-none rounded-2xl border-0 bg-transparent p-3 text-center text-[22px] font-extrabold leading-tight sm:text-[30px] outline-none placeholder:text-white/35",
              )}
              style={{
                color: textDraft.box ? contrastColor(textDraft.color) : textDraft.color,
                background: textDraft.box ? textDraft.color : "transparent",
                fontFamily: `${textFont(textDraft.font).family}, ${FONT_STACK}`,
                fontWeight: textFont(textDraft.font).weight,
                fontStyle: textFont(textDraft.font).style,
              }}
            />
          </div>
          {/* font styles: a scrolling row right above the keyboard */}
          <div
            className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:gap-2 sm:pb-3 sm:pt-2 [&::-webkit-scrollbar]:hidden"
            role="radiogroup"
            aria-label="Text font style"
            data-testid="text-font-row"
          >
            {TEXT_FONTS.map((tf) => {
              const active = textDraft.font === tf.key;
              return (
                <button
                  key={tf.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${tf.label} font`}
                  // keep the keyboard open while choosing a font
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTextDraft((d) => (d ? { ...d, font: tf.key } : d));
                    focusTextBox();
                  }}
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-1.5 text-[14px] leading-tight ring-1 sm:rounded-2xl sm:px-5 sm:py-2.5 sm:text-[18px] transition active:scale-95",
                    active ? "bg-white text-black ring-white" : "bg-white/10 text-white ring-white/20 hover:bg-white/15",
                  )}
                  style={{ fontFamily: `${tf.family}, ${FONT_STACK}`, fontWeight: tf.weight, fontStyle: tf.style }}
                >
                  {tf.label}
                </button>
              );
            })}
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
          <div className="relative flex h-[52%] animate-in flex-col rounded-t-[24px] sm:h-[62%] sm:rounded-t-[28px] bg-zinc-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-300 slide-in-from-bottom">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
            <div className="flex items-center justify-between px-5 pb-1 pt-3">
              <h2 className="text-base font-bold tracking-tight sm:text-lg">Stickers</h2>
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
                  <h3 className="py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45 sm:py-2 sm:text-xs">{g.label}</h3>
                  <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-6 sm:gap-1">
                    {g.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => addEmoji(e)}
                        aria-label={`Add ${e}`}
                        className="grid aspect-square place-items-center rounded-xl text-[22px] transition active:scale-75 hover:bg-white/10 sm:rounded-2xl sm:text-[32px]"
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

      {sheet === "gif" && <StoryGifPicker onPick={addGif} onClose={() => setSheet("none")} />}

      {sheet === "music" && <StoryMusicPicker onPick={addMusic} onClose={() => setSheet("none")} />}

      {/* discard confirmation */}
      {confirmDiscard && (
        <div className="absolute inset-0 z-[80] grid place-items-center px-8">
          <button
            type="button"
            aria-label="Close discard question"
            onClick={() => setConfirmDiscard(false)}
            className="absolute inset-0 animate-in bg-black/60 backdrop-blur-[3px] duration-200 fade-in"
          />
          <div
            role="alertdialog"
            aria-label="Discard story"
            className="relative w-full max-w-xs animate-in rounded-3xl bg-zinc-900 p-5 text-center shadow-2xl ring-1 ring-white/10 duration-200 zoom-in-95 fade-in"
          >
            <h2 className="text-lg font-bold">Do you want to discard this story?</h2>
            <p className="mt-1 text-sm text-white/60">If you go back now, your edits will be lost.</p>
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
