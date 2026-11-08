import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatClock } from "@/lib/business";
import { isMissingFunctionError, isMissingTableError } from "@/lib/db-errors";
import { useLocality } from "@/lib/use-locality";

// The generated database types don't know the community tables, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

export const COMMUNITY_MIGRATION_HINT =
  "Community needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261104000000_community.sql, then try again.";

type DbError = { message?: string | null; code?: string | null } | null | undefined;

/** Turns a database error into a message a person can act on. */
export function communityError(error: DbError, fallback: string): Error {
  if (isMissingFunctionError(error) || isMissingTableError(error))
    return new Error(COMMUNITY_MIGRATION_HINT);
  const msg = error?.message ?? "";
  if (error?.code === "P0001" && msg) return new Error(msg);
  if (error?.code === "23514") return new Error("Please check what you entered and try again.");
  if (error?.code === "42501") return new Error("You don't have permission to do that.");
  if (/failed to fetch|network/i.test(msg))
    return new Error("No connection. Check your internet and try again.");
  return new Error(fallback);
}

async function rpc<T>(name: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    console.error(`${name} failed`, error);
    throw communityError(error, fallback);
  }
  return data as T;
}

const asArray = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

export type CommunityPerson = {
  id: string;
  name: string;
  username: string;
  avatar_url: string | null;
};

// ------------------------------------------------------------ my locality
const EVERYWHERE = "*";
const localityKey = (userId: string) => `ediraa.community-locality.${userId}`;

/**
 * The area Community shows. Starts as the place picked for the Local feed, else the profile's
 * location, else "everywhere". Changing it is remembered on this device. `locality` is null for everywhere.
 */
export function useCommunityLocality() {
  const { user, profile } = useAuth();
  const meId = user?.id ?? "";
  const [feedPick] = useLocality(meId);
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (!meId) return;
    try {
      setStored(window.localStorage.getItem(localityKey(meId)));
    } catch {
      /* storage can be unavailable; the pick just won't persist */
    }
  }, [meId]);

  const fallback = feedPick?.trim() || profile?.location?.trim() || null;
  const raw = stored ?? fallback ?? EVERYWHERE;
  const locality = raw === EVERYWHERE ? null : raw;

  const setLocality = useCallback(
    (value: string | null) => {
      const next = value?.trim() ? value.trim() : EVERYWHERE;
      setStored(next);
      try {
        window.localStorage.setItem(localityKey(meId), next);
      } catch {
        /* see above */
      }
    },
    [meId],
  );
  return { locality, setLocality, profileLocation: profile?.location?.trim() || null };
}

// ------------------------------------------------------------- time (IST)
function istParts(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return {
    y: ist.getUTCFullYear(),
    m: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    dow: ist.getUTCDay(),
    h: ist.getUTCHours(),
    min: ist.getUTCMinutes(),
    dayNumber: Math.floor(ist.getTime() / 86_400_000),
  };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clock = (d: Date) => {
  const p = istParts(d);
  return formatClock(`${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`);
};

/** "Today, 6:30 PM" / "Tomorrow, 9 AM" / "Sat, 8 Nov, 7 PM" (Indian time). */
export function formatEventWhen(startIso: string, now: Date = new Date()): string {
  const s = new Date(startIso);
  const a = istParts(s);
  const diff = a.dayNumber - istParts(now).dayNumber;
  const day =
    diff === 0
      ? "Today"
      : diff === 1
        ? "Tomorrow"
        : diff === -1
          ? "Yesterday"
          : `${WEEKDAYS[a.dow]}, ${a.day} ${MONTHS[a.m]}`;
  return `${day}, ${clock(s)}`;
}

/** The little calendar badge: { day: "8", month: "NOV" }. */
export function eventBadge(startIso: string) {
  const p = istParts(new Date(startIso));
  return { day: String(p.day), month: MONTHS[p.m]!.toUpperCase() };
}

// ------------------------------------------------------------------ events
export const EVENT_CATEGORIES = [
  "Festival",
  "Sports",
  "Health",
  "Learning",
  "Music",
  "Food",
  "Kids",
  "Community",
  "Other",
] as const;

export type RsvpStatus = "going" | "interested";

export type CommunityEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  locality: string;
  venue: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  cancelled: boolean;
  host: CommunityPerson & { is_business: boolean };
  going_count: number;
  interested_count: number;
  my_status: RsvpStatus | null;
  is_mine: boolean;
};

