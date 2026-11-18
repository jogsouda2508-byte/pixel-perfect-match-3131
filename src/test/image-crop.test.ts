import { describe, expect, it } from "vitest";
import {
  clampCrop,
  coverScale,
  cropRegion,
  MAX_ZOOM,
  pointDistance,
  zoomAround,
} from "@/lib/image-crop";

const VIEW = 300;

describe("coverScale", () => {
  it("scales the short side up to the window", () => {
    expect(coverScale(1000, 500, VIEW)).toBeCloseTo(0.6); // height 500 -> 300
    expect(coverScale(400, 1200, VIEW)).toBeCloseTo(0.75); // width 400 -> 300
  });
});

describe("clampCrop", () => {
  it("never lets the picture leave an empty edge", () => {
    // 1000x500 at zoom 1 is 600x300: it can slide 150px sideways, not at all up/down
    const c = clampCrop({ zoom: 1, x: 999, y: 999 }, 1000, 500, VIEW);
    expect(c.x).toBeCloseTo(150);
    expect(c.y).toBeCloseTo(0);
    expect(clampCrop({ zoom: 1, x: -999, y: -999 }, 1000, 500, VIEW).x).toBeCloseTo(-150);
  });
  it("keeps zoom between 1 and the maximum, and survives bad numbers", () => {
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, 500, 500, VIEW).zoom).toBe(1);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, 500, 500, VIEW).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: NaN, x: NaN, y: NaN }, 500, 500, VIEW)).toEqual({
      zoom: 1,
      x: 0,
      y: 0,
    });
  });
  it("allows more movement as you zoom in", () => {
    const a = clampCrop({ zoom: 1, x: 999, y: 0 }, 500, 500, VIEW);
    const b = clampCrop({ zoom: 2, x: 999, y: 0 }, 500, 500, VIEW);
    expect(a.x).toBe(0);
    expect(b.x).toBeCloseTo(150);
  });
});

describe("zoomAround", () => {
  it("keeps the spot under the fingers in place", () => {
    const W = 800;
    const H = 800;
    const start = { zoom: 2, x: 40, y: -30 };
    const f = { x: 60, y: 20 };
    // which picture pixel is under the fingers before and after?
    const pixelAt = (s: { zoom: number; x: number; y: number }) => {
      const scale = coverScale(W, H, VIEW) * s.zoom;
      return { px: (f.x - s.x) / scale, py: (f.y - s.y) / scale };
    };
    const next = zoomAround(start, 3, f.x, f.y, W, H, VIEW);
    expect(next.zoom).toBe(3);
    expect(pixelAt(next).px).toBeCloseTo(pixelAt(start).px, 5);
    expect(pixelAt(next).py).toBeCloseTo(pixelAt(start).py, 5);
  });
  it("zooming all the way out re-centres a square picture", () => {
    expect(zoomAround({ zoom: 3, x: 100, y: 100 }, 1, 0, 0, 600, 600, VIEW)).toEqual({
      zoom: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("cropRegion", () => {
  it("at zoom 1, centred, takes the biggest centred square", () => {
    const r = cropRegion({ zoom: 1, x: 0, y: 0 }, 1000, 500, VIEW);
    expect(r.size).toBeCloseTo(500);
    expect(r.sx).toBeCloseTo(250);
    expect(r.sy).toBeCloseTo(0);
  });
  it("takes a smaller square when zoomed in", () => {
    const r = cropRegion({ zoom: 2, x: 0, y: 0 }, 1000, 1000, VIEW);
    expect(r.size).toBeCloseTo(500);
    expect(r.sx).toBeCloseTo(250);
  });
  it("follows the drag: moving the picture right shows the left part", () => {
    const left = cropRegion({ zoom: 2, x: 150, y: 0 }, 1000, 1000, VIEW);
    const right = cropRegion({ zoom: 2, x: -150, y: 0 }, 1000, 1000, VIEW);
    expect(left.sx).toBeCloseTo(0);
    expect(right.sx).toBeCloseTo(500);
  });
  it("always stays inside the picture, even with impossible input", () => {
    for (const st of [
      { zoom: 4, x: 9999, y: -9999 },
      { zoom: 1, x: -9999, y: 9999 },
      { zoom: 2.5, x: 0, y: 0 },
    ]) {
      const r = cropRegion(st, 1200, 800, VIEW);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.size).toBeLessThanOrEqual(1200 + 1e-6);
      expect(r.sy + r.size).toBeLessThanOrEqual(800 + 1e-6);
    }
  });
  it("copes with a tiny picture smaller than the window", () => {
    const r = cropRegion({ zoom: 1, x: 0, y: 0 }, 100, 100, VIEW);
    expect(r.size).toBeCloseTo(100);
    expect(r.sx).toBeCloseTo(0);
  });
});

describe("pointDistance", () => {
  it("measures the gap between two fingers", () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
