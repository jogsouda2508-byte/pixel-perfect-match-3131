import { describe, expect, it } from "vitest";
import { timeAgo } from "@/lib/time";

const now = new Date("2026-10-11T12:00:00Z").getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("timeAgo", () => {
  it("says 'Just now' under a minute", () => {
    expect(timeAgo(ago(5_000), now)).toBe("Just now");
  });
  it("never goes negative when the server clock is slightly ahead", () => {
    expect(timeAgo(ago(-3_000), now)).toBe("Just now");
  });
  it("formats minutes, hours and days", () => {
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m ago");
    expect(timeAgo(ago(2 * 3_600_000), now)).toBe("2h ago");
    expect(timeAgo(ago(3 * 86_400_000), now)).toBe("3d ago");
  });
  it("falls back to a date after a week", () => {
    expect(timeAgo(ago(10 * 86_400_000), now)).toMatch(/2026/);
  });
});
