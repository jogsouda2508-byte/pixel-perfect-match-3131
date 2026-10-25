import { isMissingFunctionError, isMissingTableError } from "@/lib/db-errors";

/** Shown when story replies / polls / notes / voice messages are used before the SQL was run. */
export const ENGAGE_MIGRATION_HINT =
  "This feature needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261028000000_story_replies_polls_notes_voice.sql, then try again.";

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** Error codes the SQL functions raise, in words a person can act on. */
const FRIENDLY: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  story_unavailable: "This story is no longer available.",
  own_story: "You can't reply to your own story.",
  not_allowed: "You don't have permission to do that.",
  invalid_message: "That message can't be sent.",
  invalid_question: "Add a question (up to 100 characters).",
  invalid_options: "Each option needs 1 to 40 characters.",
  invalid_note: "A note can be 1 to 60 characters.",
  invalid_duration: "That voice message is too short or too long.",
  invalid_audio: "The recording couldn't be used. Please try again.",
};

/** Turns a database error into an Error with a friendly message. */
export function friendlyError(error: DbError, fallback: string): Error {
  if (isMissingFunctionError(error) || isMissingTableError(error))
    return new Error(ENGAGE_MIGRATION_HINT);
  const text = error?.message ?? "";
  const key = Object.keys(FRIENDLY).find((k) => text.includes(k));
  return new Error(key ? FRIENDLY[key]! : fallback);
}
