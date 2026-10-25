import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTableError } from "@/lib/db-errors";
import { friendlyError } from "@/lib/engage";

// the generated database types don't know the notes table yet
const db = supabase as unknown as SupabaseClient;

export const NOTE_MAX = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NoteView = {
  userId: string;
  name: string;
  username: string;
  avatar: string | null;
  body: string;
  updatedAt: string;
  mine: boolean;
};

/**
 * My note plus the notes of the people I follow, newest first, none older than 24 hours.
 * The database policy already hides everything else; before the SQL is run this is just [].
 */
export async function fetchNotes(meId: string): Promise<NoteView[]> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data, error } = await db
    .from("notes")
    .select("user_id, body, updated_at")
    .gt("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("Loading notes failed", error);
    throw new Error("Couldn't load notes.");
  }
  const rows = (data ?? []) as { user_id: string; body: string; updated_at: string }[];
  if (rows.length === 0) return [];
  const { data: people, error: peopleError } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in(
      "id",
      rows.map((r) => r.user_id),
    );
  if (peopleError) throw new Error("Couldn't load notes.");
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const p = byId.get(r.user_id);
    if (!p) return [];
    return [
      {
        userId: r.user_id,
        name: p.full_name || p.username,
        username: p.username,
        avatar: p.avatar_url,
        body: r.body,
        updatedAt: r.updated_at,
        mine: r.user_id === meId,
      },
    ];
  });
}

export async function saveNote(body: string): Promise<void> {
  const { error } = await db.rpc("set_note", { p_body: body });
  if (error) throw friendlyError(error, "Couldn't save your note.");
}

export async function deleteNote(meId: string): Promise<void> {
  const { error } = await db.from("notes").delete().eq("user_id", meId);
  if (error) throw friendlyError(error, "Couldn't delete your note.");
}
