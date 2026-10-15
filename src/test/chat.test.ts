import { describe, expect, it } from "vitest";
import { isUnread } from "@/lib/chat";

describe("isUnread", () => {
  it("marks messages newer than the last-read time as unread", () => {
    expect(isUnread("2026-10-14T10:01:00.000Z", "2026-10-14T10:00:00.000Z")).toBe(true);
  });

  it("does not mark a conversation unread when it has no newer message", () => {
    expect(isUnread("2026-10-14T10:00:00.000Z", "2026-10-14T10:00:00.000Z")).toBe(false);
    expect(isUnread("2026-10-14T09:59:00.000Z", "2026-10-14T10:00:00.000Z")).toBe(false);
    expect(isUnread(null, "2026-10-14T10:00:00.000Z")).toBe(false);
  });
});
