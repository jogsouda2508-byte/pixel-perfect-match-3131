import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunctionError } from "@/lib/db-errors";
import type { MessageReactionRow, MessageRow } from "@/integrations/supabase/types";

// the generated database types don't know these functions / tables yet
const db = supabase as unknown as SupabaseClient;

const MIGRATION_HINT =
  "Replies, reactions, photos and files need a one-time database update. In Supabase open " +
  "SQL Editor, run supabase/migrations/20261030000000_chat_whatsapp.sql, then try again.";

const FRIENDLY: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "You can't do that in this chat.",
  invalid_reply: "The message you're replying to is no longer available.",
  invalid_media: "That file couldn't be attached.",
  invalid_message: "A message must be between 1 and 2000 characters.",
};

type DbError = { code?: string | null; message?: string | null } | null | undefined;

function toError(error: DbError, fallback: string): Error {
  if (isMissingFunctionError(error)) return new Error(MIGRATION_HINT);
  const text = error?.message ?? "";
  if (/bucket not found/i.test(text)) return new Error(MIGRATION_HINT);
  const key = Object.keys(FRIENDLY).find((k) => text.includes(k));
  return new Error(key ? FRIENDLY[key]! : fallback);
}

/* ------------------------------------------------------------------ */
/* Quick reactions                                                     */
/* ------------------------------------------------------------------ */

/** The six reactions WhatsApp offers first. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export const HEART = "❤️";

export type ReactionGroup = { emoji: string; count: number; mine: boolean };

/** Groups a message's reactions by emoji, most used first. */
export function groupReactions(
  list: MessageReactionRow[],
  me: string | undefined,
): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of list) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.user_id === me) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function getReactions(conversationId: string): Promise<MessageReactionRow[]> {
  const { data, error } = await db
    .from("message_reactions")
    .select("*")
    .eq("conversation_id", conversationId);
  if (error) {
    // the table doesn't exist until the migration is run: chat must keep working without it
    console.error("Loading reactions failed", error);
    return [];
  }
  return (data ?? []) as MessageReactionRow[];
}

/** `emoji = null` removes my reaction. */
export async function reactToMessage(messageId: string, emoji: string | null): Promise<void> {
  const { error } = await db.rpc("react_to_message", { p_message: messageId, p_emoji: emoji });
  if (error) {
    console.error("Reacting failed", error);
    throw toError(error, "Couldn't react to that message.");
  }
}

