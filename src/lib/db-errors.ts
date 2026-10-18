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

/** Shown when an action needs the story-video SQL migration that hasn't been run. */
export const STORY_VIDEO_MIGRATION_HINT =
  "Video stories need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261019000000_story_videos_local_feed.sql, then try again.";
