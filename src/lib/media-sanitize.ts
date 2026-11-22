/**
 * Upload security, part 3: videos and voice notes.
 *
 *  - Checks the container really is MP4 / MOV / WebM (or an audio container for voice notes). A
 *    renamed .exe, an HTML page, a HEIC photo or an MKV does not pass.
 *  - Decides the stored extension and Content-Type from the content, never from the file name.
 *  - Removes GPS location and device make/model from MP4 / MOV files (phones write these into the
 *    `moov` box). Each such box is overwritten with zeros and renamed to `free`, which every player
 *    ignores. The box keeps its size, so no offsets inside the file move and playback is unaffected.
 *
 * Only the small `moov` box is read into memory; the (up to 50 MB) media data is never copied.
 */
import {
  ascii,
  readBytes,
  sniffAudio,
  sniffVideo,
  u32be,
  UploadRejectedError,
  type AudioKind,
  type VideoKind,
} from "@/lib/file-sniff";

const BAD_VIDEO = "That doesn't look like a real MP4, MOV or WebM video.";

type Box = { type: string; start: number; headerSize: number; end: number };

/** Reads one ISO-BMFF box header from `b` at `at` (offsets inside `limit`), or null if it isn't valid. */
function readBox(b: Uint8Array, at: number, limit: number): Box | null {
  if (at + 8 > limit) return null;
  let size = u32be(b, at);
  let header = 8;
  if (size === 1) {
    if (at + 16 > limit) return null;
    const hi = u32be(b, at + 8);
    const lo = u32be(b, at + 12);
    if (hi > 0x1fffff) return null; // absurdly large
    size = hi * 2 ** 32 + lo;
    header = 16;
  } else if (size === 0) {
    size = limit - at; // box runs to the end of its container
  }
  if (size < header || at + size > limit) return null;
  return { type: ascii(b, at + 4, 4), start: at, headerSize: header, end: at + size };
}

/** Turns a box into a harmless `free` box of the same size: payload zeroed, header size kept. */
function blank(b: Uint8Array, box: Box): void {
  b.fill(0, box.start + box.headerSize, box.end);
  b[box.start + 4] = 0x66; // f
  b[box.start + 5] = 0x72; // r
  b[box.start + 6] = 0x65; // e
  b[box.start + 7] = 0x65; // e
}

// "(c)xyz" = GPS location, "(c)mak"/"(c)mod" = device make/model, "(c)swr" = software, loci = 3GPP location
const UDTA_REMOVE = new Set([
  "\u00a9xyz",
  "\u00a9mak",
  "\u00a9mod",
  "\u00a9swr",
  "loci",
  "XMP_",
  "\u00a9ART",
]);
const CONTAINERS = new Set(["moov", "udta", "trak", "mdia", "minf", "stbl", "edts"]);
/**
 * "keys" names that identify where or with what a video was shot. Apple writes
 * com.apple.quicktime.location.ISO6709, Android com.android.manufacturer / .model, and other tools
 * (ffmpeg, editors) use bare names such as "location" or "make", so the prefix is optional.
 */
const QT_KEY =
  /^(com\.apple\.quicktime\.|com\.android\.)?(location|make|model|software|author|creationdate|manufacturer|version)/i;

/**
 * Walks `moov` and blanks location/device boxes in place. Returns what it removed.
 * `b` is the moov box's bytes (modified in place).
 */
