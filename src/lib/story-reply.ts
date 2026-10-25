import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/engage";

// the generated database types don't know the new functions yet
const db = supabase as unknown as SupabaseClient;

/** The six quick reactions under a story (the database allows up to 16 characters each). */
export const STORY_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏"] as const;
export const STORY_REPLY_MAX = 2000;

export type StoryReplyKind = "reply" | "reaction";

/**
 * Sends a text reply or a quick reaction to someone's story. It lands in the normal 1:1 chat
 * with the author (which also sends the push notification). Returns that conversation's id.
 */
export async function sendStoryReply(
  storyId: string,
  body: string,
  kind: StoryReplyKind,
): Promise<string> {
  const { data, error } = await db.rpc("send_story_reply", {
    p_story_id: storyId,
    p_body: body,
    p_kind: kind,
  });
  if (error) {
    if (/not_allowed/.test(error.message ?? "")) {
      throw new Error("Follow this person to reply to their story.");
    }
    throw friendlyError(error, "Couldn't send. Please try again.");
  }
  return data as string;
}
