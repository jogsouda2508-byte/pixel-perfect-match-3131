import type {
  AlertKind,
  CommunityAlert,
  CommunityEvent,
  CommunityPoll,
  CommunityQuestion,
} from "./community";

/**
 * Short WhatsApp messages for Community posts. WhatsApp groups are how most neighbourhoods
 * pass things around, so each message reads well on its own: a headline, the key facts, and a
 * line asking people to open the app. These are plain text builders (no app imports) so they
 * are easy to test. The caller passes the link and any text it has already formatted.
 */

/** Keeps a person's own words short inside a preview: one line, cut with "…". */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The wa.me link that opens WhatsApp's own "pick a chat" screen with the message filled in. */
export function whatsappShareHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const ALERT_EMOJI: Record<AlertKind, string> = {
  power: "⚡",
  water: "💧",
  road: "🚧",
  safety: "⚠️",
  other: "📢",
};

/** `when` is the already-formatted time, e.g. formatEventWhen(e.starts_at). */
export function eventShareText(
  e: Pick<CommunityEvent, "title" | "venue" | "locality" | "going_count">,
  when: string,
  link: string,
): string {
  const place = [e.venue, e.locality].filter(Boolean).join(", ");
  const lines = [`📅 ${clip(e.title, 80)}`, `🕒 ${when}`];
  if (place) lines.push(`📍 ${clip(place, 80)}`);
  lines.push(
    e.going_count > 0 ? `${e.going_count} going. RSVP on SabZone:` : "RSVP on SabZone:",
    link,
  );
  return lines.join("\n");
}

/** `status` is the already-written line, e.g. alertStatusText(a): "Confirmed by 4 neighbours". */
export function alertShareText(
  a: Pick<CommunityAlert, "kind" | "title" | "details" | "locality">,
  status: string,
  link: string,
): string {
  const lines = [`${ALERT_EMOJI[a.kind] ?? ALERT_EMOJI.other} ${clip(a.title, 80)}`];
  if (a.locality) lines.push(`📍 ${clip(a.locality, 60)}`);
  if (a.details) lines.push(clip(a.details, 140));
  lines.push(status, "Seen it too? Confirm or correct it on SabZone:", link);
  return lines.join("\n");
}

/**
 * Never includes votes or a quiz's right answer: people should vote first, and giving the
 * answer away in the message would spoil it.
 */
export function pollShareText(
  p: Pick<CommunityPoll, "kind" | "question" | "options">,
  link: string,
): string {
  const quiz = p.kind === "quiz";
  const options = [...p.options]
    .sort((a, b) => a.position - b.position)
    .slice(0, 6)
    .map((o, i) => `${i + 1}. ${clip(o.label, 60)}`);
  return [
    `${quiz ? "🧠 Quiz" : "📊 Poll"}: ${clip(p.question, 120)}`,
    ...options,
    quiz ? "Try it on SabZone:" : "Vote on SabZone:",
    link,
  ].join("\n");
}

export function questionShareText(
  q: Pick<CommunityQuestion, "title" | "body" | "locality">,
  link: string,
): string {
  const lines = [`❓ ${clip(q.title, 120)}`];
  if (q.body) lines.push(clip(q.body, 140));
  if (q.locality) lines.push(`📍 ${clip(q.locality, 60)}`);
  lines.push("Know the answer? Help your neighbour on SabZone:", link);
  return lines.join("\n");
}
