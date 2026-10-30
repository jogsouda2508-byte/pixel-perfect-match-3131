import { useEffect, useRef } from "react";

/**
 * Plays the song attached to a photo story while it is on screen. It renders nothing.
 * It pauses together with the story (press and hold, replying, the viewers list) and stops
 * when the story changes or closes. If the browser refuses to start sound by itself, it says so
 * through onBlocked and the speaker button in the story header starts it (retry changes).
 */
export function StoryMusicPlayer({
  url,
  paused,
  muted,
  retry,
  onBlocked,
}: {
  url: string;
  paused: boolean;
  muted: boolean;
  /** changes each time the person taps "play the song" */
  retry: number;
  onBlocked: (blocked: boolean) => void;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 0.9;
    ref.current = audio;
    return () => {
      audio.pause();
      ref.current = null;
      blockedRef.current(false);
    };
  }, [url]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.muted = muted;
    if (paused) {
      audio.pause();
      return;
    }
    // some browsers (and tests) return nothing from play()
    const started = audio.play?.() as Promise<void> | undefined;
    started?.then?.(() => blockedRef.current(false)).catch?.(() => blockedRef.current(true));
  }, [url, paused, muted, retry]);

  return null;
}
