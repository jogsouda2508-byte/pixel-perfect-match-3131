/**
 * GIFs on photo stories.
 *
 * GIFs come from Giphy (needs a free API key in VITE_GIPHY_API_KEY, see developers.giphy.com).
 * The story picture itself is still one flat JPEG, so a GIF can't be baked into it without
 * losing the animation. Instead the chosen GIFs are saved next to the picture (id, position,
 * size, turn) and drawn on top of it, animated, while the story is watched. Nothing here
 * touches the database schema: like the song, the GIFs ride in the picture's address after
 * a "#", which browsers ignore when loading the picture. Old stories have no such part and
 * keep working exactly as before.
 */

/** A GIF placed on a story. x / y are the centre as a fraction of the picture (0..1). */
export type StoryGif = {
  /** Giphy id */
  id: string;
  /** width / height of the GIF */
  ratio: number;
  x: number;
  y: number;
  scale: number;
  /** radians */
  rot: number;
};

export type GifResult = {
  id: string;
  title: string;
  ratio: number;
  /** small animated preview for the picker grid */
  preview: string;
};

/** width of a GIF at scale 1, as a fraction of the picture width */
export const GIF_BASE_W = 0.46;
export const MAX_STORY_GIFS = 6;

const GIPHY = "https://api.giphy.com/v1/gifs";
const ID_RE = /^[A-Za-z0-9]{4,40}$/;

export const GIF_SUGGESTIONS = [
  "Trending",
  "Happy",
  "Love",
  "Funny",
  "Party",
  "Thanks",
  "Wow",
  "Bollywood",
];

/** The Giphy key, or "" when the app has none (the picker then explains how to add it). */
export function giphyKey(): string {
  return ((import.meta.env["VITE_GIPHY_API_KEY"] as string | undefined) ?? "").trim();
}

/** The animated picture shown for a saved GIF id (only ever built from a checked id). */
export function gifUrl(id: string): string {
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyItem = {
  id?: string;
  title?: string;
  images?: { fixed_width?: GiphyImage; fixed_width_small?: GiphyImage };
};

/** Trending GIFs when `term` is empty, otherwise a search. */
export async function searchGifs(term: string, signal?: AbortSignal): Promise<GifResult[]> {
  const key = giphyKey();
  if (!key) throw new Error("GIF search isn't set up yet. Add VITE_GIPHY_API_KEY to turn it on.");
  const q = term.trim();
  const params = new URLSearchParams({ api_key: key, limit: "30", rating: "pg-13" });
  if (q) params.set("q", q);
  const res = await fetch(
    `${GIPHY}/${q ? "search" : "trending"}?${params.toString()}`,
    signal ? { signal } : {},
  );
  if (!res.ok) throw new Error("Couldn't load GIFs. Check your connection and try again.");
  const json = (await res.json()) as { data?: GiphyItem[] };
  const out: GifResult[] = [];
  const seen = new Set<string>();
  for (const g of json.data ?? []) {
    if (!g.id || !ID_RE.test(g.id) || seen.has(g.id)) continue;
    const img = g.images?.fixed_width_small ?? g.images?.fixed_width;
    const preview = img?.url?.replace(/^http:\/\//i, "https://");
    if (!preview) continue;
    seen.add(g.id);
    const w = Number(img?.width);
    const h = Number(img?.height);
    out.push({
      id: g.id,
      title: (g.title ?? "").slice(0, 120),
      ratio: w > 0 && h > 0 ? w / h : 1,
      preview,
    });
  }
  return out;
}

// ---------------------------------------------------------------- saving in the picture address
const KEY = "#gifs=";

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Adds the GIFs to the end of a picture address (replacing any GIFs already there). */
export function embedGifs(imageUrl: string, gifs: StoryGif[]): string {
  const cut = imageUrl.lastIndexOf(KEY);
  const base = cut >= 0 ? imageUrl.slice(0, cut) : imageUrl;
  const list = gifs
    .filter((g) => ID_RE.test(g.id))
    .slice(0, MAX_STORY_GIFS)
    .map((g) => [g.id, round(g.ratio), round(g.x), round(g.y), round(g.scale), round(g.rot)]);
  if (list.length === 0) return base;
  return `${base}${KEY}${encodeURIComponent(JSON.stringify(list))}`;
}

/**
 * Splits a saved picture address into the real picture address and its GIFs. Anything damaged
 * or not shaped like a GIF we wrote is ignored, so a bad value can never break a story.
 */
export function readEmbeddedGifs(imageUrl: string | null): {
  image_url: string | null;
  gifs: StoryGif[];
} {
  if (!imageUrl) return { image_url: imageUrl, gifs: [] };
  const i = imageUrl.lastIndexOf(KEY);
  if (i < 0) return { image_url: imageUrl, gifs: [] };
  const clean = imageUrl.slice(0, i);
  const gifs: StoryGif[] = [];
  try {
    const data: unknown = JSON.parse(decodeURIComponent(imageUrl.slice(i + KEY.length)));
    if (Array.isArray(data)) {
      for (const row of data.slice(0, MAX_STORY_GIFS)) {
        if (!Array.isArray(row)) continue;
        const [id, ratio, x, y, scale, rot] = row as unknown[];
        if (typeof id !== "string" || !ID_RE.test(id)) continue;
        gifs.push({
          id,
          ratio: num(ratio, 1, 0.2, 5),
          x: num(x, 0.5, -0.1, 1.1),
          y: num(y, 0.5, -0.1, 1.1),
          scale: num(scale, 1, 0.2, 5),
          rot: num(rot, 0, -20, 20),
        });
      }
    }
  } catch {
    // damaged data: show the picture without GIFs
  }
  return { image_url: clean, gifs };
}
