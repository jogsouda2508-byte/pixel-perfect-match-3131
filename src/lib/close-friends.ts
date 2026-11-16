import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The generated database types don't know the close_friends table, so talk to it untyped.
const db = supabase as unknown as SupabaseClient;

export const CLOSE_FRIENDS_MIGRATION_HINT =
  "Close Friends needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261110000000_close_friends.sql, then try again.";

/** True when the error means the Close Friends SQL has not been run yet. */
export function isCloseFriendsMissing(error: { message?: string | null; code?: string | null }) {
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    m.includes("close_friends")
  );
}

function listError(
  error: { message?: string | null; code?: string | null },
  fallback: string,
): Error {
  return new Error(isCloseFriendsMissing(error) ? CLOSE_FRIENDS_MIGRATION_HINT : fallback);
}

/** The ids of the people on my Close Friends list. */
export async function fetchCloseFriendIds(ownerId: string): Promise<string[]> {
  const { data, error } = await db
    .from("close_friends")
    .select("friend_id")
    .eq("owner_id", ownerId)
    .limit(1000);
  if (error) {
    console.error("Loading Close Friends failed", error);
    throw listError(error, "Couldn't load your Close Friends list.");
  }
  return ((data ?? []) as { friend_id: string }[]).map((r) => r.friend_id);
}

export async function addCloseFriend(ownerId: string, friendId: string): Promise<void> {
  const { error } = await db
    .from("close_friends")
    .upsert({ owner_id: ownerId, friend_id: friendId }, { onConflict: "owner_id,friend_id" });
  if (error) {
    console.error("Adding a close friend failed", error);
    throw listError(error, "Couldn't add them. They must follow you.");
  }
}

export async function removeCloseFriend(ownerId: string, friendId: string): Promise<void> {
  const { error } = await db
    .from("close_friends")
    .delete()
    .eq("owner_id", ownerId)
    .eq("friend_id", friendId);
  if (error) {
    console.error("Removing a close friend failed", error);
    throw listError(error, "Couldn't remove them. Please try again.");
  }
}

export function useCloseFriendIds(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["close-friends", ownerId],
    queryFn: () => fetchCloseFriendIds(ownerId!),
    enabled: !!ownerId,
    staleTime: 30_000,
    retry: false,
  });
}

/** Keeps the people whose name or @username contains what was typed (ignores case and spaces). */
export function filterPeople<T extends { full_name?: string | null; username?: string | null }>(
  people: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return people;
  return people.filter(
    (p) =>
      (p.full_name ?? "").toLowerCase().includes(q) || (p.username ?? "").toLowerCase().includes(q),
  );
}
