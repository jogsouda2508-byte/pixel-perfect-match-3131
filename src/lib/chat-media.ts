import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Chat photos, files and voice messages live in PRIVATE storage buckets. The database stores an
 * address for each file; this module turns that address into a short-lived signed URL, which
 * Supabase only hands out to people allowed to read the file (the other members of the
 * conversation, and the person who sent it).
 *
 * The stored address is just an identifier: it still has the old ".../object/public/<bucket>/..."
 * shape, so old messages keep working and the app works before AND after the database update.
 */

export type ChatMediaBucket = "chat-media" | "voice";
export type ChatMediaRef = { bucket: ChatMediaBucket; path: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// <uuid>/<file name>: the same shape the database accepts (chat_media_path in the migration).
const PATH = `${UUID}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}`;
const ADDRESS = new RegExp(
  `^https?://[^/?#]+/storage/v1/object/(?:public|sign|authenticated)/(chat-media|voice)/(${PATH})(?:\\?[^#]*)?$`,
);

/** The bucket and path inside a stored address, or null if it is anything else. Strict on purpose. */
export function parseChatMediaRef(value: string | null | undefined): ChatMediaRef | null {
  if (!value || value.length > 1000) return null;
  const m = ADDRESS.exec(value);
  return m ? { bucket: m[1] as ChatMediaBucket, path: m[2]! } : null;
}

/** A picture or recording that only exists on this device (shown while it uploads). */
export function isLocalMediaUrl(value: string | null | undefined): boolean {
  return !!value && /^(blob:|data:(image|audio|video)\/)/i.test(value);
}

// ---------------------------------------------------------------------------------------------
// Signing, with a small cache so scrolling a chat does not ask again for every photo.
// ---------------------------------------------------------------------------------------------

/** How long a signed link works. A link is a key: anyone holding it can open the file until then. */
export const SIGNED_URL_TTL_SECONDS = 3600;
/** A cached link with less than this left is not reused for something newly shown. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

const cache = new Map<string, { url: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();

const keyOf = (ref: ChatMediaRef, download?: string) =>
  `${ref.bucket}/${ref.path}${download ? `#dl=${download}` : ""}`;

/** A link we already have and can still use, without asking the server. */
export function peekSignedUrl(
  ref: ChatMediaRef,
  download?: string,
  now = Date.now(),
): string | null {
  const hit = cache.get(keyOf(ref, download));
  return hit && hit.expiresAt - now > REFRESH_MARGIN_MS ? hit.url : null;
}

/** Forget every link (on sign-out, so the next person on this device starts clean). */
export function clearSignedUrlCache() {
  cache.clear();
  inFlight.clear();
}

/**
 * A signed link for one file. Fails (rejects) when the file is not there or this person may not
 * read it. `download` makes the link save the file under that name instead of opening it inline.
 */
export async function getSignedChatMediaUrl(
  ref: ChatMediaRef,
  opts: { download?: string; force?: boolean } = {},
): Promise<string> {
  const key = keyOf(ref, opts.download);
  if (!opts.force) {
    const hit = peekSignedUrl(ref, opts.download);
    if (hit) return hit;
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const request = (async () => {
    const { data, error } = await supabase.storage
      .from(ref.bucket)
      .createSignedUrl(
        ref.path,
        SIGNED_URL_TTL_SECONDS,
        opts.download ? { download: opts.download } : undefined,
      );
    if (error || !data?.signedUrl) {
      throw new Error("This file isn't available.");
    }
    cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 });
    return data.signedUrl;
  })().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export type ChatMediaState = {
  /** What to put in src / href. Undefined until it is ready. */
  src: string | undefined;
  status: "idle" | "loading" | "ready" | "error";
  /**
   * Gets a fresh link (for when the browser says the old one stopped working). Resolves true if
   * a new link is now in `src`.
   */
  refresh: () => Promise<boolean>;
};

function initialState(value: string | null | undefined, download?: string) {
  if (!value) return { status: "idle" as const, src: undefined };
  if (isLocalMediaUrl(value)) return { status: "ready" as const, src: value };
  const ref = parseChatMediaRef(value);
  if (!ref) return { status: "error" as const, src: undefined };
  const hit = peekSignedUrl(ref, download);
  return hit
    ? { status: "ready" as const, src: hit }
    : { status: "loading" as const, src: undefined };
}

/**
 * Turns a stored chat media address into something a browser can open.
 *  - a local blob:/data: preview is used as is;
 *  - an address that is not one of our chat files is refused (status "error"): the app never loads
 *    arbitrary addresses that came from message data;
 *  - everything else is signed.
 */
export function useChatMediaUrl(
  value: string | null | undefined,
  opts: { download?: string } = {},
): ChatMediaState {
  const download = opts.download;
  const [state, setState] = useState(() => initialState(value, download));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const next = initialState(value, download);
    setState(next);
    if (next.status !== "loading") return;
    const ref = parseChatMediaRef(value)!;
    getSignedChatMediaUrl(ref, download ? { download } : {}).then(
      (src) => {
        if (!cancelled) setState({ status: "ready", src });
      },
      () => {
        if (!cancelled) setState({ status: "error", src: undefined });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value, download]);

  const refresh = useCallback(async () => {
    const ref = parseChatMediaRef(value);
    if (!ref) return false;
    try {
      const src = await getSignedChatMediaUrl(ref, {
        ...(download ? { download } : {}),
        force: true,
      });
      if (alive.current) setState({ status: "ready", src });
      return true;
    } catch {
      if (alive.current) setState({ status: "error", src: undefined });
      return false;
    }
  }, [value, download]);

  return { src: state.src, status: state.status, refresh };
}

// ---------------------------------------------------------------------------------------------
// What may be sent as a file. The storage bucket enforces the same list.
// ---------------------------------------------------------------------------------------------

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  json: "application/json",
  zip: "application/zip",
  rar: "application/vnd.rar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

// Other spellings browsers use for the same things.
const MIME_ALIASES = new Set([
  "text/rtf",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "audio/webm",
]);
const ALLOWED_MIMES = new Set<string>([...Object.values(FILE_TYPES), ...MIME_ALIASES]);

/** The `accept` list for the file picker. */
export const CHAT_FILE_ACCEPT = Object.keys(FILE_TYPES)
  .filter((e) => !["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(e))
  .map((e) => `.${e}`)
  .join(",");

export type ChatFileKind = { ext: string; mime: string };

/**
 * Checks a file the person picked and says how to store it, or null if it is not allowed
 * (SVG, HTML, scripts, programs, installers and anything unknown).
 */
export function resolveChatFile(file: Pick<File, "name" | "type">): ChatFileKind | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const byExt = FILE_TYPES[ext];
  if (!byExt) return null;
  const declared = (file.type || "").toLowerCase();
  // Some systems report nothing, or a generic type, for rar / docx / csv: the extension decides.
  // But a file that SAYS it is something else (e.g. a .png that is really image/svg+xml) is refused.
  if (declared && declared !== "application/octet-stream" && !ALLOWED_MIMES.has(declared))
    return null;
  return { ext, mime: byExt };
}

export const UNSUPPORTED_FILE_MESSAGE =
  "That type of file can't be sent here. You can send photos, videos, audio, PDFs and common documents.";
