import { beforeEach, describe, expect, it } from "vitest";
import {
  RequestMetrics,
  SLOW_REQUEST_MS,
  createInstrumentedFetch,
  metrics,
  percentile,
  routeLabel,
  setTelemetrySink,
  type RequestRecord,
  type TelemetryEvent,
} from "@/lib/telemetry";

const UID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const BASE = "https://abc.supabase.co";

describe("routeLabel", () => {
  it("names rpc and table calls without their filters or ids", () => {
    expect(routeLabel(`${BASE}/rest/v1/rpc/get_feed`)).toBe("rpc/get_feed");
    expect(routeLabel(`${BASE}/rest/v1/rpc/get_feed?p_tab=following`)).toBe("rpc/get_feed");
    expect(routeLabel(`${BASE}/rest/v1/posts?select=*&author_id=eq.${UID}&limit=10`)).toBe(
      "rest/posts",
    );
  });

  it("keeps the operation and bucket of a storage call, never the folder or file", () => {
    expect(routeLabel(`${BASE}/storage/v1/object/avatars/${UID}/me.jpg`)).toBe(
      "storage/object/avatars",
    );
    expect(routeLabel(`${BASE}/storage/v1/object/public/chat-media/${UID}/a.png`)).toBe(
      "storage/object/public/chat-media",
    );
    expect(routeLabel(`${BASE}/storage/v1/object/sign/voice/${UID}/n.webm?token=abc`)).toBe(
      "storage/object/sign/voice",
    );
    expect(routeLabel(`${BASE}/storage/v1/object/list/media`)).toBe("storage/object/list/media");
  });

  it("labels sign-in and functions, and calls everything else 'other'", () => {
    expect(routeLabel(`${BASE}/auth/v1/token?grant_type=password`)).toBe("auth/token");
    expect(routeLabel(`${BASE}/functions/v1/send-push`)).toBe("functions/send-push");
    expect(routeLabel("https://example.com/whatever")).toBe("other");
    expect(routeLabel("not a url at all")).toBe("other");
  });

  it("never lets an odd path segment through", () => {
    expect(routeLabel(`${BASE}/rest/v1/rpc/get feed%20x`)).toBe("rpc/?");
    expect(routeLabel(`${BASE}/rest/v1/${"a".repeat(200)}`)).toBe("rest/?");
  });
});

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
  });
});

const rec = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  label: "rpc/get_feed",
  method: "POST",
  status: 200,
  ms: 100,
  outcome: "ok",
  at: 0,
  ...over,
});

describe("RequestMetrics", () => {
  it("summarises count, errors, slow, p50, p95 and max per endpoint", () => {
    const m = new RequestMetrics();
    for (const ms of [100, 200, 300, 400, 500]) m.record(rec({ ms }));
    m.record(rec({ ms: SLOW_REQUEST_MS + 500 }));
    m.record(rec({ status: 500, outcome: "http_error", ms: 50 }));
    const s = m.summary()["rpc/get_feed"];
    expect(s).toEqual({ count: 7, errors: 1, slow: 1, p50: 300, p95: 2500, max: 2500 });
  });

  it("keeps only the latest problems, newest last", () => {
    const m = new RequestMetrics();
    for (let i = 0; i < 80; i++) m.record(rec({ status: 500, outcome: "http_error", ms: i }));
    const problems = m.recentProblems();
    expect(problems.length).toBe(50);
    expect(problems[problems.length - 1]?.ms).toBe(79);
  });

  it("folds new endpoint names into 'other' once too many are tracked", () => {
    const m = new RequestMetrics();
    for (let i = 0; i < 200; i++) m.record(rec({ label: `rest/t${i}` }));
    const labels = Object.keys(m.summary());
    expect(labels.length).toBeLessThanOrEqual(151);
    expect(labels.includes("other")).toBe(true);
  });

  it("reset() clears everything", () => {
    const m = new RequestMetrics();
    m.record(rec());
    m.reset();
    expect(m.summary()).toEqual({});
    expect(m.recentProblems()).toEqual([]);
  });
});

/** Captures console output for the duration of one call. */
async function captureConsole<T>(run: () => Promise<T>) {
  const warn: string[] = [];
  const error: string[] = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...a: unknown[]) => void warn.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void error.push(a.map(String).join(" "));
  try {
    return { result: await run(), warn, error };
  } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

