import type { StoryGroup } from "@/lib/social";

/** Two taps on a story closer together than this count as a double-tap. */
export const DOUBLE_TAP_MS = 300;
/** How long the big heart stays on screen (matches the CSS animation in styles.css). */
export const HEART_ANIMATION_MS = 900;

/** True when `now` is a quick second tap after `previous` (both from Date.now()). */
export function isDoubleTap(
  previous: number | null,
  now: number,
  windowMs: number = DOUBLE_TAP_MS,
): boolean {
  if (previous === null) return false;
  const gap = now - previous;
  return gap >= 0 && gap <= windowMs;
}

/** Pure: returns the story groups with one story's liked flag changed (same object when unchanged). */
export function withStoryLiked(
  groups: StoryGroup[],
  storyId: string,
  liked: boolean,
): StoryGroup[] {
  let changed = false;
  const next = groups.map((group) => {
    if (!group.items.some((item) => item.id === storyId && item.liked_by_me !== liked))
      return group;
    changed = true;
    return {
      ...group,
      items: group.items.map((item) =>
        item.id === storyId ? { ...item, liked_by_me: liked } : item,
      ),
    };
  });
  return changed ? next : groups;
}
