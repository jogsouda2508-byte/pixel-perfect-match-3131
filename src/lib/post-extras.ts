import { supabase } from "@/integrations/supabase/client";
import type { FeedRow, TaggedPerson } from "@/integrations/supabase/types";
import type { PlaceSelection } from "@/lib/places";

/** Most people one post can tag (the database enforces the same limit). */
export const MAX_TAGGED_PEOPLE = 20;

/** Column values for the `posts` insert. Empty when no location was chosen. */
export function locationColumns(location: PlaceSelection | null | undefined) {
  if (!location) return {};
  return {
    location_place_id: location.placeId,
    location_name: location.name,
    location_address: location.address,
    location_city: location.city,
  };
}

/**
 * Saves the tagged people for a post the caller just created. Permission checks (post owner,
 * account exists, can see the post) happen in the database function, not here.
 * Never throws: the post already exists, so a tagging problem must not look like a failed post.
 * Resolves to true when every requested person was tagged (or there was nothing to save).
 * The database silently skips anyone who may not see the post (e.g. a non-friend on a Friends
 * post), so a smaller saved count than requested also resolves to false and the caller can say so.
 */
export async function saveTags(postId: string, userIds: string[]): Promise<boolean> {
  const unique = [...new Set(userIds)].slice(0, MAX_TAGGED_PEOPLE);
  if (unique.length === 0) return true;
  try {
    const { data, error } = await supabase.rpc("set_post_tags", {
      p_post_id: postId,
      p_user_ids: unique,
    });
    if (error) {
      console.error("Tagging people failed", error);
      return false;
    }
    return typeof data !== "number" || data >= unique.length;
  } catch (error) {
    console.error("Tagging people failed", error);
    return false;
  }
}

type LocationRow = {
  id: string;
  location_place_id: string | null;
  location_name: string | null;
  location_address: string | null;
  location_city: string | null;
};

type TagRow = { post_id: string; person: TaggedPerson | null };

/**
 * Adds each post's location and tagged people to rows that came from a fixed-shape RPC
 * (get_feed, get_saved_posts, ...). Two extra queries per page, both filtered by the same
 * row-level security as the posts themselves. If the location/tag migration has not been run
 * yet, or a query fails, the rows come back unchanged so the feed never breaks.
 */
export async function withPostExtras<T extends FeedRow>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  try {
    const ids = rows.map((row) => row.id);
    const [locations, tags] = await Promise.all([
      supabase
        .from("posts")
        .select("id, location_place_id, location_name, location_address, location_city")
        .in("id", ids),
      supabase
        .from("post_tags")
        .select("post_id, person:profiles!post_tags_tagged_user_id_fkey(id, username, full_name, avatar_url)")
        .in("post_id", ids)
        .order("created_at", { ascending: true }),
    ]);

    const locationById = new Map<string, LocationRow>();
    if (!locations.error) {
      for (const row of (locations.data ?? []) as unknown as LocationRow[]) {
        if (row.location_place_id) locationById.set(row.id, row);
      }
    }

    const peopleByPost = new Map<string, TaggedPerson[]>();
    if (!tags.error) {
      for (const row of (tags.data ?? []) as unknown as TagRow[]) {
        if (!row.person) continue;
        const list = peopleByPost.get(row.post_id) ?? [];
        list.push(row.person);
        peopleByPost.set(row.post_id, list);
      }
    }

    if (locationById.size === 0 && peopleByPost.size === 0) return rows;

    return rows.map((row) => {
      const location = locationById.get(row.id);
      const people = peopleByPost.get(row.id);
      return {
        ...row,
        ...(location
          ? {
              location_place_id: location.location_place_id,
              location_name: location.location_name,
              location_address: location.location_address,
              location_city: location.location_city,
            }
          : {}),
        ...(people ? { tagged_people: people } : {}),
      };
    });
  } catch (error) {
    console.error("Loading post locations and tags failed", error);
    return rows;
  }
}

/** Unique hashtags in a caption, without the "#", in the order they first appear. */
export function extractHashtags(text: string): string[] {
  const found = text.match(/#[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  return [...new Set(found.map((tag) => tag.slice(1)))].slice(0, 30);
}

/** Appends a "#" to the caption (with a space first when needed), capped at `max` characters. */
export function appendHashtagMark(text: string, max: number): string {
  const spaced = text && !text.endsWith(" ") && !text.endsWith("\n") ? `${text} #` : `${text}#`;
  return spaced.slice(0, max);
}
