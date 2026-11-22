// Byte-level builders for tiny but structurally valid JPEG/PNG/GIF/WebP/MP4 files used by the upload-security tests.
/* ---------------------------------------------------------------- builders */
export const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
export const bytes = (...parts: (number[] | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
export const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
export const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));

export function jpegSeg(marker: number, payload: number[]) {
  return [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
}
/** Exif APP1 payload (big-endian) with Orientation + a GPS-looking marker string. */
export function exifPayload(orientation: number) {
  return [
    ...enc("Exif\0\0"),
    ...enc("MM"),
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    ...enc("GPS:12.9716N,77.5946E"),
  ];
}
export function makeJpeg(opts: { orientation?: number; trailing?: string } = {}) {
  return bytes(
    [0xff, 0xd8],
    jpegSeg(0xe0, [...enc("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    jpegSeg(0xe1, exifPayload(opts.orientation ?? 6)),
    jpegSeg(0xe1, enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta SECRETXMP/>")),
    jpegSeg(0xfe, enc("secret comment")),
    jpegSeg(0xdb, new Array(65).fill(1)),
    jpegSeg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    jpegSeg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56],
    [0xff, 0xd9],
    enc(opts.trailing ?? ""),
  );
}

export function pngChunk(type: string, data: number[]) {
  // CRC computed with the same algorithm as the sanitizer would verify
  const body = [...enc(type), ...data];
  let c = 0xffffffff;
  for (const byte of body) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return [...be32(data.length), ...body, ...be32((c ^ 0xffffffff) >>> 0)];
}
export function makePng(trailing = "") {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...be32(1), ...be32(1), 8, 2, 0, 0, 0]),
    pngChunk("eXIf", enc("GPS-SECRET")),
    pngChunk("tEXt", enc("Comment\0secret")),
    pngChunk("tIME", [7, 234, 1, 1, 0, 0, 0]),
    pngChunk("IDAT", [8, 0xd7, 0x63, 0x60, 0, 0, 0, 4, 0, 1]),
    pngChunk("IEND", []),
    enc(trailing),
  );
}

export function makeGif(trailing = "") {
  return bytes(
    enc("GIF89a"),
    [1, 0, 1, 0, 0x80, 0, 0],
    [0, 0, 0, 255, 255, 255], // 2-colour table
    [0x21, 0xff, 11, ...enc("NETSCAPE2.0"), 3, 1, 0, 0, 0],
    [0x21, 0xff, 11, ...enc("XMP DataXMP"), 4, ...enc("GPS!"), 0],
    [0x21, 0xfe, 6, ...enc("secret"), 0],
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0],
    [0x3b],
    enc(trailing),
  );
}

export function chunkLe(type: string, data: number[]) {
  const pad = data.length & 1 ? [0] : [];
  return [...enc(type), ...le32(data.length), ...data, ...pad];
}
export function makeWebp(trailing = "") {
  const body = [
    ...enc("WEBP"),
    ...chunkLe("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // alpha-less, EXIF + XMP flags set
    ...chunkLe("VP8L", [0x2f, 0, 0, 0, 0, 0, 0, 0]),
    ...chunkLe("EXIF", enc("GPS-SECRET")),
    ...chunkLe("XMP ", enc("<xmp/>")),
  ];
  return bytes(enc("RIFF"), le32(body.length), body, enc(trailing));
}

/* MP4 */
export const box = (type: string | number[], ...payload: (number[] | Uint8Array)[]) => {
  const t = typeof type === "string" ? enc(type) : type;
  const p = payload.flatMap((x) => [...x]);
  return [...be32(8 + p.length), ...t, ...p];
};
export const XYZ = [0xa9, 0x78, 0x79, 0x7a];
export const MAK = [0xa9, 0x6d, 0x61, 0x6b];
export function makeMp4(opts: { quickTimeKeys?: boolean; bareKey?: boolean } = {}) {
  const udta = box(
    "udta",
    box(XYZ, enc("+12.9716+077.5946/")),
    box(MAK, enc("Samsung")),
    box("name", enc("keepme")),
  );
  const keyName = enc(opts.bareKey ? "location" : "com.apple.quicktime.location.ISO6709");
  const keys = box(
    "keys",
    [0, 0, 0, 0],
    be32(2),
    box("mdta", enc("com.apple.quicktime.title")),
    box("mdta", keyName),
  );
  const ilst = box(
    "ilst",
    box(be32(1), box("data", [0, 0, 0, 1, 0, 0, 0, 0], enc("My title"))),
    box(be32(2), box("data", [0, 0, 0, 1, 0, 0, 0, 0], enc("+12.9716+077.5946/"))),
  );
  const meta = box("meta", box("hdlr", [0, 0, 0, 0, 0, 0, 0, 0], enc("mdta")), keys, ilst);
  const moov = box(
    "moov",
    box("mvhd", new Array(100).fill(0)),
    udta,
    ...(opts.quickTimeKeys ? [meta] : []),
  );
  return bytes(
    box("ftyp", enc("isom"), be32(512), enc("isomiso2mp41")),
    box("mdat", enc("MEDIA-DATA-MEDIA-DATA")),
    moov,
  );
}
