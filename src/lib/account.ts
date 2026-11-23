import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  callGateway,
  gatewayProblem,
  startSession,
  tokensFrom,
  waitText,
} from "@/lib/auth-gateway";

const db = supabase as unknown as SupabaseClient;

export const DELETE_WORD = "DELETE";

/**
 * For developers only: goes to the console, never to the screen. People who see the
 * "migration_missing" error get DELETE_UNAVAILABLE_MESSAGE instead.
 */
export const DELETE_MIGRATION_HINT =
  "Account deletion needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261113000000_delete_account.sql and " +
  "supabase/migrations/20261116000002_privacy_account_deletion.sql, then try again.";

export const DELETE_UNAVAILABLE_MESSAGE =
  "Account deletion isn't available right now. Please try again later or contact support.";
export const DELETE_FAILED_MESSAGE =
  "Couldn't delete your account. Check your internet and try again.";
export const REAUTH_MESSAGE =
  "For your security, please confirm it's you again, then delete your account.";
export const REAUTH_AFTER_FILES_MESSAGE =
  "Your sign-in expired while we were removing your files. Your account was NOT deleted " +
  "(some photos and videos may already be gone). Confirm it's you again and delete once more.";
export const WRONG_PASSWORD_MESSAGE = "That password isn't right. Please try again.";
export const FILES_FAILED_MESSAGE =
  "We couldn't remove all of your uploaded photos and videos, so nothing was deleted. " +
  "Check your internet and try again.";
export const IDENTITY_MESSAGE =
  "We couldn't confirm this sign-in belongs to the account you are deleting. Nothing was deleted.";
export const WRONG_ACCOUNT_MESSAGE =
  "You signed in with a different account than the one you wanted to delete. " +
  "Nothing was deleted. Sign in with the right account and try again.";
export const PROFILE_MISSING_MESSAGE =
  "We couldn't load your profile. Reload the page and try again.";
export const EMAIL_UNVERIFIED_MESSAGE =
  "Please verify your email before deleting your account.";

/** Every storage bucket that keeps files under a "<user id>/" folder. */
export const USER_BUCKETS = ["avatars", "media", "videos", "voice", "chat-media"] as const;

export type AccountDeletionErrorCode =
  | "wrong_password"
  | "reauth_required"
  | "identity_mismatch"
  | "rate_limited"
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

// ------------------------------------------------------------------ token + Google re-sign-in

/**
 * Reads the claims of a token WITHOUT checking its signature. Only for comparing ids on this
 * device (is this the same person / the same sign-in?); the server decides what is allowed.
 */
