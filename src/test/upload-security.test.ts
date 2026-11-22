import { describe, expect, it } from "vitest";
import {
  UploadRejectedError,
  readBytes,
  safeFileName,
  sniffAudio,
  sniffDocument,
  sniffImage,
  sniffVideo,
} from "@/lib/file-sniff";
import {
  readExifOrientation,
  sanitizeGif,
  sanitizeImageBytes,
  sanitizeImageFile,
  sanitizeJpeg,
  sanitizePng,
  sanitizeWebp,
} from "@/lib/image-sanitize";
import { inspectAndCleanVideo, inspectAudio, scrubMoov } from "@/lib/media-sanitize";

const file = (b: Uint8Array, name: string, type = "") => new File([b as BlobPart], name, { type });

import {
  XYZ,
  be32,
  box,
  bytes,
  enc,
  has,
  makeGif,
  makeJpeg,
  makeMp4,
  makePng,
  makeWebp,
} from "@/test/upload-fixtures";

describe("sniffing", () => {
  it("recognises real images by content, not by name", () => {
    expect(sniffImage(makeJpeg())?.mime).toBe("image/jpeg");
    expect(sniffImage(makePng())?.mime).toBe("image/png");
    expect(sniffImage(makeGif())?.mime).toBe("image/gif");
    expect(sniffImage(makeWebp())?.mime).toBe("image/webp");
    expect(sniffImage(Uint8Array.from(enc("<svg xmlns='x'><script>1</script></svg>")))).toBeNull();
    expect(sniffImage(Uint8Array.from(enc("MZ\x90\0 not a picture")))).toBeNull();
  });

  it("tells MP4, MOV and WebM apart and refuses HEIC, MKV and audio-only m4a as video", () => {
    expect(sniffVideo(makeMp4())?.mime).toBe("video/mp4");
    expect(sniffVideo(bytes(box("ftyp", enc("qt  "), be32(0), enc("qt  "))))?.mime).toBe(
      "video/quicktime",
    );
    expect(sniffVideo(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], enc("B\x82\x84webm")))?.mime).toBe(
      "video/webm",
    );
    expect(sniffVideo(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], enc("B\x82\x88matroska")))).toBeNull();
    expect(sniffVideo(bytes(box("ftyp", enc("heic"), be32(0), enc("mif1heic"))))).toBeNull();
    expect(sniffVideo(bytes(box("ftyp", enc("M4A "), be32(0), enc("M4A mp42"))))).toBeNull();
    expect(sniffVideo(Uint8Array.from(enc("<html>hi</html>")))).toBeNull();
  });

  it("recognises voice-note containers", () => {
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], enc("B\x82\x84webm")))?.mime).toBe(
      "audio/webm",
    );
    expect(sniffAudio(Uint8Array.from(enc("OggS\0\x02")))?.mime).toBe("audio/ogg");
    expect(sniffAudio(Uint8Array.from(enc("ID3\x03")))?.mime).toBe("audio/mpeg");
    expect(sniffAudio(makeMp4())?.mime).toBe("audio/mp4");
    expect(sniffAudio(Uint8Array.from(enc("not audio at all")))).toBeNull();
  });
});

