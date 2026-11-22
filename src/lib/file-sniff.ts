/**
 * Upload security, part 1: work out what a file REALLY is from its bytes.
 *
 * `File.type` is set by the browser from the file *name*, and the name is chosen by whoever picked
 * the file, so it proves nothing. Everything here looks at the first bytes of the content instead,
 * and the upload code uses the result (never the name or the declared type) to decide the stored
 * extension and Content-Type.
 *
 * Pure functions on `Uint8Array`, so they are unit-tested in Node without a browser.
 */

/** A file was refused. The message is written for the person who picked the file. */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/** Reads a Blob (or a slice of it) into memory. Falls back to FileReader where Blob.arrayBuffer is missing. */
export async function readBytes(blob: Blob, start = 0, end = blob.size): Promise<Uint8Array> {
  const part = start === 0 && end >= blob.size ? blob : blob.slice(start, end);
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new UploadRejectedError("Couldn't read that file."));
    reader.readAsArrayBuffer(part);
  });
}

/* ------------------------------------------------------------------ */
/* Small byte helpers                                                  */
/* ------------------------------------------------------------------ */

export function ascii(b: Uint8Array, start: number, length: number): string {
  let s = "";
  for (let i = start; i < Math.min(b.length, start + length); i++)
    s += String.fromCharCode(b[i] as number);
  return s;
}

export function startsWith(b: Uint8Array, bytes: readonly number[], at = 0): boolean {
  if (b.length < at + bytes.length) return false;
  return bytes.every((v, i) => b[at + i] === v);
}

export function u32be(b: Uint8Array, at: number): number {
  return (
    (((b[at] as number) << 24) |
      ((b[at + 1] as number) << 16) |
      ((b[at + 2] as number) << 8) |
      (b[at + 3] as number)) >>>
    0
  );
}

export function u32le(b: Uint8Array, at: number): number {
  return (
    ((b[at] as number) |
      ((b[at + 1] as number) << 8) |
      ((b[at + 2] as number) << 16) |
      ((b[at + 3] as number) << 24)) >>>
    0
  );
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export type ImageKind = {
  mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  ext: "jpg" | "png" | "gif" | "webp";
};

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ext: "png" };
  const head = ascii(b, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

/** True when the bytes are text that looks like markup/script (an SVG or HTML page pretending to be a file). */
export function looksLikeMarkup(b: Uint8Array): boolean {
  let i = 0;
  // UTF-8 byte order mark, then whitespace
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  const head = ascii(b, i, 64).toLowerCase();
  return [
    "<!doctype",
    "<html",
    "<svg",
    "<script",
    "<?xml",
    "<iframe",
    "<body",
    "<head",
    "<meta",
    "<object",
    "<embed",
  ].some((p) => head.startsWith(p));
}

/* ------------------------------------------------------------------ */
/* Video and audio containers                                          */
/* ------------------------------------------------------------------ */

export type VideoKind = {
  mime: "video/mp4" | "video/quicktime" | "video/webm";
  ext: "mp4" | "mov" | "webm";
  container: "isobmff" | "webm";
};

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

/** Brands that mean "this ISO-BMFF file is a picture (HEIC/AVIF), not a video". */
const IMAGE_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"]);
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "m4v ",
  "f4v ",
]);
const AUDIO_MP4_BRANDS = new Set(["m4a ", "m4b "]);

/** Reads the `ftyp` box. Returns the major brand and the compatible brands, or null if there is none. */
export function readFtyp(b: Uint8Array): { major: string; compatible: string[] } | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const size = u32be(b, 0);
  if (size < 16 || size > 4096) return null;
  const end = Math.min(size, b.length);
  const compatible: string[] = [];
  for (let at = 16; at + 4 <= end; at += 4) compatible.push(ascii(b, at, 4).toLowerCase());
  return { major: ascii(b, 8, 4).toLowerCase(), compatible };
}

/** Is this an EBML (WebM/Matroska) header whose DocType is "webm"? */
export function isWebm(b: Uint8Array): boolean {
  if (!startsWith(b, EBML_MAGIC)) return false;
  return ascii(b, 0, 64).includes("webm") && !ascii(b, 0, 64).includes("matroska");
}

export function sniffVideo(b: Uint8Array): VideoKind | null {
  if (isWebm(b)) return { mime: "video/webm", ext: "webm", container: "webm" };
  const ftyp = readFtyp(b);
  if (!ftyp) return null;
  const all = [ftyp.major, ...ftyp.compatible];
  if (IMAGE_BRANDS.has(ftyp.major) || AUDIO_MP4_BRANDS.has(ftyp.major)) return null;
  if (ftyp.major === "qt  ") return { mime: "video/quicktime", ext: "mov", container: "isobmff" };
  if (all.some((x) => MP4_BRANDS.has(x)))
    return { mime: "video/mp4", ext: "mp4", container: "isobmff" };
  return null;
}

export type AudioKind = {
  mime: "audio/webm" | "audio/mp4" | "audio/ogg" | "audio/mpeg";
  ext: "webm" | "m4a" | "ogg" | "mp3";
};

