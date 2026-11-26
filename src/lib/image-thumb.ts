/**
 * Egress saver, step 2: a small thumbnail saved next to every new photo post.
 *
 * Profile grids show photos as tiles about 130 px wide, but they used to download the whole
 * photo (hundreds of KB) for each tile. Now a post photo <id>.jpg gets a tiny sibling
 * <id>_t.jpg (~20-40 KB) and the grids ask for that one instead.
 *
 *   - Nothing in the database changes: the thumbnail address is worked out from the photo's own
 *     address, in the same folder, so the existing upload rules already allow it.
 *   - Posts made before this existed have no thumbnail: the grid just falls back to the full
 *     photo (see ThumbImage), so every old post still shows, exactly as before.
 *   - Only plain JPEG photos get one. Animated GIFs, and pictures with transparency (which are
 *     not stored as JPEG), keep using the original so they look exactly the same.
 *   - A thumbnail problem never fails a post: it is made on a best-effort basis.
 */
import { readBytes } from "@/lib/file-sniff";

/** The SHORT side of a thumbnail, in pixels (tiles are square and cropped, so this must cover them). */
export const THUMB_SHORT_SIDE = 480;
/** The longest side is capped, so a very wide panorama doesn't become a huge "thumbnail". */
export const THUMB_MAX_SIDE = 960;
export const THUMB_QUALITY = 0.75;
/** A photo this small is already as light as a thumbnail: don't make one. */
export const THUMB_SKIP_BELOW = 80 * 1024;

const POST_JPG =
  /^(https?:\/\/[^/?#]+\/storage\/v1\/object\/public\/media\/[^/?#]+\/posts\/[^/?#.]+)\.jpg(\?[^#]*)?$/i;

/** The thumbnail's address for a post photo address, or null when this photo can't have one. */
export function thumbnailUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const m = POST_JPG.exec(imageUrl);
  return m ? `${m[1]}_t.jpg${m[2] ?? ""}` : null;
}

/** The storage path of the thumbnail for a photo's storage path (<uid>/posts/<id>.jpg). */
export function thumbnailPath(photoPath: string): string | null {
  const m = /^(.+)\.jpg$/i.exec(photoPath);
  return m ? `${m[1]}_t.jpg` : null;
}

/** The size to draw: short side THUMB_SHORT_SIDE, longest side at most THUMB_MAX_SIDE, never larger. */
export function thumbSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    THUMB_SHORT_SIDE / Math.min(width, height),
    THUMB_MAX_SIDE / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A small JPEG copy of a JPEG photo, or null when none is needed or anything goes wrong. */
export async function makeThumbnail(photo: File): Promise<Blob | null> {
  try {
    if (photo.type !== "image/jpeg" || photo.size <= THUMB_SKIP_BELOW) return null;
    if (typeof createImageBitmap !== "function") return null;
    // make sure it really is a JPEG before decoding it
    const head = await readBytes(photo, 0, 3);
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null;

    const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
    try {
      const { width, height } = thumbSize(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", THUMB_QUALITY),
      );
      if (!blob || blob.type !== "image/jpeg" || blob.size >= photo.size) return null;
      return blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
