import { supabase } from "@/integrations/supabase/client";
import type { Audience, PostRow, VideoFeedRow } from "@/integrations/supabase/types";

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const VIDEO_PAGE_SIZE = 8;

type VideoFileInfo = Pick<File, "name" | "size" | "type">;

export function validateVideoFile(file: VideoFileInfo): string | null {
  const supportedTypes: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const extension = file.name.split(".").pop()?.toLowerCase();
  const validType = file.type
    ? Object.prototype.hasOwnProperty.call(supportedTypes, file.type)
    : ["mp4", "webm", "mov"].includes(extension ?? "");
  if (!validType) return "Choose an MP4, WebM, or MOV video.";
  if (file.size > MAX_VIDEO_BYTES) return "Videos must be 50 MB or smaller.";
  if (file.size <= 0) return "The selected video is empty.";
  return null;
}

export function validateVideoDuration(durationSeconds: number): string | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return "Couldn't read this video's duration.";
  if (durationSeconds > MAX_VIDEO_SECONDS) return "Videos must be 60 seconds or shorter.";
  return null;
}

export async function createVideoThumbnail(video: HTMLVideoElement): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Couldn't create a thumbnail for this video.");

  const previousTime = video.currentTime;
  const thumbnailTime = Math.min(1, Math.max(0, video.duration / 2));
  if (Math.abs(previousTime - thumbnailTime) > 0.05) {
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Couldn't read a frame from this video."));
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = thumbnailTime;
    });
    video.currentTime = previousTime;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 720);
  canvas.height = Math.round((canvas.width / width) * height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't create a thumbnail for this video.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Couldn't create a thumbnail for this video."));
    }, "image/jpeg", 0.82);
  });
  return new File([blob], "thumbnail.jpg", { type: "image/jpeg" });
}

function storageError(action: string, error: unknown): never {
  console.error(`${action} failed`, error);
  throw new Error(`Couldn't ${action}. Please try again.`);
}

function storagePathFromPublicUrl(url: string, bucket: "videos" | "media"): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const path = new URL(url).pathname;
  const index = path.indexOf(marker);
  if (index < 0) return null;
  return path
    .slice(index + marker.length)
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

type UploadResult = { path: string; publicUrl: string };

function uploadVideoFile(
  file: File,
  userId: string,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const config = import.meta.env;
    const projectUrl = config["VITE_SUPABASE_URL"] as string | undefined;
    const publishableKey = config["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
    if (!projectUrl || !publishableKey) {
      reject(new Error("Video uploads are unavailable because Supabase is not configured."));
      return;
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        reject(new Error("Please sign in again before uploading a video."));
        return;
      }

      const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();

      if (signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      signal.addEventListener("abort", abort, { once: true });

      xhr.open("POST", `${projectUrl.replace(/\/$/, "")}/storage/v1/object/videos/${encodedPath}`);
      xhr.setRequestHeader("apikey", publishableKey);
      xhr.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("Cache-Control", "31536000");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("Video upload failed. Check your connection and try again."));
      };
      xhr.onabort = () => {
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Upload cancelled", "AbortError"));
      };
      xhr.onload = () => {
        signal.removeEventListener("abort", abort);
        if (xhr.status < 200 || xhr.status >= 300) {
          console.error("Video upload failed", xhr.status, xhr.responseText);
          reject(new Error("Video upload failed. Check the file and try again."));
          return;
        }
        onProgress(100);
        resolve({
          path,
          publicUrl: `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/videos/${encodedPath}`,
        });
      };
      xhr.send(file);
    }).catch((error: unknown) => {
      console.error("Video upload authentication failed", error);
      reject(new Error("Couldn't prepare the video upload. Please try again."));
    });
  });
}

