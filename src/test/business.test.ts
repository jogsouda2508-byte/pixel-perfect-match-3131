import { describe, expect, it } from "vitest";
import {
  computeOpenStatus,
  defaultHoursDraft,
  formatClock,
  formatIndianMobile,
  formatRupees,
  formatServicePrice,
  hoursRows,
  isValidIndianMobile,
  parsePrice,
  sanitizeIndianMobile,
  sanitizePriceInput,
  setupProgress,
  telHref,
  validateBusinessForm,
  whatsappHref,
  type BusinessForm,
  type BusinessHour,
} from "@/lib/business";

/** A moment in Indian time (IST = UTC+5:30). dow: 0 = Monday. 2026-11-02 is a Monday. */
const ist = (dow: number, h: number, m = 0) =>
  new Date(Date.UTC(2026, 10, 2 + dow, h, m) - 5.5 * 3600_000);

const week = (over: Partial<Record<number, Partial<BusinessHour>>> = {}): BusinessHour[] =>
  Array.from({ length: 7 }, (_, dow) => ({
    dow,
    is_closed: dow === 6,
    is_24h: false,
    open_time: dow === 6 ? null : "10:00",
    close_time: dow === 6 ? null : "20:00",
    ...over[dow],
  }));

describe("Indian mobile numbers", () => {
  it("keeps 10 digits and drops +91 / 91 / leading 0", () => {
    expect(sanitizeIndianMobile("98765 43210")).toBe("9876543210");
    expect(sanitizeIndianMobile("+91 98765 43210")).toBe("9876543210");
    expect(sanitizeIndianMobile("919876543210")).toBe("9876543210");
    expect(sanitizeIndianMobile("09876543210")).toBe("9876543210");
  });
  it("does not eat the start of a number that begins with 91 while typing", () => {
    expect(sanitizeIndianMobile("91")).toBe("91");
    expect(sanitizeIndianMobile("9123456789")).toBe("9123456789");
    expect(sanitizeIndianMobile("91234567895")).toBe("9123456789");
  });
  it("validates 6-9 start and 10 digits", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("6000000000")).toBe(true);
    expect(isValidIndianMobile("5876543210")).toBe(false);
    expect(isValidIndianMobile("987654321")).toBe(false);
  });
  it("formats and builds links", () => {
    expect(formatIndianMobile("9876543210")).toBe("+91 98765 43210");
    expect(telHref("9876543210")).toBe("tel:+919876543210");
    expect(whatsappHref("9876543210")).toBe("https://wa.me/919876543210");
    expect(whatsappHref("9876543210", "Hi there")).toBe(
      "https://wa.me/919876543210?text=Hi%20there",
    );
  });
});

describe("rupee prices", () => {
  it("uses Indian digit grouping", () => {
    expect(formatRupees(200)).toBe("₹200");
    expect(formatRupees(1500)).toBe("₹1,500");
    expect(formatRupees(150000)).toBe("₹1,50,000");
    expect(formatRupees(12345678)).toBe("₹1,23,45,678");
    expect(formatRupees(99.5)).toBe("₹99.50");
  });
  it("shows From / Free", () => {
    expect(formatServicePrice({ price: 200, price_from: true })).toBe("From ₹200");
    expect(formatServicePrice({ price: 0, price_from: false })).toBe("Free");
  });
  it("parses what people type", () => {
    expect(parsePrice("1,500")).toBe(1500);
    expect(parsePrice("₹99.5")).toBe(99.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("1.234")).toBeNull();
    expect(parsePrice("99999999")).toBeNull();
    expect(sanitizePriceInput("1a2b.3456")).toBe("12.34");
  });
});

