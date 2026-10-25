import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";

describe("formatCount (Instagram style)", () => {
  it("shows nothing for zero", () => {
    expect(formatCount(0)).toBe("");
  });
  it("shows whole numbers below 10,000", () => {
    expect(formatCount(1)).toBe("1");
    expect(formatCount(223)).toBe("223");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(9999)).toBe("9,999");
  });
  it("abbreviates from 10,000 without rounding up", () => {
    expect(formatCount(10_000)).toBe("10K");
    expect(formatCount(30_300)).toBe("30.3K");
    expect(formatCount(999_999)).toBe("999.9K");
    expect(formatCount(1_000_000)).toBe("1M");
    expect(formatCount(1_250_000)).toBe("1.2M");
  });
});
