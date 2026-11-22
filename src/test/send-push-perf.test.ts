import { describe, expect, it } from "vitest";
import {
  DELIVERY_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_CONCURRENT_DELIVERIES,
  MAX_RECIPIENTS,
  isBodyTooLarge,
  mapWithConcurrency,
  pushSummaryLog,
} from "../../supabase/functions/send-push/logic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const out = await mapWithConcurrency([30, 5, 15, 1], 2, async (n) => {
      await sleep(n);
      return n * 2;
    });
    expect(out).toEqual([60, 10, 30, 2]);
  });

  it("never runs more than `limit` at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(3);
      running--;
    });
    expect(peak).toBe(4);
  });

  it("handles an empty list, a limit above the size, and a nonsense limit", async () => {
    expect(await mapWithConcurrency([], 5, async (x: number) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 50, async (x) => x + 1)).toEqual([2, 3]);
    expect(await mapWithConcurrency([1, 2, 3], 0, async (x) => x)).toEqual([1, 2, 3]);
    expect(await mapWithConcurrency([1, 2, 3], Number.NaN, async (x) => x)).toEqual([1, 2, 3]);
  });

  it("passes the index and rejects when a task throws", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(["a", "b", "c"], 2, async (_, i) => void seen.push(i));
    expect(seen.sort()).toEqual([0, 1, 2]);
    await expect(
      mapWithConcurrency([1, 2], 2, async () => {
        throw new Error("boom");
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("is fast enough for one request's worst case", () => {
    // 500 recipients with 25 at a time = 20 waves, not 500 simultaneous connections
    expect(Math.ceil(MAX_RECIPIENTS / MAX_CONCURRENT_DELIVERIES)).toBe(20);
    expect(DELIVERY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("isBodyTooLarge", () => {
  it("rejects only a Content-Length above the limit", () => {
    expect(isBodyTooLarge(null)).toBe(false);
    expect(isBodyTooLarge("300")).toBe(false);
    expect(isBodyTooLarge(String(MAX_BODY_BYTES))).toBe(false);
    expect(isBodyTooLarge(String(MAX_BODY_BYTES + 1))).toBe(true);
    expect(isBodyTooLarge("not a number")).toBe(false);
  });

  it("leaves room for a full request of 500 recipients", () => {
    const biggest = JSON.stringify({
      recipient_ids: Array.from({ length: MAX_RECIPIENTS }, () => "00000000-0000-4000-8000-00000000000a"),
      sender_id: "00000000-0000-4000-8000-00000000000b",
      title: "x".repeat(80),
      body: "y".repeat(140),
      url: "/" + "z".repeat(299),
      tag: "t".repeat(100),
    });
    expect(biggest.length).toBeLessThan(MAX_BODY_BYTES);
  });
});

describe("pushSummaryLog", () => {
  it("is one JSON line with numbers only", () => {
    const line = pushSummaryLog({
      ms: 123.7,
      recipients: 3,
      web: { sent: 2, removed: 1, failed: 0 },
      android: { sent: 1, removed: 0, failed: 1 },
    });
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      event: "send_push_done",
      ms: 124,
      recipients: 3,
      web: { sent: 2, removed: 1, failed: 0 },
      android: { sent: 1, removed: 0, failed: 1 },
    });
  });

  it("drops anything that is not a known counter (no endpoints, tokens or ids)", () => {
    const sneaky = {
      ms: 1,
      recipients: 1,
      web: { sent: 1, removed: 0, failed: 0, endpoint: "https://push.example/abc", token: "secret" },
      android: { sent: 0, removed: 0, failed: 0 },
    };
    const line = pushSummaryLog(sneaky);
    expect(line.includes("push.example")).toBe(false);
    expect(line.includes("secret")).toBe(false);
  });
});