/** Adds / replaces / removes my reaction in a list (used for instant, optimistic updates). */
export function applyReaction(
  list: MessageReactionRow[],
  change: { messageId: string; conversationId: string; userId: string; emoji: string | null },
): MessageReactionRow[] {
  const rest = list.filter(
    (r) => !(r.message_id === change.messageId && r.user_id === change.userId),
  );
  if (!change.emoji) return rest;
  return [
    ...rest,
    {
      message_id: change.messageId,
      conversation_id: change.conversationId,
      user_id: change.userId,
      emoji: change.emoji,
      created_at: new Date().toISOString(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Sending: replies, photos, files                                     */
/* ------------------------------------------------------------------ */

export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1600;

export type PreparedImage = { blob: Blob; width: number; height: number; ext: string };

/** Shrinks big camera photos so they upload fast; small images and GIFs are sent untouched. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const original = async (): Promise<PreparedImage> => {
    const size = await measure(file).catch(() => ({ width: 0, height: 0 }));
    const ext = (file.type.split("/")[1] ?? "jpg")
      .replace("jpeg", "jpg")
      .replace(/[^a-z0-9]/gi, "");
    return { blob: file, ...size, ext: ext || "jpg" };
  };
  if (file.type === "image/gif" || file.type === "image/svg+xml") return original();
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return original();
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return original();
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return original();
    return { blob, width, height, ext: "jpg" };
  } catch {
    return original();
  }
}

function measure(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

async function upload(userId: string, blob: Blob, ext: string, contentType: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${safeExt}`;
  const { error } = await supabase.storage
    .from("chat-media")
    .upload(path, blob, { contentType, cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("Chat media upload failed", error);
    if (/bucket not found/i.test(error.message ?? "")) throw new Error(MIGRATION_HINT);
    throw new Error("Couldn't upload that file. Please try again.");
  }
  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  return { path, url: data.publicUrl };
}

type SendArgs = {
  conversationId: string;
  body?: string;
  replyTo?: string | null;
};

async function callSend(
  args: SendArgs & {
    imageUrl?: string;
    imageW?: number;
    imageH?: number;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
  },
): Promise<MessageRow> {
  const { data, error } = await db.rpc("send_chat_message", {
    p_conversation: args.conversationId,
    p_body: args.body ?? "",
    p_reply_to: args.replyTo ?? null,
    p_image_url: args.imageUrl ?? null,
    p_image_w: args.imageW ?? null,
    p_image_h: args.imageH ?? null,
    p_file_url: args.fileUrl ?? null,
    p_file_name: args.fileName ?? null,
    p_file_size: args.fileSize ?? null,
  });
  if (error) throw toError(error, "Couldn't send your message. Please try again.");
  return data as MessageRow;
}

/** A text message that quotes another message. */
export function sendReply(args: SendArgs & { body: string }): Promise<MessageRow> {
  const body = args.body.trim();
  if (!body || body.length > 2000) {
    return Promise.reject(new Error("Messages must be between 1 and 2000 characters."));
  }
  return callSend({ ...args, body });
}

export async function sendImageMessage(
  args: SendArgs & { userId: string; image: PreparedImage },
): Promise<MessageRow> {
  if (args.image.blob.size > MEDIA_MAX_BYTES) throw new Error("Photos must be 15 MB or smaller.");
  const { path, url } = await upload(
    args.userId,
    args.image.blob,
    args.image.ext,
    args.image.blob.type || "image/jpeg",
  );
  try {
    return await callSend({
      ...args,
      imageUrl: url,
      imageW: args.image.width,
      imageH: args.image.height,
    });
  } catch (error) {
    void supabase.storage.from("chat-media").remove([path]);
    throw error;
  }
}

export async function sendFileMessage(
  args: SendArgs & { userId: string; file: File },
): Promise<MessageRow> {
  if (args.file.size > MEDIA_MAX_BYTES) throw new Error("Files must be 15 MB or smaller.");
  const ext = args.file.name.includes(".") ? (args.file.name.split(".").pop() ?? "bin") : "bin";
  const { path, url } = await upload(
    args.userId,
    args.file,
    ext,
    args.file.type || "application/octet-stream",
  );
  try {
    return await callSend({
      ...args,
      fileUrl: url,
      fileName: args.file.name,
      fileSize: args.file.size,
    });
  } catch (error) {
    void supabase.storage.from("chat-media").remove([path]);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Small display helpers                                               */
/* ------------------------------------------------------------------ */

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What a quoted message looks like in the reply box. */
export function quotePreview(m: MessageRow): string {
  if (m.audio_url) return "🎤 Voice message";
  if (m.image_url) return m.body && m.body !== "📷 Photo" ? m.body : "📷 Photo";
  if (m.file_url) return m.file_name ? `📄 ${m.file_name}` : "📄 Document";
  if (m.shared_post_id) return "🎬 Shared post";
  if (m.story_kind) return m.story_kind === "reaction" ? m.body : `Story reply: ${m.body}`;
  return m.body;
}

/** "Today", "Yesterday", or the date: the little pill between days. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** The caption typed with a photo / document ("" when it only has the automatic label). */
export function mediaCaption(m: Pick<MessageRow, "body" | "image_url" | "file_url">): string {
  if (m.image_url) return m.body === "📷 Photo" ? "" : m.body;
  if (m.file_url) return m.body.startsWith("📄 ") ? "" : m.body;
  return "";
}

/**
 * When the other people in this chat last opened it (the oldest of them, for a group).
 * A message sent before this time has been read by everyone: that is what turns the ticks blue.
 */
export async function getOthersReadAt(conversationId: string, me: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("user_id, last_read_at")
    .eq("conversation_id", conversationId)
    .neq("user_id", me);
  if (error) {
    console.error("Loading read receipts failed", error);
    return null;
  }
  const times = (data ?? []).map((r) => new Date(r.last_read_at).getTime());
  return times.length ? Math.min(...times) : null;
}

/** A steady colour per person, used for names in group chats and on quoted messages. */
export function senderColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 58% 46%)`;
}
