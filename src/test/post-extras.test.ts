import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));

import { parsePhotonFeatures, placeSubtitle } from "@/lib/places";
import {
  appendHashtagMark,
  extractHashtags,
  locationColumns,
  MAX_TAGGED_PEOPLE,
  saveTags,
} from "@/lib/post-extras";

const photon = {
  features: [
    {
      properties: {
        osm_id: 1,
        osm_type: "W",
        name: "Cubbon Park",
        district: "Sampangi Rama Nagar",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
      },
    },
    // duplicate id, nameless result and malformed rows are dropped
    { properties: { osm_id: 1, osm_type: "W", name: "Cubbon Park" } },
    { properties: { osm_id: 2, osm_type: "N" } },
    { properties: { name: "No id" } },
    {},
  ],
};

describe("parsePhotonFeatures", () => {
  it("turns provider results into places with a stable id, name, address and city", () => {
    const places = parsePhotonFeatures(photon);
    expect(places).toEqual([
      {
        placeId: "osm:W1",
        name: "Cubbon Park",
        address: "Sampangi Rama Nagar, Bengaluru, Karnataka, India",
        city: "Bengaluru",
      },
    ]);
  });

  it("returns an empty list for unexpected responses", () => {
    expect(parsePhotonFeatures(null)).toEqual([]);
    expect(parsePhotonFeatures({})).toEqual([]);
    expect(parsePhotonFeatures({ features: "nope" })).toEqual([]);
  });

  it("uses the address, then the city, as the subtitle", () => {
    expect(placeSubtitle({ address: "A, B", city: "B" })).toBe("A, B");
    expect(placeSubtitle({ address: null, city: "B" })).toBe("B");
    expect(placeSubtitle({ address: null, city: null })).toBe("");
  });
});

describe("locationColumns", () => {
  it("is empty when no location was chosen", () => {
    expect(locationColumns(null)).toEqual({});
    expect(locationColumns(undefined)).toEqual({});
  });

  it("maps a place to the posts columns and never includes coordinates", () => {
    const columns = locationColumns({
      placeId: "osm:W1",
      name: "Cubbon Park",
      address: "Bengaluru",
      city: "Bengaluru",
    });
    expect(columns).toEqual({
      location_place_id: "osm:W1",
      location_name: "Cubbon Park",
      location_address: "Bengaluru",
      location_city: "Bengaluru",
    });
  });
});

describe("saveTags", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not call the database when nobody is tagged", async () => {
    await expect(saveTags("post-1", [])).resolves.toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("de-duplicates ids and caps the list", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await expect(saveTags("post-1", ["a", "b", "a"])).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_post_tags", { p_post_id: "post-1", p_user_ids: ["a", "b"] });

    rpc.mockClear();
    rpc.mockResolvedValue({ data: MAX_TAGGED_PEOPLE, error: null });
    const many = Array.from({ length: MAX_TAGGED_PEOPLE + 5 }, (_, i) => `u${i}`);
    await saveTags("post-1", many);
    expect(rpc.mock.calls[0]?.[1].p_user_ids).toHaveLength(MAX_TAGGED_PEOPLE);
  });

  it("reports a partial save when the database skipped someone", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await expect(saveTags("post-1", ["a", "b"])).resolves.toBe(false);
  });

  it("reports failure without throwing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(saveTags("post-1", ["a"])).resolves.toBe(false);
    rpc.mockRejectedValue(new Error("network"));
    await expect(saveTags("post-1", ["a"])).resolves.toBe(false);
  });
});

describe("hashtags", () => {
  it("finds unique hashtags in order, including non-English letters", () => {
    expect(extractHashtags("Fun day #park #Bengaluru #park, #ಬೆಂಗಳೂರು!")).toEqual([
      "park",
      "Bengaluru",
      "ಬೆಂಗಳೂರು",
    ]);
    expect(extractHashtags("no tags here # alone")).toEqual([]);
  });

  it("adds a # with a space only when needed and respects the limit", () => {
    expect(appendHashtagMark("", 500)).toBe("#");
    expect(appendHashtagMark("hello", 500)).toBe("hello #");
    expect(appendHashtagMark("hello ", 500)).toBe("hello #");
    expect(appendHashtagMark("hello\n", 500)).toBe("hello\n#");
    expect(appendHashtagMark("abcde", 5)).toBe("abcde");
  });
});
