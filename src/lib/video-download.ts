/**
 * Direct download of the original video file.
 *
 * The "videos" bucket is public, so the stored URL points at the real file. We fetch it
 * as a Blob and save it under a readable name. If the browser blocks that fetch (CORS,
 * offline, expired link) we fall back to Supabase's `?download=` URL, which makes the
 * storage server answer with Content-Disposition: attachment. Only the public/anon
 * client is involved here: no service-role key is ever used in the browser.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const KNOWN_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

export class VideoDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoDownloadError";
  }
}

/** Picks the real extension from the URL path, then the MIME type, and defaults to mp4. */
export function videoExtension(url: string, mimeType?: string | null): string {
  try {
    const last = new URL(url, "https://placeholder.invalid").pathname.split("/").pop() ?? "";
    const ext = last.includes(".") ? last.split(".").pop()?.toLowerCase() : undefined;
    if (ext && KNOWN_EXTENSIONS.has(ext)) return ext;
  } catch {
    // fall through to the MIME type
  }
  const base = mimeType?.split(";")[0]?.trim().toLowerCase();
  return (base && MIME_EXTENSIONS[base]) || "mp4";
}

/** e.g. gicco-chat-video-3f2a….mp4 */
export function videoFilename(videoId: string, url: string, mimeType?: string | null): string {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `gicco-chat-video-${safeId || "download"}.${videoExtension(url, mimeType)}`;
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a moment to start the save before releasing the blob
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

/** Supabase public URLs accept ?download=<name> to force a Content-Disposition: attachment. */
export function forcedDownloadUrl(url: string, filename: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("download", filename);
  return parsed.toString();
}

function friendlyError(status: number): string {
  if (status === 401 || status === 403)
    return "You don't have permission to download this video, or the link has expired.";
  if (status === 404) return "This video is no longer available.";
  return "Couldn't download this video. Please try again.";
}

/**
 * Resolves once the browser has been handed the file. Throws VideoDownloadError with a
 * message that is safe to show to the person when it cannot be downloaded.
 */
export async function downloadVideo(
  video: { id: string; video_url: string | null },
  signal?: AbortSignal,
): Promise<string> {
  if (!video.video_url) throw new VideoDownloadError("This video is no longer available.");
  const url = video.video_url;
  const fallbackName = videoFilename(video.id, url);

  try {
    const response = await fetch(url, { signal: signal ?? null });
    if (!response.ok) throw new VideoDownloadError(friendlyError(response.status));
    const blob = await response.blob();
    if (blob.size === 0) throw new VideoDownloadError("The downloaded video was empty.");
    const filename = videoFilename(
      video.id,
      url,
      blob.type || response.headers.get("content-type"),
    );
    saveBlob(blob, filename);
    return filename;
  } catch (error) {
    if (error instanceof VideoDownloadError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Network/CORS failure: let the storage server send the file as an attachment instead.
    // We cannot observe the result of a plain navigation, so only use this when fetch failed
    // for a reason other than a definite HTTP error above.
    try {
      const link = document.createElement("a");
      link.href = forcedDownloadUrl(url, fallbackName);
      link.download = fallbackName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return fallbackName;
    } catch {
      throw new VideoDownloadError(
        "Couldn't download this video. Check your connection and try again.",
      );
    }
  }
}
