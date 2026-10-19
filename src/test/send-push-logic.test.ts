import { describe, expect, it } from "vitest";
import {
  MAX_RECIPIENTS,
  isGoneStatus,
  parsePushRequest,
  recipientsWithoutSender,
  safeAppPath,
  safeEqual,
  toPayload,
} from "../../supabase/functions/send-push/logic";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

describe("parsePushRequest", () => {
  const ok = { recipient_ids: [A, B], sender_id: A, title: "Ana", body: "hi", url: "/chat/1", tag: "chat:1" };

  it("accepts a valid request and builds the { title, body, url, tag } payload", () => {
    const r = parsePushRequest(ok);
    if (!r.ok) throw new Error(r.error);
    expect(toPayload(r.value)).toEqual({ title: "Ana", body: "hi", url: "/chat/1", tag: "chat:1" });
  });

  it("skips the sender and de-duplicates recipients", () => {
    const r = parsePushRequest({ ...ok, recipient_ids: [A, B, B, C] });
    if (!r.ok) throw new Error(r.error);
    expect(recipientsWithoutSender(r.value)).toEqual([B, C]);
  });

  it("rejects bad input", () => {
    expect(parsePushRequest(null).ok).toBe(false);
    expect(parsePushRequest({ ...ok, recipient_ids: "x" }).ok).toBe(false);
    expect(parsePushRequest({ ...ok, recipient_ids: ["nope"] }).ok).toBe(false);
    expect(parsePushRequest({ ...ok, sender_id: "nope" }).ok).toBe(false);
    expect(parsePushRequest({ ...ok, title: "  " }).ok).toBe(false);
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(parsePushRequest({ ...ok, recipient_ids: many }).ok).toBe(false);
  });

  it("keeps the notification small", () => {
    const r = parsePushRequest({ ...ok, title: "t".repeat(500), body: "b".repeat(500) });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.title.length).toBeLessThanOrEqual(80);
    expect(r.value.body.length).toBeLessThanOrEqual(140);
  });

  it("allows a missing sender (e.g. system events)", () => {
    const r = parsePushRequest({ ...ok, sender_id: null });
    if (!r.ok) throw new Error(r.error);
    expect(recipientsWithoutSender(r.value)).toEqual([A, B]);
  });
});

describe("safeAppPath", () => {
  it("only allows in-app paths", () => {
    expect(safeAppPath("/chat/1")).toBe("/chat/1");
    expect(safeAppPath("/notifications")).toBe("/notifications");
    expect(safeAppPath("https://evil.example")).toBe("/");
    expect(safeAppPath("//evil.example")).toBe("/");
    expect(safeAppPath("/\\evil.example")).toBe("/");
    expect(safeAppPath(undefined)).toBe("/");
  });
});

describe("helpers", () => {
  it("treats 404 and 410 as a dead subscription, nothing else", () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(undefined)).toBe(false);
  });

  it("compares secrets exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
