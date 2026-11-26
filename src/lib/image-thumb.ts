/**
 * Egress saver, steps 2 and 3: lighter copies saved next to every new photo post.
 *
 *   <id>.jpg    the photo itself (up to 1600 px)
 *   <id>_t.jpg  thumbnail, ~480 px short side: profile grids
 *   <id>_m.jpg  feed copy, 1200 px longest side: feed, discover, saved and the post page
 *
 * Original description of the thumbnail (step 2):
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

type Variant = "t" | "m";

function variantUrl(imageUrl: string | null | undefined, variant: Variant): string | null {
  if (!imageUrl) return null;
  const m = POST_JPG.exec(imageUrl);
  return m ? `${m[1]}_${variant}.jpg${m[2] ?? ""}` : null;
}

function variantPath(photoPath: string, variant: Variant): string | null {
  const m = /^(.+)\.jpg$/i.exec(photoPath);
  return m ? `${m[1]}_${variant}.jpg` : null;
}

/** The thumbnail's address for a post photo address, or null when this photo can't have one. */
export function thumbnailUrl(imageUrl: string | null | undefined): string | null {
  return variantUrl(imageUrl, "t");
}

/** The feed copy's address for a post photo address, or null when this photo can't have one. */
export function feedImageUrl(imageUrl: string | null | undefined): string | null {
  return variantUrl(imageUrl, "m");
}

/** The storage path of the thumbnail for a photo's storage path (<uid>/posts/<id>.jpg). */
export function thumbnailPath(photoPath: string): string | null {
  return variantPath(photoPath, "t");
}

/** The storage path of the feed copy for a photo's storage path. */
export function feedImagePath(photoPath: string): string | null {
  return variantPath(photoPath, "m");
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

/** The feed copy: longest side at most FEED_MAX_SIDE (sharp on a phone card), never larger. */
export const FEED_MAX_SIDE = 1200;
export const FEED_QUALITY = 0.8;
/** A photo this small is light enough for the feed as it is: don't make a copy. */
export const FEED_SKIP_BELOW = 150 * 1024;
/** The feed copy must be at least 10 % smaller than the photo, or it isn't worth keeping. */
const FEED_MAX_RATIO = 0.9;

export function feedSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, FEED_MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A smaller JPEG copy of a JPEG photo, or null when none is needed or anything goes wrong. */
async function renderJpeg(
  photo: File,
  pick: (w: number, h: number) => { width: number; height: number },
  quality: number,
  skipBelow: number,
  maxRatio: number,
): Promise<Blob | null> {
  try {
    if (photo.type !== "image/jpeg" || photo.size <= skipBelow) return null;
    if (typeof createImageBitmap !== "function") return null;
    // make sure it really is a JPEG before decoding it
    const head = await readBytes(photo, 0, 3);
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null;

    const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
    try {
      const { width, height } = pick(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob || blob.type !== "image/jpeg" || blob.size >= photo.size * maxRatio) return null;
      return blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** A small JPEG thumbnail of a JPEG photo, or null when none is needed or anything goes wrong. */
export function makeThumbnail(photo: File): Promise<Blob | null> {
  return renderJpeg(photo, thumbSize, THUMB_QUALITY, THUMB_SKIP_BELOW, 1);
}

/** A feed-sized JPEG copy of a JPEG photo, or null when none is needed or anything goes wrong. */
export function makeFeedImage(photo: File): Promise<Blob | null> {
  return renderJpeg(photo, feedSize, FEED_QUALITY, FEED_SKIP_BELOW, FEED_MAX_RATIO);
}
