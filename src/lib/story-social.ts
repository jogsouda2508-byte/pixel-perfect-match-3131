import { supabase } from "@/integrations/supabase/client";
import { sendMessage, startConversation } from "@/lib/chat";

/**
 * Likes and comments on stories. The story_likes / story_comments tables come from
 * migration 20261020000000_story_interactions.sql and are not in the generated
 * Supabase types yet, so this one module talks to them through a loosely typed client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export const MAX_STORY_COMMENT = 300;

export type StoryPerson = {
  full_name: string | null;
  username: string;
  avatar_url: string | null;
};

export type StoryLike = { user_id: string; created_at: string; person: StoryPerson | null };

export type StoryComment = {
  id: string;
  author_id: string;
  content: string;
  created_at: string;
  person: StoryPerson | null;
};

function fail(action: string, error: { message: string }): never {
  console.error(`${action} failed`, error);
  throw new Error(error.message || `${action} failed`);
}

/** The story's author sees every like; anyone else only sees their own (row-level security). */
export async function fetchStoryLikes(storyId: string): Promise<StoryLike[]> {
  const { data, error } = await db
    .from("story_likes")
    .select("user_id, created_at, person:profiles!story_likes_user_id_fkey(full_name, username, avatar_url)")
    .eq("story_id", storyId)
    .order("created_at", { ascending: false });
  if (error) fail("Loading likes", error);
  return (data ?? []) as StoryLike[];
}

export async function setStoryLike(storyId: string, userId: string, like: boolean): Promise<void> {
  const { error } = like
    ? await db
        .from("story_likes")
        .upsert(
          { story_id: storyId, user_id: userId },
          { onConflict: "story_id,user_id", ignoreDuplicates: true },
        )
    : await db.from("story_likes").delete().eq("story_id", storyId).eq("user_id", userId);
  if (error) fail("Updating like", error);
}

export async function fetchStoryComments(storyId: string): Promise<StoryComment[]> {
  const { data, error } = await db
    .from("story_comments")
    .select(
      "id, author_id, content, created_at, person:profiles!story_comments_author_id_fkey(full_name, username, avatar_url)",
    )
    .eq("story_id", storyId)
    .order("created_at", { ascending: true });
  if (error) fail("Loading comments", error);
  return (data ?? []) as StoryComment[];
}

export async function addStoryComment(
  storyId: string,
  authorId: string,
  content: string,
): Promise<void> {
  const text = content.trim();
  if (!text) throw new Error("Write a comment first.");
  if (text.length > MAX_STORY_COMMENT) {
    throw new Error(`Comments can be up to ${MAX_STORY_COMMENT} characters.`);
  }
  const { error } = await db
    .from("story_comments")
    .insert({ story_id: storyId, author_id: authorId, content: text });
  if (error) fail("Posting comment", error);
}

export async function deleteStoryComment(commentId: string): Promise<void> {
  const { error } = await db.from("story_comments").delete().eq("id", commentId);
  if (error) fail("Deleting comment", error);
}

/** A reply is a private message to the story's author, so it shows up in their chat. */
export async function replyToStory(authorId: string, text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error("Write a reply first.");
  const conversationId = await startConversation(authorId);
  await sendMessage(conversationId, `↩️ Replied to your story: ${body}`);
  return conversationId;
}

/** Username autocomplete for @mentions. */
export async function searchUsernames(prefix: string): Promise<(StoryPerson & { id: string })[]> {
  const q = prefix.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .ilike("username", `${q}%`)
    .limit(5);
  if (error) fail("Searching people", error);
  return data ?? [];
}
