import { useSyncExternalStore } from "react";

/**
 * Remembers which stories this device has already watched, so their ring turns grey
 * (like Instagram). Kept in localStorage per signed-in user; no database change needed.
 * Every access is wrapped in try/catch because storage can be blocked or full.
 */
const MAX_REMEMBERED = 500;
const EMPTY: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();
const cache = new Map<string, ReadonlySet<string>>();
const emit = () => listeners.forEach((l) => l());

const keyFor = (userId: string) => `gicco:seen-stories:${userId}`;

function read(userId: string): ReadonlySet<string> {
  if (!userId) return EMPTY;
  const hit = cache.get(userId);
  if (hit) return hit;
  let ids: string[] = [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    ids = [];
  }
  const set = new Set(ids);
  cache.set(userId, set);
  return set;
}

export function markStorySeen(userId: string, storyId: string): void {
  if (!userId || !storyId) return;
  const current = read(userId);
  if (current.has(storyId)) return;
  const next = new Set(current);
  next.add(storyId);
  // keep only the newest ids
  const trimmed = new Set([...next].slice(-MAX_REMEMBERED));
  cache.set(userId, trimmed);
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify([...trimmed]));
  } catch {
    /* storage unavailable: the ring still turns grey for this visit */
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The ids of the stories I have already watched (re-renders when it changes). */
export function useSeenStories(userId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => read(userId),
    () => EMPTY,
  );
}

// ---- which person's story is loading right now (drives the ring animation in the row) ----
let loadingAuthor: string | null = null;

export function setStoryLoadingAuthor(authorId: string | null): void {
  if (loadingAuthor === authorId) return;
  loadingAuthor = authorId;
  emit();
}

/** Only clears the flag if it still belongs to this author (avoids clearing the next person's). */
export function clearStoryLoadingAuthor(authorId: string): void {
  if (loadingAuthor === authorId) setStoryLoadingAuthor(null);
}

export function useLoadingStoryAuthor(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => loadingAuthor,
    () => null,
  );
}
