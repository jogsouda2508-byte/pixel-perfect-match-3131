import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFY_PREFS,
  hasNotifyLocation,
  notifyExample,
  parseNotifyPrefs,
} from "@/lib/community-notify";

describe("parseNotifyPrefs", () => {
  it("reads both choices", () => {
    expect(parseNotifyPrefs({ alerts: false, events: true })).toEqual({
      alerts: false,
      events: true,
    });
    expect(parseNotifyPrefs({ alerts: true, events: false })).toEqual({
      alerts: true,
      events: false,
    });
  });
  it("treats anything unclear as on", () => {
    expect(parseNotifyPrefs(null)).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(parseNotifyPrefs("nope")).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(parseNotifyPrefs({})).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(parseNotifyPrefs({ alerts: "no", events: 0 })).toEqual(DEFAULT_NOTIFY_PREFS);
  });
  it("does not share the default object", () => {
    parseNotifyPrefs(null).alerts = false;
    expect(DEFAULT_NOTIFY_PREFS.alerts).toBe(true);
  });
});

describe("hasNotifyLocation", () => {
  it("needs a real location", () => {
    expect(hasNotifyLocation("Whitefield")).toBe(true);
    expect(hasNotifyLocation("   ")).toBe(false);
    expect(hasNotifyLocation(null)).toBe(false);
    expect(hasNotifyLocation(undefined)).toBe(false);
  });
});

describe("notifyExample", () => {
  it("describes each kind differently", () => {
    expect(notifyExample("alerts")).toMatch(/alerts/i);
    expect(notifyExample("events")).toMatch(/events/i);
  });
});