export function jwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The id of the sign-in (session) a token belongs to. It changes only on a real new sign-in. */
export function sessionIdOf(token: string | null | undefined): string | null {
  const id = jwtClaims(token)?.["session_id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Identifies the current sign-in: the session id inside the token, or (for tokens without one)
 * the time the server says the person last signed in. It changes only on a real new sign-in.
 */
export function signInMarker(
  session: { access_token?: string | null; user?: { last_sign_in_at?: string | null } } | null,
): string | null {
  if (!session) return null;
  const id = sessionIdOf(session.access_token);
  if (id) return `s:${id}`;
  const at = session.user?.last_sign_in_at;
  return at ? `t:${at}` : null;
}

const GOOGLE_REAUTH_KEY = "sabzone.deleteAccount.googleReauth";
const GOOGLE_REAUTH_TTL_MS = 10 * 60 * 1000;

type GoogleReauthMark = { userId: string; marker: string; at: number };

/**
 * Written just before sending the person to Google to confirm it's them. It remembers WHO is
 * deleting and WHICH sign-in they had (see signInMarker), so the return can be checked: a brand-new sign-in for the
 * same account counts, a sign-in for another Google account does not.
 */
export function markGoogleReauth(userId: string, marker: string): void {
  try {
    const mark: GoogleReauthMark = { userId, marker, at: Date.now() };
    window.sessionStorage.setItem(GOOGLE_REAUTH_KEY, JSON.stringify(mark));
  } catch {
    /* storage unavailable: the server's recent-sign-in check still protects the account */
  }
}

export function clearGoogleReauth(): void {
  try {
    window.sessionStorage.removeItem(GOOGLE_REAUTH_KEY);
  } catch {
    /* nothing to clear */
  }
}

export type GoogleReauthStatus =
  /** No Google confirmation is in progress. */
  | "none"
  /** Sent to Google, still on the old sign-in. Nothing decided yet. */
  | "pending"
  /** A new sign-in for the same account came back. */
  | "confirmed"
  /** A new sign-in came back, but for a different account. */
  | "wrong_account";

/** Looks at where a Google confirmation stands. Settles (and forgets) it once it is decided. */
export function checkGoogleReauth(
  currentUserId: string,
  session: Parameters<typeof signInMarker>[0],
): GoogleReauthStatus {
  let mark: GoogleReauthMark | null = null;
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_REAUTH_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const m = parsed as Partial<GoogleReauthMark> | null;
    if (m && typeof m.userId === "string" && typeof m.marker === "string" && typeof m.at === "number")
      mark = { userId: m.userId, marker: m.marker, at: m.at };
  } catch {
    mark = null;
  }
  if (!mark) return "none";
  if (Date.now() - mark.at > GOOGLE_REAUTH_TTL_MS) {
    clearGoogleReauth();
    return "none";
  }
  const now = signInMarker(session);
  if (!now) return "pending";
  if (now === mark.marker) return "pending";
  clearGoogleReauth();
  return currentUserId === mark.userId ? "confirmed" : "wrong_account";
}

// ------------------------------------------------------------------ storage

type Entry = { name: string; id: string | null };

const PAGE_SIZE = 100;
const MAX_FOLDER_DEPTH = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A bucket that doesn't exist (or has nothing for this person) simply has no files to remove. */
function isNotFound(error: {
  message?: string | undefined;
  statusCode?: string | number | undefined;
}): boolean {
  return String(error.statusCode ?? "") === "404" || /not.?found/i.test(error.message ?? "");
}

/**
 * Lists every file under `prefix`, going into sub-folders (folders come back with a null id).
 * Anything that stops the listing from being complete is thrown, never treated as "empty":
 * skipping files would leave a deleted person's public photos online.
 */
async function listFiles(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_FOLDER_DEPTH) throw new Error(`folders nested too deeply in ${bucket}`);
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (offset > 1_000_000) throw new Error(`listing of ${bucket} did not finish`);
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE_SIZE, offset });
    if (error) {
      if (isNotFound(error)) return files;
      throw error;
    }
    if (!data || data.length === 0) break;
    for (const e of data as Entry[]) {
      if (e.id) files.push(`${prefix}/${e.name}`);
      else files.push(...(await listFiles(bucket, `${prefix}/${e.name}`, depth + 1)));
    }
    if (data.length < PAGE_SIZE) break;
  }
  return files;
}

async function removeChunk(bucket: string, chunk: string[]): Promise<void> {
  // Two short retries: a dropped connection should not block someone from deleting their account.
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (!error || isNotFound(error)) return;
    if (attempt >= 2) throw error;
    await sleep(400 * (attempt + 1));
  }
}

/**
 * Removes the person's uploaded photos, videos and voice notes. Throws if any file could not be
 * removed, so the account is NOT deleted while its files are still online. Storage does not
 * report files it refused to delete, so each bucket is listed again afterwards and must be empty.
 * Returns how many files went.
 */
export async function removeMyFiles(userId: string): Promise<number> {
  // Never list with an empty or odd prefix: that would walk other people's folders.
  if (!UUID_RE.test(userId)) throw new Error("removeMyFiles needs a user id");
  let removed = 0;
  for (const bucket of USER_BUCKETS) {
    const paths = await listFiles(bucket, userId);
    for (let i = 0; i < paths.length; i += PAGE_SIZE) {
      const chunk = paths.slice(i, i + PAGE_SIZE);
      await removeChunk(bucket, chunk);
      removed += chunk.length;
    }
    if (paths.length > 0) {
      const left = await listFiles(bucket, userId);
      if (left.length > 0) throw new Error(`${left.length} file(s) are still in ${bucket}`);
    }
  }
  return removed;
}

// ------------------------------------------------------------------ this device

/**
 * Erases what this app keeps in the browser/phone for the person (drafts, "seen" markers, area).
 * Only call it once the account is really gone.
 */
export function clearLocalUserData(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  for (const area of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = window[area];
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
  clearGoogleReauth();
}

// ------------------------------------------------------------------ the deletion itself

function looksLikeMissingMigration(message: string): boolean {
  return /could not find the function|function .*does not exist|schema cache/i.test(message);
}

/** Asks the auth server (not the copy kept on this device) who is signed in, and checks it. */
async function verifiedUser(expectedUserId: string): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const status = error?.status;
    if (!error || status === 401 || status === 403 || error.name === "AuthSessionMissingError")
      throw new AccountDeletionError("reauth_required", REAUTH_MESSAGE);
    console.error("getUser failed", error);
    throw new AccountDeletionError("failed", DELETE_FAILED_MESSAGE);
  }
  if (data.user.id !== expectedUserId)
    throw new AccountDeletionError("identity_mismatch", IDENTITY_MESSAGE);
  return data.user;
}

