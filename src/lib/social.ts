import { supabase } from "@/integrations/supabase/client";
import type {
  Audience,
  CommentRow,
  FeedRow,
  GroupListRow,
  NotificationRow,
  PersonRow,
  PostRow,
  Profile,
  ProfileUpdate,
  SavedFeedRow,
  TrendingRow,
} from "@/integrations/supabase/types";
import type { PlaceSelection } from "@/lib/places";
import { locationColumns, saveTags, withPostExtras } from "@/lib/post-extras";

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
  return withPostExtras(data ?? []);
}

export async function createPost(args: {
  authorId: string;
  content: string;
  audience: Audience;
  image: File | null;
  /** Optional place picked in the location picker (never raw device coordinates). */
  location?: PlaceSelection | null | undefined;
  /** Optional ids of the people tagged in this post. */
  taggedUserIds?: string[] | undefined;
}): Promise<{ id: string; tagsFailed: boolean }> {
  const image_url = args.image ? await uploadImage(args.authorId, "posts", args.image) : null;
  const { data, error } = await supabase
    .from("posts")
    .insert({
      author_id: args.authorId,
      content: args.content,
      audience: args.audience,
      image_url,
      ...locationColumns(args.location),
    })
    .select("id")
    .single();
  if (error) fail("Creating the post", error);
  // The post exists now. Tags are saved by a permission-checked database function; if that
  // step fails the post stays published and the caller is told so it can say so.
  const tagsFailed = !(await saveTags(data.id, args.taggedUserIds ?? []));
  return { id: data.id, tagsFailed };
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

/**
 * Posts this person is tagged in. Row-level security on `posts` still applies through the join,
 * so a viewer only ever sees tagged posts they are allowed to see.
 */
export async function fetchTaggedPosts(userId: string): Promise<PostRow[]> {
  const { data, error } = await supabase
    .from("post_tags")
    .select("created_at, post:posts!inner(*)")
    .eq("tagged_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) fail("Loading tagged posts", error);
  return ((data ?? []) as unknown as { post: PostRow | null }[])
    .map((row) => row.post)
    .filter((post): post is PostRow => !!post);
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

/** "following" = now a follower (public account); "requested" = waiting for a private account to accept. */
export type FollowResult = "following" | "requested";

/** Follow a public account, or ask to follow a private one. The database decides which. */
export async function sendFollowRequest(targetId: string): Promise<FollowResult> {
  const { data, error } = await supabase.rpc("send_follow_request", { p_target: targetId });
  if (error) fail("Following", error);
  return data === "following" ? "following" : "requested";
}

export async function cancelFollowRequest(targetId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_follow_request", { p_target: targetId });
  if (error) fail("Cancelling the follow request", error);
}

/**
 * Accept or decline a request somebody sent to me. If it was already answered (for example on
 * another device) the database says "request_not_found"; that counts as done, not as an error.
 */
export async function respondFollowRequest(
  requesterId: string,
  accept: boolean,
): Promise<"accepted" | "declined"> {
  const { data, error } = await supabase.rpc("respond_follow_request", {
    p_requester: requesterId,
    p_accept: accept,
  });
  if (error) {
    if (error.message.includes("request_not_found")) return accept ? "accepted" : "declined";
    fail(accept ? "Accepting the request" : "Declining the request", error);
  }
  return data === "accepted" ? "accepted" : "declined";
}

/** Ids of the private accounts I have asked to follow and am still waiting on. */
export async function fetchMyPendingRequestIds(meId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("follow_requests")
    .select("target_id")
    .eq("requester_id", meId)
    .eq("status", "pending");
  if (error) {
    // The private-accounts migration may not be applied yet: behave as "no requests".
    console.error("Loading follow requests failed", error);
    return [];
  }
  return (data ?? []).map((row) => row.target_id);
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
  // Shared reels/posts show up under Messages, not in the bell.
  return (data ?? []).filter((n) => n.kind !== "share");
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
  items: { id: string; image_url: string; created_at: string; liked_by_me: boolean }[];
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

  const rows = (data ?? []) as unknown as StoryWithAuthor[];
  // Which of these stories I already liked. If the story-likes migration has not been run yet
  // this query fails, and the stories simply show as "not liked" instead of breaking.
  const likedIds = new Set<string>();
  if (meId && rows.length > 0) {
    const { data: likes, error: likesError } = await supabase
      .from("story_likes")
      .select("story_id")
      .eq("user_id", meId)
      .in(
        "story_id",
        rows.map((row) => row.id),
      );
    if (likesError) console.error("Loading story likes failed", likesError);
    for (const like of likes ?? []) likedIds.add(like.story_id);
  }

  const groups = new Map<string, StoryGroup>();
  for (const s of rows) {
    const g = groups.get(s.author_id) ?? {
      authorId: s.author_id,
      name: s.author?.full_name || s.author?.username || "",
      username: s.author?.username ?? "",
      avatar: s.author?.avatar_url ?? null,
      items: [],
      latest: s.created_at,
    };
    g.items.push({
      id: s.id,
      image_url: s.image_url,
      created_at: s.created_at,
      liked_by_me: likedIds.has(s.id),
    });
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

/**
 * Like or unlike a story. The primary key (story_id, user_id) allows only one like per person,
 * so repeating the request is harmless. Who may like (a story they can see) is enforced by
 * row-level security; the story owner's notification is derived from this row by the database.
 */
export async function setStoryLike(storyId: string, userId: string, like: boolean): Promise<void> {
  const { error } = like
    ? await supabase
        .from("story_likes")
        .upsert(
          { story_id: storyId, user_id: userId },
          { onConflict: "story_id,user_id", ignoreDuplicates: true },
        )
    : await supabase.from("story_likes").delete().eq("story_id", storyId).eq("user_id", userId);
  if (error) fail(like ? "Liking the story" : "Removing your story like", error);
}

export async function deleteStory(storyId: string): Promise<void> {
  const { error } = await supabase.from("stories").delete().eq("id", storyId);
  if (error) fail("Deleting the story", error);
}

// ------------------------------------------------------------- other profiles
/** Looks a profile up by @username (case-insensitive). Resolves to null when nobody has it. */
export async function fetchProfileByUsername(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.trim().replace(/^@/, "").toLowerCase())
    .maybeSingle();
  if (error) fail("Loading the profile", error);
  return data ?? null;
}

export async function fetchIsFollowing(meId: string, targetId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", meId)
    .eq("following_id", targetId);
  if (error) fail("Checking follow status", error);
  return (count ?? 0) > 0;
}

export async function fetchFollowingIds(meId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", meId)
    .limit(1000);
  if (error) fail("Loading who you follow", error);
  return (data ?? []).map((r) => r.following_id);
}

export type FollowListPerson = Pick<
  Profile,
  "id" | "full_name" | "username" | "avatar_url" | "account_type"
>;

/** The people who follow `userId` ("followers") or whom `userId` follows ("following"). */
export async function fetchFollowList(
  userId: string,
  kind: "followers" | "following",
): Promise<FollowListPerson[]> {
  // followers: rows where following_id = user, show the follower; following: the reverse.
  const filterCol = kind === "followers" ? "following_id" : "follower_id";
  const personFk = kind === "followers" ? "follows_follower_id_fkey" : "follows_following_id_fkey";
  const { data, error } = await supabase
    .from("follows")
    .select(
      `created_at, person:profiles!${personFk}(id, full_name, username, avatar_url, account_type)`,
    )
    .eq(filterCol, userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(kind === "followers" ? "Loading followers" : "Loading following", error);
  return ((data ?? []) as unknown as { person: FollowListPerson | null }[])
    .map((r) => r.person)
    .filter((p): p is FollowListPerson => !!p);
}

// ---------------------------------------------------------------- edit profile
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Uploads to the public `avatars` bucket (<uid>/avatar.<ext>) and returns a cache-busted URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error("Please choose a JPG, PNG, WebP or GIF image.");
  if (file.size > MAX_AVATAR_BYTES) throw new Error("Image must be 5 MB or smaller.");
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${userId}/avatar.${ext}`; // folder name must equal the user's id (storage policy)
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) fail("Photo upload", error);
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function updateMyProfile(userId: string, patch: ProfileUpdate): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) fail("Saving your profile", error);
  if (!data) throw new Error("Your profile could not be found. Please log out and sign in again.");
}

// ---------------------------------------------------------------- saved posts
export async function fetchSavedIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("saved_posts")
    .select("post_id")
    .eq("user_id", userId)
    .limit(2000);
  if (error) fail("Loading saved posts", error);
  return (data ?? []).map((r) => r.post_id);
}

export async function setSaved(userId: string, postId: string, save: boolean): Promise<void> {
  const { error } = save
    ? await supabase
        .from("saved_posts")
        .upsert(
          { user_id: userId, post_id: postId },
          { onConflict: "user_id,post_id", ignoreDuplicates: true },
        )
    : await supabase.from("saved_posts").delete().eq("user_id", userId).eq("post_id", postId);
  if (error) fail(save ? "Saving the post" : "Removing the saved post", error);
}

export async function fetchSavedPosts(before?: string | null): Promise<SavedFeedRow[]> {
  const { data, error } = await supabase.rpc("get_saved_posts", {
    p_limit: FEED_PAGE_SIZE,
    p_before: before ?? null,
  });
  if (error) fail("Loading saved posts", error);
  return withPostExtras(data ?? []);
}

// --------------------------------------------------------------------- groups
export async function fetchGroups(args: {
  query?: string;
  mineOnly?: boolean;
  limit?: number;
}): Promise<GroupListRow[]> {
  const { data, error } = await supabase.rpc("get_groups", {
    p_query: args.query?.trim() ? args.query.trim() : null,
    p_mine_only: args.mineOnly ?? false,
    p_limit: args.limit ?? 30,
  });
  if (error) fail("Loading groups", error);
  return data ?? [];
}

export async function createGroup(name: string, description: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_group", {
    p_name: name.trim(),
    p_description: description.trim(),
  });
  if (error) fail("Creating the group", error);
  return data as string;
}

export async function setGroupMembership(
  groupId: string,
  userId: string,
  join: boolean,
): Promise<void> {
  const { error } = join
    ? await supabase
        .from("group_members")
        .upsert(
          { group_id: groupId, user_id: userId },
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        )
    : await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) fail(join ? "Joining the group" : "Leaving the group", error);
}

export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from("groups").delete().eq("id", groupId);
  if (error) fail("Deleting the group", error);
}

// ------------------------------------------------------------ single post
/** One post (image, text or video) with counts, as the viewer's RLS allows. Null if gone/hidden. */
export async function fetchPostById(postId: string, userId: string): Promise<FeedRow | null> {
  const { data: post, error } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();
  if (error) fail("Loading this post", error);
  if (!post) return null;

  const [author, likes, comments, liked] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, username, avatar_url, account_type")
      .eq("id", post.author_id)
      .maybeSingle(),
    supabase.from("post_likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
    supabase
      .from("post_comments")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id),
    supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", post.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const failed = author.error ?? likes.error ?? comments.error ?? liked.error;
  if (failed) fail("Loading this post", failed);
  if (!author.data) return null;

  const row: FeedRow = {
    ...post,
    media_type: post.media_type ?? "image",
    author_name: author.data.full_name,
    author_username: author.data.username,
    author_avatar: author.data.avatar_url,
    author_account_type: author.data.account_type,
    like_count: likes.count ?? 0,
    comment_count: comments.count ?? 0,
    liked_by_me: !!liked.data,
  };
  const [withExtras] = await withPostExtras([row]);
  return withExtras ?? row;
}
