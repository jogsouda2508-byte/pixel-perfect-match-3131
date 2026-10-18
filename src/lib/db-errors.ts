/**
 * True when the database says a column does not exist, i.e. an SQL migration hasn't
 * been run yet (Postgres 42703 "undefined_column", or PostgREST's schema-cache message).
 */
export function isMissingColumnError(
  error:
    { code?: string | null | undefined; message?: string | null | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

/** True when the database refused a story because of its stories_media_check rule (e.g. a story longer than 15 s before the update). */
export function isStoryLengthConstraintError(
  error:
    { code?: string | null | undefined; message?: string | null | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  return error.code === "23514" && /stories_media_check/.test(error.message ?? "");
}

/**
 * True when the database says a function (RPC) does not exist, i.e. an SQL migration
 * hasn't been run yet (Postgres 42883 "undefined_function", or PostgREST PGRST202).
 */
export function isMissingFunctionError(
  error:
    { code?: string | null | undefined; message?: string | null | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/** True when the database says a table does not exist (a migration hasn't been run yet). */
export function isMissingTableError(
  error:
    { code?: string | null | undefined; message?: string | null | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

/** Shown when a single long story needs the story-length SQL update that hasn't been run. */
export const STORY_LENGTH_MIGRATION_HINT =
  "Longer video stories need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261020000000_story_single_video_views_likes.sql, then try again.";

/** Shown when an action needs the story-video SQL migration that hasn't been run. */
export const STORY_VIDEO_MIGRATION_HINT =
  "Video stories need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261019000000_story_videos_local_feed.sql, then try again.";
