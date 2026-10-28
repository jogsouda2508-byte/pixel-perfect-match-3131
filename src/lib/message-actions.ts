import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunctionError } from "@/lib/db-errors";
import type { MessageRow } from "@/integrations/supabase/types";

// the generated database types don't know these functions yet
const db = supabase as unknown as SupabaseClient;

const MIGRATION_HINT =
  "Editing and deleting messages needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261029000000_edit_delete_messages.sql, then try again.";

const FRIENDLY: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "You can only change your own messages.",
  not_editable: "Only text messages can be edited.",
  invalid_message: "A message must be between 1 and 2000 characters.",
};

type DbError = { code?: string | null; message?: string | null } | null | undefined;

function toError(error: DbError, fallback: string): Error {
  if (isMissingFunctionError(error)) return new Error(MIGRATION_HINT);
  const text = error?.message ?? "";
  const key = Object.keys(FRIENDLY).find((k) => text.includes(k));
  return new Error(key ? FRIENDLY[key]! : fallback);
}

/** Only plain text can be edited; voice, shared posts and story replies can only be deleted. */
export function isEditable(message: MessageRow): boolean {
  return (
    !message.audio_url &&
    !message.shared_post_id &&
    !message.story_kind &&
    !message.image_url &&
    !message.file_url
  );
}

export async function editMessage(messageId: string, body: string): Promise<MessageRow> {
  const { data, error } = await db.rpc("edit_message", { p_message: messageId, p_body: body });
  if (error) {
    console.error("Editing a message failed", error);
    throw toError(error, "Couldn't edit your message. Please try again.");
  }
  return data as MessageRow;
}

const VOICE_PATH = "/storage/v1/object/public/voice/";
const MEDIA_PATH = "/storage/v1/object/public/chat-media/";

function storagePath(url: string | null | undefined, marker: string): string | null {
  const at = (url ?? "").indexOf(marker);
  if (at === -1) return null;
  const path = decodeURIComponent((url ?? "").slice(at + marker.length).split("?")[0] ?? "");
  return path || null;
}

/** Deletes the message for everyone in the chat (and a voice message's audio file). */
export async function deleteMessage(
  message: Pick<MessageRow, "id" | "audio_url"> &
    Partial<Pick<MessageRow, "image_url" | "file_url">>,
): Promise<void> {
  const { error } = await db.rpc("delete_message", { p_message: message.id });
  if (error) {
    console.error("Deleting a message failed", error);
    throw toError(error, "Couldn't delete your message. Please try again.");
  }
  // best effort: the message is already gone, a leftover file is harmless
  const voicePath = storagePath(message.audio_url, VOICE_PATH);
  if (voicePath) void supabase.storage.from("voice").remove([voicePath]);
  const mediaPaths = [message.image_url, message.file_url].flatMap((u) => {
    const p = storagePath(u, MEDIA_PATH);
    return p ? [p] : [];
  });
  if (mediaPaths.length) void supabase.storage.from("chat-media").remove(mediaPaths);
}

/**
 * Keeps the cached chat history in step with a delete / edit, so a deleted message can't
 * come back when the chat is opened again and an edited one doesn't show its old text.
 */
export function patchCachedMessages(
  queryClient: QueryClient,
  change: { type: "delete"; id: string } | { type: "update"; row: MessageRow },
): void {
  queryClient.setQueriesData<MessageRow[]>({ queryKey: ["chat-messages"] }, (old) => {
    if (!Array.isArray(old)) return old;
    if (change.type === "delete") return old.filter((m) => m.id !== change.id);
    return old.map((m) => (m.id === change.row.id ? { ...m, ...change.row } : m));
  });
}
