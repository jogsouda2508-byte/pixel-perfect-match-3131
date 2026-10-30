/**
 * Story editor: the layout + drawing code that turns "photo + text + stickers + drawing + song
 * label + caption" into ONE 1080x1920 picture (stories are saved as a single image).
 *
 * The editor screen shows the same things with HTML. Both use the numbers in this file
 * (text wrapping, sizes, positions), so what you see while editing is what gets published.
 *
 * Everything is measured in a 360 x 640 "design" space and scaled by K = 3 for the export.
 */
import { bigCover, type StoryMusic } from "@/lib/story-music";

export const W = 1080;
export const H = 1920;
export const DESIGN_W = 360;
/** design units -> export pixels */
export const K = W / DESIGN_W;

export const FONT_STACK =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

export const TEXT_COLORS = [
  "#ffffff",
  "#111111",
  "#ff4d6d",
  "#ff9f1c",
  "#ffd60a",
  "#2ec4b6",
  "#4cc9f0",
  "#8b7bff",
];

export const BRUSH_COLORS = TEXT_COLORS;
/** brush widths in design units */
export const BRUSH_SIZES = [4, 8, 14];

export type StoryOverlay = {
  id: string;
  kind: "text" | "emoji" | "music";
  /** centre of the item, as a fraction of the picture (0..1) */
  x: number;
  y: number;
  scale: number;
  /** radians */
  rot: number;
  text?: string;
  color?: string;
  /** text on a solid coloured box instead of plain text with a shadow */
  box?: boolean;
  emoji?: string;
  music?: StoryMusic;
};

export type Stroke = {
  color: string;
  /** brush width as a fraction of the picture width */
  width: number;
  /** points as fractions of the picture (0..1) */
  pts: { x: number; y: number }[];
};

// ------------------------------------------------------------------ measuring
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    measureCtx = document.createElement("canvas").getContext("2d");
  } catch {
    measureCtx = null;
  }
  return measureCtx ?? null;
}

function textWidth(ctx: CanvasRenderingContext2D | null, s: string, fontPx: number): number {
  // no canvas (very old browser / tests): a rough guess keeps the layout sensible
  return ctx ? ctx.measureText(s).width : s.length * fontPx * 0.56;
}

