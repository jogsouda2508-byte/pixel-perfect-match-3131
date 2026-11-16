import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The generated database types don't know the blocks / mutes / reports tables, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

export const SAFETY_MIGRATION_HINT =
  "Block, mute and report need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261111000000_block_mute_report.sql, then try again.";

type DbError = { message?: string | null; code?: string | null };

/** True when the error means the block / mute / report SQL has not been run yet. */
export function isSafetyMissing(error: DbError | null | undefined): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /\b(blocks|mutes|reports|block_state)\b/.test(m)
  );
}

/** True when the database refused something because of a block ("blocked"). */
export function isBlockedError(error: DbError | null | undefined): boolean {
  return !!error && (error.message ?? "").trim().toLowerCase() === "blocked";
}

/** Something to tell the person when an action failed because of a block, else the fallback. */
export function blockedMessage(error: unknown, fallback: string): string {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return /\bblocked\b/i.test(message) ? "You can't do that with this person." : fallback;
}

function failure(error: DbError, fallback: string): Error {
  return new Error(isSafetyMissing(error) ? SAFETY_MIGRATION_HINT : fallback);
}

// ---------------------------------------------------------------------------------------------
// People lists
// ---------------------------------------------------------------------------------------------

export type SafetyPerson = {
  id: string;
  full_name: string | null;
  username: string;
  avatar_url: string | null;
};

type PersonJoinRow = { person: SafetyPerson | null };

async function fetchPeopleList(table: "blocks" | "mutes", me: string): Promise<SafetyPerson[]> {
  const mine = table === "blocks" ? "blocker_id" : "muter_id";
  const other = table === "blocks" ? "blocked_id" : "muted_id";
  const { data, error } = await db
    .from(table)
    .select(`created_at, person:profiles!${table}_${other}_fkey(id, full_name, username, avatar_url)`)
    .eq(mine, me)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error(`Loading ${table} failed`, error);
    throw failure(error, "Couldn't load that list. Please try again.");
  }
  return ((data ?? []) as unknown as PersonJoinRow[])
    .map((r) => r.person)
    .filter((p): p is SafetyPerson => !!p);
}

export const fetchBlocked = (me: string) => fetchPeopleList("blocks", me);
export const fetchMuted = (me: string) => fetchPeopleList("mutes", me);

// ---------------------------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------------------------

export type BlockState = "none" | "mine" | "theirs";

/** Did I block them ("mine"), did they block me ("theirs"), or neither. Never throws. */
export async function fetchBlockState(otherId: string): Promise<BlockState> {
  try {
    const { data, error } = await db.rpc("block_state", { p_other: otherId });
    if (error) return "none";
    return data === "mine" || data === "theirs" ? data : "none";
  } catch {
    return "none";
  }
}

export async function blockUser(me: string, otherId: string): Promise<void> {
  const { error } = await db
    .from("blocks")
    .upsert({ blocker_id: me, blocked_id: otherId }, { onConflict: "blocker_id,blocked_id" });
  if (error) {
    console.error("Blocking failed", error);
    throw failure(error, "Couldn't block them. Please try again.");
  }
  clearMutedCache();
}

export async function unblockUser(me: string, otherId: string): Promise<void> {
  const { error } = await db.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", otherId);
  if (error) {
    console.error("Unblocking failed", error);
    throw failure(error, "Couldn't unblock them. Please try again.");
  }
}

// ---------------------------------------------------------------------------------------------
// Mute
// ---------------------------------------------------------------------------------------------

export async function muteUser(me: string, otherId: string): Promise<void> {
  const { error } = await db
    .from("mutes")
    .upsert({ muter_id: me, muted_id: otherId }, { onConflict: "muter_id,muted_id" });
  if (error) {
    console.error("Muting failed", error);
    throw failure(error, "Couldn't mute them. Please try again.");
  }
  clearMutedCache();
}

export async function unmuteUser(me: string, otherId: string): Promise<void> {
  const { error } = await db.from("mutes").delete().eq("muter_id", me).eq("muted_id", otherId);
  if (error) {
    console.error("Unmuting failed", error);
    throw failure(error, "Couldn't unmute them. Please try again.");
  }
  clearMutedCache();
}