export type EventScope = "upcoming" | "going" | "hosting" | "past";

const EVENT_DEFAULT_LENGTH_MS = 3 * 3600_000;
export const eventEnd = (e: { starts_at: string; ends_at: string | null }) =>
  e.ends_at
    ? new Date(e.ends_at)
    : new Date(new Date(e.starts_at).getTime() + EVENT_DEFAULT_LENGTH_MS);

export type EventStatus = {
  state: "live" | "soon" | "upcoming" | "ended" | "cancelled";
  text: string;
};

export function eventStatus(
  e: { starts_at: string; ends_at: string | null; cancelled: boolean },
  now: Date = new Date(),
): EventStatus {
  if (e.cancelled) return { state: "cancelled", text: "Cancelled" };
  const start = new Date(e.starts_at).getTime();
  const t = now.getTime();
  if (t >= eventEnd(e).getTime()) return { state: "ended", text: "Ended" };
  if (t >= start) return { state: "live", text: "Happening now" };
  const mins = Math.round((start - t) / 60_000);
  if (mins < 60) return { state: "soon", text: `Starts in ${Math.max(mins, 1)} min` };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { state: "soon", text: `Starts in ${hours} h` };
  return { state: "upcoming", text: "" };
}

/** null = no limit. */
export function spotsLeft(e: { capacity: number | null; going_count: number }): number | null {
  return e.capacity === null ? null : Math.max(e.capacity - e.going_count, 0);
}

