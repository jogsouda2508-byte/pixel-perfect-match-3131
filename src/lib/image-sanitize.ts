/**
 * Upload security, part 2: make an image safe to publish.
 *
 * Photos from phones carry EXIF: GPS coordinates, the camera model, a timestamp, sometimes a
 * thumbnail of the uncropped picture. The `media` and `avatars` buckets are PUBLIC, so anything left
 * in the file is readable by anyone. This rewrites the file at byte level:
 *
 *  - keeps only the parts needed to show the picture (pixel data, colour profile, transparency,
 *    animation) and drops metadata (EXIF, XMP, IPTC, comments, timestamps, embedded thumbnails);
 *  - drops anything after the end of the image, which is where "polyglot" files hide a second
 *    payload (an archive, a script) behind a valid picture;
 *  - refuses files whose structure is broken or truncated.
 *
 * It does NOT re-encode, so quality, transparency and GIF/WebP animation are untouched. For JPEG the
 * rotation (EXIF Orientation) is kept as a tiny 1-tag EXIF block so portrait photos don't turn sideways.
 */
import {
  ascii,
  readBytes,
  sniffImage,
  looksLikeMarkup,
  u32be,
  u32le,
  UploadRejectedError,
  type ImageKind,
} from "@/lib/file-sniff";

export type SanitizedImage = {
  bytes: Uint8Array<ArrayBuffer>;
  kind: ImageKind;
  /** Human-readable list of what was removed, e.g. ["EXIF/XMP (APP1)", "trailing data (31 bytes)"]. */
  removed: string[];
};

const corrupt = () =>
  new UploadRejectedError("That image looks damaged or isn't a real picture. Try another one.");

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* JPEG                                                                */
/* ------------------------------------------------------------------ */

/** Reads the EXIF Orientation (1-8) out of an APP1 segment payload, or 1 when absent/unreadable. */
export function readExifOrientation(seg: Uint8Array): number {
  // seg = "Exif\0\0" + TIFF header + IFDs
  if (ascii(seg, 0, 4) !== "Exif" || seg.length < 14) return 1;
  const t = 6;
  const little = ascii(seg, t, 2) === "II";
  if (!little && ascii(seg, t, 2) !== "MM") return 1;
  const u16 = (at: number) =>
    little
      ? (seg[at] as number) | ((seg[at + 1] as number) << 8)
      : ((seg[at] as number) << 8) | (seg[at + 1] as number);
  const u32 = (at: number) => (little ? u32le(seg, at) : u32be(seg, at));
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > seg.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.length) return 1;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** An APP1 segment holding nothing but the Orientation tag (34 bytes). */
function orientationOnlyExif(orientation: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xe1,
    0x00,
    0x22, // APP1, length 34
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // "Exif\0\0"
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian TIFF header, IFD0 at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00, // Orientation = n
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
}

