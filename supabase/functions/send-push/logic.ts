// Pure helpers for the send-push Edge Function (no Deno / network imports, so they are
// unit-tested with the app's normal test runner: src/test/send-push-logic.test.ts).

export type PushRequest = {
  /** people who should get the notification */
  recipient_ids: string[];
  /** who caused it; never notified about their own action */
  sender_id: string | null;
  title: string;
  body: string;
  /** an in-app path such as /chat/<id> */
  url: string;
  /** same tag = the newer notification replaces the older one */
  tag: string;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_RECIPIENTS = 500;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Only in-app paths; anything else (other sites, protocol-relative links) becomes "/". */
export function safeAppPath(url: unknown): string {
  if (typeof url !== "string") return "/";
  const u = url.trim();
  if (!u.startsWith("/") || u.startsWith("//") || u.includes("\\") || /[\u0000-\u001f]/.test(u)) {
    return "/";
  }
  return clip(u, 300);
}

export type ParseResult = { ok: true; value: PushRequest } | { ok: false; error: string };

export function parsePushRequest(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Body must be a JSON object." };
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r["recipient_ids"])) return { ok: false, error: "recipient_ids must be an array." };
  const ids = [...new Set(r["recipient_ids"].filter((x): x is string => typeof x === "string"))];
  if (ids.some((id) => !UUID.test(id))) return { ok: false, error: "recipient_ids must be UUIDs." };
  if (ids.length > MAX_RECIPIENTS) return { ok: false, error: "Too many recipients." };

  const sender = r["sender_id"];
  if (sender !== null && sender !== undefined && (typeof sender !== "string" || !UUID.test(sender))) {
    return { ok: false, error: "sender_id must be a UUID." };
  }

  const title = typeof r["title"] === "string" ? r["title"].trim() : "";
  if (!title) return { ok: false, error: "title is required." };
  const body = typeof r["body"] === "string" ? r["body"].trim() : "";

  return {
    ok: true,
    value: {
      recipient_ids: ids,
      sender_id: typeof sender === "string" ? sender : null,
      title: clip(title, 80),
      body: clip(body, 140),
      url: safeAppPath(r["url"]),
      tag: typeof r["tag"] === "string" ? clip(r["tag"].trim(), 100) : "",
    },
  };
}

/** Everyone except the sender, once each. */
export function recipientsWithoutSender(req: PushRequest): string[] {
  return req.recipient_ids.filter((id) => id !== req.sender_id);
}

export function toPayload(req: PushRequest): PushPayload {
  return { title: req.title, body: req.body, url: req.url, tag: req.tag };
}

/** The push service says the subscription is gone for good. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** Constant-time string comparison for the shared secret. */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
