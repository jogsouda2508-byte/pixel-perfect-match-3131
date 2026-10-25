import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const shareCountKey = (postId: string) => ["post-share-count", postId] as const;

/** How many times a post was sent to someone. 0 if the database has no counter yet. */
export async function fetchPostShareCount(postId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_post_share_count", { p_post_id: postId });
    if (error) return 0;
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function useShareCount(postId: string): number {
  const query = useQuery({
    queryKey: shareCountKey(postId),
    queryFn: () => fetchPostShareCount(postId),
    staleTime: 60_000,
    retry: false,
  });
  return query.data ?? 0;
}
