import { randomId } from "@/lib/uuid";
import { supabase } from "@/integrations/supabase/client";
import { removeStoryVideoFile } from "@/lib/story-video";
import { videoUsedByHighlight } from "@/lib/highlights";
import type {
  Audience,
  CommentRow,
  FeedRow,
  GroupInviteRow,
  GroupListRow,
  GroupMemberRow,
  LocalityRow,
  NotificationRow,
  PersonRow,
  PostRow,
  Profile,
  ProfileUpdate,
  SavedFeedRow,
  StoryEngagementRow,
  StoryViewerRow,
  TrendingRow,
} from "@/integrations/supabase/types";
import type { PlaceSelection } from "@/lib/places";
import { locationColumns, saveTags, withPostExtras } from "@/lib/post-extras";
import {
  isMissingColumnError,
  isMissingFunctionError,
  isMissingTableError,
} from "@/lib/db-errors";

export type FeedTab = "for_you" | "following" | "local" | "business";
export const FEED_PAGE_SIZE = 10;

/** Database error codes (raised by the group functions) in plain words. */
const FRIENDLY_ERRORS: Record<string, string> = {
  private_group: "This group is private. You need an invitation to join.",
  no_invite: "This invitation was withdrawn.",
  admins_only: "Only the group admin can do that.",
  admin_cannot_leave: "Admins can't leave. Delete the group instead.",
  not_member: "You're not a member of this group.",
  group_not_found: "This group no longer exists.",
};

function fail(action: string, error: { message: string }): never {
  console.error(`${action} failed`, error);
  throw new Error(
    FRIENDLY_ERRORS[error.message] ?? (error.message || `${action} failed`),
  );
}

// ---------------------------------------------------------------- media upload
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return "Please choose a JPG, PNG, WebP or GIF image.";
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
  const path = `${userId}/${folder}/${randomId()}.${ext}`;
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
  /** Local tab only: the locality the person picked (else their profile location is used). */
  location?: string | null;
}): Promise<FeedRow[]> {
  const location = args.tab === "local" ? args.location?.trim() : "";
  const { data, error } = await supabase.rpc("get_feed", {
    p_tab: args.tab,
    p_search: args.search?.trim() ? args.search.trim() : null,
    p_limit: FEED_PAGE_SIZE,
    p_before: args.before ?? null,
    // Only sent when set, so the other tabs keep working on an older database.
    ...(location ? { p_location: location } : {}),
  });
  if (error) fail("Loading the feed", error);
  return withPostExtras(data ?? []);
}

