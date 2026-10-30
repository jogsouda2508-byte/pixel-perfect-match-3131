import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Music2, Pause, Play, Search, X } from "lucide-react";
import {
  DEFAULT_MUSIC_SECONDS,
  MUSIC_SECONDS,
  MUSIC_SUGGESTIONS,
  searchMusic,
  type MusicResult,
  type StoryMusic,
} from "@/lib/story-music";
import { cn } from "@/lib/utils";

const chipTerm = (chip: string) => (chip === "Trending" ? "top hits" : chip);

/**
 * "Choose a song" sheet for the story editor: search, quick category chips, a play button to
 * hear the clip, and a tap on the row to use it.
 */
export function StoryMusicPicker({
  onPick,
  onClose,
}: {
  onPick: (music: StoryMusic) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(MUSIC_SUGGESTIONS[0] ?? "Trending");
  const [results, setResults] = useState<MusicResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // step 2: after a song is tapped, the person picks how many seconds it should last
  const [selected, setSelected] = useState<MusicResult | null>(null);
  const [seconds, setSeconds] = useState<number>(DEFAULT_MUSIC_SECONDS);
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<number | null>(null);

  const term = query.trim() || chipTerm(chip);

  // Search while typing, but wait a moment after the last key so we don't ask on every letter.
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(
      () => {
        searchMusic(term, ctl.signal)
          .then((r) => {
            setResults(r);
            setLoading(false);
          })
          .catch((e: unknown) => {
            if (ctl.signal.aborted) return;
            setResults([]);
            setError(e instanceof Error ? e.message : "Couldn't load songs.");
            setLoading(false);
          });
      },
      query.trim() ? 350 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [term, query, retry]);

  const stop = () => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setPreviewing(false);
  };
  useEffect(() => stop, []);

  const togglePlay = (r: MusicResult) => {
    if (playing === r.id) {
      stop();
      return;
    }
    stop();
    const audio = new Audio(r.url);
    audio.volume = 0.8;
    audio.onended = () => setPlaying(null);
    audioRef.current = audio;
    setPlaying(r.id);
    void audio.play().catch(() => setPlaying(null));
  };

  // Tapping a song opens the "how many seconds?" step instead of using it right away.
  const choose = (r: MusicResult) => {
    stop();
    setSelected(r);
  };

  // Plays the song for just the chosen number of seconds, so they can hear how it will feel.
  const previewLength = () => {
    if (!selected) return;
    if (previewing) {
      stop();
      return;
    }
    stop();
    const audio = new Audio(selected.url);
    audio.volume = 0.8;
    audio.onended = () => stop();
    audioRef.current = audio;
    setPreviewing(true);
    void audio.play().catch(() => setPreviewing(false));
    previewTimer.current = window.setTimeout(stop, seconds * 1000);
  };

  const confirmSeconds = () => {
    if (!selected) return;
    stop();
    onPick({ title: selected.title, url: selected.url, cover: selected.cover ?? null, seconds });
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end" data-testid="story-music-picker">
      <button
        type="button"
        aria-label="Close music"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-black/55 backdrop-blur-[3px] duration-200 fade-in"
      />
      <div className="relative flex h-[78%] animate-in flex-col rounded-t-[28px] bg-zinc-900/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-300 slide-in-from-bottom">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 className="text-base font-bold tracking-tight">Add music</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition active:scale-90 hover:bg-white/15"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4">
          <div className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 ring-1 ring-white/10 transition focus-within:bg-white/15 focus-within:ring-white/30">
            <Search className="h-4 w-4 shrink-0 text-white/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs or artists"
              aria-label="Search songs"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X className="h-4 w-4 text-white/60" />
              </button>
            )}
          </div>
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MUSIC_SUGGESTIONS.map((c) => {
              const active = !query.trim() && chip === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setChip(c);
                  }}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold transition active:scale-95",
                    active ? "bg-white text-black" : "bg-white/10 text-white/85 hover:bg-white/15",
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading && (
            <div className="space-y-1 px-2 pt-1" aria-busy="true" aria-label="Loading songs">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl p-2">
                  <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
                    <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && error && (
            <div className="grid place-items-center gap-3 px-6 py-14 text-center">
              <p className="text-sm text-white/70">{error}</p>
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition active:scale-95"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="grid place-items-center gap-2 px-6 py-14 text-center text-white/60">
              <Music2 className="h-8 w-8" />
              <p className="text-sm">No songs found. Try another name.</p>
            </div>
          )}
          {!loading &&
            !error &&
            results.map((r, i) => (
              <div
                key={r.id}
                className="group flex animate-in items-center gap-3 rounded-2xl p-2 transition fill-mode-backwards duration-300 fade-in slide-in-from-bottom-2 hover:bg-white/[0.07]"
                style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
              >
                <button
                  type="button"
                  onClick={() => choose(r)}
                  aria-label={`Use ${r.title}`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {r.cover ? (
                    <img
                      src={r.cover}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg bg-white/10 object-cover"
                    />
                  ) : (
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10">
                      <Music2 className="h-5 w-5" />
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{r.name}</span>
                    <span className="block truncate text-[12px] text-white/55">{r.artist}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => togglePlay(r)}
                  aria-label={playing === r.id ? `Pause ${r.name}` : `Play ${r.name}`}
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-90",
                    playing === r.id ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20",
                  )}
                >
                  {playing === r.id ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  )}
                </button>
              </div>
            ))}
        </div>
        {selected && (
          <div
            className="absolute inset-0 z-10 flex animate-in flex-col rounded-t-[28px] bg-zinc-900 duration-200 fade-in"
            data-testid="story-music-length"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
            <div className="flex items-center gap-2 px-4 pb-2 pt-3">
              <button
                type="button"
                onClick={() => {
                  stop();
                  setSelected(null);
                }}
                aria-label="Back to songs"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition active:scale-90 hover:bg-white/15"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h2 className="text-lg font-bold tracking-tight">How many seconds?</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto overscroll-contain px-6 pt-2 sm:gap-6 sm:pt-6">
              {selected.cover ? (
                <img
                  src={selected.cover}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-2xl bg-white/10 object-cover shadow-lg sm:h-28 sm:w-28"
                />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-white/10 sm:h-28 sm:w-28">
                  <Music2 className="h-9 w-9" />
                </div>
              )}
              <div className="min-w-0 max-w-full text-center">
                <p className="truncate text-base font-semibold">{selected.name}</p>
                <p className="truncate text-sm text-white/55">{selected.artist}</p>
              </div>
              <div className="shrink-0 text-center">
                <p className="text-4xl font-bold tabular-nums sm:text-5xl">{seconds}s</p>
                <p className="mt-1 text-sm text-white/55">The song and your story will last this long</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-center gap-2" role="radiogroup" aria-label="Song length in seconds">
                {MUSIC_SECONDS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={seconds === n}
                    onClick={() => {
                      stop();
                      setSeconds(n);
                    }}
                    className={cn(
                      "min-w-[56px] rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95",
                      seconds === n ? "bg-white text-black" : "bg-white/10 text-white/85 hover:bg-white/15",
                    )}
                  >
                    {n}s
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={previewLength}
                className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold transition active:scale-95 hover:bg-white/15"
              >
                {previewing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                {previewing ? "Stop" : `Preview ${seconds}s`}
              </button>
            </div>
            <div className="shrink-0 border-t border-white/5 bg-zinc-900 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
              <button
                type="button"
                onClick={confirmSeconds}
                className="h-12 w-full rounded-full bg-white text-[15px] font-bold text-black transition active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
