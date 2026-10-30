import { useCallback, useEffect, useRef, useState } from "react";
import { GIF_BASE_W, gifUrl, type StoryGif } from "@/lib/story-gifs";

/**
 * The picture of a photo story, with its GIFs (if any) playing on top. The GIFs are placed with
 * fractions of the picture, so they land exactly where they were put in the editor on any screen.
 * A story without GIFs renders just the plain picture, exactly as before.
 */
export function StoryPhoto({ src, gifs }: { src: string; gifs?: StoryGif[] | undefined }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const hasGifs = !!gifs && gifs.length > 0;

  // where the picture sits inside the viewer (it is centred and shrunk to fit)
  const measure = useCallback(() => {
    const im = imgRef.current;
    if (!im) return;
    setBox({ l: im.offsetLeft, t: im.offsetTop, w: im.offsetWidth, h: im.offsetHeight });
  }, []);

  useEffect(() => {
    if (!hasGifs) return;
    measure();
    const im = imgRef.current;
    if (!im || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(im);
    if (im.parentElement) ro.observe(im.parentElement);
    return () => ro.disconnect();
  }, [hasGifs, measure, src]);

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt=""
        draggable={false}
        onLoad={hasGifs ? measure : undefined}
        className="max-h-full max-w-full object-contain"
      />
      {hasGifs && box && box.w > 0 && (
        <div
          aria-hidden="true"
          data-testid="story-gifs"
          className="pointer-events-none absolute overflow-hidden"
          style={{ left: box.l, top: box.t, width: box.w, height: box.h }}
        >
          {gifs.map((g) => {
            const w = GIF_BASE_W * box.w;
            return (
              <img
                key={`${g.id}-${g.x}-${g.y}`}
                src={gifUrl(g.id)}
                alt=""
                draggable={false}
                className="absolute block select-none rounded-lg"
                style={{
                  left: `${g.x * 100}%`,
                  top: `${g.y * 100}%`,
                  width: w,
                  height: w / (g.ratio || 1),
                  transform: `translate(-50%, -50%) rotate(${g.rot}rad) scale(${g.scale})`,
                }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
