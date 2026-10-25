import { describe, expect, it } from "vitest";
import { percentages, type PollOption } from "@/lib/polls";

const opts = (a: number, b: number): PollOption[] => [
  { id: "a", label: "A", position: 0, votes: a },
  { id: "b", label: "B", position: 1, votes: b },
];

describe("poll percentages", () => {
  it("is 0 / 0 when nobody voted", () => {
    expect(percentages(opts(0, 0))).toEqual([0, 0]);
  });
  it("splits votes", () => {
    expect(percentages(opts(1, 3))).toEqual([25, 75]);
  });
  it("always adds up to 100", () => {
    for (const [a, b] of [[1, 2], [1, 6], [2, 5], [7, 13], [1, 1000]] as const) {
      const [x, y] = percentages(opts(a, b));
      expect((x ?? 0) + (y ?? 0)).toBe(100);
    }
  });
});