/** Breaks text into lines no wider than maxW (pixels at the font that is currently set). */
export function wrapLines(
  ctx: CanvasRenderingContext2D | null,
  text: string,
  fontPx: number,
  maxW: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    const push = () => {
      lines.push(line);
      line = "";
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(ctx, candidate, fontPx) <= maxW) {
        line = candidate;
        continue;
      }
      if (line) push();
      // a single very long word: split it by characters
      if (textWidth(ctx, word, fontPx) <= maxW) {
        line = word;
        continue;
      }
      let piece = "";
      for (const ch of word) {
        if (textWidth(ctx, piece + ch, fontPx) > maxW && piece) {
          lines.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    push();
  }
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Cuts a string with "…" so it fits maxW. */
export function fitText(
  ctx: CanvasRenderingContext2D | null,
  s: string,
  fontPx: number,
  maxW: number,
): string {
  if (textWidth(ctx, s, fontPx) <= maxW) return s;
  let out = s;
  while (out.length > 1 && textWidth(ctx, `${out}…`, fontPx) > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

// ----------------------------------------------------------------------- text
export const TEXT_FONT_PX = 34 * K;
const TEXT_MAX_W = 280 * K;
const TEXT_LINE = 1.22;
const TEXT_PAD_X = 14 * K;
const TEXT_PAD_Y = 8 * K;

export type TextLayout = {
  lines: string[];
  font: string;
  fontPx: number;
  lineH: number;
  /** size of the text itself */
  w: number;
  h: number;
  padX: number;
  padY: number;
};

export function layoutText(text: string): TextLayout {
  const ctx = getMeasureCtx();
  const font = `800 ${TEXT_FONT_PX}px ${FONT_STACK}`;
  if (ctx) ctx.font = font;
  const lines = wrapLines(ctx, text, TEXT_FONT_PX, TEXT_MAX_W);
  const w = Math.max(
    TEXT_FONT_PX,
    ...lines.map((l) => textWidth(ctx, l, TEXT_FONT_PX)),
  );
  const lineH = TEXT_FONT_PX * TEXT_LINE;
  return { lines, font, fontPx: TEXT_FONT_PX, lineH, w, h: lineH * lines.length, padX: TEXT_PAD_X, padY: TEXT_PAD_Y };
}

/** Black or white, whichever is easier to read on this colour. */
export function contrastColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => parseInt(v ?? "0", 16));
  const lum = (0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)) / 255;
  return lum > 0.62 ? "#111111" : "#ffffff";
}

// --------------------------------------------------------------------- caption
export const CAPTION_FONT_PX = 17 * K;
const CAPTION_MAX_W = 292 * K;
const CAPTION_LINE = 1.28;
export const CAPTION_Y = 0.86;
export const CAPTION_MAX_LINES = 3;
export const CAPTION_MAX_CHARS = 140;

export function layoutCaption(text: string): TextLayout {
  const ctx = getMeasureCtx();
  const font = `600 ${CAPTION_FONT_PX}px ${FONT_STACK}`;
  if (ctx) ctx.font = font;
  let lines = wrapLines(ctx, text.trim(), CAPTION_FONT_PX, CAPTION_MAX_W);
  if (lines.length > CAPTION_MAX_LINES) {
    lines = lines.slice(0, CAPTION_MAX_LINES);
    lines[CAPTION_MAX_LINES - 1] = fitText(
      ctx,
      `${lines[CAPTION_MAX_LINES - 1] ?? ""}…`,
      CAPTION_FONT_PX,
      CAPTION_MAX_W,
    );
  }
  const w = Math.max(CAPTION_FONT_PX, ...lines.map((l) => textWidth(ctx, l, CAPTION_FONT_PX)));
  const lineH = CAPTION_FONT_PX * CAPTION_LINE;
  return { lines, font, fontPx: CAPTION_FONT_PX, lineH, w, h: lineH * lines.length, padX: 14 * K, padY: 9 * K };
}

// ----------------------------------------------------------------- music label
export const MUSIC_W = 232 * K;
export const MUSIC_H = 52 * K;
const MUSIC_COVER = 40 * K;
const MUSIC_PAD = 6 * K;

/** "Song - Artist" -> the two lines of the label */
export function splitMusicTitle(title: string): { name: string; artist: string } {
  const i = title.indexOf(" - ");
  if (i < 0) return { name: title, artist: "" };
  return { name: title.slice(0, i), artist: title.slice(i + 3) };
}

export const MUSIC_NAME_FONT = 14 * K;
export const MUSIC_ARTIST_FONT = 11.5 * K;
export const MUSIC_TEXT_X = MUSIC_PAD + MUSIC_COVER + 10 * K;
export const MUSIC_TEXT_W = MUSIC_W - MUSIC_TEXT_X - 14 * K;

// --------------------------------------------------------------------- drawing
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number) {
  // A tiny copy of the photo, stretched back up, is a soft blur that works in every browser
  // (ctx.filter is missing on older iPhones).
  const tiny = document.createElement("canvas");
  tiny.width = 27;
  tiny.height = 48;
  const t = tiny.getContext("2d");
  if (t) {
    const s = Math.max(tiny.width / iw, tiny.height / ih);
    t.drawImage(img, (tiny.width - iw * s) / 2, (tiny.height - ih * s) / 2, iw * s, ih * s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#0b0b12";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(0, 0, W, H);
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.pts.length === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * w;
    const [first, ...rest] = s.pts;
    if (!first) continue;
    if (rest.length === 0) {
      ctx.beginPath();
      ctx.arc(first.x * w, first.y * h, (s.width * w) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(first.x * w, first.y * h);
    // quadratic curves through the midpoints make the line smooth instead of jagged
    for (let i = 0; i < rest.length - 1; i += 1) {
      const p = rest[i];
      const n = rest[i + 1];
      if (!p || !n) continue;
      ctx.quadraticCurveTo(p.x * w, p.y * h, ((p.x + n.x) / 2) * w, ((p.y + n.y) / 2) * h);
    }
    const lastPt = rest[rest.length - 1];
    if (lastPt) ctx.lineTo(lastPt.x * w, lastPt.y * h);
    ctx.stroke();
  }
}

function drawMusicLabel(ctx: CanvasRenderingContext2D, music: StoryMusic, cover: HTMLImageElement | null) {
  const x = -MUSIC_W / 2;
  const y = -MUSIC_H / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18 * K;
  ctx.shadowOffsetY = 4 * K;
  roundedRect(ctx, x, y, MUSIC_W, MUSIC_H, MUSIC_H / 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.restore();

  const cx = x + MUSIC_PAD;
  const cy = y + (MUSIC_H - MUSIC_COVER) / 2;
  ctx.save();
  roundedRect(ctx, cx, cy, MUSIC_COVER, MUSIC_COVER, MUSIC_COVER / 2);
  ctx.clip();
  if (cover && cover.naturalWidth > 0) {
    ctx.drawImage(cover, cx, cy, MUSIC_COVER, MUSIC_COVER);
  } else {
    const g = ctx.createLinearGradient(cx, cy, cx + MUSIC_COVER, cy + MUSIC_COVER);
    g.addColorStop(0, "#6c63ff");
    g.addColorStop(1, "#c04dff");
    ctx.fillStyle = g;
    ctx.fillRect(cx, cy, MUSIC_COVER, MUSIC_COVER);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${22 * K}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♪", cx + MUSIC_COVER / 2, cy + MUSIC_COVER / 2 + 1 * K);
  }
  ctx.restore();

  const { name, artist } = splitMusicTitle(music.title);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tx = x + MUSIC_TEXT_X;
  ctx.font = `700 ${MUSIC_NAME_FONT}px ${FONT_STACK}`;
  ctx.fillStyle = "#111111";
  ctx.fillText(fitText(ctx, name, MUSIC_NAME_FONT, MUSIC_TEXT_W), tx, artist ? -7.5 * K : 0);
  if (artist) {
    ctx.font = `500 ${MUSIC_ARTIST_FONT}px ${FONT_STACK}`;
    ctx.fillStyle = "#6b6b78";
    ctx.fillText(fitText(ctx, artist, MUSIC_ARTIST_FONT, MUSIC_TEXT_W), tx, 9 * K);
  }
}

function drawTextBlock(ctx: CanvasRenderingContext2D, layout: TextLayout, color: string, box: boolean) {
  ctx.font = layout.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (box) {
    roundedRect(
      ctx,
      -layout.w / 2 - layout.padX,
      -layout.h / 2 - layout.padY,
      layout.w + layout.padX * 2,
      layout.h + layout.padY * 2,
      12 * K,
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = contrastColor(color);
  } else {
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10 * K;
    ctx.shadowOffsetY = 2 * K;
  }
  layout.lines.forEach((line, i) => {
    ctx.fillText(line, 0, -layout.h / 2 + layout.lineH * (i + 0.5));
  });
}

export type RenderInput = {
  photo: HTMLImageElement;
  strokes: Stroke[];
  items: StoryOverlay[];
  caption: string;
  /** cover art by song url (missing / failed ones fall back to a plain tile) */
  covers: Map<string, HTMLImageElement | null>;
};

export function drawStory(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { photo, strokes, items, caption, covers } = input;
  const iw = photo.naturalWidth || photo.width;
  const ih = photo.naturalHeight || photo.height;
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(ctx, photo, iw, ih);

  // the photo itself, whole (never cropped), centred
  const s = Math.min(W / iw, H / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);

  drawStrokes(ctx, strokes, W, H);

  for (const it of items) {
    ctx.save();
    ctx.translate(it.x * W, it.y * H);
    ctx.rotate(it.rot);
    ctx.scale(it.scale, it.scale);
    if (it.kind === "text" && it.text?.trim()) {
      drawTextBlock(ctx, layoutText(it.text), it.color ?? "#ffffff", !!it.box);
    } else if (it.kind === "emoji" && it.emoji) {
      ctx.font = `${64 * K}px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.emoji, 0, 3 * K);
    } else if (it.kind === "music" && it.music) {
      drawMusicLabel(ctx, it.music, covers.get(it.music.url) ?? null);
    }
    ctx.restore();
  }

  if (caption.trim()) {
    const layout = layoutCaption(caption);
    ctx.save();
    ctx.translate(W / 2, CAPTION_Y * H);
    ctx.font = layout.font;
    roundedRect(
      ctx,
      -layout.w / 2 - layout.padX,
      -layout.h / 2 - layout.padY,
      layout.w + layout.padX * 2,
      layout.h + layout.padY * 2,
      14 * K,
    );
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, 0, -layout.h / 2 + layout.lineH * (i + 0.5));
    });
    ctx.restore();
  }
}

// ------------------------------------------------------------------- loading
export function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load the picture."));
    img.src = src;
  });
}

/** Draws the whole story and returns it as a JPEG file ready to upload. */
export async function renderStoryFile(input: Omit<RenderInput, "covers">): Promise<File> {
  const covers = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    input.items
      .filter((i) => i.kind === "music" && i.music)
      .map(async (i) => {
        const url = i.music?.cover ? bigCover(i.music.cover) : null;
        if (!i.music) return;
        if (!url) {
          covers.set(i.music.url, null);
          return;
        }
        // cover art that can't be read safely is skipped, so the export never fails because of it
        covers.set(i.music.url, await loadImage(url, true).catch(() => null));
      }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't edit stories.");
  drawStory(ctx, { ...input, covers });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Couldn't create the story picture.");
  return new File([blob], `story-${Date.now()}.jpg`, { type: "image/jpeg" });
}