/** Profile locations people use, most common first (for the Local tab's picker). */
export async function fetchLocalities(limit = 20): Promise<LocalityRow[]> {
  const { data, error } = await supabase.rpc("get_localities", {
    p_limit: limit,
  });
  if (error) fail("Loading localities", error);
  return data ?? [];
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
  const image_url = args.image
    ? await uploadImage(args.authorId, "posts", args.image)
    : null;
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
export async function setLike(
  postId: string,
  userId: string,
  like: boolean,
): Promise<void> {
  const { error } = like
    ? await supabase
        .from("post_likes")
        .upsert(
          { post_id: postId, user_id: userId },
          { onConflict: "post_id,user_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId);
  if (error) fail("Updating the like", error);
}

// ------------------------------------------------------------------- comments
export type CommentView = CommentRow & {
  author: {
    full_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
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

export async function addComment(
  postId: string,
  authorId: string,
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: authorId, content: content.trim() });
  if (error) fail("Posting the comment", error);
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from("post_comments")
    .delete()
    .eq("id", commentId);
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
export async function sendFollowRequest(
  targetId: string,
): Promise<FollowResult> {
  const { data, error } = await supabase.rpc("send_follow_request", {
    p_target: targetId,
  });
  if (error) fail("Following", error);
  return data === "following" ? "following" : "requested";
}

export async function cancelFollowRequest(targetId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_follow_request", {
    p_target: targetId,
  });
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
    if (error.message.includes("request_not_found"))
      return accept ? "accepted" : "declined";
    fail(accept ? "Accepting the request" : "Declining the request", error);
  }
  return data === "accepted" ? "accepted" : "declined";
}

/** Ids of the private accounts I have asked to follow and am still waiting on. */
export async function fetchMyPendingRequestIds(
  meId: string,
): Promise<string[]> {
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

export async function setFollow(
  meId: string,
  targetId: string,
  follow: boolean,
): Promise<void> {
  const { error } = follow
    ? await supabase
        .from("follows")
        .upsert(
          { follower_id: meId, following_id: targetId },
          { onConflict: "follower_id,following_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("follows")
        .delete()
        .eq("follower_id", meId)
        .eq("following_id", targetId);
  if (error) fail("Updating follow", error);
}

export async function fetchFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number; posts: number }> {
  const [followers, following, posts] = await Promise.all([
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", userId),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", userId),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("author_id", userId),
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
  const { data, error } = await supabase.rpc("get_trending_topics", {
    p_limit: limit,
  });
  if (error) fail("Loading trending topics", error);
  return data ?? [];
}

// -------------------------------------------------------------- notifications
export async function fetchNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase.rpc("get_notifications", {
    p_limit: 50,
  });
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
export type StoryItem = {
  id: string;
  media_type: "image" | "video";
  /** set for image stories */
  image_url: string | null;
  /** set for video stories */
  video_url: string | null;
  /** all segments of one video upload share this id (null for images) */
  upload_id: string | null;
  segment_index: number;
  segment_count: number;
  /** the part of video_url, in seconds, that this story plays */
  segment_start: number;
  segment_end: number | null;
  created_at: string;
  /** optional local flag used by withStoryLiked(); the app reads likes from StoryEngagement */
  liked_by_me?: boolean;
};

export type StoryGroup = {
  authorId: string;
  name: string;
  username: string;
  avatar: string | null;
  items: StoryItem[];
  latest: string;
};

type StoryWithAuthor = {
  id: string;
  author_id: string;
  image_url: string | null;
  media_type: "image" | "video" | null;
  video_url: string | null;
  upload_id: string | null;
  segment_index: number | null;
  segment_count: number | null;
  segment_start: number | null;
  segment_end: number | null;
  created_at: string;
  author: {
    full_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
};

// The story rows are read WITHOUT embedding profiles: if the database ever has more than one
// foreign key between stories and profiles, PostgREST refuses an embed ("more than one
// relationship was found"). Authors are loaded with a second, simple query instead.
const STORY_COLUMNS_FULL =
  "id, author_id, image_url, media_type, video_url, upload_id, segment_index, segment_count, segment_start, segment_end, created_at";
// What exists before the video-story migration: photo stories only.
const STORY_COLUMNS_BASIC = "id, author_id, image_url, created_at";

type StoryAuthor = {
  full_name: string;
  username: string;
  avatar_url: string | null;
};

export async function fetchStories(meId: string): Promise<StoryGroup[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const full = await supabase
    .from("stories")
    .select(STORY_COLUMNS_FULL)
    .gt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .order("segment_index", { ascending: true });

  let rows: unknown = full.data;
  if (full.error) {
    // The video-story columns are missing (migration not run yet): keep photo stories
    // working instead of showing nothing. Any other error is a real failure.
    if (!isMissingColumnError(full.error)) fail("Loading stories", full.error);
    console.warn(
      "Video-story columns are missing; run 20261019000000_story_videos_local_feed.sql in Supabase.",
    );
    const basic = await supabase
      .from("stories")
      .select(STORY_COLUMNS_BASIC)
      .gt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (basic.error) fail("Loading stories", basic.error);
    rows = basic.data;
  }

  const storyRows = (rows ?? []) as Omit<StoryWithAuthor, "author">[];
  const authors = new Map<string, StoryAuthor>();
  const authorIds = [...new Set(storyRows.map((r) => r.author_id))];
  if (authorIds.length > 0) {
    const { data: people, error: peopleError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", authorIds);
    if (peopleError) fail("Loading story authors", peopleError);
    for (const p of (people ?? []) as (StoryAuthor & { id: string })[])
      authors.set(p.id, p);
  }

  const groups = new Map<string, StoryGroup>();
  for (const row of storyRows) {
    const s: StoryWithAuthor = {
      ...row,
      author: authors.get(row.author_id) ?? null,
    };
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
      media_type: s.media_type ?? "image",
      image_url: s.image_url,
      video_url: s.video_url,
      upload_id: s.upload_id,
      segment_index: s.segment_index ?? 0,
      segment_count: s.segment_count ?? 1,
      segment_start: s.segment_start ?? 0,
      segment_end: s.segment_end,
      created_at: s.created_at,
    });
    g.latest = s.created_at;
    groups.set(s.author_id, g);
  }
  // Your own story first, then the newest from the people you follow.
  return [...groups.values()].sort((a, b) =>
    a.authorId === meId
      ? -1
      : b.authorId === meId
        ? 1
        : b.latest.localeCompare(a.latest),
  );
}

export async function createStory(authorId: string, file: File): Promise<void> {
  const image_url = await uploadImage(authorId, "stories", file);
  const { error } = await supabase
    .from("stories")
    .insert({ author_id: authorId, image_url });
  if (error) fail("Creating the story", error);
}

/**
 * Deletes a story. For a video, every segment of the same upload goes together
 * (they share one file), and the file itself is removed afterwards.
 */
export async function deleteStory(
  item: Pick<StoryItem, "id" | "upload_id" | "video_url">,
): Promise<void> {
  const query = supabase.from("stories").delete();
  const { error } = item.upload_id
    ? await query.eq("upload_id", item.upload_id)
    : await query.eq("id", item.id);
  if (error) fail("Deleting the story", error);
  // a highlight may still use this video file: then keep the file
  if (item.video_url && !(await videoUsedByHighlight(item.video_url)))
    await removeStoryVideoFile(item.video_url);
}

// ------------------------------------------------- story viewers + likes
/** The story views/likes SQL (20261020000000_story_single_video_views_likes.sql) hasn't been run. */
function storyViewsMissing(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  return isMissingFunctionError(error) || isMissingTableError(error);
}

export type StoryEngagement = {
  /** how many people viewed it (the real total only when it is my story) */
  views: number;
  /** how many of them liked it (the real total only when it is my story) */
  likes: number;
  /** whether I liked it */
  likedByMe: boolean;
};

export type StoryViewerPerson = {
  userId: string;
  name: string;
  username: string;
  avatar: string | null;
  viewedAt: string;
  liked: boolean;
  likedAt: string | null;
};

/**
 * Remembers that I viewed a story (once per person per story). Never throws: a failure
 * here must not interrupt watching a story. Does nothing on my own story.
 */
export async function recordStoryView(storyId: string): Promise<void> {
  const { error } = await supabase.rpc("record_story_view", {
    p_story_id: storyId,
  });
  if (error) {
    if (storyViewsMissing(error)) {
      console.warn(
        "Story views are not set up; run 20261020000000_story_single_video_views_likes.sql in Supabase.",
      );
    } else {
      console.error("Recording the story view failed", error);
    }
  }
}

/**
 * Likes or unlikes a story as me. Safe to repeat: the database keeps at most one like per
 * person per story, so asking for the same state twice changes nothing (and never notifies
 * the owner twice). Throws when the story can't be liked (expired, hidden, deleted, or mine),
 * so the caller can put the heart back.
 */
export async function setStoryLike(
  storyId: string,
  liked: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc("set_story_like", {
    p_story_id: storyId,
    p_liked: liked,
  });
  if (error) fail("Updating the story like", error);
  // NULL = the database found no story I'm allowed to like
  if (data === null || data === undefined) {
    fail("Updating the story like", {
      message: "This story isn't available any more.",
    });
  }
}

/**
 * Views, likes and "liked by me" for one story. Resolves to null when the database
 * update hasn't been run yet, so the app simply hides the views / like buttons
 * instead of showing an error.
 */
export async function fetchStoryEngagement(
  storyId: string,
): Promise<StoryEngagement | null> {
  const { data, error } = await supabase.rpc("get_story_engagement", {
    p_story_ids: [storyId],
  });
  if (error) {
    if (storyViewsMissing(error)) return null;
    fail("Loading story views", error);
  }
  const row = ((data ?? []) as StoryEngagementRow[])[0];
  return {
    views: Number(row?.view_count ?? 0),
    likes: Number(row?.like_count ?? 0),
    likedByMe: row?.liked_by_me ?? false,
  };
}

/** Who viewed my story, newest first, and who liked it. Only works for my own stories. */
export async function fetchStoryViewers(
  storyId: string,
): Promise<StoryViewerPerson[]> {
  const { data, error } = await supabase.rpc("get_story_viewers", {
    p_story_id: storyId,
  });
  if (error) {
    if (storyViewsMissing(error)) return [];
    fail("Loading story viewers", error);
  }
  return ((data ?? []) as StoryViewerRow[]).map((r) => ({
    userId: r.viewer_id,
    name: r.full_name || r.username,
    username: r.username,
    avatar: r.avatar_url,
    viewedAt: r.viewed_at,
    liked: r.liked,
    likedAt: r.liked_at,
  }));
}

// ------------------------------------------------------------- other profiles
/** Looks a profile up by @username (case-insensitive). Resolves to null when nobody has it. */
export async function fetchProfileByUsername(
  username: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.trim().replace(/^@/, "").toLowerCase())
    .maybeSingle();
  if (error) fail("Loading the profile", error);
  return data ?? null;
}

export async function fetchIsFollowing(
  meId: string,
  targetId: string,
): Promise<boolean> {
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
  const personFk =
    kind === "followers"
      ? "follows_follower_id_fkey"
      : "follows_following_id_fkey";
  const { data, error } = await supabase
    .from("follows")
    .select(
      `created_at, person:profiles!${personFk}(id, full_name, username, avatar_url, account_type)`,
    )
    .eq(filterCol, userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error)
    fail(
      kind === "followers" ? "Loading followers" : "Loading following",
      error,
    );
  return ((data ?? []) as unknown as { person: FollowListPerson | null }[])
    .map((r) => r.person)
    .filter((p): p is FollowListPerson => !!p);
}

export type PostLiker = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

/** Who liked a post, newest like first (up to 200). Row-level security hides likes on posts you can't see. */
export async function fetchPostLikers(postId: string): Promise<PostLiker[]> {
  const { data, error } = await supabase
    .from("post_likes")
    .select("user_id")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail("Loading likes", error);
  const ids = (data ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];
  const { data: people, error: peopleError } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", ids);
  if (peopleError) fail("Loading likes", peopleError);
  const byId = new Map((people ?? []).map((p) => [p.id, p as PostLiker]));
  return ids.map((id) => byId.get(id)).filter((p): p is PostLiker => !!p);
}

// ---------------------------------------------------------------- edit profile
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Uploads to the public `avatars` bucket (<uid>/avatar.<ext>) and returns a cache-busted URL. */
export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error("Please choose a JPG, PNG, WebP or GIF image.");
  if (file.size > MAX_AVATAR_BYTES)
    throw new Error("Image must be 5 MB or smaller.");
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${userId}/avatar.${ext}`; // folder name must equal the user's id (storage policy)
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) fail("Photo upload", error);
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function updateMyProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) fail("Saving your profile", error);
  if (!data)
    throw new Error(
      "Your profile could not be found. Please log out and sign in again.",
    );
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

export async function setSaved(
  userId: string,
  postId: string,
  save: boolean,
): Promise<void> {
  const { error } = save
    ? await supabase
        .from("saved_posts")
        .upsert(
          { user_id: userId, post_id: postId },
          { onConflict: "user_id,post_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("saved_posts")
        .delete()
        .eq("user_id", userId)
        .eq("post_id", postId);
  if (error) fail(save ? "Saving the post" : "Removing the saved post", error);
}

export async function fetchSavedPosts(
  before?: string | null,
): Promise<SavedFeedRow[]> {
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

/** One group as visible to me (null if it doesn't exist or is private and I'm not involved). */
export async function fetchGroup(
  groupId: string,
): Promise<GroupListRow | null> {
  const { data, error } = await supabase.rpc("get_groups", {
    p_query: null,
    p_mine_only: false,
    p_limit: 1,
    p_group: groupId,
  });
  if (error) fail("Loading the group", error);
  return data?.[0] ?? null;
}

/** Creates the group, its chat room and one pending invitation per invitee. */
export async function createGroup(
  name: string,
  description: string,
  isPrivate = false,
  invitees: string[] = [],
): Promise<string> {
  const { data, error } = await supabase.rpc("create_group", {
    p_name: name.trim(),
    p_description: description.trim(),
    p_is_private: isPrivate,
    p_invitees: invitees,
  });
  if (error) fail("Creating the group", error);
  return data as string;
}

/** Join a public group, or leave one. Both go through database functions. */
export async function setGroupMembership(
  groupId: string,
  _userId: string,
  join: boolean,
): Promise<void> {
  const { error } = join
    ? await supabase.rpc("join_group", { p_group: groupId })
    : await supabase.rpc("leave_group", { p_group: groupId });
  if (error) fail(join ? "Joining the group" : "Leaving the group", error);
}

export async function inviteToGroup(
  groupId: string,
  userIds: string[],
): Promise<number> {
  const { data, error } = await supabase.rpc("invite_to_group", {
    p_group: groupId,
    p_users: userIds,
  });
  if (error) fail("Inviting people", error);
  return Number(data ?? 0);
}

export async function respondToGroupInvite(
  groupId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("respond_group_invite", {
    p_group: groupId,
    p_accept: accept,
  });
  if (error)
    fail(
      accept ? "Accepting the invitation" : "Declining the invitation",
      error,
    );
}

export async function removeGroupMember(
  groupId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc("remove_group_member", {
    p_group: groupId,
    p_user: userId,
  });
  if (error) fail("Removing the member", error);
}

export async function fetchMyGroupInvites(): Promise<GroupInviteRow[]> {
  const { data, error } = await supabase.rpc("get_my_group_invites");
  if (error) fail("Loading invitations", error);
  return data ?? [];
}

export async function fetchGroupMembers(
  groupId: string,
): Promise<GroupMemberRow[]> {
  const { data, error } = await supabase.rpc("get_group_members", {
    p_group: groupId,
  });
  if (error) fail("Loading members", error);
  return data ?? [];
}

export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from("groups").delete().eq("id", groupId);
  if (error) fail("Deleting the group", error);
}

// ------------------------------------------------------------ single post
/** One post (image, text or video) with counts, as the viewer's RLS allows. Null if gone/hidden. */
export async function fetchPostById(
  postId: string,
  userId: string,
): Promise<FeedRow | null> {
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
    supabase
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id),
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