describe("JPEG sanitizer", () => {
  it("removes EXIF/GPS, XMP, comments and trailing payloads", () => {
    const out = sanitizeJpeg(makeJpeg({ trailing: "PK\x03\x04-hidden-zip" }));
    expect(has(out.bytes, "GPS:")).toBe(false);
    expect(has(out.bytes, "SECRETXMP")).toBe(false);
    expect(has(out.bytes, "secret comment")).toBe(false);
    expect(has(out.bytes, "hidden-zip")).toBe(false);
    expect(out.removed.join(" ")).toMatch(/EXIF/);
    expect(out.removed.join(" ")).toMatch(/trailing data/);
    // still a JPEG that starts with SOI and ends with EOI
    expect([...out.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...out.bytes.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it("keeps the rotation so portrait photos do not turn sideways", () => {
    const out = sanitizeJpeg(makeJpeg({ orientation: 6 }));
    const app1 = out.bytes.findIndex((v, i, a) => v === 0xff && a[i + 1] === 0xe1);
    expect(app1).toBeGreaterThan(0);
    expect(readExifOrientation(out.bytes.slice(app1 + 4))).toBe(6);
    expect(has(out.bytes, "GPS:")).toBe(false);
  });

  it("keeps the compressed picture data byte for byte", () => {
    const out = sanitizeJpeg(makeJpeg());
    expect(has(out.bytes, "\x12\xff\x00\x34\xff\xd0\x56")).toBe(true);
  });

  it("rejects truncated or malformed files", () => {
    const good = makeJpeg();
    expect(() => sanitizeJpeg(good.slice(0, good.length - 4))).toThrow(UploadRejectedError);
    expect(() => sanitizeJpeg(bytes([0xff, 0xd8, 0xff, 0xd9]))).toThrow(UploadRejectedError);
    expect(() => sanitizeJpeg(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow(UploadRejectedError);
  });
});

describe("PNG / GIF / WebP sanitizers", () => {
  it("PNG: drops EXIF, text, time and trailing data; keeps picture chunks", () => {
    const out = sanitizePng(makePng("<?php evil ?>"));
    expect(has(out.bytes, "eXIf")).toBe(false);
    expect(has(out.bytes, "tEXt")).toBe(false);
    expect(has(out.bytes, "tIME")).toBe(false);
    expect(has(out.bytes, "evil")).toBe(false);
    expect(has(out.bytes, "IDAT")).toBe(true);
    expect(has(out.bytes, "IEND")).toBe(true);
    expect(sniffImage(out.bytes)?.mime).toBe("image/png");
  });

  it("PNG: rejects a corrupted critical chunk and a missing IEND", () => {
    const png = makePng();
    const broken = png.slice();
    broken[Buffer.from(png).indexOf("IDAT") + 5]! ^= 0xff; // flip a byte inside IDAT
    expect(() => sanitizePng(broken)).toThrow(UploadRejectedError);
    expect(() => sanitizePng(png.slice(0, png.length - 12))).toThrow(UploadRejectedError);
  });

  it("GIF: drops comments, XMP and trailing data but keeps animation loop + frames", () => {
    const out = sanitizeGif(makeGif("<script>1</script>"));
    expect(has(out.bytes, "secret")).toBe(false);
    expect(has(out.bytes, "XMP DataXMP")).toBe(false);
    expect(has(out.bytes, "script")).toBe(false);
    expect(has(out.bytes, "NETSCAPE2.0")).toBe(true);
    expect(out.bytes[out.bytes.length - 1]).toBe(0x3b);
    expect(sanitizeGif(out.bytes).removed).toEqual([]); // idempotent
  });

  it("GIF: rejects a file with no trailer", () => {
    const g = makeGif();
    expect(() => sanitizeGif(g.slice(0, g.length - 1))).toThrow(UploadRejectedError);
  });

  it("WebP: drops EXIF/XMP chunks, clears the VP8X flags and fixes the RIFF size", () => {
    const out = sanitizeWebp(makeWebp("trailing-junk"));
    expect(has(out.bytes, "EXIF")).toBe(false);
    expect(has(out.bytes, "XMP ")).toBe(false);
    expect(has(out.bytes, "trailing-junk")).toBe(false);
    const vp8x = out.bytes.findIndex(
      (_, i, a) => String.fromCharCode(...a.slice(i, i + 4)) === "VP8X",
    );
    expect(out.bytes[vp8x + 8]! & 0x0c).toBe(0);
    const riffSize =
      out.bytes[4]! | (out.bytes[5]! << 8) | (out.bytes[6]! << 16) | (out.bytes[7]! << 24);
    expect(riffSize + 8).toBe(out.bytes.length);
  });

  it("sanitizeImageBytes refuses SVG/HTML with a clear message", () => {
    expect(() => sanitizeImageBytes(Uint8Array.from(enc("<svg onload=alert(1)>")))).toThrow(/SVG/);
    expect(() => sanitizeImageBytes(Uint8Array.from(enc("hello")))).toThrow(UploadRejectedError);
  });

  it("sanitizeImageFile ignores a lying name/type and enforces the size limit", async () => {
    const f = await sanitizeImageFile(file(makeJpeg(), "evil.html", "text/html"), 1024 * 1024);
    expect(f.type).toBe("image/jpeg");
    expect(f.name).toBe("image.jpg");
    await expect(sanitizeImageFile(file(makeJpeg(), "a.jpg", "image/jpeg"), 10)).rejects.toThrow(
      /larger/,
    );
    await expect(
      sanitizeImageFile(file(Uint8Array.from(enc("x")), "a.jpg", "image/jpeg"), 99999),
    ).rejects.toThrow(UploadRejectedError);
  });
});

describe("video inspection and location scrubbing", () => {
  it("removes GPS and device boxes from udta without changing the file size", async () => {
    const src = makeMp4();
    const out = await inspectAndCleanVideo(file(src, "clip.mp4", "video/mp4"));
    const cleaned = await readBytes(out.blob);
    expect(cleaned.length).toBe(src.length);
    expect(has(cleaned, "+12.9716")).toBe(false);
    expect(has(cleaned, "Samsung")).toBe(false);
    expect(has(cleaned, "keepme")).toBe(true); // unrelated metadata untouched
    expect(has(cleaned, "MEDIA-DATA-MEDIA-DATA")).toBe(true);
    expect(out.removed).toEqual(expect.arrayContaining(["GPS location", "device details"]));
    expect(out.kind).toEqual({ mime: "video/mp4", ext: "mp4", container: "isobmff" });
  });

  it("removes the QuickTime location entry but keeps the title", () => {
    const moov = makeMp4({ quickTimeKeys: true });
    const start =
      moov.findIndex((_, i, a) => String.fromCharCode(...a.slice(i, i + 4)) === "moov") - 4;
    const body = moov.slice(start);
    const removed = scrubMoov(body);
    expect(removed).toContain("GPS location");
    expect(has(body, "+12.9716")).toBe(false);
    expect(has(body, "My title")).toBe(true);
  });

  it("also removes bare-named keys such as `location` (ffmpeg / Android style)", () => {
    const moov = makeMp4({ quickTimeKeys: true, bareKey: true });
    const start =
      moov.findIndex((_, i, a) => String.fromCharCode(...a.slice(i, i + 4)) === "moov") - 4;
    const body = moov.slice(start);
    expect(scrubMoov(body)).toContain("GPS location");
    expect(has(body, "+12.9716")).toBe(false);
    expect(has(body, "My title")).toBe(true);
  });

  it("passes a clean video through untouched", async () => {
    const f = file(
      bytes(
        box("ftyp", enc("isom"), be32(0), enc("isom")),
        box("mdat", [1, 2, 3]),
        box("moov", box("mvhd", [0, 0, 0, 0])),
      ),
      "a.mov",
      "video/quicktime",
    );
    const out = await inspectAndCleanVideo(f);
    expect(out.removed).toEqual([]);
    expect(out.blob).toBe(f);
  });

  it("uses the content, not the name: a renamed web page or truncated file is refused", async () => {
    await expect(
      inspectAndCleanVideo(
        file(Uint8Array.from(enc("<html><script>x</script>")), "v.mp4", "video/mp4"),
      ),
    ).rejects.toThrow(UploadRejectedError);
    const mp4 = makeMp4();
    await expect(
      inspectAndCleanVideo(file(mp4.slice(0, mp4.length - 30), "v.mp4", "video/mp4")),
    ).rejects.toThrow(/real MP4/);
    await expect(
      inspectAndCleanVideo(file(new Uint8Array(0), "v.mp4", "video/mp4")),
    ).rejects.toThrow(/empty/);
  });

  it("accepts a WebM header and rejects non-audio voice notes", async () => {
    const webm = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], enc("B\x82\x84webm"), new Array(20).fill(0));
    expect((await inspectAndCleanVideo(file(webm, "a.webm"))).kind.ext).toBe("webm");
    expect((await inspectAudio(new Blob([webm]))).kind.mime).toBe("audio/webm");
    await expect(inspectAudio(new Blob([Uint8Array.from(enc("MZ......"))]))).rejects.toThrow(
      UploadRejectedError,
    );
  });
});

describe("chat attachments", () => {
  const pdf = Uint8Array.from(enc("%PDF-1.7\n1 0 obj"));
  const zip = bytes([0x50, 0x4b, 0x03, 0x04], new Array(30).fill(0));

  it("accepts real documents and reports the stored type", () => {
    expect(sniffDocument(pdf, "report.PDF")).toEqual({ ext: "pdf", mime: "application/pdf" });
    expect(sniffDocument(zip, "sheet.xlsx").ext).toBe("xlsx");
    expect(sniffDocument(Uint8Array.from(enc("a,b\n1,2")), "d.csv").mime).toBe("text/csv");
    expect(sniffDocument(Uint8Array.from(enc('{"a":1}')), "d.json").mime).toBe("application/json");
  });

  it("refuses executables, scripts, web pages and SVG however they are named", () => {
    for (const name of [
      "setup.exe",
      "run.sh",
      "page.html",
      "pic.svg",
      "app.apk",
      "x.js",
      "noext",
    ]) {
      expect(() => sniffDocument(pdf, name), name).toThrow(UploadRejectedError);
    }
  });

  it("refuses double extensions such as invoice.exe.pdf", () => {
    expect(() => sniffDocument(pdf, "invoice.exe.pdf")).toThrow(/isn't allowed/);
    expect(() => sniffDocument(pdf, "photo.php.pdf")).toThrow(UploadRejectedError);
  });

  it("refuses a file whose content does not match its extension", () => {
    expect(() => sniffDocument(Uint8Array.from(enc("MZ\x90\0")), "fake.pdf")).toThrow(/real \.pdf/);
    expect(() => sniffDocument(pdf, "fake.docx")).toThrow(UploadRejectedError);
    expect(() =>
      sniffDocument(Uint8Array.from(enc("<html><script>1</script>")), "notes.txt"),
    ).toThrow(UploadRejectedError);
    expect(() => sniffDocument(bytes(enc("text"), [0, 1, 2]), "bin.txt")).toThrow(
      UploadRejectedError,
    );
  });

  it("refuses Office files that carry macros", () => {
    const withMacro = bytes(zip, enc("word/vbaProject.bin"));
    expect(() => sniffDocument(withMacro, "doc.docx")).toThrow(/macros/);
  });
});

describe("safeFileName", () => {
  it("removes paths, control and direction-override characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\cv.pdf")).toBe("cv.pdf");
    expect(safeFileName("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(safeFileName("a\u0000b\u0007c.txt")).toBe("abc.txt");
    expect(safeFileName("...")).toBe("file");
    expect(safeFileName("")).toBe("file");
  });

  it("limits the length but keeps the extension", () => {
    const out = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
