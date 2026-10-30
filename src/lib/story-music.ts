/**
 * Music for photo stories.
 *
 * Songs come from the free iTunes Search API (no key, no sign-up). It returns a 30-second preview
 * clip and cover art for each song, which is exactly what a story needs. Nothing here touches the
 * database: the chosen song is saved by createStory() in social.ts.
 */

export type StoryMusic = {
  /** "Song name - Artist" */
  title: string;
  /** https preview clip that plays while the story is watched */
  url: string;
  /** square cover art, shown on the sticker (optional) */
  cover?: string | null;
  /** how many seconds the person wants the song (and the story) to last */
  seconds?: number;
};

export type MusicResult = StoryMusic & {
  id: string;
  name: string;
  artist: string;
};

type ItunesTrack = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
};

/** Search chips shown above the results. The first one is loaded when the sheet opens. */
export const MUSIC_SUGGESTIONS = ["Trending", "Bollywood", "Hip hop", "Chill", "Party", "Romantic"];

/** Lengths the person can pick. iTunes previews are 30 seconds long, so 30 is the most. */
export const MUSIC_SECONDS = [5, 10, 15, 20, 30] as const;
export const DEFAULT_MUSIC_SECONDS = 15;
const MAX_MUSIC_SECONDS = 30;

const clampSeconds = (n: number) =>
  Math.min(MAX_MUSIC_SECONDS, Math.max(1, Math.round(Number.isFinite(n) ? n : DEFAULT_MUSIC_SECONDS)));

/**
 * The chosen length travels inside the song address after a "#" (browsers ignore that part when
 * loading audio), so no new database column is needed and old stories keep working.
 */
export function withMusicSeconds(url: string, seconds: number): string {
  return `${url.split("#")[0]}#len=${clampSeconds(seconds)}`;
}

/** Splits a saved song address into the real audio address and the chosen length (if any). */
export function readMusicSeconds(url: string): { url: string; seconds: number | null } {
  const i = url.indexOf("#len=");
  if (i < 0) return { url, seconds: null };
  const n = Number(url.slice(i + 5));
  return { url: url.slice(0, i), seconds: Number.isFinite(n) && n > 0 ? clampSeconds(n) : null };
}

export function musicTitle(name: string, artist: string): string {
  return artist ? `${name} - ${artist}` : name;
}

/** Cover art comes as 100x100; ask for a sharper copy when it is drawn on the story picture. */
export function bigCover(url: string | null | undefined): string | null {
  return url ? url.replace(/\/\d+x\d+bb\./, "/300x300bb.") : null;
}

export async function searchMusic(term: string, signal?: AbortSignal): Promise<MusicResult[]> {
  const q = term.trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Couldn't load songs. Check your connection and try again.");
  const json = (await res.json()) as { results?: ItunesTrack[] };
  const out: MusicResult[] = [];
  const seen = new Set<string>();
  for (const t of json.results ?? []) {
    if (!t.trackName || !t.previewUrl) continue;
    // previews are served over https; anything else would be blocked on an https page anyway
    const preview = t.previewUrl.replace(/^http:\/\//i, "https://");
    const id = String(t.trackId ?? preview);
    if (seen.has(id)) continue;
    seen.add(id);
    const artist = t.artistName ?? "";
    out.push({
      id,
      name: t.trackName,
      artist,
      title: musicTitle(t.trackName, artist),
      url: preview,
      cover: bigCover(t.artworkUrl100),
    });
  }
  return out;
}

/**
 * Where the song is kept when the two optional database columns don't exist (yet): at the end
 * of the picture's address, after a "#". Browsers ignore that part when loading the picture, so
 * the story looks the same, and the song still plays for everyone who watches it.
 */
const EMBED_KEY = "#song=";

export function embedMusic(imageUrl: string, music: { title: string; url: string }): string {
  return `${imageUrl.split("#")[0]}${EMBED_KEY}${encodeURIComponent(
    JSON.stringify({ t: music.title, u: music.url }),
  )}`;
}

export function readEmbeddedMusic(imageUrl: string | null): {
  image_url: string | null;
  music_title: string | null;
  music_url: string | null;
} {
  if (!imageUrl) return { image_url: imageUrl, music_title: null, music_url: null };
  const i = imageUrl.indexOf(EMBED_KEY);
  if (i < 0) return { image_url: imageUrl, music_title: null, music_url: null };
  const clean = imageUrl.slice(0, i);
  try {
    const data = JSON.parse(decodeURIComponent(imageUrl.slice(i + EMBED_KEY.length))) as {
      t?: unknown;
      u?: unknown;
    };
    if (typeof data.u === "string" && /^https:\/\//i.test(data.u)) {
      return {
        image_url: clean,
        music_title: typeof data.t === "string" ? data.t.slice(0, 200) : "",
        music_url: data.u,
      };
    }
  } catch {
    // damaged data: show the picture without a song
  }
  return { image_url: clean, music_title: null, music_url: null };
}
