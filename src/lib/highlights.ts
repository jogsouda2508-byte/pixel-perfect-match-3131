import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTableError } from "@/lib/db-errors";
import type { StoryItem } from "@/lib/social";

/**
 * Story highlights. The tables come from supabase/migrations/20261027000000_story_highlights.sql.
 * Until that SQL is run everything here quietly returns "no highlights", so the app keeps working.
 */
// the generated database types don't know the highlight tables yet
const db = supabase as unknown as SupabaseClient;

export type HighlightItem = {
  id: string;
  media_type: "image" | "video";
  image_url: string | null;
  video_url: string | null;
  segment_start: number;
  segment_end: number | null;
};

export type Highlight = {
  id: string;
  title: string;
  createdAt: string;
  items: HighlightItem[];
};

type Row = {
  id: string;
  title: string;
  created_at: string;
  items: (HighlightItem & { position: number })[] | null;
};

export const HIGHLIGHT_TITLE_MAX = 20;

/** Newest first. Highlights with no photos or videos left are skipped. */
export async function fetchHighlights(ownerId: string): Promise<Highlight[]> {
  const { data, error } = await db
    .from("story_highlights")
    .select(
      "id, title, created_at, items:story_highlight_items(id, media_type, image_url, video_url, segment_start, segment_end, position)",
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("Loading highlights failed", error);
    throw new Error(error.message || "Loading highlights failed");
  }
  return ((data ?? []) as unknown as Row[])
    .map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      items: [...(r.items ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          id: i.id,
          media_type: i.media_type,
          image_url: i.image_url,
          video_url: i.video_url,
          segment_start: Number(i.segment_start ?? 0),
          segment_end: i.segment_end === null ? null : Number(i.segment_end),
        })),
    }))
    .filter((h) => h.items.length > 0);
}

/** Saves the chosen stories (in the order given) as a new highlight. */
export async function createHighlight(
  ownerId: string,
  title: string,
  stories: StoryItem[],
): Promise<void> {
  const clean = title.trim().slice(0, HIGHLIGHT_TITLE_MAX) || "Highlights";
  if (stories.length === 0) throw new Error("Choose at least one story.");
  const { data, error } = await db
    .from("story_highlights")
    .insert({ owner_id: ownerId, title: clean })
    .select("id")
    .single();
  if (error || !data) {
    if (error && isMissingTableError(error))
      throw new Error("Highlights aren't set up yet. Run the highlights SQL in Supabase first.");
    throw new Error(error?.message || "Couldn't create the highlight.");
  }
  const id = (data as { id: string }).id;
  const { error: itemsError } = await db.from("story_highlight_items").insert(
    stories.map((s, position) => ({
      highlight_id: id,
      media_type: s.media_type === "video" && s.video_url ? "video" : "image",
      image_url: s.media_type === "video" && s.video_url ? null : s.image_url,
      video_url: s.media_type === "video" ? s.video_url : null,
      segment_start: s.segment_start ?? 0,
      segment_end: s.segment_end,
      position,
    })),
  );
  if (itemsError) {
    await db.from("story_highlights").delete().eq("id", id);
    throw new Error(itemsError.message || "Couldn't save the stories.");
  }
}

export async function deleteHighlight(id: string): Promise<void> {
  const { error } = await db.from("story_highlights").delete().eq("id", id);
  if (error) throw new Error(error.message || "Couldn't delete the highlight.");
}

/**
 * True if a highlight still uses this video file. Deleting the story must then keep the file,
 * otherwise the highlight would break. Any error counts as "not used".
 */
export async function videoUsedByHighlight(videoUrl: string): Promise<boolean> {
  try {
    const { count, error } = await db
      .from("story_highlight_items")
      .select("id", { count: "exact", head: true })
      .eq("video_url", videoUrl);
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
