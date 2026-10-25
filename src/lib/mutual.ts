import { supabase } from "@/integrations/supabase/client";
import { fetchFollowingIds } from "@/lib/social";

export type MutualPerson = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
};

/**
 * "Followed by ...": people I follow who also follow this person. `total` is how many there
 * are in all, `people` the first 3 (newest follower first) for the little photos and names.
 */
export async function fetchMutualFollowers(
  meId: string,
  targetId: string,
): Promise<{ total: number; people: MutualPerson[] }> {
  const [mine, theirs] = await Promise.all([
    fetchFollowingIds(meId),
    supabase
      .from("follows")
      .select("follower_id")
      .eq("following_id", targetId)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (theirs.error) throw new Error(theirs.error.message || "Loading followers failed");
  const mineSet = new Set(mine);
  const ids = (theirs.data ?? [])
    .map((r) => r.follower_id)
    .filter((id) => id !== meId && mineSet.has(id));
  if (ids.length === 0) return { total: 0, people: [] };
  const firstIds = ids.slice(0, 3);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", firstIds);
  if (error) throw new Error(error.message || "Loading people failed");
  const byId = new Map((data ?? []).map((p) => [p.id, p as MutualPerson]));
  const people = firstIds.map((id) => byId.get(id)).filter((p): p is MutualPerson => !!p);
  return { total: ids.length, people };
}
