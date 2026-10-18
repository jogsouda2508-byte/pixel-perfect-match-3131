/**
 * Place search for the "Add location" picker.
 *
 * Provider: Photon (https://photon.komoot.io) -- search-as-you-type on OpenStreetMap data.
 * It needs no API key, so nothing secret ships to the browser. The public instance is
 * rate limited (fair use): we debounce in the UI, cancel obsolete requests, cache results
 * and surface HTTP 429 as a friendly "try again in a moment" message.
 *
 * To switch to Google Places later, keep the same two functions (searchPlaces / nearbyPlaces)
 * and the same PlaceSelection shape, but call Google from a server function so the key stays
 * on the server.
 *
 * Privacy: only the place the person picks is saved with a post (provider id, name, address,
 * city). Device coordinates are used, in memory, only to bias search results after the person
 * explicitly taps "Use my location" -- they are never stored or published.
 */

export type PlaceSelection = {
  /** Stable provider id, e.g. "osm:W12345" */
  placeId: string;
  name: string;
  /** Readable address line, e.g. "Cubbon Park, Bengaluru, Karnataka, India" */
  address: string | null;
  city: string | null;
};

export type PlacesErrorCode = "rate_limited" | "failed";

export class PlacesError extends Error {
  readonly code: PlacesErrorCode;
  constructor(code: PlacesErrorCode, message: string) {
    super(message);
    this.name = "PlacesError";
    this.code = code;
  }
}

const SEARCH_URL = "https://photon.komoot.io/api/";
const REVERSE_URL = "https://photon.komoot.io/reverse";
const MAX_QUERY_LENGTH = 100;

type PhotonProperties = {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
};

type PhotonResponse = {
  features?: { properties?: PhotonProperties }[];
};

/** "Cubbon Park" -> "Cubbon Park". Falls back to the street when a result has no name. */
function placeName(p: PhotonProperties): string | null {
  const name = p.name?.trim() || p.street?.trim();
  return name ? name : null;
}

/** Joins the non-empty, de-duplicated parts of an address. */
function joinParts(parts: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw?.trim();
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(", ");
}

/** Turns a Photon response into places. Pure, so it is unit-tested without the network. */
export function parsePhotonFeatures(json: unknown): PlaceSelection[] {
  const features = (json as PhotonResponse | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const places: PlaceSelection[] = [];
  for (const feature of features) {
    const p = feature?.properties;
    if (!p || p.osm_id === undefined || !p.osm_type) continue;
    const name = placeName(p);
    if (!name) continue;
    const placeId = `osm:${p.osm_type}${p.osm_id}`;
    if (seen.has(placeId)) continue;
    seen.add(placeId);
    const city = p.city?.trim() || p.locality?.trim() || p.district?.trim() || p.county?.trim() || null;
    const street = joinParts([[p.housenumber, p.street].filter(Boolean).join(" ")]);
    const address =
      joinParts([
        // don't repeat the name when it is the street itself
        street && street.toLowerCase() !== name.toLowerCase() ? street : undefined,
        p.district,
        p.locality,
        city ?? undefined,
        p.state,
        p.country,
      ]) || null;
    places.push({ placeId, name, address, city });
  }
  return places;
}

/** Shorter "Bengaluru, Karnataka" style line shown under a place name. */
export function placeSubtitle(place: Pick<PlaceSelection, "address" | "city">): string {
  return place.address ?? place.city ?? "";
}

const cache = new Map<string, PlaceSelection[]>();
const CACHE_LIMIT = 60;

function remember(key: string, value: PlaceSelection[]) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function request(url: string, signal?: AbortSignal): Promise<PlaceSelection[]> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new PlacesError("failed", "Couldn't reach the places service. Check your connection.");
  }
  if (response.status === 429) {
    throw new PlacesError("rate_limited", "Too many searches. Please wait a moment and try again.");
  }
  if (!response.ok) {
    throw new PlacesError("failed", "Couldn't load places. Please try again.");
  }
  try {
    return parsePhotonFeatures(await response.json());
  } catch {
    throw new PlacesError("failed", "Couldn't read the places response. Please try again.");
  }
}

/** ~1 km precision is plenty for biasing results and leaks less than raw GPS. */
function roundCoord(value: number): string {
  return value.toFixed(2);
}

export type Coordinates = { latitude: number; longitude: number };

/**
 * Searches places, cities, colleges, cafes, restaurants, parks, landmarks and businesses.
 * `bias` is optional and only passed after the person explicitly shared their location.
 */
export async function searchPlaces(
  query: string,
  options: { signal?: AbortSignal | undefined; bias?: Coordinates | null | undefined } = {},
): Promise<PlaceSelection[]> {
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: "8", lang: "en" });
  if (options.bias) {
    params.set("lat", roundCoord(options.bias.latitude));
    params.set("lon", roundCoord(options.bias.longitude));
  }
  const url = `${SEARCH_URL}?${params.toString()}`;
  const cached = cache.get(url);
  if (cached) return cached;
  const places = await request(url, options.signal);
  remember(url, places);
  return places;
}

/** Named places around the given point. Only called after the person grants location access. */
export async function nearbyPlaces(
  at: Coordinates,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<PlaceSelection[]> {
  const params = new URLSearchParams({
    lat: roundCoord(at.latitude),
    lon: roundCoord(at.longitude),
    radius: "2",
    limit: "12",
    lang: "en",
  });
  return request(`${REVERSE_URL}?${params.toString()}`, options.signal);
}

/** Wraps the browser geolocation API in a promise. Only call this from a click handler. */
export function requestDeviceLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? "denied" : "failed")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}