export function sniffAudio(b: Uint8Array): AudioKind | null {
  if (startsWith(b, EBML_MAGIC)) return isWebm(b) ? { mime: "audio/webm", ext: "webm" } : null;
  if (ascii(b, 0, 4) === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  const ftyp = readFtyp(b);
  if (ftyp) {
    if (IMAGE_BRANDS.has(ftyp.major)) return null;
    const all = [ftyp.major, ...ftyp.compatible];
    if (all.some((x) => MP4_BRANDS.has(x) || AUDIO_MP4_BRANDS.has(x) || x === "qt  "))
      return { mime: "audio/mp4", ext: "m4a" };
    return null;
  }
  if (ascii(b, 0, 3) === "ID3") return { mime: "audio/mpeg", ext: "mp3" };
  if (b.length > 2 && b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0)
    return { mime: "audio/mpeg", ext: "mp3" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Documents (chat attachments)                                        */
/* ------------------------------------------------------------------ */

export type DocumentKind = { ext: string; mime: string };

type Family = "pdf" | "ole2" | "zip" | "rar" | "rtf" | "text";

/** The ONLY attachment types chat accepts. Anything not listed here is refused, whatever it is called. */
export const DOCUMENT_TYPES: Record<string, { mime: string; family: Family }> = {
  pdf: { mime: "application/pdf", family: "pdf" },
  doc: { mime: "application/msword", family: "ole2" },
  xls: { mime: "application/vnd.ms-excel", family: "ole2" },
  ppt: { mime: "application/vnd.ms-powerpoint", family: "ole2" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    family: "zip",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    family: "zip",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    family: "zip",
  },
  zip: { mime: "application/zip", family: "zip" },
  rar: { mime: "application/vnd.rar", family: "rar" },
  rtf: { mime: "application/rtf", family: "rtf" },
  txt: { mime: "text/plain", family: "text" },
  csv: { mime: "text/csv", family: "text" },
  json: { mime: "application/json", family: "text" },
};

/** Every mime type chat attachments may have (used for the server-side allow-list too). */
export const DOCUMENT_MIME_TYPES: string[] = [
  ...new Set(Object.values(DOCUMENT_TYPES).map((t) => t.mime)),
];

/** File extensions that must never appear anywhere in an attachment's name ("invoice.exe.pdf"). */
export const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "msi",
  "dll",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "cpl",
  "lnk",
  "reg",
  "vbs",
  "vbe",
  "js",
  "jse",
  "mjs",
  "wsf",
  "wsh",
  "ps1",
  "psm1",
  "sh",
  "bash",
  "jar",
  "apk",
  "aab",
  "ipa",
  "dmg",
  "app",
  "deb",
  "rpm",
  "iso",
  "html",
  "htm",
  "xhtml",
  "svg",
  "xml",
  "php",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "py",
  "pl",
  "rb",
  "hta",
  "docm",
  "xlsm",
  "pptm",
  "dotm",
  "xlam",
  "swf",
  "svgz",
]);

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * A file name that is safe to store and to show to other people: no path parts, no control or
 * invisible direction-changing characters (used to make "gpj.exe" display as "exe.jpg"), and a sane length.
 */
export function safeFileName(name: string, fallback = "file"): string {
  let s = (name ?? "").normalize("NFC");
  s = s.split(/[\\/]/).pop() ?? "";
  // control chars, bidi embeddings/overrides/isolates, zero-width and BOM characters
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "");
  s = s
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^\.+/, "");
  if (!s) return fallback;
  if (s.length > 120) {
    const ext = fileExtension(s);
    const keep = ext ? `.${ext.slice(0, 10)}` : "";
    s = s.slice(0, 120 - keep.length) + keep;
  }
  return s;
}

function isValidUtf8Text(b: Uint8Array): boolean {
  const sample = b.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false; // NUL byte: binary
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function includesAscii(b: Uint8Array, needle: string): boolean {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i <= b.length - n; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < n; j++) if (b[i + j] !== needle.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

/**
 * Decides whether a chat attachment is allowed. The name must have an allowed extension and no
 * dangerous extension anywhere in it, AND the bytes must really be that kind of file.
 */
export function sniffDocument(bytes: Uint8Array, fileName: string): DocumentKind {
  const name = safeFileName(fileName);
  const parts = name.toLowerCase().split(".").slice(1);
  if (parts.some((p) => DANGEROUS_EXTENSIONS.has(p))) {
    throw new UploadRejectedError("That file type isn't allowed.");
  }
  const ext = fileExtension(name);
  const type = DOCUMENT_TYPES[ext];
  if (!type) {
    throw new UploadRejectedError(
      "That file type isn't supported. You can send PDF, Word, Excel, PowerPoint, text, CSV, JSON, RTF or ZIP files.",
    );
  }
  const bad = () =>
    new UploadRejectedError(`This file doesn't look like a real .${ext} file, so it wasn't sent.`);

  switch (type.family) {
    case "pdf":
      // PDF readers accept the header anywhere in the first 1 KB
      if (!ascii(bytes, 0, 1024).includes("%PDF-")) throw bad();
      break;
    case "ole2":
      if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw bad();
      break;
    case "zip":
      if (
        !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
        !startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      )
        throw bad();
      // Office files that carry macros hide them in vbaProject.bin: a plain .docx never has one.
      if (ext !== "zip" && includesAscii(bytes, "vbaProject.bin")) {
        throw new UploadRejectedError("Files that contain macros can't be sent.");
      }
      break;
    case "rar":
      if (!startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) throw bad();
      break;
    case "rtf":
      if (ascii(bytes, 0, 5) !== "{\\rtf") throw bad();
      break;
    case "text":
      if (!isValidUtf8Text(bytes) || looksLikeMarkup(bytes)) throw bad();
      break;
  }
  return { ext, mime: type.mime };
}
