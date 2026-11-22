/**
 * Private chat media.
 *
 * Photos, files and voice notes sent in chats are stored in the `chat-media` and `voice` buckets.
 * Messages keep the plain "public" style URL (it is only a stable address), and the app turns it
 * into a short-lived signed URL when it needs to show it. Once the matching database migration
 * (20261116000000_upload_security.sql) makes those buckets private, only the sender and the people
 * in that conversation can get a signed URL; before it is applied the old URL keeps working, so
 * this code is safe to ship first.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKETS = ["chat-media", "voice"] as const;
type PrivateBucket = (typeof BUCKETS)[number];

/** How long a signed link lives, and how long we keep reusing one (a little less, so it never expires on screen). */
const SIGNED_SECONDS = 60 * 60;
const REUSE_MS = 50 * 60 * 1000;

/** Splits a stored media URL into bucket + object path, or null when it isn't one of the private buckets. */
export function parsePrivateMediaUrl(
  url: string | null | undefined,
): { bucket: PrivateBucket; path: string } | null {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return null;
  for (const bucket of BUCKETS) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const at = url.indexOf(marker);
    if (at === -1) continue;
    let path = url.slice(at + marker.length).split("?")[0] ?? "";
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
    return path ? { bucket, path } : null;
  }
  return null;
}

const cache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string>>();

function cached(url: string): string | undefined {
  const hit = cache.get(url);
  return hit && hit.expires > Date.now() ? hit.url : undefined;
}

/** Signed URL for a stored media URL. Never throws: on any failure it returns the URL it was given. */
export async function resolveMediaUrl(url: string): Promise<string> {
  const target = parsePrivateMediaUrl(url);
  if (!target) return url;
  const hit = cached(url);
  if (hit) return hit;
  const pending = inflight.get(url);
  if (pending) return pending;
  const job = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(target.bucket)
        .createSignedUrl(target.path, SIGNED_SECONDS);
      if (error || !data?.signedUrl) return url;
      cache.set(url, { url: data.signedUrl, expires: Date.now() + REUSE_MS });
      return data.signedUrl;
    } catch {
      return url;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}

/**
 * The URL to put in <img>/<audio>/<a>. Ordinary URLs come back immediately and unchanged; chat
 * media URLs come back as `undefined` for a moment while the signed link is fetched.
 */
export function useResolvedMediaUrl(url: string | null | undefined): string | undefined {
  const [resolved, setResolved] = useState<{ for: string; url: string } | null>(null);
  const target = url ?? "";
  const needsSigning = parsePrivateMediaUrl(target) !== null;

  useEffect(() => {
    if (!needsSigning) return;
    let live = true;
    void resolveMediaUrl(target).then((signed) => {
      if (live) setResolved({ for: target, url: signed });
    });
    return () => {
      live = false;
    };
  }, [target, needsSigning]);

  if (!url) return undefined;
  if (!needsSigning) return url;
  return cached(url) ?? (resolved?.for === url ? resolved.url : undefined);
}

/** Test helper. */
export function clearMediaUrlCache(): void {
  cache.clear();
  inflight.clear();
}