/**
 * Proves the password through the auth-gateway (log-in is by USERNAME there, it is rate limited,
 * and the email address never reaches this device), then switches to the fresh session it
 * returns. The session is only adopted when it belongs to the account being deleted.
 */
async function reauthWithPassword(
  userId: string,
  username: string | null | undefined,
  password: string | undefined,
): Promise<void> {
  const name = (username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!name) throw new AccountDeletionError("failed", PROFILE_MISSING_MESSAGE);
  if (!password) throw new AccountDeletionError("wrong_password", WRONG_PASSWORD_MESSAGE);

  const r = await callGateway("login", { username: name, password });
  const tokens = r.ok ? tokensFrom(r) : null;
  if (!tokens) {
    if (r.status === 401) {
      const wait = r.data["retry_after"];
      throw new AccountDeletionError(
        "wrong_password",
        typeof wait === "number" && wait > 0
          ? `${WRONG_PASSWORD_MESSAGE} Too many tries: wait ${waitText(wait)}.`
          : WRONG_PASSWORD_MESSAGE,
      );
    }
    if (r.status === 403 && r.data["error"] === "email_not_verified")
      throw new AccountDeletionError("failed", EMAIL_UNVERIFIED_MESSAGE);
    throw new AccountDeletionError(
      r.status === 429 ? "rate_limited" : "failed",
      gatewayProblem(r, DELETE_FAILED_MESSAGE),
    );
  }
  // Check whose session this is BEFORE switching to it.
  if (jwtClaims(tokens.access_token)?.["sub"] !== userId)
    throw new AccountDeletionError("identity_mismatch", IDENTITY_MESSAGE);
  const started = await startSession(tokens);
  if (started.error) throw new AccountDeletionError("failed", started.error);
}

export type DeleteAccountInput = {
  /** The account the person believes they are deleting (checked against the auth server). */
  userId: string;
  /** The log-in username, needed to check the password through the auth-gateway. */
  username?: string | null | undefined;
  /** Required for accounts that have a password (see hasPasswordLogin). */
  password?: string | undefined;
};

/**
 * Deletes the account for good, in an order that never strands a half-deleted person:
 *  1. ask the auth server who is signed in and make sure it is `userId`,
 *  2. when the account has a password, prove it through the auth-gateway (new session),
 *     then check the identity again,
 *  3. ask the database whether the sign-in is recent enough, BEFORE touching any file,
 *  4. remove the uploaded files (stops here if any can't be removed or remain),
 *  5. delete the account and its data (database function, which checks recency again),
 *  6. only now wipe what the app stored on this device.
 * The caller signs the person out afterwards.
 */
export async function deleteMyAccount(input: DeleteAccountInput): Promise<void> {
  const { userId, username, password } = input;

  let user = await verifiedUser(userId);

  // The password requirement comes from the server's view of the account, not from the screen.
  if (hasPasswordLogin(user)) {
    await reauthWithPassword(userId, username, password);
    user = await verifiedUser(userId);
  }

  const fresh = await db.rpc("my_session_is_fresh");
  if (fresh.error) {
    console.error("my_session_is_fresh failed", fresh.error);
    if (looksLikeMissingMigration(fresh.error.message ?? "")) {
      console.error(DELETE_MIGRATION_HINT);
      throw new AccountDeletionError("migration_missing", DELETE_UNAVAILABLE_MESSAGE);
    }
    throw new AccountDeletionError("failed", DELETE_FAILED_MESSAGE);
  }
  if (fresh.data !== true) throw new AccountDeletionError("reauth_required", REAUTH_MESSAGE);

  try {
    await removeMyFiles(user.id);
  } catch (e) {
    console.error("couldn't remove uploaded files", e);
    throw new AccountDeletionError("files_failed", FILES_FAILED_MESSAGE);
  }

  const { error } = await db.rpc("delete_my_account");
  if (error) {
    console.error("delete_my_account failed", error);
    const message = error.message ?? "";
    // Already gone (for example a second tap): the goal is reached.
    if (!/account_not_found/i.test(message)) {
      if (/reauth_required/i.test(message))
        throw new AccountDeletionError("reauth_required", REAUTH_AFTER_FILES_MESSAGE);
      if (looksLikeMissingMigration(message)) {
        console.error(DELETE_MIGRATION_HINT);
        throw new AccountDeletionError("migration_missing", DELETE_UNAVAILABLE_MESSAGE);
      }
      throw new AccountDeletionError("failed", DELETE_FAILED_MESSAGE);
    }
  }

  clearLocalUserData(user.id);
}