export async function uploadVideoPost(args: {
  authorId: string;
  caption: string;
  audience: Audience;
  file: File;
  thumbnail: File;
  durationSeconds: number;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}): Promise<PostRow> {
  const fileProblem = validateVideoFile(args.file);
  if (fileProblem) throw new Error(fileProblem);
  const durationProblem = validateVideoDuration(args.durationSeconds);
  if (durationProblem) throw new Error(durationProblem);

  let videoPath: string | null = null;
  let thumbnailPath: string | null = null;
  try {
    const uploadedVideo = await uploadVideoFile(
      args.file,
      args.authorId,
      args.signal,
      (progress) => args.onProgress(Math.round(progress * 0.9)),
    );
    videoPath = uploadedVideo.path;
    if (args.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

    const thumbnailKey = `${args.authorId}/videos/${crypto.randomUUID()}.jpg`;
    const { error: thumbnailError } = await supabase.storage
      .from("media")
      .upload(thumbnailKey, args.thumbnail, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
    if (thumbnailError) storageError("upload the video thumbnail", thumbnailError);
    thumbnailPath = thumbnailKey;
    const thumbnailUrl = supabase.storage.from("media").getPublicUrl(thumbnailKey).data.publicUrl;
    if (args.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert({
        author_id: args.authorId,
        content: args.caption.trim(),
        image_url: null,
        audience: args.audience,
        media_type: "video",
        video_url: uploadedVideo.publicUrl,
        thumbnail_url: thumbnailUrl,
        duration_seconds: args.durationSeconds,
      })
      .select("*")
      .single();
    if (postError) storageError("publish the video", postError);
    args.onProgress(100);
    return post;
  } catch (error) {
    if (videoPath) {
      const { error: cleanupError } = await supabase.storage.from("videos").remove([videoPath]);
      if (cleanupError) console.error("Failed to clean up an unpublished video", cleanupError);
    }
    if (thumbnailPath) {
      const { error: cleanupError } = await supabase.storage.from("media").remove([thumbnailPath]);
      if (cleanupError) console.error("Failed to clean up an unpublished thumbnail", cleanupError);
    }
    throw error;
  }
}

export async function fetchVideoFeed(offset: number): Promise<VideoFeedRow[]> {
  const { data, error } = await supabase.rpc("get_video_feed", {
    p_limit: VIDEO_PAGE_SIZE,
    p_offset: offset,
  });
  if (error) storageError("load videos", error);
  return data ?? [];
}

export async function fetchVideoById(videoId: string, userId: string): Promise<VideoFeedRow | null> {
  const { data: post, error } = await supabase
    .from("posts")
    .select("*")
    .eq("id", videoId)
    .eq("media_type", "video")
    .maybeSingle();
  if (error) storageError("load this video", error);
  if (!post?.video_url) return null;

  const [author, likes, comments, liked, follows] = await Promise.all([
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
    // Just "do I follow this author?" -- a head count, not every follower row.
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", post.author_id)
      .eq("follower_id", userId),
  ]);
  const errorResult =
    author.error ?? likes.error ?? comments.error ?? liked.error ?? follows.error;
  if (errorResult) storageError("load this video", errorResult);
  if (!author.data) return null;

  return {
    ...post,
    // the query filters on media_type = 'video' and rejects rows without a video_url above
    media_type: "video",
    video_url: post.video_url,
    duration_seconds: post.duration_seconds ?? 0,
    author_name: author.data.full_name,
    author_username: author.data.username,
    author_avatar: author.data.avatar_url,
    author_account_type: author.data.account_type,
    like_count: likes.count ?? 0,
    comment_count: comments.count ?? 0,
    liked_by_me: !!liked.data,
    is_following: (follows.count ?? 0) > 0,
  };
}

export async function fetchUserVideos(userId: string): Promise<PostRow[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("author_id", userId)
    .eq("media_type", "video")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) storageError("load profile videos", error);
  return data ?? [];
}

export async function deleteVideoPost(
  post: Pick<VideoFeedRow, "id" | "video_url" | "thumbnail_url">,
): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", post.id);
  if (error) storageError("delete this video", error);

  const videoPath = post.video_url ? storagePathFromPublicUrl(post.video_url, "videos") : null;
  const thumbnailPath = post.thumbnail_url
    ? storagePathFromPublicUrl(post.thumbnail_url, "media")
    : null;
  if (videoPath) {
    const { error: videoError } = await supabase.storage.from("videos").remove([videoPath]);
    if (videoError) storageError("remove the video file", videoError);
  }
  if (thumbnailPath) {
    const { error: thumbnailError } = await supabase.storage.from("media").remove([thumbnailPath]);
    if (thumbnailError) storageError("remove the video thumbnail", thumbnailError);
  }
}

export function truncateCaption(text: string, maxLength = 120): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: `${text.slice(0, maxLength).trimEnd()}…`, truncated: true };
}
