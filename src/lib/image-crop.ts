/**
 * Maths and drawing for the profile-photo cropper. Kept separate from the screen so it can be tested.
 *
 * The picture sits behind a square window (`view`, in screen pixels) that is shown through a round
 * mask. `zoom` 1 means "just big enough to cover the window"; `x` / `y` say how far the middle of
 * the picture has been dragged away from the middle of the window.
 */

export const CROP_OUTPUT = 512; // pixels on each side of the saved photo
export const MIN_ZOOM = 1;
/** Hard ceiling on zoom. A profile photo is a face, not a pore: past this it just looks cropped. */
export const MAX_ZOOM = 3;
/**
 * Smallest piece of the original (in its own pixels) the user may zoom in to. Below this the saved
 * 512 px photo would be a heavily stretched, blurry enlargement.
 */
export const MIN_SOURCE_PX = 160;
/** How far up a portrait photo starts: faces sit in the upper part, so centring cuts off heads. */
export const PORTRAIT_FOCUS = 0.3;
export const CROP_QUALITY = 0.9;

export type CropState = { zoom: number; x: number; y: number };
export type CropRegion = { sx: number; sy: number; size: number };

/** Scale at which the picture exactly covers the window. */
export function coverScale(imgW: number, imgH: number, view: number): number {
  return Math.max(view / imgW, view / imgH);
}

/**
 * The most this picture can be zoomed: never above MAX_ZOOM, and never so far that the saved photo
 * would be built from fewer than MIN_SOURCE_PX source pixels. Small pictures may not zoom at all.
 */
export function maxZoomFor(imgW: number, imgH: number): number {
  const shortSide = Math.min(imgW, imgH);
  if (!(shortSide > 0)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, shortSide / MIN_SOURCE_PX));
}

/**
 * Where a freshly opened picture starts: zoom 1, centred sideways. Portrait photos are nudged
 * towards the top so the face is not cut off; landscape and square ones stay centred.
 */
export function initialCrop(imgW: number, imgH: number, view: number): CropState {
  const scale = coverScale(imgW, imgH, view);
  const slackY = Math.max(0, (imgH * scale - view) / 2);
  return clampCrop(
    { zoom: 1, x: 0, y: imgH > imgW ? slackY * PORTRAIT_FOCUS : 0 },
    imgW,
    imgH,
    view,
  );
}

/** Keeps the zoom in range and the picture covering the whole window (no empty edges). */
export function clampCrop(state: CropState, imgW: number, imgH: number, view: number): CropState {
  const zoom = Math.min(
    maxZoomFor(imgW, imgH),
    Math.max(MIN_ZOOM, Number.isFinite(state.zoom) ? state.zoom : MIN_ZOOM),
  );
  const scale = coverScale(imgW, imgH, view) * zoom;
  const maxX = Math.max(0, (imgW * scale - view) / 2);
  const maxY = Math.max(0, (imgH * scale - view) / 2);
  return {
    zoom,
    x: Math.min(maxX, Math.max(-maxX, Number.isFinite(state.x) ? state.x : 0)),
    y: Math.min(maxY, Math.max(-maxY, Number.isFinite(state.y) ? state.y : 0)),
  };
}

/**
 * Changes the zoom while the spot under the fingers (`fx`, `fy`: pixels from the window's centre)
 * stays where it is, which is what pinching feels like.
 */
export function zoomAround(
  state: CropState,
  nextZoom: number,
  fx: number,
  fy: number,
  imgW: number,
  imgH: number,
  view: number,
): CropState {
  const clamped = Math.min(maxZoomFor(imgW, imgH), Math.max(MIN_ZOOM, nextZoom));
  const ratio = clamped / state.zoom;
  return clampCrop(
    { zoom: clamped, x: fx - (fx - state.x) * ratio, y: fy - (fy - state.y) * ratio },
    imgW,
    imgH,
    view,
  );
}

/** The square of the original picture (in its own pixels) that is inside the window. */
export function cropRegion(state: CropState, imgW: number, imgH: number, view: number): CropRegion {
  const s = clampCrop(state, imgW, imgH, view);
  const scale = coverScale(imgW, imgH, view) * s.zoom;
  const size = Math.min(view / scale, imgW, imgH);
  const sx = (imgW * scale - view) / 2 / scale - s.x / scale;
  const sy = (imgH * scale - view) / 2 / scale - s.y / scale;
  return {
    sx: Math.min(imgW - size, Math.max(0, sx)),
    sy: Math.min(imgH - size, Math.max(0, sy)),
    size,
  };
}

/** Distance between two touch points (for pinch). */
export function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Draws the chosen square at CROP_OUTPUT x CROP_OUTPUT and returns it as a JPEG. Re-drawing the
 * picture also drops everything hidden inside the original file (camera details, GPS location),
 * which matters because avatars are public. The corner of the picture is square: the app shows it
 * inside a circle with object-fit: cover, so nothing is lost.
 */
export async function renderCrop(
  img: CanvasImageSource,
  region: CropRegion,
  output: number = CROP_OUTPUT,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = output;
  canvas.height = output;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't crop photos. Please try another browser.");
  ctx.fillStyle = "#ffffff"; // JPEG has no see-through, so transparent PNGs get white, not black
  ctx.fillRect(0, 0, output, output);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, region.sx, region.sy, region.size, region.size, 0, 0, output, output);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the cropped photo."))),
      "image/jpeg",
      CROP_QUALITY,
    );
  });
}
