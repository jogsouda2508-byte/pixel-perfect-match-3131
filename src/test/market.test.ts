import { describe, expect, it } from "vitest";
import { formatPrice, parsePrice, validateListing, type ListingForm } from "@/lib/market";

describe("formatPrice", () => {
  it("shows rupees with Indian digit grouping", () => {
    expect(formatPrice(450)).toBe("₹450");
    expect(formatPrice(125000)).toBe("₹1,25,000");
    expect(formatPrice(99.5)).toBe("₹99.5");
  });
  it("calls zero free", () => {
    expect(formatPrice(0)).toBe("Free");
  });
});

describe("parsePrice", () => {
  it("reads plain numbers, commas and a rupee sign", () => {
    expect(parsePrice("1500")).toBe(1500);
    expect(parsePrice("₹ 12,500")).toBe(12500);
    expect(parsePrice("99.50")).toBe(99.5);
  });
  it("treats empty and 'free' as free", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice("  ")).toBe(0);
    expect(parsePrice("Free")).toBe(0);
  });
  it("rejects things that are not an amount", () => {
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("-5")).toBeNull();
    expect(parsePrice("1.234")).toBeNull();
    expect(parsePrice("99999999")).toBeNull();
  });
});

describe("validateListing", () => {
  const ok: ListingForm = {
    title: "Study table",
    description: "",
    price: "1500",
    category: "furniture",
    condition: "used",
    locality: "Whitefield",
    photos: 1,
  };
  it("accepts a complete listing", () => {
    expect(validateListing(ok)).toEqual({});
  });
  it("asks for a title, a valid price, an area and a photo", () => {
    const e = validateListing({ ...ok, title: "ab", price: "x", locality: " ", photos: 0 });
    expect(Object.keys(e).sort()).toEqual(["locality", "photos", "price", "title"]);
  });
  it("lets a free item through", () => {
    expect(validateListing({ ...ok, price: "" })).toEqual({});
  });
});
