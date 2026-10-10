import { supabase } from "@/integrations/supabase/client";
import type {
  Audience,
  CommentRow,
  FeedRow,
  NotificationRow,
  PersonRow,
  PostRow,
  TrendingRow,
} from "@/integrations/supabase/types";

export type FeedTab = "for_you" | "following" | "local" | "business";
export const FEED_PAGE_SIZE = 10;

function fail(action: string, error: { message: string }): never {
  console.error(`${action} failed`, error);
  throw new Error(error.message || `${action} failed`);
}

// ---------------------------------------------------------------- media upload
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Please choose a JPG, PNG, WebP or GIF image.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is larger than 10 MB.";
  return null;
}

/** Uploads to the public `media` bucket under <uid>/<folder>/<uuid>.<ext> and returns the public URL. */
async function uploadImage(
  userId: string,
  folder: "posts" | "stories",
  file: File,
): Promise<string> {
  const problem = validateImage(file);
  if (problem) throw new Error(problem);
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) fail("Image upload", error);
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------- posts
export async function fetchFeed(args: {
  tab: FeedTab;
  search?: string;
  before?: string | null;
}): Promise<FeedRow[]> {
  const { data, error } = await supabase.rpc("get_feed", {
    p_tab: args.tab,
    p_search: args.search?.trim() ? args.search.trim() : null,
    p_limit: FEED_PAGE_SIZE,
    p_before: args.before ?? null,
  });
  if (error) fail("Loading the feed", error);
  return data ?? [];
}

export async function createPost(args: {
  authorId: string;
  content: string;
  audience: Audience;
  image: File | null;
}): Promise<void> {
  const image_url = args.image ? await uploadImage(args.authorId, "posts", args.image) : null;
  const { error } = await supabase.from("posts").insert({
    author_id: args.authorId,
    content: args.content,
    audience: args.audience,
    image_url,
  });
  if (error) fail("Creating the post", error);
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) fail("Deleting the post", error);
}

export async function fetchUserPosts(userId: string): Promise<PostRow[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("author_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) fail("Loading your posts", error);
  return data ?? [];
}

// ---------------------------------------------------------------------- likes
export async function setLike(postId: string, userId: string, like: boolean): Promise<void> {
  const { error } = like
    ? await supabase
        .from("post_likes")
        .upsert(
          { post_id: postId, user_id: userId },
          { onConflict: "post_id,user_id", ignoreDuplicates: true },
        )
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) fail("Updating the like", error);
}

// ------------------------------------------------------------------- comments
export type CommentView = CommentRow & {
  author: { full_name: string; username: string; avatar_url: string | null } | null;
};

export async function fetchComments(postId: string): Promise<CommentView[]> {
  const { data, error } = await supabase
    .from("post_comments")
    .select("*, author:profiles(full_name, username, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) fail("Loading comments", error);
  return (data ?? []) as unknown as CommentView[];
}

export async function addComment(postId: string, authorId: string, content: string): Promise<void> {
  const { error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: authorId, content: content.trim() });
  if (error) fail("Posting the comment", error);
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
  if (error) fail("Deleting the comment", error);
}

// -------------------------------------------------------------------- people
export async function fetchPeople(args: {
  query?: string;
  businessOnly?: boolean;
  excludeFollowed?: boolean;
  limit?: number;
}): Promise<PersonRow[]> {
  const { data, error } = await supabase.rpc("get_people", {
    p_query: args.query?.trim() ? args.query.trim() : null,
    p_business_only: args.businessOnly ?? false,
    p_exclude_followed: args.excludeFollowed ?? false,
    p_limit: args.limit ?? 20,
  });
  if (error) fail("Loading people", error);
  return data ?? [];
}

export async function setFollow(meId: string, targetId: string, follow: boolean): Promise<void> {
  const { error } = follow
    ? await supabase
        .from("follows")
        .upsert(
          { follower_id: meId, following_id: targetId },
          { onConflict: "follower_id,following_id", ignoreDuplicates: true },
        )
    : await supabase.from("follows").delete().eq("follower_id", meId).eq("following_id", targetId);
  if (error) fail("Updating follow", error);
}

export async function fetchFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number; posts: number }> {
  const [followers, following, posts] = await Promise.all([
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId),
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    supabase.from("posts").select("*", { count: "exact", head: true }).eq("author_id", userId),
  ]);
  const err = followers.error ?? following.error ?? posts.error;
  if (err) fail("Loading profile stats", err);
  return {
    followers: followers.count ?? 0,
    following: following.count ?? 0,
    posts: posts.count ?? 0,
  };
}

// ------------------------------------------------------------------- trending
export async function fetchTrending(limit = 8): Promise<TrendingRow[]> {
  const { data, error } = await supabase.rpc("get_trending_topics", { p_limit: limit });
  if (error) fail("Loading trending topics", error);
  return data ?? [];
}

// -------------------------------------------------------------- notifications
export async function fetchNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase.rpc("get_notifications", { p_limit: 50 });
  if (error) fail("Loading notifications", error);
  return data ?? [];
}

export async function fetchUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_notification_count");
  if (error) fail("Checking notifications", error);
  return Number(data ?? 0);
}

export async function markNotificationsSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ notifications_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) fail("Marking notifications as read", error);
}

// -------------------------------------------------------------------- stories
export type StoryGroup = {
  authorId: string;
  name: string;
  username: string;
  avatar: string | null;
  items: { id: string; image_url: string; created_at: string }[];
  latest: string;
};

type StoryWithAuthor = {
  id: string;
  author_id: string;
  image_url: string;
  created_at: string;
  author: { full_name: string; username: string; avatar_url: string | null } | null;
};

export async function fetchStories(meId: string): Promise<StoryGroup[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("stories")
    .select(
      "id, author_id, image_url, created_at, author:profiles(full_name, username, avatar_url)",
    )
    .gt("created_at", cutoff)
    .order("created_at", { ascending: true });
  if (error) fail("Loading stories", error);

  const groups = new Map<string, StoryGroup>();
  for (const s of (data ?? []) as unknown as StoryWithAuthor[]) {
    const g = groups.get(s.author_id) ?? {
      authorId: s.author_id,
      name: s.author?.full_name || s.author?.username || "",
      username: s.author?.username ?? "",
      avatar: s.author?.avatar_url ?? null,
      items: [],
      latest: s.created_at,
    };
    g.items.push({ id: s.id, image_url: s.image_url, created_at: s.created_at });
    g.latest = s.created_at;
    groups.set(s.author_id, g);
  }
  // Your own story first, then the newest from the people you follow.
  return [...groups.values()].sort((a, b) =>
    a.authorId === meId ? -1 : b.authorId === meId ? 1 : b.latest.localeCompare(a.latest),
  );
}

export async function createStory(authorId: string, file: File): Promise<void> {
  const image_url = await uploadImage(authorId, "stories", file);
  const { error } = await supabase.from("stories").insert({ author_id: authorId, image_url });
  if (error) fail("Creating the story", error);
}

export async function deleteStory(storyId: string): Promise<void> {
  const { error } = await supabase.from("stories").delete().eq("id", storyId);
  if (error) fail("Deleting the story", error);
}
