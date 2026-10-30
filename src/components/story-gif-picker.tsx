import { useEffect, useState } from "react";
import { ImageOff, Search, X } from "lucide-react";
import { GIF_SUGGESTIONS, searchGifs, type GifResult } from "@/lib/story-gifs";
import { cn } from "@/lib/utils";

// "Trending" has no search word: an empty search asks Giphy for what is trending.
const chipTerm = (chip: string) => (chip === "Trending" ? "" : chip);

/**
 * "Add GIF" sheet for the story editor: search, quick category chips and a grid of animated
 * GIFs. Tapping one puts it on the photo.
 */
export function StoryGifPicker({
  onPick,
  onClose,
}: {
  onPick: (gif: GifResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(GIF_SUGGESTIONS[0] ?? "Trending");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const term = query.trim() || chipTerm(chip);

  // Search while typing, but wait a moment after the last key so we don't ask on every letter.
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(
      () => {
        searchGifs(term, ctl.signal)
          .then((r) => {
            setResults(r);
            setLoading(false);
          })
          .catch((e: unknown) => {
            if (ctl.signal.aborted) return;
            setResults([]);
            setError(e instanceof Error ? e.message : "Couldn't load GIFs.");
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

  // two columns, filled so the shorter one gets the next GIF (a simple "masonry" look)
  const columns: GifResult[][] = [[], []];
  const heights = [0, 0];
  for (const g of results) {
    const c = (heights[0] ?? 0) <= (heights[1] ?? 0) ? 0 : 1;
    columns[c]?.push(g);
    heights[c] = (heights[c] ?? 0) + 1 / (g.ratio || 1);
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col justify-end"
      data-testid="story-gif-picker"
    >
      <button
        type="button"
        aria-label="Close GIFs"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-black/55 backdrop-blur-[3px] duration-200 fade-in"
      />
      <div className="relative flex h-[78%] animate-in flex-col rounded-t-[28px] bg-zinc-900/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-300 slide-in-from-bottom">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 className="text-base font-bold tracking-tight">Add GIF</h2>
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
              placeholder="Search GIFs"
              aria-label="Search GIFs"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X className="h-4 w-4 text-white/60" />
              </button>
            )}
          </div>
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {GIF_SUGGESTIONS.map((c) => {
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

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading && (
            <div className="grid grid-cols-2 gap-2 pt-1" aria-busy="true" aria-label="Loading GIFs">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl bg-white/10"
                  style={{ height: i % 3 === 0 ? 150 : 110 }}
                />
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
              <ImageOff className="h-8 w-8" />
              <p className="text-sm">No GIFs found. Try another word.</p>
            </div>
          )}
          {!loading && !error && results.length > 0 && (
            <div className="grid grid-cols-2 items-start gap-2 pt-1">
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-2">
                  {col.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onPick(g)}
                      aria-label={`Use GIF ${g.title || g.id}`}
                      className="block w-full animate-in overflow-hidden rounded-2xl bg-white/10 duration-300 fade-in transition active:scale-95"
                      style={{ aspectRatio: String(g.ratio || 1) }}
                    >
                      <img
                        src={g.preview}
                        alt={g.title}
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="pb-2 pt-4 text-center text-[11px] font-medium uppercase tracking-wider text-white/35">
            Powered by GIPHY
          </p>
        </div>
      </div>
    </div>
  );
}