/** Date + time typed in the form (Indian time) -> ISO string, or null when not valid. */
export function istToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today's date as YYYY-MM-DD in Indian time (for the date picker's min). */
export function istToday(now: Date = new Date()): string {
  const p = istParts(now);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export type EventForm = {
  title: string;
  category: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  description: string;
  capacity: string;
  locality: string;
};
export type EventErrors = Partial<
  Record<"title" | "date" | "start" | "end" | "locality" | "capacity", string>
> & {
  count: number;
};

export function validateEventForm(f: EventForm, now: Date = new Date()): EventErrors {
  const e: EventErrors = { count: 0 };
  if (f.title.trim().length < 3) e.title = "Give your event a name (at least 3 letters)";
  if (f.locality.trim().length < 2) e.locality = "Add the area, like Whitefield";
  if (!f.date) e.date = "Pick a date";
  if (!f.start) e.start = "Pick a start time";
  const startIso = f.date && f.start ? istToIso(f.date, f.start) : null;
  if (startIso && new Date(startIso).getTime() < now.getTime() - 5 * 60_000)
    e.start = "The start time has already passed";
  if (f.end) {
    const endIso = istToIso(f.date, f.end);
    if (startIso && endIso && new Date(endIso) <= new Date(startIso))
      e.end = "The end time must be after the start";
  }
  if (f.capacity.trim()) {
    const n = Number(f.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) e.capacity = "Enter a number from 1 to 100000";
  }
  e.count = Object.keys(e).length - 1;
  return e;
}

function icsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** An .ics calendar file with two reminders (a day before, an hour before). */
export function eventToIcs(e: CommunityEvent, now: Date = new Date()): string {
  const place = [e.venue, e.locality].filter(Boolean).join(", ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gicco chat//Community//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@gicco-chat`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(new Date(e.starts_at))}`,
    `DTEND:${icsDate(eventEnd(e))}`,
    `SUMMARY:${icsText(e.title)}`,
    `LOCATION:${icsText(place)}`,
    `DESCRIPTION:${icsText(e.description ?? `Hosted by ${e.host.name} on Gicco chat`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(e.title)} starts in 1 hour`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(e.title)} is tomorrow`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function fetchEvents(args: {
  locality: string | null;
  scope: EventScope;
  category?: string;
}) {
  return rpc<unknown>(
    "get_community_events",
    {
      p_locality: args.locality,
      p_scope: args.scope,
      p_category: args.category ?? "",
      p_limit: 50,
    },
    "Couldn't load events.",
  ).then((d) => asArray<CommunityEvent>(d));
}

export async function createEvent(hostId: string, f: EventForm): Promise<void> {
  const startIso = istToIso(f.date, f.start);
  if (!startIso) throw new Error("Please pick a valid date and time.");
  const { error } = await db.from("community_events").insert({
    host_id: hostId,
    title: f.title.trim(),
    category: f.category || "Other",
    locality: f.locality.trim(),
    venue: f.venue.trim() || null,
    description: f.description.trim() || null,
    starts_at: startIso,
    ends_at: f.end ? istToIso(f.date, f.end) : null,
    capacity: f.capacity.trim() ? Number(f.capacity) : null,
  });
  if (error) {
    console.error("create event failed", error);
    throw communityError(error, "Couldn't create the event.");
  }
}

export function setRsvp(eventId: string, status: RsvpStatus | null) {
  return rpc<{ my_status: RsvpStatus | null; going_count: number }>(
    "set_event_rsvp",
    { p_event_id: eventId, p_status: status },
    "Couldn't save your response.",
  );
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await db.from("community_events").update({ cancelled: true }).eq("id", eventId);
  if (error) throw communityError(error, "Couldn't cancel the event.");
}
export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await db.from("community_events").delete().eq("id", eventId);
  if (error) throw communityError(error, "Couldn't delete the event.");
}

// ------------------------------------------------------------------ alerts
export type AlertKind = "power" | "water" | "road" | "safety" | "other";
export const ALERT_KINDS: { kind: AlertKind; label: string; example: string }[] = [
  { kind: "power", label: "Power cut", example: "Power cut" },
  { kind: "water", label: "Water supply", example: "No water supply" },
  { kind: "road", label: "Road / traffic", example: "Road blocked" },
  { kind: "safety", label: "Safety", example: "Safety concern" },
  { kind: "other", label: "Other", example: "Local update" },
];
export const alertKindLabel = (k: string) =>
  ALERT_KINDS.find((x) => x.kind === k)?.label ?? "Alert";

export type AlertStatus = "confirmed" | "unconfirmed" | "disputed" | "resolved";
export type CommunityAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  details: string | null;
  locality: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  confirm_count: number;
  dispute_count: number;
  status: AlertStatus;
  my_vote: "confirm" | "dispute" | null;
  is_mine: boolean;
  author: CommunityPerson;
};

export function alertStatusText(
  a: Pick<CommunityAlert, "status" | "confirm_count" | "dispute_count">,
) {
  const n = Number(a.confirm_count);
  switch (a.status) {
    case "confirmed":
      return `Confirmed by ${n} neighbour${n === 1 ? "" : "s"}`;
    case "disputed":
      return "Neighbours say this may not be true";
    case "resolved":
      return "Fixed: back to normal";
    default:
      return n > 0
        ? `${n} neighbour${n === 1 ? "" : "s"} confirmed so far`
        : "Waiting for neighbours to confirm";
  }
}

export function alertExpiryText(expiresIso: string, now: Date = new Date()): string {
  const mins = Math.round((new Date(expiresIso).getTime() - now.getTime()) / 60_000);
  if (mins <= 0) return "Ending";
  if (mins < 60) return `Hides in ${mins} min`;
  return `Hides in ${Math.round(mins / 60)} h`;
}

export function fetchAlerts(locality: string | null) {
  return rpc<unknown>(
    "get_community_alerts",
    { p_locality: locality, p_limit: 50 },
    "Couldn't load alerts.",
  ).then((d) =>
    asArray<CommunityAlert>(d).map((a) => ({
      ...a,
      confirm_count: Number(a.confirm_count),
      dispute_count: Number(a.dispute_count),
    })),
  );
}

export async function createAlert(
  authorId: string,
  v: { kind: AlertKind; title: string; details: string; locality: string },
): Promise<void> {
  const { error } = await db.from("community_alerts").insert({
    author_id: authorId,
    kind: v.kind,
    title: v.title.trim(),
    details: v.details.trim() || null,
    locality: v.locality.trim(),
  });
  if (error) {
    console.error("create alert failed", error);
    throw communityError(error, "Couldn't post the alert.");
  }
}

export function voteAlert(alertId: string, vote: "confirm" | "dispute" | null) {
  return rpc<null>(
    "vote_community_alert",
    { p_alert_id: alertId, p_vote: vote },
    "Couldn't save your vote.",
  );
}
export async function resolveAlert(alertId: string): Promise<void> {
  const { error } = await db
    .from("community_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", alertId);
  if (error) throw communityError(error, "Couldn't update the alert.");
}
export async function deleteAlert(alertId: string): Promise<void> {
  const { error } = await db.from("community_alerts").delete().eq("id", alertId);
  if (error) throw communityError(error, "Couldn't delete the alert.");
}

// ------------------------------------------------------------- skill swap
export const SKILL_SUGGESTIONS = [
  "Guitar",
  "Keyboard",
  "Singing",
  "Hindi",
  "Kannada",
  "English speaking",
  "Yoga",
  "Cooking",
  "Photography",
  "Coding",
  "Maths tuition",
  "Drawing",
  "Dance",
  "Cricket coaching",
  "Stitching",
  "Excel",
] as const;

export type SwapMode = "in_person" | "online" | "either";
export const SWAP_MODES: { mode: SwapMode; label: string }[] = [
  { mode: "either", label: "Either" },
  { mode: "in_person", label: "In person" },
  { mode: "online", label: "Online" },
];
export const swapModeLabel = (m: string) => SWAP_MODES.find((x) => x.mode === m)?.label ?? "Either";
export type SwapMatch = "perfect" | "teaches_you" | "wants_you" | "none";

export type SkillSwap = {
  id: string;
  teach: string;
  want: string;
  mode: SwapMode;
  note: string | null;
  locality: string;
  active: boolean;
  created_at: string;
  match: SwapMatch;
  is_mine: boolean;
  person: CommunityPerson;
};

export function swapMatchText(m: SwapMatch): string {
  switch (m) {
    case "perfect":
      return "Perfect match: you can teach each other";
    case "teaches_you":
      return "Can teach you what you want";
    case "wants_you":
      return "Wants to learn what you teach";
    default:
      return "";
  }
}

/** Same rule as the database: equal, or one contains the other (4+ letters). */
export function skillsMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/\s+/g, " ");
  const y = b.trim().toLowerCase().replace(/\s+/g, " ");
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
}

export function fetchSkillSwaps(args: { locality: string | null; query?: string }) {
  return rpc<unknown>(
    "get_community_skill_swaps",
    { p_locality: args.locality, p_query: args.query ?? "", p_limit: 60 },
    "Couldn't load skill swaps.",
  ).then((d) => asArray<SkillSwap>(d));
}

export async function createSkillSwap(
  userId: string,
  v: { teach: string; want: string; mode: SwapMode; note: string; locality: string },
): Promise<void> {
  const { error } = await db.from("community_skill_swaps").insert({
    user_id: userId,
    teach: v.teach.trim(),
    want: v.want.trim(),
    mode: v.mode,
    note: v.note.trim() || null,
    locality: v.locality.trim(),
  });
  if (error) {
    console.error("create swap failed", error);
    throw communityError(error, "Couldn't post your skill swap.");
  }
}
export async function setSwapActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.from("community_skill_swaps").update({ active }).eq("id", id);
  if (error) throw communityError(error, "Couldn't update your skill swap.");
}
export async function deleteSwap(id: string): Promise<void> {
  const { error } = await db.from("community_skill_swaps").delete().eq("id", id);
  if (error) throw communityError(error, "Couldn't delete your skill swap.");
}

// ------------------------------------------------------------------- polls
export type PollOption = { id: string; label: string; position: number; votes: number };
export type CommunityPoll = {
  id: string;
  kind: "poll" | "quiz";
  question: string;
  locality: string | null;
  closes_at: string;
  created_at: string;
  is_mine: boolean;
  author: CommunityPerson;
  options: PollOption[];
  total_votes: number;
  my_vote: string | null;
  correct_option_id: string | null;
};
export type PollScope = "open" | "closed" | "mine";

export function fetchPolls(args: { locality: string | null; scope: PollScope }) {
  return rpc<unknown>(
    "get_community_polls",
    { p_locality: args.locality, p_scope: args.scope, p_limit: 50 },
    "Couldn't load polls.",
  ).then((d) =>
    asArray<CommunityPoll>(d).map((p) => ({
      ...p,
      total_votes: Number(p.total_votes),
      options: asArray<PollOption>(p.options).map((o) => ({ ...o, votes: Number(o.votes) })),
    })),
  );
}
export function fetchPollStreak(): Promise<number> {
  return rpc<number>("get_poll_streak", {}, "Couldn't load your streak.").then((n) =>
    Number(n ?? 0),
  );
}
export function votePoll(pollId: string, optionId: string) {
  return rpc<null>(
    "vote_community_poll",
    { p_poll_id: pollId, p_option_id: optionId },
    "Couldn't save your vote.",
  );
}

export type PollForm = {
  kind: "poll" | "quiz";
  question: string;
  options: string[];
  correct: number;
  hours: number;
  everyone: boolean;
  locality: string;
};
export type PollErrors = {
  question?: string;
  options?: string;
  locality?: string;
  correct?: string;
  count: number;
};

export function validatePollForm(f: PollForm): PollErrors {
  const e: PollErrors = { count: 0 };
  if (f.question.trim().length < 5) e.question = "Write your question (at least 5 letters)";
  const filled = f.options.map((o) => o.trim()).filter(Boolean);
  if (filled.length < 2) e.options = "Add at least 2 options";
  else if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length)
    e.options = "Each option must be different";
  if (!f.everyone && f.locality.trim().length < 2) e.locality = "Add the area, or choose Everyone";
  if (f.kind === "quiz" && !f.options[f.correct]?.trim()) e.correct = "Tap the right answer";
  e.count = Object.keys(e).length - 1;
  return e;
}

export async function createPoll(f: PollForm): Promise<void> {
  // keep the right answer pointing at the same option after empty rows are dropped
  const kept = f.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
  const correct = kept.findIndex((x) => x.i === f.correct);
  await rpc<string>(
    "create_community_poll",
    {
      p_question: f.question.trim(),
      p_options: kept.map((x) => x.o),
      p_locality: f.everyone ? null : f.locality.trim(),
      p_kind: f.kind,
      p_correct_index: f.kind === "quiz" ? correct : null,
      p_hours: f.hours,
    },
    "Couldn't create the poll.",
  );
}
export async function deletePoll(id: string): Promise<void> {
  const { error } = await db.from("community_polls").delete().eq("id", id);
  if (error) throw communityError(error, "Couldn't delete the poll.");
}

export const pctOf = (votes: number, total: number) =>
  total > 0 ? Math.round((votes / total) * 100) : 0;

export function pollClosesText(closesIso: string, now: Date = new Date()): string {
  const mins = Math.round((new Date(closesIso).getTime() - now.getTime()) / 60_000);
  if (mins <= 0) return "Closed";
  if (mins < 60) return `Closes in ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `Closes in ${h} h`;
  return `Closes in ${Math.round(h / 24)} days`;
}

export type DailyPrompt = {
  kind: "poll" | "quiz";
  question: string;
  options: string[];
  correct: number;
};
const PROMPTS: { kind: "poll" | "quiz"; q: string; o: string[]; c?: number }[] = [
  {
    kind: "poll",
    q: "Best breakfast in {place}?",
    o: ["Dosa", "Idli-vada", "Poori-saagu", "Upma"],
  },
  { kind: "poll", q: "Tea or coffee to start your day?", o: ["Tea", "Filter coffee", "Neither"] },
  {
    kind: "quiz",
    q: "Which river is the main source of Bengaluru's drinking water?",
    o: ["Cauvery", "Krishna", "Tungabhadra", "Godavari"],
    c: 0,
  },
  {
    kind: "poll",
    q: "How do you usually get around {place}?",
    o: ["Walk or cycle", "Bike or scooter", "Car", "Bus or metro"],
  },
  {
    kind: "poll",
    q: "Best evening snack near {place}?",
    o: ["Pani puri", "Masala puri", "Samosa", "Bonda-bajji"],
  },
  { kind: "quiz", q: "How many states does India have?", o: ["26", "28", "29", "31"], c: 1 },
  {
    kind: "poll",
    q: "Your weekend plan?",
    o: ["Family outing", "Sports", "Movie", "Rest at home"],
  },
  {
    kind: "poll",
    q: "Is {place} getting too crowded?",
    o: ["Yes, a lot", "A little", "Not at all"],
  },
  {
    kind: "quiz",
    q: "Which festival is known as the festival of lights?",
    o: ["Diwali", "Holi", "Pongal", "Onam"],
    c: 0,
  },
  {
    kind: "poll",
    q: "Which food do you order most?",
    o: ["North Indian", "South Indian", "Chinese", "Biryani"],
  },
  {
    kind: "quiz",
    q: "Which city is called the Silicon Valley of India?",
    o: ["Hyderabad", "Pune", "Bengaluru", "Chennai"],
    c: 2,
  },
  {
    kind: "poll",
    q: "Best time for a walk or run?",
    o: ["Early morning", "Evening", "Night", "Never"],
  },
  {
    kind: "poll",
    q: "What does {place} need most?",
    o: ["Better roads", "More parks", "Less traffic", "Cleaner streets"],
  },
];

/** One suggested question per day (Indian time), so there is always something to start with. */
export function dailyPrompt(now: Date, locality: string | null): DailyPrompt {
  const p = PROMPTS[istParts(now).dayNumber % PROMPTS.length]!;
  return {
    kind: p.kind,
    question: p.q.replace("{place}", locality || "your area"),
    options: p.o,
    correct: p.c ?? 0,
  };
}

// ------------------------------------------------------------------ Ask
export const QUESTION_CATEGORIES = [
  "Health",
  "Food",
  "Housing",
  "Schools",
  "Transport",
  "Shopping",
  "Services",
  "Other",
] as const;

export type CommunityQuestion = {
  id: string;
  title: string;
  body: string | null;
  category: string;
  locality: string;
  created_at: string;
  is_mine: boolean;
  answered: boolean;
  answer_count: number;
  local_answer_count: number;
  author: CommunityPerson;
};
export type CommunityAnswer = {
  id: string;
  body: string;
  created_at: string;
  is_mine: boolean;
  accepted: boolean;
  is_local: boolean;
  helpful_count: number;
  my_helpful: boolean;
  author: CommunityPerson;
};
export type QuestionDetail = Omit<
  CommunityQuestion,
  "answered" | "answer_count" | "local_answer_count"
> & {
  accepted_answer_id: string | null;
  answers: CommunityAnswer[];
};
export type QuestionFilter = "new" | "unanswered" | "mine";

export function fetchQuestions(args: {
  locality: string | null;
  query?: string;
  filter: QuestionFilter;
}) {
  return rpc<unknown>(
    "get_community_questions",
    { p_locality: args.locality, p_query: args.query ?? "", p_filter: args.filter, p_limit: 50 },
    "Couldn't load questions.",
  ).then((d) =>
    asArray<CommunityQuestion>(d).map((q) => ({
      ...q,
      answer_count: Number(q.answer_count),
      local_answer_count: Number(q.local_answer_count),
    })),
  );
}

export async function fetchQuestion(id: string): Promise<QuestionDetail | null> {
  const d = await rpc<QuestionDetail | null>(
    "get_community_question",
    { p_id: id },
    "Couldn't load the question.",
  );
  if (!d) return null;
  return {
    ...d,
    answers: asArray<CommunityAnswer>(d.answers).map((a) => ({
      ...a,
      helpful_count: Number(a.helpful_count),
    })),
  };
}

export async function createQuestion(
  authorId: string,
  v: { title: string; body: string; category: string; locality: string },
): Promise<string> {
  const { data, error } = await db
    .from("community_questions")
    .insert({
      author_id: authorId,
      title: v.title.trim(),
      body: v.body.trim() || null,
      category: v.category || "Other",
      locality: v.locality.trim(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("create question failed", error);
    throw communityError(error, "Couldn't post your question.");
  }
  return (data as { id: string }).id;
}

export async function createAnswer(
  questionId: string,
  authorId: string,
  body: string,
): Promise<void> {
  const { error } = await db
    .from("community_answers")
    .insert({ question_id: questionId, author_id: authorId, body: body.trim() });
  if (error) {
    console.error("create answer failed", error);
    throw communityError(error, "Couldn't post your answer.");
  }
}
export function toggleHelpful(answerId: string) {
  return rpc<boolean>("toggle_answer_helpful", { p_answer_id: answerId }, "Couldn't save that.");
}
export function acceptAnswer(questionId: string, answerId: string | null) {
  return rpc<null>(
    "accept_community_answer",
    { p_question_id: questionId, p_answer_id: answerId },
    "Couldn't pick that answer.",
  );
}
export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await db.from("community_questions").delete().eq("id", id);
  if (error) throw communityError(error, "Couldn't delete the question.");
}
export async function deleteAnswer(id: string): Promise<void> {
  const { error } = await db.from("community_answers").delete().eq("id", id);
  if (error) throw communityError(error, "Couldn't delete your answer.");
}
