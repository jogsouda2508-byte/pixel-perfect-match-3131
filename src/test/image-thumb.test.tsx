import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ThumbImage } from "@/components/thumb-image";
import {
  FEED_MAX_SIDE,
  FEED_SKIP_BELOW,
  THUMB_MAX_SIDE,
  THUMB_SHORT_SIDE,
  THUMB_SKIP_BELOW,
  feedImagePath,
  feedImageUrl,
  feedSize,
  makeFeedImage,
  makeThumbnail,
  thumbSize,
  thumbnailPath,
  thumbnailUrl,
} from "@/lib/image-thumb";

const BASE = "https://x.supabase.co/storage/v1/object/public/media";
const UID = "8eb884fc-5073-4d93-95db-d950f1fdb05d";
const PID = "11111111-2222-4333-8444-555555555555";

describe("thumbnailUrl", () => {
  it("points a post JPEG at its thumbnail", () => {
    expect(thumbnailUrl(`${BASE}/${UID}/posts/${PID}.jpg`)).toBe(
      `${BASE}/${UID}/posts/${PID}_t.jpg`,
    );
  });
  it("keeps a query string", () => {
    expect(thumbnailUrl(`${BASE}/${UID}/posts/${PID}.jpg?v=3`)).toBe(
      `${BASE}/${UID}/posts/${PID}_t.jpg?v=3`,
    );
  });
  it("has none for GIF / PNG / WebP posts, stories, listings, videos or other sites", () => {
    expect(thumbnailUrl(`${BASE}/${UID}/posts/${PID}.gif`)).toBeNull();
    expect(thumbnailUrl(`${BASE}/${UID}/posts/${PID}.png`)).toBeNull();
    expect(thumbnailUrl(`${BASE}/${UID}/posts/${PID}.webp`)).toBeNull();
    expect(thumbnailUrl(`${BASE}/${UID}/stories/${PID}.jpg`)).toBeNull();
    expect(thumbnailUrl(`${BASE}/${UID}/market/${PID}.jpg`)).toBeNull();
    expect(thumbnailUrl("https://cdn.example/p.jpg")).toBeNull();
    expect(thumbnailUrl(null)).toBeNull();
  });
});

describe("thumbnailPath / thumbSize", () => {
  it("names the thumbnail next to the photo", () => {
    expect(thumbnailPath(`${UID}/posts/${PID}.jpg`)).toBe(`${UID}/posts/${PID}_t.jpg`);
    expect(thumbnailPath(`${UID}/posts/${PID}.png`)).toBeNull();
  });
  it("covers the tile on the short side and never upscales", () => {
    expect(thumbSize(1600, 1200)).toEqual({ width: 640, height: THUMB_SHORT_SIDE });
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
  it("caps panoramas", () => {
    const s = thumbSize(1600, 300);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(THUMB_MAX_SIDE);
  });
});

describe("makeThumbnail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const jpeg = (size: number, type = "image/jpeg") => {
    const b = new Uint8Array(size);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return new File([b], "p.jpg", { type });
  };
  function browser(outBytes: number, outType = "image/jpeg") {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(outBytes)], { type: outType })),
    );
  }

  it("makes a small JPEG from a big one", async () => {
    browser(30_000);
    const t = await makeThumbnail(jpeg(300_000));
    expect(t?.size).toBe(30_000);
    expect(t?.type).toBe("image/jpeg");
  });
  it("skips photos that are already small, and non-JPEGs", async () => {
    browser(30_000);
    expect(await makeThumbnail(jpeg(THUMB_SKIP_BELOW))).toBeNull();
    expect(await makeThumbnail(jpeg(300_000, "image/png"))).toBeNull();
  });
  it("returns null (never throws) when the browser can't do it", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await makeThumbnail(jpeg(300_000))).toBeNull();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad")));
    expect(await makeThumbnail(jpeg(300_000))).toBeNull();
  });
  it("returns null when the result is not smaller", async () => {
    browser(400_000);
    expect(await makeThumbnail(jpeg(300_000))).toBeNull();
  });
});

