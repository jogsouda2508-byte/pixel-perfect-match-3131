import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;

export const DELETE_WORD = "DELETE";

export const DELETE_MIGRATION_HINT =
  "Account deletion needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261113000000_delete_account.sql and " +
  "supabase/migrations/20261116000000_privacy_account_deletion.sql, then try again.";

export const REAUTH_MESSAGE =
  "For your security, please sign out, sign back in, and then delete your account.";
export const WRONG_PASSWORD_MESSAGE = "That password isn't right. Please try again.";
export const FILES_FAILED_MESSAGE =
  "We couldn't remove all of your uploaded photos and videos, so nothing was deleted. " +
  "Check your internet and try again.";

/** Every storage bucket that keeps files under a "<user id>/" folder. */
export const USER_BUCKETS = ["avatars", "media", "videos", "voice", "chat-media"] as const;

export type AccountDeletionErrorCode =
  | "wrong_password"
  | "reauth_required"
  | "files_failed"
  | "migration_missing"
  | "failed";

/** Thrown by deleteMyAccount. `code` lets the screen react; `message` is safe to show. */
export class AccountDeletionError extends Error {
  constructor(
    readonly code: AccountDeletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

/** True when what was typed matches the confirmation word (any case, spaces ignored). */
export function isDeleteConfirmed(text: string): boolean {
  return text.trim().toUpperCase() === DELETE_WORD;
}

/** True when the person can prove who they are with a password (email sign-up), not only Google. */
export function hasPasswordLogin(user: Pick<User, "app_metadata" | "identities">): boolean {
  const providers = (user.app_metadata as { providers?: unknown } | undefined)?.providers;
  if (Array.isArray(providers) && providers.includes("email")) return true;
  return (user.identities ?? []).some((i) => i.provider === "email");
}

type Entry = { name: string; id: string | null };

/** A bucket that doesn't exist (or has nothing for this person) simply has no files to remove. */
function isNotFound(error: {
  message?: string | undefined;
  statusCode?: string | number | undefined;
}): boolean {
  return String(error.statusCode ?? "") === "404" || /not.?found/i.test(error.message ?? "");
}

/**
 * Lists every file under `prefix`, going into sub-folders (folders come back with a null id).
 * A listing error is thrown, never treated as "empty": skipping files would leave a deleted
 * person's public photos online.
 */
async function listFiles(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const files: string[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset });
    if (error) {
      if (isNotFound(error)) return files;
      throw error;
    }
    if (!data || data.length === 0) break;
    for (const e of data as Entry[]) {
      if (e.id) files.push(`${prefix}/${e.name}`);
      else files.push(...(await listFiles(bucket, `${prefix}/${e.name}`, depth + 1)));
    }
    if (data.length < 100) break;
  }
  return files;
}

async function removeChunk(bucket: string, chunk: string[]): Promise<void> {
  // One quick retry: a dropped connection should not block someone from deleting their account.
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (!error || isNotFound(error)) return;
    if (attempt >= 1) throw error;
  }
}

/**
 * Removes the person's uploaded photos, videos and voice notes. Throws if any file could not be
 * removed, so the account is NOT deleted while its files are still online. Returns how many
 * files went.
 */
export async function removeMyFiles(userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of USER_BUCKETS) {
    const paths = await listFiles(bucket, userId);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      await removeChunk(bucket, chunk);
      removed += chunk.length;
    }
  }
  return removed;
}

/** Erases what this app keeps in the browser/phone for the person (drafts, "seen" markers, area). */
export function clearLocalUserData(userId: string): void {
  try {
    if (typeof window === "undefined" || !userId) return;
    const store = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.includes(userId)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    /* storage can be unavailable (private mode); nothing more to do */
  }
}

function looksLikeMissingMigration(message: string): boolean {
  return /delete_my_account|my_session_is_fresh|schema cache|does not exist/i.test(message);
}

export type DeleteAccountInput = {
  userId: string;
  /** The login email, needed to check the password. */
  email?: string | null | undefined;
  /** Required for accounts that have a password (see hasPasswordLogin). */
  password?: string | undefined;
};

/**
 * Deletes the account for good, in an order that never strands a half-deleted person:
 *  1. confirm the password (when the account has one),
 *  2. ask the server whether the sign-in is recent enough, BEFORE touching any file,
 *  3. remove the uploaded files (stops here if any can't be removed),
 *  4. delete the account and its data (database function),
 *  5. wipe what the app stored on this device.
 * The caller signs the person out afterwards.
 */
export async function deleteMyAccount(input: DeleteAccountInput): Promise<void> {
  const { userId, email, password } = input;

  if (password !== undefined) {
    if (!email || password.length === 0)
      throw new AccountDeletionError("wrong_password", WRONG_PASSWORD_MESSAGE);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || data.user?.id !== userId)
      throw new AccountDeletionError("wrong_password", WRONG_PASSWORD_MESSAGE);
  }

  const fresh = await db.rpc("my_session_is_fresh");
  if (fresh.error) {
    console.error("my_session_is_fresh failed", fresh.error);
    if (looksLikeMissingMigration(fresh.error.message ?? ""))
      throw new AccountDeletionError("migration_missing", DELETE_MIGRATION_HINT);
    throw new AccountDeletionError(
      "failed",
      "Couldn't delete your account. Check your internet and try again.",
    );
  }
  if (fresh.data !== true) throw new AccountDeletionError("reauth_required", REAUTH_MESSAGE);

  try {
    await removeMyFiles(userId);
  } catch (e) {
    console.error("couldn't remove uploaded files", e);
    throw new AccountDeletionError("files_failed", FILES_FAILED_MESSAGE);
  }

  const { error } = await db.rpc("delete_my_account");
  if (error) {
    console.error("delete_my_account failed", error);
    const message = error.message ?? "";
    if (/reauth_required/i.test(message))
      throw new AccountDeletionError("reauth_required", REAUTH_MESSAGE);
    if (looksLikeMissingMigration(message))
      throw new AccountDeletionError("migration_missing", DELETE_MIGRATION_HINT);
    throw new AccountDeletionError(
      "failed",
      "Couldn't delete your account. Check your internet and try again.",
    );
  }

  clearLocalUserData(userId);
}