export function scrubMoov(b: Uint8Array): string[] {
  const removed = new Set<string>();

  const children = (from: number, to: number): Box[] => {
    const list: Box[] = [];
    let at = from;
    while (at < to) {
      const box = readBox(b, at, to);
      if (!box) break;
      list.push(box);
      at = box.end;
    }
    return list;
  };

  const walk = (box: Box, depth: number): void => {
    if (depth > 8) return;
    const inner = box.start + box.headerSize;
    if (box.type === "meta") return void scrubMeta(box);
    if (!CONTAINERS.has(box.type)) return;
    for (const child of children(inner, box.end)) {
      if (box.type === "udta" && UDTA_REMOVE.has(child.type)) {
        blank(b, child);
        removed.add(
          child.type === "\u00a9xyz" || child.type === "loci" ? "GPS location" : "device details",
        );
      } else {
        walk(child, depth + 1);
      }
    }
  };

  /** `meta` holds either ISO-style entries or QuickTime "keys" + "ilst" pairs. */
  const scrubMeta = (meta: Box): void => {
    const inner = meta.start + meta.headerSize;
    // ISO "meta" is a full box (4 extra version/flags bytes); the QuickTime one is not.
    const qtStyle = ascii(b, inner + 4, 4) === "hdlr";
    const kids = children(qtStyle ? inner : inner + 4, meta.end);
    const keys = kids.find((k) => k.type === "keys");
    const ilst = kids.find((k) => k.type === "ilst");
    if (!keys || !ilst) return;

    // keys: version/flags(4) + entry_count(4) + entries of [size(4) "mdta"(4) name]
    const doomed = new Set<number>();
    let at = keys.start + keys.headerSize + 8;
    let index = 1;
    while (at + 8 <= keys.end) {
      const size = u32be(b, at);
      if (size < 8 || at + size > keys.end) break;
      if (QT_KEY.test(ascii(b, at + 8, size - 8))) doomed.add(index);
      at += size;
      index++;
    }
    if (doomed.size === 0) return;
    for (const item of children(ilst.start + ilst.headerSize, ilst.end)) {
      // an ilst item's "type" is the big-endian index of its key
      if (doomed.has(u32be(b, item.start + 4))) {
        blank(b, item);
        removed.add("GPS location");
      }
    }
  };

  const top = readBox(b, 0, b.length);
  if (top && top.type === "moov") walk(top, 0);
  return [...removed];
}

export type CleanVideo = {
  blob: Blob;
  kind: VideoKind;
  removed: string[];
};

/**
 * Checks a picked video's content and removes location data. The returned blob is what should be
 * uploaded; use `kind.mime` / `kind.ext` for the Content-Type and the stored file name.
 */
export async function inspectAndCleanVideo(file: Blob): Promise<CleanVideo> {
  if (file.size <= 0) throw new UploadRejectedError("The selected video is empty.");
  const head = await readBytes(file, 0, Math.min(file.size, 4096));
  const kind = sniffVideo(head);
  if (!kind) throw new UploadRejectedError(BAD_VIDEO);
  if (kind.container === "webm") return { blob: file, kind, removed: [] };

  // Walk the top-level boxes by reading only their 16-byte headers.
  let at = 0;
  let moov: Box | null = null;
  let sawMedia = false;
  while (at < file.size) {
    const header = await readBytes(file, at, Math.min(file.size, at + 16));
    if (header.length < 8) throw new UploadRejectedError(BAD_VIDEO);
    let size = u32be(header, 0);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) throw new UploadRejectedError(BAD_VIDEO);
      size = u32be(header, 8) * 2 ** 32 + u32be(header, 12);
      headerSize = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < headerSize || at + size > file.size) throw new UploadRejectedError(BAD_VIDEO);
    const type = ascii(header, 4, 4);
    if (type === "moov") moov = { type, start: at, headerSize, end: at + size };
    if (type === "mdat" || type === "moof") sawMedia = true;
    at += size;
  }
  if (!moov || !sawMedia) throw new UploadRejectedError(BAD_VIDEO);

  const moovBytes = await readBytes(file, moov.start, moov.end);
  const removed = scrubMoov(moovBytes);
  if (removed.length === 0) return { blob: file, kind, removed };
  const cleaned = new Blob(
    [file.slice(0, moov.start), moovBytes as BlobPart, file.slice(moov.end)],
    { type: kind.mime },
  );
  return { blob: cleaned, kind, removed };
}

export type CleanAudio = { blob: Blob; kind: AudioKind };

/** Checks a recorded voice note's container. Voice notes carry no location data. */
export async function inspectAudio(file: Blob): Promise<CleanAudio> {
  if (file.size <= 0) throw new UploadRejectedError("The recording is empty.");
  const kind = sniffAudio(await readBytes(file, 0, Math.min(file.size, 4096)));
  if (!kind) throw new UploadRejectedError("That isn't a valid voice recording.");
  return { blob: file, kind };
}