let epoch = 0;
/** A fake clock that starts far from every earlier test, so log throttling never carries over. */
function clock() {
  epoch += 10_000_000;
  let t = epoch;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("createInstrumentedFetch", () => {
  beforeEach(() => {
    metrics.reset();
    setTelemetrySink(null);
  });

  it("passes the response through untouched and records a fast request quietly", async () => {
    const c = clock();
    const response = new Response("{}", { status: 200 });
    const f = createInstrumentedFetch(async () => response, { now: c.now });
    const { result, warn, error } = await captureConsole(() =>
      f(`${BASE}/rest/v1/rpc/get_feed`, { method: "POST" }),
    );
    expect(result).toBe(response);
    expect(warn).toEqual([]);
    expect(error).toEqual([]);
    expect(metrics.summary()["rpc/get_feed"]?.count).toBe(1);
  });

  it("logs a slow request once as a structured warning without any ids or filters", async () => {
    const c = clock();
    const f = createInstrumentedFetch(
      async () => {
        c.advance(SLOW_REQUEST_MS + 1);
        return new Response("{}", { status: 200 });
      },
      { now: c.now },
    );
    const { warn, error } = await captureConsole(async () => {
      await f(`${BASE}/rest/v1/posts?author_id=eq.${UID}&select=*`, { method: "GET" });
      await f(`${BASE}/rest/v1/posts?author_id=eq.${UID}&select=*`, { method: "GET" });
    });
    expect(error).toEqual([]);
    expect(warn.length).toBe(1); // the second one within 10 s is counted, not printed
    const line = JSON.parse(warn[0] ?? "{}");
    expect(line).toMatchObject({ event: "slow_request", label: "rest/posts", method: "GET", status: 200 });
    expect(warn[0]?.includes(UID)).toBe(false);
    expect(warn[0]?.includes("select")).toBe(false);
    expect(metrics.summary()["rest/posts"]?.slow).toBe(2);
  });

  it("says how many similar problems were held back when it logs again later", async () => {
    const c = clock();
    const f = createInstrumentedFetch(async () => new Response("", { status: 502 }), { now: c.now });
    const { error } = await captureConsole(async () => {
      await f(`${BASE}/rest/v1/rpc/get_feed`);
      await f(`${BASE}/rest/v1/rpc/get_feed`);
      await f(`${BASE}/rest/v1/rpc/get_feed`);
      c.advance(11_000);
      await f(`${BASE}/rest/v1/rpc/get_feed`);
    });
    expect(error.length).toBe(2);
    expect(JSON.parse(error[1] ?? "{}").similar_suppressed).toBe(2);
  });

  it("logs a server error as an error, but not a 4xx (those are normal answers)", async () => {
    const c = clock();
    let status = 500;
    const f = createInstrumentedFetch(async () => new Response("", { status }), { now: c.now });
    const first = await captureConsole(() => f(`${BASE}/rest/v1/rpc/get_people`));
    expect(JSON.parse(first.error[0] ?? "{}")).toMatchObject({
      event: "request_failed",
      status: 500,
      outcome: "http_error",
    });
    status = 409;
    const second = await captureConsole(() => f(`${BASE}/rest/v1/rpc/get_notifications`));
    expect(second.error).toEqual([]);
    expect(metrics.summary()["rpc/get_notifications"]?.errors).toBe(1);
  });

  it("records a network failure (without the error message) and rethrows the same error", async () => {
    const c = clock();
    const boom = new TypeError(`Failed to fetch ${BASE}/rest/v1/rpc/get_feed?token=secret`);
    const f = createInstrumentedFetch(async () => Promise.reject(boom), { now: c.now });
    const { error, result } = await captureConsole(() =>
      f(`${BASE}/rest/v1/rpc/get_feed`).then(
        () => "resolved",
        (e: unknown) => e,
      ),
    );
    expect(result).toBe(boom);
    expect(JSON.parse(error[0] ?? "{}")).toMatchObject({ outcome: "network_error", status: 0 });
    expect(error[0]?.includes("secret")).toBe(false);
  });

  it("stops a database request that gets no answer, and records a timeout", async () => {
    const c = clock();
    const f = createInstrumentedFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      { timeoutMs: 25, now: c.now },
    );
    const { result, error } = await captureConsole(() =>
      f(`${BASE}/rest/v1/rpc/get_feed`).then(
        () => "resolved",
        (e: unknown) => e,
      ),
    );
    expect((result as { name?: string }).name).toBe("TimeoutError");
    expect(JSON.parse(error[0] ?? "{}")).toMatchObject({ outcome: "timeout", label: "rpc/get_feed" });
  });

  it("never times out a storage upload", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const f = createInstrumentedFetch(
      async (_input, init) => {
        seen.push(init?.signal);
        return new Response("{}", { status: 200 });
      },
      {},
    );
    const init = { method: "POST" };
    await f(`${BASE}/storage/v1/object/videos/${UID}/clip.mp4`, init);
    expect(seen[0]).toBe(undefined);
  });

  it("does not count a request the caller cancelled as a failure", async () => {
    const c = clock();
    const caller = new AbortController();
    const f = createInstrumentedFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      { now: c.now, timeoutMs: 5_000 },
    );
    const { error, result } = await captureConsole(() => {
      const p = f(`${BASE}/rest/v1/rpc/get_feed`, { signal: caller.signal }).then(
        () => "resolved",
        (e: unknown) => e,
      );
      caller.abort();
      return p;
    });
    expect((result as { name?: string }).name).toBe("AbortError");
    expect(error).toEqual([]);
    expect(metrics.summary()["rpc/get_feed"]).toBe(undefined);
  });

  it("tells an optional sink about slow and failed requests, and survives a sink that throws", async () => {
    const c = clock();
    const events: TelemetryEvent[] = [];
    setTelemetrySink((e) => {
      events.push(e);
      throw new Error("sink bug");
    });
    const f = createInstrumentedFetch(async () => new Response("", { status: 503 }), { now: c.now });
    await captureConsole(() => f(`${BASE}/rest/v1/rpc/get_feed`));
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.record.label).toBe("rpc/get_feed");
  });
});