describe("ThumbImage", () => {
  it("loads the thumbnail, and falls back to the full photo when there is none", () => {
    const full = `${BASE}/${UID}/posts/${PID}.jpg`;
    const { container } = render(<ThumbImage src={full} />);
    const img = () => container.querySelector("img") as HTMLImageElement;
    expect(img().getAttribute("src")).toBe(`${BASE}/${UID}/posts/${PID}_t.jpg`);
    expect(img().getAttribute("loading")).toBe("lazy");
    fireEvent.error(img()); // old post: no thumbnail
    expect(img().getAttribute("src")).toBe(full);
    fireEvent.error(img()); // and no endless loop if the full photo fails too
    expect(img().getAttribute("src")).toBe(full);
  });
  it("uses the photo as is when it can't have a thumbnail", () => {
    const gif = `${BASE}/${UID}/posts/${PID}.gif`;
    const { container } = render(<ThumbImage src={gif} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(gif);
  });
});

describe("feed copy helpers", () => {
  const PID2 = "99999999-2222-4333-8444-555555555555";
  it("points a post JPEG at its feed copy, keeping the query string", () => {
    expect(feedImageUrl(`${BASE}/${UID}/posts/${PID2}.jpg`)).toBe(
      `${BASE}/${UID}/posts/${PID2}_m.jpg`,
    );
    expect(feedImageUrl(`${BASE}/${UID}/posts/${PID2}.jpg?v=3`)).toBe(
      `${BASE}/${UID}/posts/${PID2}_m.jpg?v=3`,
    );
  });
  it("has none for GIF / PNG, stories, other sites or empty", () => {
    expect(feedImageUrl(`${BASE}/${UID}/posts/${PID2}.gif`)).toBeNull();
    expect(feedImageUrl(`${BASE}/${UID}/posts/${PID2}.png`)).toBeNull();
    expect(feedImageUrl(`${BASE}/${UID}/stories/${PID2}.jpg`)).toBeNull();
    expect(feedImageUrl("https://cdn.example/p.jpg")).toBeNull();
    expect(feedImageUrl(undefined)).toBeNull();
  });
  it("names the feed copy next to the photo", () => {
    expect(feedImagePath(`${UID}/posts/${PID2}.jpg`)).toBe(`${UID}/posts/${PID2}_m.jpg`);
    expect(feedImagePath(`${UID}/posts/${PID2}.png`)).toBeNull();
  });
  it("feedSize caps the longest side and never upscales", () => {
    expect(feedSize(1600, 1200)).toEqual({ width: FEED_MAX_SIDE, height: 900 });
    expect(feedSize(1200, 1600)).toEqual({ width: 900, height: FEED_MAX_SIDE });
    expect(feedSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("makeFeedImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const jpeg = (size: number, type = "image/jpeg") => {
    const b = new Uint8Array(size);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return new File([b], "p.jpg", { type });
  };
  function browser(outBytes: number) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(outBytes)], { type: "image/jpeg" })),
    );
  }
  it("makes a smaller JPEG from a big one", async () => {
    browser(120_000);
    const m = await makeFeedImage(jpeg(400_000));
    expect(m?.size).toBe(120_000);
    expect(m?.type).toBe("image/jpeg");
  });
  it("skips small photos and non-JPEGs", async () => {
    browser(50_000);
    expect(await makeFeedImage(jpeg(FEED_SKIP_BELOW))).toBeNull();
    expect(await makeFeedImage(jpeg(400_000, "image/png"))).toBeNull();
  });
  it("returns null when the copy is not clearly smaller, or the browser can't do it", async () => {
    browser(380_000); // not 10 % smaller than 400 KB
    expect(await makeFeedImage(jpeg(400_000))).toBeNull();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad")));
    expect(await makeFeedImage(jpeg(400_000))).toBeNull();
  });
});

describe("ThumbImage variant=feed", () => {
  it("loads the feed copy, falls back to the full photo, passes other props through", () => {
    const full = `${BASE}/${UID}/posts/77777777-2222-4333-8444-555555555555.jpg`;
    const { container } = render(
      <ThumbImage src={full} variant="feed" aria-hidden="true" className="w-full" />,
    );
    const img = () => container.querySelector("img") as HTMLImageElement;
    expect(img().getAttribute("src")).toBe(full.replace(".jpg", "_m.jpg"));
    expect(img().getAttribute("aria-hidden")).toBe("true");
    expect(img().className).toBe("w-full");
    fireEvent.error(img()); // old post: no feed copy
    expect(img().getAttribute("src")).toBe(full);
    fireEvent.error(img()); // no loop
    expect(img().getAttribute("src")).toBe(full);
  });
});
