import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/engage";
import { inspectAudio } from "@/lib/media-sanitize";
import { isMissingFunctionError } from "@/lib/db-errors";
import type { MessageRow } from "@/integrations/supabase/types";

// the generated database types don't know the voice function yet
const db = supabase as unknown as SupabaseClient;

/** Keeps every file well under the bucket's 5 MB limit on every browser. */
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MIN_SECONDS = 1;
/** The voice bucket refuses anything bigger than this. */
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;

const VOICE_MIGRATION_HINT =
  "Voice messages need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261028000000_voice_messages.sql, then try again.";

const FORMATS = [
  { mime: "audio/webm;codecs=opus", type: "audio/webm", ext: "webm" },
  { mime: "audio/webm", type: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", type: "audio/mp4", ext: "m4a" },
  { mime: "audio/ogg;codecs=opus", type: "audio/ogg", ext: "ogg" },
] as const;

export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Why recording can't start here, in words a person can act on. */
export function voiceUnsupportedMessage(): string {
  if (typeof window !== "undefined" && window.isSecureContext === false)
    return "Voice messages need a secure (https) connection.";
  return "Voice messages aren't supported on this device.";
}

/** Shown when the person tapped "Don't allow" (or blocked the microphone earlier). */
export const MIC_DENIED_MESSAGE =
  "Microphone is blocked. Allow it when asked, or turn it on in your phone's " +
  "Settings > Apps > this app > Permissions > Microphone.";

/** The best recording format this browser can make (undefined = let the browser choose). */
export function pickVoiceFormat() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
}

/** Uploads the recording to my own folder of the "voice" bucket, then sends it to the chat. */
export async function sendVoiceMessage(
  conversationId: string,
  userId: string,
  blob: Blob,
  seconds: number,
): Promise<MessageRow> {
  const secs = Math.min(600, Math.max(1, Math.round(seconds)));
  if (blob.size > VOICE_MAX_BYTES)
    throw new Error("That voice message is too long. Try a shorter one.");
  // The stored type comes from the recording's actual container, not from whatever the blob claims.
  const audio = await inspectAudio(blob);
  const { type, ext } = { type: audio.kind.mime, ext: audio.kind.ext };
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("voice")
    .upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
  if (uploadError) {
    console.error("Voice upload failed", uploadError);
    if (/bucket not found/i.test(uploadError.message ?? "")) throw new Error(VOICE_MIGRATION_HINT);
    throw new Error("Couldn't upload your voice message. Please try again.");
  }
  const { data: pub } = supabase.storage.from("voice").getPublicUrl(path);
  const { data, error } = await db.rpc("send_voice_message", {
    p_conversation: conversationId,
    p_url: pub.publicUrl,
    p_seconds: secs,
  });
  if (error) {
    void supabase.storage.from("voice").remove([path]);
    if (isMissingFunctionError(error)) throw new Error(VOICE_MIGRATION_HINT);
    throw friendlyError(error, "Couldn't send your voice message.");
  }
  return data as MessageRow;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
