import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

// Only one inline video plays at a time: starting one pauses the previous one.
let currentlyPlaying: HTMLVideoElement | null = null;

/**
 * Inline player for video posts in lists (Home feed, Saved, ...).
 * Uses the browser's native controls (play/pause, seek, volume, fullscreen), keeps the
 * poster until playback, pauses when scrolled out of view, and shows a retry state when
 * the file can't be loaded.
 */
export function VideoPlayer({
  src,
  poster,
  label,
}: {
  src: string;
  poster?: string | null;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Pause when less than a quarter of the player is on screen.
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.intersectionRatio < 0.25 && !video.paused) video.pause();
      },
      { threshold: [0, 0.25, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
    // re-run after a failed video is retried, because the <video> element is remounted
  }, [failed]);

  useEffect(() => {
    const video = ref.current;
    return () => {
      if (video && currentlyPlaying === video) currentlyPlaying = null;
    };
  }, [failed]);

  if (failed) {
    return (
      <div
        role="alert"
        className="mt-3 grid min-h-48 place-items-center rounded-xl border border-border bg-elevated/60 p-6 text-center"
      >
        <div className="space-y-3">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">This video can't be played right now.</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              // the <video> remounts, so it reloads the source
            }}
            className="min-h-11 rounded-full border border-primary px-5 text-sm font-semibold text-primary"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onPlay={(event) => {
        const video = event.currentTarget;
        if (currentlyPlaying && currentlyPlaying !== video) currentlyPlaying.pause();
        currentlyPlaying = video;
      }}
      onEnded={(event) => {
        if (currentlyPlaying === event.currentTarget) currentlyPlaying = null;
      }}
      onError={() => setFailed(true)}
      className="mt-3 max-h-[50dvh] w-full rounded-xl bg-black object-contain sm:max-h-[70dvh]"
    />
  );
}
