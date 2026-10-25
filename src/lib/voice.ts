import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/engage";
import type { MessageRow } from "@/integrations/supabase/types";

// the generated database types don't know the voice function yet
const db = supabase as unknown as SupabaseClient;

/** Keeps every file well under the bucket's 5 MB limit on every browser. */
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MIN_SECONDS = 1;

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

/** The best recording format this browser can make (undefined = let the browser choose). */
export function pickVoiceFormat() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
}

function extFor(blobType: string): { type: string; ext: string } {
  const base = (blobType.split(";")[0] ?? "").trim().toLowerCase();
  if (base === "audio/mp4" || base === "video/mp4") return { type: base, ext: "m4a" };
  if (base === "audio/ogg") return { type: base, ext: "ogg" };
  if (base === "audio/mpeg") return { type: base, ext: "mp3" };
  return { type: base === "video/webm" ? base : "audio/webm", ext: "webm" };
}

/** Uploads the recording to my own folder of the "voice" bucket, then sends it to the chat. */
export async function sendVoiceMessage(
  conversationId: string,
  userId: string,
  blob: Blob,
  seconds: number,
): Promise<MessageRow> {
  const secs = Math.min(600, Math.max(1, Math.round(seconds)));
  const { type, ext } = extFor(blob.type);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("voice")
    .upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
  if (uploadError) {
    console.error("Voice upload failed", uploadError);
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
    throw friendlyError(error, "Couldn't send your voice message.");
  }
  return data as MessageRow;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
