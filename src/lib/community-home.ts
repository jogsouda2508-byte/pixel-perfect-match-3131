import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatEventWhen, useCommunityLocality } from "@/lib/community";

// The generated database types don't know the community functions, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

/** What Home needs to know about Community, from get_community_home (one call). */
export type CommunityHome = {
  new_alerts: number;
  new_events: number;
  active_alerts: number;
  today_events: number;
  weekend_events: number;
  next_event: { id: string; title: string; starts_at: string } | null;
  top_alert: { id: string; kind: string; title: string } | null;
};

const n = (x: unknown): number => {
  const v = Number(x);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

/** Reads the database answer safely: missing or odd values become 0 / null. */
export function parseCommunityHome(raw: unknown): CommunityHome {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const next = r["next_event"] as Record<string, unknown> | null | undefined;
  const top = r["top_alert"] as Record<string, unknown> | null | undefined;
  return {
    new_alerts: n(r["new_alerts"]),
    new_events: n(r["new_events"]),
    active_alerts: n(r["active_alerts"]),
    today_events: n(r["today_events"]),
    weekend_events: n(r["weekend_events"]),
    next_event:
      next && typeof next["title"] === "string" && typeof next["starts_at"] === "string"
        ? { id: String(next["id"] ?? ""), title: next["title"], starts_at: next["starts_at"] }
        : null,
    top_alert:
      top && typeof top["title"] === "string"
        ? { id: String(top["id"] ?? ""), kind: String(top["kind"] ?? "other"), title: top["title"] }
        : null,
  };
}

// ------------------------------------------------- "new since I last looked"
const seenKey = (userId: string) => `ediraa.community-seen.${userId}`;

/** When this person last opened Community on this device (ISO), or null if never. */
export function getCommunitySeen(userId: string): string | null {
  try {
    const v = window.localStorage.getItem(seenKey(userId));
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

/** Call when Community is opened: clears the dot/count, here and on the Home cards. */
export function markCommunitySeen(userId: string, queryClient?: QueryClient): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(seenKey(userId), new Date().toISOString());
  } catch {
    /* storage can be unavailable; the dot just comes back next time */
  }
  queryClient?.setQueriesData<CommunityHome>({ queryKey: ["community", "home"] }, (old) =>
    old ? { ...old, new_alerts: 0, new_events: 0 } : old,
  );
  void queryClient?.invalidateQueries({ queryKey: ["community", "home"] });
}

/** Number on the Community icon: alerts and events from other people since the last visit. */
export const communityBadgeCount = (h: CommunityHome | null | undefined): number =>
  h ? h.new_alerts + h.new_events : 0;

export const communityBadgeText = (count: number): string => (count > 9 ? "9+" : String(count));

// --------------------------------------------------------------- the strip
export type HomeStrip = {
  tab: "events" | "alerts";
  kind: "alert" | "event" | "idle";
  title: string;
  sub: string;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The one-line "what's happening" card for the Home feed. The most useful thing wins:
 * new alerts, then events today, then events this weekend, then alerts still active, then the next event.
 * `near` is false when Community shows everywhere (no area picked), so it never claims "near you".
 */
export function buildHomeStrip(h: CommunityHome, near: boolean, now: Date = new Date()): HomeStrip {
  const where = near ? "near you" : "on Community";
  const nextSub = h.next_event
    ? `${h.next_event.title} · ${formatEventWhen(h.next_event.starts_at, now)}`
    : "Tap to see";

  if (h.new_alerts > 0)
    return {
      tab: "alerts",
      kind: "alert",
      title: `${plural(h.new_alerts, "new alert", "new alerts")} ${where}`,
      sub: h.top_alert?.title ?? "Tap to see",
    };
  if (h.today_events > 0)
    return {
      tab: "events",
      kind: "event",
      title: `${plural(h.today_events, "event", "events")} today ${where}`,
      sub: nextSub,
    };
  if (h.weekend_events > 0)
    return {
      tab: "events",
      kind: "event",
      title: `${plural(h.weekend_events, "event", "events")} this weekend ${where}`,
      sub: nextSub,
    };
  if (h.active_alerts > 0)
    return {
      tab: "alerts",
      kind: "alert",
      title: `${plural(h.active_alerts, "active alert", "active alerts")} ${where}`,
      sub: h.top_alert?.title ?? "Tap to see",
    };
  if (h.next_event)
    return { tab: "events", kind: "event", title: `Next event ${where}`, sub: nextSub };
  return {
    tab: "events",
    kind: "idle",
    title: near ? "See what's happening near you" : "See what's happening on Community",
    sub: "Events, alerts, polls and questions",
  };
}

// ------------------------------------------------------------------ the hook
export async function fetchCommunityHome(
  locality: string | null,
  since: string | null,
): Promise<CommunityHome> {
  const { data, error } = await db.rpc("get_community_home", {
    p_locality: locality,
    p_since: since,
  });
  if (error) throw error;
  return parseCommunityHome(data);
}

/**
 * Community summary for Home. Returns null while loading and if the database update hasn't been run
 * (then the dot and the card simply stay hidden: Home never breaks because of Community).
 */
export function useCommunityHome(): { home: CommunityHome | null; near: boolean } {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const { locality } = useCommunityLocality();
  const query = useQuery({
    queryKey: ["community", "home", meId, locality ?? "*"],
    queryFn: () => fetchCommunityHome(locality, getCommunitySeen(meId)),
    enabled: !!meId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return { home: query.data ?? null, near: locality !== null };
}
