import { useSyncExternalStore } from "react";

// One sound setting shared by every video in the feed and the Reels viewer.
// Sound is ON by default; it is only off when the person turned it off themselves.
const KEY = "ediraa-videos-muted";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

let muted = read();
const listeners = new Set<() => void>();

export function isFeedMuted(): boolean {
  return muted;
}

/**
 * Change the shared sound setting.
 * `remember: true`  -> the person tapped the speaker icon, so it is saved for next time.
 * `remember: false` -> the browser blocked sound autoplay, so we only mute for now.
 */
export function setFeedMuted(next: boolean, remember = true): void {
  if (next === muted && !remember) return;
  muted = next;
  if (remember) {
    try {
      window.localStorage.setItem(KEY, String(next));
    } catch {
      /* storage unavailable: the setting just won't be remembered */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeedMuted(): boolean {
  return useSyncExternalStore(subscribe, isFeedMuted, () => false);
}
