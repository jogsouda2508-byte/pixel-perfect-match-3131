import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunctionError } from "@/lib/db-errors";

// The generated database types don't know the community functions, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

/** Which Community notifications a person wants. Both are on until they say otherwise. */
export type CommunityNotifyPrefs = { alerts: boolean; events: boolean };

export const DEFAULT_NOTIFY_PREFS: CommunityNotifyPrefs = { alerts: true, events: true };

export const NOTIFY_MIGRATION_HINT =
  "Community notifications need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261105000000_community_notifications.sql, then try again.";

/** Reads the database answer safely: anything that isn't a clear true/false is treated as on. */
export function parseNotifyPrefs(raw: unknown): CommunityNotifyPrefs {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_NOTIFY_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    alerts: r["alerts"] !== false,
    events: r["events"] !== false,
  };
}

/** The person-friendly line under each switch. */
export function notifyExample(kind: keyof CommunityNotifyPrefs): string {
  return kind === "alerts"
    ? "Power cuts, water and road alerts near you, and when neighbours confirm them."
    : "New events near you, and a heads-up if an event you joined is cancelled.";
}

/** True when the person has set a location, which is how "near you" is worked out. */
export function hasNotifyLocation(location: string | null | undefined): boolean {
  return (location ?? "").trim().length > 0;
}

function toError(
  error: { message?: string | null; code?: string | null },
  fallback: string,
): Error {
  if (isMissingFunctionError(error)) return new Error(NOTIFY_MIGRATION_HINT);
  if (/failed to fetch|network/i.test(error.message ?? ""))
    return new Error("No connection. Check your internet and try again.");
  return new Error(fallback);
}

export async function fetchNotifyPrefs(): Promise<CommunityNotifyPrefs> {
  const { data, error } = await db.rpc("get_community_notify_prefs");
  if (error) {
    console.error("get_community_notify_prefs failed", error);
    throw toError(error, "Couldn't load your Community notification choices.");
  }
  return parseNotifyPrefs(data);
}

export async function saveNotifyPrefs(next: CommunityNotifyPrefs): Promise<CommunityNotifyPrefs> {
  const { data, error } = await db.rpc("set_community_notify_prefs", {
    p_alerts: next.alerts,
    p_events: next.events,
  });
  if (error) {
    console.error("set_community_notify_prefs failed", error);
    throw toError(error, "Couldn't save your choice. Please try again.");
  }
  return parseNotifyPrefs(data);
}
