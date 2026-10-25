import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTableError } from "@/lib/db-errors";
import { friendlyError } from "@/lib/engage";

// the generated database types don't know the poll tables yet
const db = supabase as unknown as SupabaseClient;

export const POLL_QUESTION_MAX = 100;
export const POLL_OPTION_MAX = 40;

export type PollOption = { id: string; label: string; position: number; votes: number };
export type Poll = {
  id: string;
  question: string;
  createdBy: string;
  options: PollOption[];
  /** the option I voted for (only my own vote is ever readable) */
  myVote: string | null;
};
/** A poll that is being written; it is created together with its post. */
export type PollDraft = { question: string; options: [string, string] };
export type PollTarget = { postId: string } | { storyId: string };
type Kind = "post" | "story";

type PollRow = {
  id: string;
  post_id: string | null;
  story_id: string | null;
  created_by: string;
  question: string;
  options: { id: string; label: string; position: number; vote_count: number }[] | null;
};

async function fetchBatch(kind: Kind, ids: string[]): Promise<Map<string, Poll>> {
  const column = kind === "post" ? "post_id" : "story_id";
  const out = new Map<string, Poll>();
  const { data, error } = await db
    .from("polls")
    .select(
      "id, post_id, story_id, created_by, question, options:poll_options(id, label, position, vote_count)",
    )
    .in(column, ids);
  if (error) {
    if (isMissingTableError(error)) return out;
    throw new Error("Couldn't load the poll.");
  }
  const rows = (data ?? []) as unknown as PollRow[];
  if (rows.length === 0) return out;
  const { data: votes } = await db
    .from("poll_votes")
    .select("poll_id, option_id")
    .in(
      "poll_id",
      rows.map((r) => r.id),
    );
  const mine = new Map(
    ((votes ?? []) as { poll_id: string; option_id: string }[]).map((v) => [
      v.poll_id,
      v.option_id,
    ]),
  );
  for (const r of rows) {
    const key = (kind === "post" ? r.post_id : r.story_id) ?? "";
    out.set(key, {
      id: r.id,
      question: r.question,
      createdBy: r.created_by,
      options: [...(r.options ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((o) => ({ id: o.id, label: o.label, position: o.position, votes: o.vote_count })),
      myVote: mine.get(r.id) ?? null,
    });
  }
  return out;
}

type Waiter = { resolve: (p: Poll | null) => void; reject: (e: unknown) => void };
let queue: Record<Kind, Map<string, Waiter[]>> = { post: new Map(), story: new Map() };
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = queue;
  queue = { post: new Map(), story: new Map() };
  for (const kind of ["post", "story"] as const) {
    const waiting = batch[kind];
    if (waiting.size === 0) continue;
    try {
      const found = await fetchBatch(kind, [...waiting.keys()]);
      for (const [id, list] of waiting) for (const w of list) w.resolve(found.get(id) ?? null);
    } catch (e) {
      for (const list of waiting.values()) for (const w of list) w.reject(e);
    }
  }
}

/** A feed shows many posts at once: every poll asked for in the same moment is one request. */
function loadPoll(kind: Kind, id: string): Promise<Poll | null> {
  return new Promise((resolve, reject) => {
    const list = queue[kind].get(id) ?? [];
    list.push({ resolve, reject });
    queue[kind].set(id, list);
    timer ??= setTimeout(() => void flush(), 15);
  });
}

export const pollKey = (kind: Kind, id: string) => ["poll", kind, id] as const;

/** The poll of a post or story (null when there is none). */
export function usePoll(target: { postId?: string | undefined; storyId?: string | undefined }) {
  const kind: Kind = target.postId ? "post" : "story";
  const id = target.postId ?? target.storyId ?? "";
  return {
    kind,
    id,
    query: useQuery({
      queryKey: pollKey(kind, id),
      queryFn: () => loadPoll(kind, id),
      enabled: !!id,
      staleTime: 30_000,
      retry: false,
    }),
  };
}

export async function createPoll(
  target: PollTarget,
  question: string,
  options: [string, string],
): Promise<string> {
  const { data, error } = await db.rpc("create_poll", {
    p_post_id: "postId" in target ? target.postId : null,
    p_story_id: "storyId" in target ? target.storyId : null,
    p_question: question,
    p_options: options,
  });
  if (error) throw friendlyError(error, "Couldn't create the poll.");
  return data as string;
}

export async function votePoll(pollId: string, optionId: string, userId: string): Promise<void> {
  const { error } = await db
    .from("poll_votes")
    .insert({ poll_id: pollId, user_id: userId, option_id: optionId });
  // 23505: I already voted (for example on another device) - not a failure
  if (error && error.code !== "23505") throw friendlyError(error, "Couldn't save your vote.");
}

/** Percentages that always add up to 100 (largest remainder), 0/0 when nobody voted. */
export function percentages(options: PollOption[]): number[] {
  const total = options.reduce((n, o) => n + o.votes, 0);
  if (total === 0) return options.map(() => 0);
  const raw = options.map((o) => (o.votes / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}