describe("opening hours", () => {
  it("formats clock times", () => {
    expect(formatClock("20:00")).toBe("8 PM");
    expect(formatClock("08:30")).toBe("8:30 AM");
    expect(formatClock("00:00")).toBe("12 AM");
    expect(formatClock("12:00")).toBe("12 PM");
  });
  it("is open during the day and says when it closes", () => {
    expect(computeOpenStatus(week(), ist(1, 11))).toEqual({
      state: "open",
      text: "Open now · Closes 8 PM",
    });
  });
  it("is closed before opening and says when it opens", () => {
    expect(computeOpenStatus(week(), ist(1, 8))).toEqual({
      state: "closed",
      text: "Closed · Opens today at 10 AM",
    });
  });
  it("is closed after closing and opens tomorrow", () => {
    expect(computeOpenStatus(week(), ist(1, 21)).text).toBe("Closed · Opens tomorrow at 10 AM");
  });
  it("skips a closed Sunday and opens Monday", () => {
    expect(computeOpenStatus(week(), ist(5, 21)).text).toBe("Closed · Opens Mon at 10 AM");
  });
  it("handles opening after midnight (6 PM - 2 AM)", () => {
    const night = week({ 4: { open_time: "18:00", close_time: "02:00" } });
    expect(computeOpenStatus(night, ist(4, 23)).state).toBe("open");
    expect(computeOpenStatus(night, ist(5, 1)).state).toBe("open"); // Friday night spills into Saturday
    expect(computeOpenStatus(night, ist(5, 3)).state).toBe("closed");
  });
  it("handles open 24 hours and unknown hours", () => {
    expect(computeOpenStatus(week({ 1: { is_24h: true } }), ist(1, 3)).text).toBe("Open 24 hours");
    expect(computeOpenStatus([], ist(1, 11)).state).toBe("unknown");
  });
  it("reads Indian time wherever the viewer is", () => {
    // 04:30 UTC is 10:00 IST: just opened
    expect(computeOpenStatus(week(), new Date(Date.UTC(2026, 10, 3, 4, 30))).state).toBe("open");
    // 04:29 UTC is 09:59 IST: not yet
    expect(computeOpenStatus(week(), new Date(Date.UTC(2026, 10, 3, 4, 29))).state).toBe("closed");
  });
  it("lists every day and marks today", () => {
    const rows = hoursRows(week(), ist(2, 12));
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ day: "Monday", text: "10 AM – 8 PM", isToday: false });
    expect(rows[2]!.isToday).toBe(true);
    expect(rows[6]!.text).toBe("Closed");
  });
});

describe("the edit form", () => {
  const form = (over: Partial<BusinessForm> = {}): BusinessForm => ({
    category: "Salon & Beauty",
    phone: "9876543210",
    whatsappSame: true,
    whatsapp: "",
    address: "",
    hoursEnabled: true,
    hours: defaultHoursDraft(),
    services: [],
    ...over,
  });
  it("accepts a good form", () => {
    expect(validateBusinessForm(form()).count).toBe(0);
  });
  it("needs a category and a phone", () => {
    const e = validateBusinessForm(form({ category: "", phone: "" }));
    expect(e.category).toBeTruthy();
    expect(e.phone).toBeTruthy();
  });
  it("rejects a bad phone and bad WhatsApp", () => {
    const e = validateBusinessForm(
      form({ phone: "1234", whatsappSame: false, whatsapp: "5555555555" }),
    );
    expect(e.phone).toBeTruthy();
    expect(e.whatsapp).toBeTruthy();
    expect(e.count).toBe(2);
  });
  it("rejects equal opening and closing times", () => {
    const hours = defaultHoursDraft();
    hours[0] = { ...hours[0]!, open: "10:00", close: "10:00" };
    expect(validateBusinessForm(form({ hours })).hours).toMatch(/Monday/);
  });
  it("ignores empty price rows but flags half-filled ones", () => {
    const empty = { key: "a", name: "", price: "", priceFrom: false, description: "" };
    const noPrice = { key: "b", name: "Haircut", price: "", priceFrom: false, description: "" };
    const noName = { key: "c", name: "", price: "100", priceFrom: false, description: "" };
    const e = validateBusinessForm(form({ services: [empty, noPrice, noName] }));
    expect(Object.keys(e.services ?? {})).toEqual(["b", "c"]);
  });
});

describe("set-up progress", () => {
  it("counts contact, hours and prices", () => {
    expect(setupProgress(null).done).toBe(0);
    const page = {
      category: "Salon & Beauty",
      phone: "9876543210",
      whatsapp: null,
      address: null,
      hours: week(),
      services: [],
      rating_avg: null,
      rating_count: 0,
      distribution: {},
    };
    expect(setupProgress(page)).toMatchObject({
      contact: true,
      hours: true,
      prices: false,
      done: 2,
    });
  });
});