// The mutes table only returns my own rows, so no id is needed. A short cache keeps the feed and
// the story row from asking again on every refresh. Any problem means "nobody is muted": muting
// must never stop the feed from loading.
let mutedCache: { at: number; ids: Set<string> } | null = null;
const MUTED_TTL_MS = 30_000;

export function clearMutedCache() {
  mutedCache = null;
}

export async function fetchMutedIds(): Promise<Set<string>> {
  if (mutedCache && Date.now() - mutedCache.at < MUTED_TTL_MS) return mutedCache.ids;
  const ids = new Set<string>();
  try {
    const { data, error } = await db.from("mutes").select("muted_id").limit(1000);
    if (!error) {
      for (const r of (data ?? []) as { muted_id: string }[]) ids.add(r.muted_id);
      mutedCache = { at: Date.now(), ids };
    }
  } catch {
    /* nobody is muted */
  }
  return ids;
}

/** Leaves out rows written by muted people. Pure, so it is easy to test. */
export function dropMuted<T extends { author_id: string }>(rows: T[], muted: Set<string>): T[] {
  return muted.size === 0 ? rows : rows.filter((r) => !muted.has(r.author_id));
}

/** The ids of the people I have muted (shared by every post card, so it loads once). */
export function useMutedIds() {
  return useQuery({
    queryKey: ["muted-ids"],
    queryFn: async () => [...(await fetchMutedIds())],
    staleTime: 30_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export type ReportTarget = "user" | "post" | "comment" | "story" | "message";
export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "nudity"
  | "violence"
  | "scam"
  | "false_info"
  | "self_harm"
  | "other";

// The `value`s must match the reports.reason check in 20261111000000_block_mute_report.sql.
export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "spam", label: "Spam", hint: "Repeated, irrelevant or fake promotion" },
  { value: "harassment", label: "Bullying or harassment", hint: "Targeting or threatening someone" },
  { value: "hate", label: "Hate speech", hint: "Attacks people for who they are" },
  { value: "nudity", label: "Nudity or sexual content", hint: "Not suitable for everyone" },
  { value: "violence", label: "Violence or dangerous acts", hint: "Hurting people or animals" },
  { value: "scam", label: "Scam or fraud", hint: "Trying to cheat people out of money" },
  { value: "false_info", label: "False information", hint: "Misleading or made up" },
  { value: "self_harm", label: "Suicide or self-harm", hint: "Someone may be in danger" },
  { value: "other", label: "Something else", hint: "Tell us more below" },
];

export const REPORT_DETAILS_MAX = 500;

export type ReportInput = {
  targetType: ReportTarget;
  targetId: string;
  /** The person who wrote it / owns the account (so the report can be tied to them). */
  targetUserId?: string | null;
  reason: ReportReason;
  details?: string;
};

/** What to tell the person when sending a report did not work. */
export function reportErrorMessage(error: DbError | null | undefined): string {
  if (!error) return "Couldn't send your report. Please try again.";
  if (isSafetyMissing(error)) return SAFETY_MIGRATION_HINT;
  if ((error.message ?? "").includes("too_many_reports")) {
    return "You've sent a lot of reports today. Please try again tomorrow.";
  }
  return "Couldn't send your report. Please try again.";
}

/** Sends a report. Reporting the same thing twice is fine: it just says thanks. */
export async function submitReport(me: string, input: ReportInput): Promise<"sent" | "already"> {
  const details = (input.details ?? "").trim().slice(0, REPORT_DETAILS_MAX);
  const { error } = await db.from("reports").insert({
    reporter_id: me,
    target_type: input.targetType,
    target_id: input.targetId,
    target_user_id: input.targetUserId ?? null,
    reason: input.reason,
    details: details || null,
  });
  if (!error) return "sent";
  if (error.code === "23505") return "already";
  console.error("Sending a report failed", error);
  throw new Error(reportErrorMessage(error));
}

/** Every query that shows other people's content, so it refreshes after a block / mute. */
export const CONTENT_QUERY_KEYS = [
  "feed",
  "video-feed",
  "stories",
  "user-posts",
  "user-tagged",
  "user-videos",
  "follow-counts",
  "follow-list",
  "followers-list",
  "my-following",
  "is-following",
  "my-follow-requests",
  "people",
  "saved-posts",
  "comments",
  "close-friends",
  "conversations",
  "muted-ids",
  "blocked-list",
  "muted-list",
  "block-state",
] as const;
