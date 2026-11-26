import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPRESS_MAX_SIDE,
  COMPRESS_SKIP_BELOW,
  compressImageFile,
  isAnimatedImage,
  targetSize,
} from "@/lib/image-compress";

const BIG = COMPRESS_SKIP_BELOW + 1000;

function fileOf(bytes: number[], type: string, size = BIG): File {
  const body = new Uint8Array(size);
  body.set(bytes);
  return new File([body], "photo", { type });
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function pngHead(withActl: boolean): number[] {
  const chunk = (type: string, len: number) => [
    (len >>> 24) & 255,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...new Array(len).fill(0),
    0,
    0,
    0,
    0, // crc
  ];
  return [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", 13),
    ...(withActl ? chunk("acTL", 8) : []),
    ...chunk("IDAT", 4),
  ];
}

function webpHead(animated: boolean): number[] {
  const t = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return [...t("RIFF"), 0, 0, 0, 0, ...t("WEBP"), ...t("VP8X"), 10, 0, 0, 0, animated ? 2 : 0];
}

describe("isAnimatedImage", () => {
  it("knows GIF, animated WebP and animated PNG", () => {
    expect(isAnimatedImage(Uint8Array.from(GIF))).toBe(true);
    expect(isAnimatedImage(Uint8Array.from(webpHead(true)))).toBe(true);
    expect(isAnimatedImage(Uint8Array.from(pngHead(true)))).toBe(true);
  });
  it("lets still pictures through", () => {
    expect(isAnimatedImage(Uint8Array.from(JPEG))).toBe(false);
    expect(isAnimatedImage(Uint8Array.from(webpHead(false)))).toBe(false);
    expect(isAnimatedImage(Uint8Array.from(pngHead(false)))).toBe(false);
  });
});

describe("targetSize", () => {
  it("shrinks the longest side to the limit and keeps the shape", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: COMPRESS_MAX_SIDE, height: 1200 });
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: COMPRESS_MAX_SIDE });
  });
  it("never makes a picture bigger", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("compressImageFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A browser that can decode `w` x `h` and encode to `outBytes`. Returns what was drawn. */
  function fakeBrowser(w: number, h: number, outBytes: number, opaque = true) {
    const drawn: { width: number; height: number }[] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: w, height: h, close: vi.fn() })),
    );
    const ctx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingQuality: "low",
      fillStyle: "",
      getImageData: () => ({ data: new Uint8ClampedArray(opaque ? [1, 2, 3, 255] : [1, 2, 3, 0]) }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      cb,
      type,
    ) {
      drawn.push({ width: this.width, height: this.height });
      cb(new Blob([new Uint8Array(outBytes)], { type: type ?? "image/png" }));
    });
    return drawn;
  }

  it("returns small files untouched", async () => {
    const small = fileOf(JPEG, "image/jpeg", 1000);
    expect(await compressImageFile(small)).toBe(small);
  });

  it("returns GIFs untouched, so they keep moving", async () => {
    const gif = fileOf(GIF, "image/gif");
    expect(await compressImageFile(gif)).toBe(gif);
  });

  it("returns the original when the browser can't decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const jpg = fileOf(JPEG, "image/jpeg");
    expect(await compressImageFile(jpg)).toBe(jpg);
  });

  it("returns the original when decoding throws", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad")));
    const jpg = fileOf(JPEG, "image/jpeg");
    expect(await compressImageFile(jpg)).toBe(jpg);
  });

  it("shrinks a big photo to a smaller JPEG", async () => {
    const drawn = fakeBrowser(4000, 3000, 200_000);
    const jpg = fileOf(JPEG, "image/jpeg", 5_000_000);
    const out = await compressImageFile(jpg);
    expect(out).not.toBe(jpg);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("image.jpg");
    expect(out.size).toBe(200_000);
    expect(drawn[drawn.length - 1]).toEqual({ width: COMPRESS_MAX_SIDE, height: 1200 });
  });

  it("keeps the original when the result is not clearly smaller", async () => {
    fakeBrowser(1000, 800, BIG); // same size out as in
    const jpg = fileOf(JPEG, "image/jpeg");
    expect(await compressImageFile(jpg)).toBe(jpg);
  });

  it("keeps transparent pictures transparent (WebP, not JPEG)", async () => {
    fakeBrowser(2000, 2000, 100_000, false);
    const png = fileOf(pngHead(false), "image/png", 3_000_000);
    const out = await compressImageFile(png);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("image.webp");
  });

  it("turns an opaque PNG (e.g. a screenshot) into a JPEG", async () => {
    fakeBrowser(2000, 2000, 100_000, true);
    const png = fileOf(pngHead(false), "image/png", 3_000_000);
    expect((await compressImageFile(png)).type).toBe("image/jpeg");
  });
});
