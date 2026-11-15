import { describe, expect, it } from "vitest";
import {
  bookingStatusLabel,
  bookingWhen,
  istDate,
  offerEndsText,
  requestedAt,
  validateBooking,
  validateOffer,
} from "@/lib/bookings";

const NOW = new Date("2026-11-16T06:30:00Z"); // 12:00 noon in India

describe("offerEndsText", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  it("counts down in minutes, hours and days", () => {
    expect(offerEndsText(at(20 * 60_000), NOW)).toBe("Ends in 20 min");
    expect(offerEndsText(at(5 * 3_600_000), NOW)).toBe("Ends in 5 h");
    expect(offerEndsText(at(30 * 3_600_000), NOW)).toBe("Ends tomorrow");
    expect(offerEndsText(at(5 * 86_400_000), NOW)).toBe("Ends in 5 days");
  });
  it("says Ended once it is over", () => {
    expect(offerEndsText(at(-1000), NOW)).toBe("Ended");
  });
});

describe("validateOffer", () => {
  it("needs a title and a short tag", () => {
    expect(validateOffer({ title: "Diwali sale", details: "", badge: "20% OFF" })).toEqual({});
    expect(Object.keys(validateOffer({ title: "ab", details: "", badge: "x".repeat(17) }))).toEqual(
      ["title", "badge"],
    );
  });
});

describe("requestedAt and istDate", () => {
  it("reads the date and time as Indian time", () => {
    expect(requestedAt("2026-11-18", "16:30")?.toISOString()).toBe("2026-11-18T11:00:00.000Z");
  });
  it("rejects half-filled or odd values", () => {
    expect(requestedAt("", "16:30")).toBeNull();
    expect(requestedAt("2026-11-18", "")).toBeNull();
    expect(requestedAt("18/11/2026", "16:30")).toBeNull();
  });
  it("gives today's date in India", () => {
    // 23:00 UTC on the 15th is already 4:30 AM on the 16th in India
    expect(istDate(new Date("2026-11-15T23:00:00Z"))).toBe("2026-11-16");
    expect(istDate(new Date("2026-11-15T23:00:00Z"), 2)).toBe("2026-11-18");
  });
});

describe("validateBooking", () => {
  it("asks for a day and a time", () => {
    expect(Object.keys(validateBooking({ date: "", time: "", note: "" }, NOW))).toEqual([
      "date",
      "time",
    ]);
  });
  it("accepts a time in the future", () => {
    expect(validateBooking({ date: "2026-11-18", time: "16:30", note: "" }, NOW)).toEqual({});
  });
  it("rejects the past and anything more than 90 days away", () => {
    expect(validateBooking({ date: "2026-11-16", time: "09:00", note: "" }, NOW).when).toMatch(
      /future/,
    );
    expect(validateBooking({ date: "2027-06-01", time: "09:00", note: "" }, NOW).when).toMatch(
      /90 days/,
    );
  });
});

describe("labels", () => {
  it("names each status", () => {
    expect(bookingStatusLabel("pending")).toBe("Waiting for reply");
    expect(bookingStatusLabel("accepted")).toBe("Confirmed");
  });
  it("shows the booking time in Indian time", () => {
    expect(bookingWhen("2026-11-18T11:00:00.000Z")).toMatch(/4:30\s?pm/i);
  });
});