export function sanitizeJpeg(src: Uint8Array): SanitizedImage {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) throw corrupt();
  const out: Uint8Array[] = [src.subarray(0, 2)];
  const removed = new Set<string>();
  let insertAt = 1; // where the orientation block goes: after SOI (and after JFIF if present)
  let orientation = 1;
  let sawFrame = false;
  let sawScan = false;
  let sawEnd = false;
  let i = 2;

  while (i < src.length) {
    // skip fill bytes: FF FF ... FF xx
    while (src[i] === 0xff && src[i + 1] === 0xff) i++;
    if (src[i] !== 0xff) throw corrupt();
    const marker = src[i + 1] as number;

    if (marker === 0xd9) {
      out.push(src.subarray(i, i + 2));
      i += 2;
      sawEnd = true;
      break;
    }
    // markers that stand alone (no length): TEM, RSTn
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(src.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0x00 || marker === 0xd8) throw corrupt();

    if (i + 4 > src.length) throw corrupt();
    const length = ((src[i + 2] as number) << 8) | (src[i + 3] as number);
    const end = i + 2 + length;
    if (length < 2 || end > src.length) throw corrupt();
    const seg = src.subarray(i, end);
    const payload = src.subarray(i + 4, end);

    let keep = true;
    if (marker >= 0xe0 && marker <= 0xef) {
      keep = false;
      if (marker === 0xe0 && ascii(payload, 0, 5) === "JFIF\0")
        keep = true; // JFIF header (JFXX thumbnail is dropped)
      else if (marker === 0xe2 && ascii(payload, 0, 12) === "ICC_PROFILE\0")
        keep = true; // colour profile
      else if (marker === 0xee && ascii(payload, 0, 5) === "Adobe") keep = true; // needed to decode CMYK
      if (marker === 0xe1) {
        if (ascii(payload, 0, 4) === "Exif") orientation = readExifOrientation(payload);
        removed.add(
          ascii(payload, 0, 4) === "Exif" ? "EXIF (camera, GPS, time)" : "XMP/APP1 metadata",
        );
      } else if (!keep) {
        removed.add(`metadata (APP${marker - 0xe0})`);
      }
    } else if (marker === 0xfe) {
      keep = false;
      removed.add("comment");
    }

    if (keep) {
      out.push(seg);
      if (marker === 0xe0) insertAt = out.length;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      sawFrame = true;

    i = end;

    if (marker === 0xda) {
      // entropy-coded image data: runs until the next real marker
      sawScan = true;
      let j = i;
      for (;;) {
        if (j >= src.length) throw corrupt(); // truncated: no EOI
        if (src[j] === 0xff) {
          const next = src[j + 1] as number | undefined;
          if (next === undefined) throw corrupt();
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          if (next === 0xff) {
            j++;
            continue;
          }
          break;
        }
        j++;
      }
      out.push(src.subarray(i, j));
      i = j;
    }
  }

  if (!sawEnd || !sawFrame || !sawScan) throw corrupt();
  if (i < src.length) removed.add(`trailing data (${src.length - i} bytes)`);

  if (orientation > 1) out.splice(insertAt, 0, orientationOnlyExif(orientation));
  return { bytes: concat(out), kind: { mime: "image/jpeg", ext: "jpg" }, removed: [...removed] };
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++)
    c = (crcTable[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Ancillary chunks that affect how the picture looks. Everything else (text, EXIF, time, ...) is dropped. */
const PNG_KEEP = new Set([
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "pHYs",
  "cICP",
  "acTL",
  "fcTL",
  "fdAT",
]);
const PNG_CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

export function sanitizePng(src: Uint8Array): SanitizedImage {
  const out: Uint8Array[] = [src.subarray(0, 8)];
  const removed = new Set<string>();
  let i = 8;
  let first = true;
  let sawData = false;
  let sawEnd = false;

  while (i + 12 <= src.length) {
    const len = u32be(src, i);
    const type = ascii(src, i + 4, 4);
    const end = i + 12 + len;
    if (len > 0x7fffffff || end > src.length) throw corrupt();
    if (first && (type !== "IHDR" || len !== 13)) throw corrupt();
    first = false;

    const crcOk = crc32(src, i + 4, i + 8 + len) === u32be(src, i + 8 + len);
    const critical = PNG_CRITICAL.has(type);
    if (!crcOk && critical) throw corrupt();

    if (critical || (PNG_KEEP.has(type) && crcOk)) {
      out.push(src.subarray(i, end));
      if (type === "IDAT") sawData = true;
    } else if (/^[A-Z]/.test(type) && !critical) {
      // unknown chunk the decoder is required to understand: not something we can vouch for
      throw corrupt();
    } else {
      removed.add(type === "eXIf" ? "EXIF (camera, GPS, time)" : `metadata (${type})`);
    }
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !sawData) throw corrupt();
  if (i < src.length) removed.add(`trailing data (${src.length - i} bytes)`);
  return { bytes: concat(out), kind: { mime: "image/png", ext: "png" }, removed: [...removed] };
}

/* ------------------------------------------------------------------ */
/* GIF                                                                 */
/* ------------------------------------------------------------------ */

export function sanitizeGif(src: Uint8Array): SanitizedImage {
  if (src.length < 14) throw corrupt();
  const out: Uint8Array[] = [];
  const removed = new Set<string>();
  const flags = src[10] as number;
  let i = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  if (i > src.length) throw corrupt();
  out.push(src.subarray(0, i));
  let sawImage = false;
  let sawTrailer = false;

  /** Skips a run of data sub-blocks; returns the index after the 0-length terminator. */
  const skipBlocks = (at: number): number => {
    let p = at;
    for (;;) {
      if (p >= src.length) throw corrupt();
      const n = src[p] as number;
      p += 1 + n;
      if (n === 0) return p;
      if (p > src.length) throw corrupt();
    }
  };

  while (i < src.length) {
    const intro = src[i] as number;
    if (intro === 0x3b) {
      out.push(src.subarray(i, i + 1));
      i++;
      sawTrailer = true;
      break;
    }
    if (intro === 0x21) {
      const label = src[i + 1] as number;
      const next = skipBlocks(i + 2);
      let keep = false;
      if (label === 0xf9)
        keep = true; // graphic control: frame timing/transparency
      else if (label === 0xff) {
        const app = ascii(src, i + 3, 11);
        keep = app === "NETSCAPE2.0" || app === "ANIMEXTS1.0"; // loop count
        if (!keep) removed.add("application data (XMP)");
      } else if (label === 0xfe) removed.add("comment");
      else removed.add("metadata");
      if (keep) out.push(src.subarray(i, next));
      i = next;
      continue;
    }
    if (intro === 0x2c) {
      if (i + 10 > src.length) throw corrupt();
      const f = src[i + 9] as number;
      const table = f & 0x80 ? 3 * (1 << ((f & 7) + 1)) : 0;
      const dataStart = i + 10 + table + 1; // + LZW minimum code size byte
      if (dataStart > src.length) throw corrupt();
      const next = skipBlocks(dataStart);
      out.push(src.subarray(i, next));
      sawImage = true;
      i = next;
      continue;
    }
    throw corrupt();
  }
  if (!sawTrailer || !sawImage) throw corrupt();
  if (i < src.length) removed.add(`trailing data (${src.length - i} bytes)`);
  return { bytes: concat(out), kind: { mime: "image/gif", ext: "gif" }, removed: [...removed] };
}

/* ------------------------------------------------------------------ */
/* WebP                                                                */
/* ------------------------------------------------------------------ */

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

export function sanitizeWebp(src: Uint8Array): SanitizedImage {
  if (src.length < 20) throw corrupt();
  const riffEnd = 8 + u32le(src, 4);
  if (riffEnd > src.length || riffEnd < 20) throw corrupt();
  const chunks: Uint8Array[] = [];
  const removed = new Set<string>();
  let sawImage = false;
  let i = 12;

  while (i + 8 <= riffEnd) {
    const type = ascii(src, i, 4);
    const size = u32le(src, i + 4);
    const padded = size + (size & 1);
    const end = i + 8 + padded;
    if (end > riffEnd) throw corrupt();
    if (WEBP_KEEP.has(type)) {
      const chunk = src.slice(i, end); // copy: VP8X flags are edited below
      if (type === "VP8X" && size >= 10) {
        chunk[8] = (chunk[8] as number) & ~0x0c; // clear the "has EXIF" and "has XMP" flags
      }
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") sawImage = true;
      chunks.push(chunk);
    } else {
      removed.add(type === "EXIF" ? "EXIF (camera, GPS, time)" : `metadata (${type.trim()})`);
    }
    i = end;
  }
  if (!sawImage) throw corrupt();
  if (riffEnd < src.length) removed.add(`trailing data (${src.length - riffEnd} bytes)`);

  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return {
    bytes: concat([header, body]),
    kind: { mime: "image/webp", ext: "webp" },
    removed: [...removed],
  };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/** Sniffs the bytes, then rewrites them without metadata. Throws UploadRejectedError for anything else. */
export function sanitizeImageBytes(bytes: Uint8Array): SanitizedImage {
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new UploadRejectedError(
      looksLikeMarkup(bytes)
        ? "SVG and web-page files aren't allowed. Please choose a JPG, PNG, WebP or GIF image."
        : "Please choose a JPG, PNG, WebP or GIF image.",
    );
  }
  switch (kind.mime) {
    case "image/jpeg":
      return sanitizeJpeg(bytes);
    case "image/png":
      return sanitizePng(bytes);
    case "image/gif":
      return sanitizeGif(bytes);
    case "image/webp":
      return sanitizeWebp(bytes);
  }
}

/**
 * Validates and cleans a picked image file. The returned File has the TRUE content type and a
 * name made from it; the original name and declared type are never used.
 */
export async function sanitizeImageFile(file: Blob, maxBytes: number): Promise<File> {
  if (file.size <= 0) throw new UploadRejectedError("That image is empty.");
  if (file.size > maxBytes) {
    throw new UploadRejectedError(
      `That image is larger than ${Math.round(maxBytes / 1048576)} MB.`,
    );
  }
  const cleaned = sanitizeImageBytes(await readBytes(file));
  return new File([cleaned.bytes], `image.${cleaned.kind.ext}`, { type: cleaned.kind.mime });
}
