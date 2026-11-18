import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;

export const DELETE_WORD = "DELETE";

export const DELETE_MIGRATION_HINT =
  "Account deletion needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261113000000_delete_account.sql, then try again.";

/** Every storage bucket that keeps files under a "<user id>/" folder. */
export const USER_BUCKETS = ["avatars", "media", "videos", "voice", "chat-media"] as const;

/** True when what was typed matches the confirmation word (any case, spaces ignored). */
export function isDeleteConfirmed(text: string): boolean {
  return text.trim().toUpperCase() === DELETE_WORD;
}

type Entry = { name: string; id: string | null };

/** Lists every file under `prefix`, going into sub-folders (folders come back with a null id). */
async function listFiles(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const files: string[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset });
    if (error || !data || data.length === 0) break;
    for (const e of data as Entry[]) {
      if (e.id) files.push(`${prefix}/${e.name}`);
      else files.push(...(await listFiles(bucket, `${prefix}/${e.name}`, depth + 1)));
    }
    if (data.length < 100) break;
  }
  return files;
}

/**
 * Removes the person's uploaded photos, videos and voice notes. Best effort: a bucket that can't
 * be read or cleaned doesn't stop the account from being deleted. Returns how many files went.
 */
export async function removeMyFiles(userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of USER_BUCKETS) {
    try {
      const paths = await listFiles(bucket, userId);
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await supabase.storage.from(bucket).remove(chunk);
        if (!error) removed += chunk.length;
      }
    } catch (e) {
      console.error(`couldn't clean ${bucket}`, e);
    }
  }
  return removed;
}

/** Deletes the files, then the account itself. The caller signs the person out afterwards. */
export async function deleteMyAccount(userId: string): Promise<void> {
  await removeMyFiles(userId);
  const { error } = await db.rpc("delete_my_account");
  if (error) {
    console.error("delete_my_account failed", error);
    if (/delete_my_account|schema cache|does not exist/i.test(error.message ?? "")) {
      throw new Error(DELETE_MIGRATION_HINT);
    }
    throw new Error("Couldn't delete your account. Check your internet and try again.");
  }
}
