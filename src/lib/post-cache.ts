import type { QueryClient } from "@tanstack/react-query";
import type { FeedRow } from "@/integrations/supabase/types";
import { setLike } from "@/lib/social";

export type PostPatch = Partial<Pick<FeedRow, "liked_by_me" | "like_count" | "comment_count">>;

// Every cached list/detail that can show the same post. A like made on one screen must be
// visible on the others without waiting for a refetch.
const POST_QUERY_KEYS = [["feed"], ["video-feed"], ["saved-posts"], ["video-by-id"]] as const;

function isPost(value: unknown, postId: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && (value as { id?: unknown }).id === postId;
}

/** Pure: returns `data` with the matching post patched (infinite-query pages or a single row). */
export function patchPostData(data: unknown, postId: string, patch: PostPatch): unknown {
  if (typeof data !== "object" || data === null) return data;
  const pages = (data as { pages?: unknown }).pages;
  if (Array.isArray(pages)) {
    let changed = false;
    const nextPages = pages.map((page: unknown) => {
      if (!Array.isArray(page) || !page.some((row: unknown) => isPost(row, postId))) return page;
      changed = true;
      return page.map((row: unknown) => (isPost(row, postId) ? { ...row, ...patch } : row));
    });
    return changed ? { ...(data as object), pages: nextPages } : data;
  }
  return isPost(data, postId) ? { ...data, ...patch } : data;
}

export function patchPostInCaches(qc: QueryClient, postId: string, patch: PostPatch): void {
  for (const queryKey of POST_QUERY_KEYS) {
    qc.setQueriesData({ queryKey }, (old: unknown) => patchPostData(old, postId, patch));
  }
}

/**
 * Like / unlike with an optimistic update of every cache, then the database write.
 * If the write fails the caches are restored and the error is re-thrown for the caller to report.
 */
export async function togglePostLike(
  qc: QueryClient,
  userId: string,
  post: { id: string; liked_by_me: boolean; like_count: number },
  like: boolean,
): Promise<void> {
  const previous: PostPatch = { liked_by_me: post.liked_by_me, like_count: post.like_count };
  patchPostInCaches(qc, post.id, {
    liked_by_me: like,
    like_count: Math.max(0, post.like_count + (like ? 1 : -1)),
  });
  try {
    await setLike(post.id, userId, like);
  } catch (error) {
    patchPostInCaches(qc, post.id, previous);
    throw error;
  }
}
