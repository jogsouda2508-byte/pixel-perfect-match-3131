/**
 * Egress saver, step 1: make a photo smaller BEFORE it is uploaded.
 *
 * Phone photos are often 3-8 MB, and every person who opens a post downloads that file again.
 * The feed shows photos about 400 px wide, so almost all of those bytes are wasted. Here the
 * longest side is shrunk to COMPRESS_MAX_SIDE and the picture is saved again at COMPRESS_QUALITY,
 * which is still sharp on a phone and usually 10x smaller.
 *
 * Safe by design: this never makes an upload fail and never makes a picture worse for no gain.
 *   - GIFs, animated WebP and animated PNG are returned untouched (re-drawing would freeze them);
 *   - small files are returned untouched;
 *   - if the browser can't decode or draw it, or the result is not clearly smaller, the ORIGINAL
 *     file is returned, so the upload works exactly as it did before;
 *   - pictures with transparency stay transparent (saved as WebP), everything else becomes JPEG;
 *   - the rotation of the photo is applied to the pixels, and re-drawing also drops EXIF/GPS.
 * The result still goes through sanitizeImageFile afterwards, like any other upload.
 */

import { readBytes } from "@/lib/file-sniff";

/** Longest side, in pixels, of a stored photo. */
export const COMPRESS_MAX_SIDE = 1600;
/** JPEG / WebP quality (0-1). */
export const COMPRESS_QUALITY = 0.82;
/** Files at or below this size are already small: leave them alone. */
export const COMPRESS_SKIP_BELOW = 250 * 1024;
/** The new file must be at least this much smaller (0.95 = 5 %) or the original is kept. */
const MIN_GAIN = 0.95;

const ascii = (b: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...b.subarray(at, at + len));

/** True for animated GIF / WebP / PNG, which must not be re-drawn (they would stop moving). */
export function isAnimatedImage(head: Uint8Array): boolean {
  if (head.length >= 6 && ascii(head, 0, 3) === "GIF") return true;
  // WebP: "RIFF" size "WEBP" then "VP8X" with the animation flag (bit 1) in the flags byte
  if (head.length >= 21 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    return ascii(head, 12, 4) === "VP8X" && ((head[20] as number) & 0x02) !== 0;
  }
  // PNG: an "acTL" chunk before the first "IDAT" chunk means APNG
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === "PNG") {
    let at = 8;
    while (at + 8 <= head.length) {
      const len =
        ((head[at] as number) << 24) |
        ((head[at + 1] as number) << 16) |
        ((head[at + 2] as number) << 8) |
        (head[at + 3] as number);
      const type = ascii(head, at + 4, 4);
      if (type === "acTL") return true;
      if (type === "IDAT") return false;
      if (len < 0) return false;
      at += 12 + len;
    }
  }
  return false;
}

/** The size to draw at: never bigger than the original, longest side at most `maxSide`. */
export function targetSize(
  width: number,
  height: number,
  maxSide = COMPRESS_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Does the picture have see-through pixels? Checked on a small copy, which is cheap. */
function hasTransparency(bitmap: ImageBitmap): boolean {
  const probe = document.createElement("canvas");
  probe.width = 128;
  probe.height = 128;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, 128, 128);
  const { data } = ctx.getImageData(0, 0, 128, 128);
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) < 255) return true;
  }
  return false;
}

/**
 * Returns a smaller copy of the photo, or the very same file when there is nothing to gain or
 * anything goes wrong. Never throws.
 */
export async function compressImageFile(file: File): Promise<File> {
  try {
    if (file.size <= COMPRESS_SKIP_BELOW) return file;
    const head = await readBytes(file, 0, 4096);
    if (isAnimatedImage(head)) return file;
    if (typeof createImageBitmap !== "function") return file;

    // "from-image" applies the camera's rotation to the pixels, so portrait photos stay upright
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const { width, height } = targetSize(bitmap.width, bitmap.height);
      const transparent = file.type !== "image/jpeg" && hasTransparency(bitmap);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      if (!transparent) {
        ctx.fillStyle = "#fff"; // anything see-through we missed turns white, not black
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);

      const wanted = transparent ? "image/webp" : "image/jpeg";
      const blob = await toBlob(canvas, wanted, COMPRESS_QUALITY);
      // an old browser may ignore "image/webp" and hand back a PNG: then keep the original
      if (!blob || blob.type !== wanted) return file;
      if (blob.size >= file.size * MIN_GAIN) return file;

      const ext = wanted === "image/webp" ? "webp" : "jpg";
      return new File([blob], `image.${ext}`, { type: wanted });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
