/**
 * Request timing, slow-request and failure logging for every call the app makes to Supabase.
 *
 * Wired in once, at the Supabase client (src/integrations/supabase/client.ts), so no screen has
 * to change. It records how long each request took until the server answered, keeps small
 * in-memory statistics (count, errors, slow, p50, p95, max per endpoint) and writes ONE
 * structured log line for a slow or failing request, at most once per endpoint every 10 seconds.
 *
 * Privacy: only low-cardinality labels are kept ("rpc/get_feed", "rest/posts",
 * "storage/object/avatars"). Query strings, filter values, user ids, file names, headers and
 * bodies never reach a log or a metric. Failures keep only the error's name, not its message
 * (messages can contain the URL).
 *
 * It also stops requests to the database and sign-in service that get no answer for 30 s
 * (a stalled mobile connection would otherwise wait forever). Storage uploads and downloads
 * are never timed out: a big video upload can legitimately take minutes.
 *
 * Read the numbers in the browser console: `__sabzoneMetrics()`.
 */

export const SLOW_REQUEST_MS = 2_000;
export const REQUEST_TIMEOUT_MS = 30_000;
const LOG_EVERY_MS = 10_000;
const MAX_SAMPLES_PER_LABEL = 200;
const MAX_LABELS = 150;
const MAX_RECENT_PROBLEMS = 50;

export type Outcome = "ok" | "http_error" | "network_error" | "timeout";

export type RequestRecord = {
  label: string;
  method: string;
  /** HTTP status, or 0 when no answer arrived */
  status: number;
  /** milliseconds until the server answered (headers received) */
  ms: number;
  outcome: Outcome;
  at: number;
};

export type LabelSummary = {
  count: number;
  errors: number;
  slow: number;
  p50: number;
  p95: number;
  max: number;
};

/**
 * A short, id-free name for a Supabase URL. Anything unrecognised becomes "other" so a new
 * kind of URL can never leak into logs by accident.
 */
export function routeLabel(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return "other";
  }
  const seg = path.split("/").filter(Boolean);
  const safe = (s: string | undefined) => (s && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "?");
  if (seg[0] === "rest" && seg[1] === "v1") {
    if (seg[2] === "rpc") return `rpc/${safe(seg[3])}`;
    return `rest/${safe(seg[2])}`;
  }
  if (seg[0] === "storage" && seg[1] === "v1") {
    // /storage/v1/object/<bucket>/<user id>/<file> : keep the operation and the bucket only
    const kinds = ["public", "sign", "list"];
    const op = seg[2] === "object" && kinds.includes(seg[3] ?? "") ? (seg[3] ?? "") : "";
    const bucket = seg[2] === "object" ? seg[op ? 4 : 3] : seg[3];
    return `storage/${safe(seg[2])}${op ? `/${op}` : ""}/${safe(bucket)}`;
  }
  if (seg[0] === "auth" && seg[1] === "v1") return `auth/${safe(seg[2])}`;
  if (seg[0] === "functions" && seg[1] === "v1") return `functions/${safe(seg[2])}`;
  return "other";
}

/** Nearest-rank percentile of an ascending list (p between 0 and 100). */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(sortedAscending.length, Math.max(1, rank)) - 1] ?? 0;
}

export class RequestMetrics {
  private samples = new Map<string, number[]>();
  private totals = new Map<string, { count: number; errors: number; slow: number }>();
  private problems: RequestRecord[] = [];

  record(rec: RequestRecord): void {
    let label = rec.label;
    if (!this.totals.has(label) && this.totals.size >= MAX_LABELS) label = "other";

    const total = this.totals.get(label) ?? { count: 0, errors: 0, slow: 0 };
    total.count++;
    if (rec.outcome !== "ok") total.errors++;
    if (rec.ms >= SLOW_REQUEST_MS) total.slow++;
    this.totals.set(label, total);

    const list = this.samples.get(label) ?? [];
    list.push(rec.ms);
    if (list.length > MAX_SAMPLES_PER_LABEL) list.shift();
    this.samples.set(label, list);

    if (rec.outcome !== "ok" || rec.ms >= SLOW_REQUEST_MS) {
      this.problems.push(rec);
      if (this.problems.length > MAX_RECENT_PROBLEMS) this.problems.shift();
    }
  }

  summary(): Record<string, LabelSummary> {
    const out: Record<string, LabelSummary> = {};
    for (const [label, total] of this.totals) {
      const sorted = [...(this.samples.get(label) ?? [])].sort((a, b) => a - b);
      out[label] = {
        ...total,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? 0,
      };
    }
    return out;
  }

  recentProblems(): RequestRecord[] {
    return [...this.problems];
  }

  reset(): void {
    this.samples.clear();
    this.totals.clear();
    this.problems = [];
  }
}

export const metrics = new RequestMetrics();

export type TelemetryEvent = { type: "slow" | "error"; record: RequestRecord };
type Sink = (event: TelemetryEvent) => void;
let sink: Sink | null = null;

/** Optional: forward slow/failed requests to an external monitor (never receives ids or bodies). */
export function setTelemetrySink(next: Sink | null): void {
  sink = next;
}

const lastLogged = new Map<string, { at: number; suppressed: number }>();

/** One JSON line. Goes through console, so the app's existing error capture sees errors too. */
function logProblem(rec: RequestRecord, type: "slow" | "error", now: number): void {
  const key = `${type}:${rec.label}`;
  const prev = lastLogged.get(key);
  if (prev && now - prev.at < LOG_EVERY_MS) {
    prev.suppressed++;
    return;
  }
  const suppressed = prev?.suppressed ?? 0;
  lastLogged.set(key, { at: now, suppressed: 0 });
  const line = JSON.stringify({
    event: type === "slow" ? "slow_request" : "request_failed",
    label: rec.label,
    method: rec.method,
    status: rec.status,
    ms: Math.round(rec.ms),
    outcome: rec.outcome,
    ...(suppressed > 0 && { similar_suppressed: suppressed }),
  });
  if (type === "slow") console.warn(line);
  else console.error(line);
}

function report(rec: RequestRecord, now: number): void {
  metrics.record(rec);
  const failed = rec.outcome === "network_error" || rec.outcome === "timeout" || rec.status >= 500;
  const slow = rec.ms >= SLOW_REQUEST_MS;
  if (failed) logProblem(rec, "error", now);
  else if (slow) logProblem(rec, "slow", now);
  if ((failed || slow) && sink) {
    try {
      sink({ type: failed ? "error" : "slow", record: rec });
    } catch {
      /* a broken sink must never break a request */
    }
  }
}

function timeoutFor(label: string): number | null {
  return label.startsWith("rest/") || label.startsWith("rpc/") || label.startsWith("auth/")
    ? REQUEST_TIMEOUT_MS
    : null;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createInstrumentedFetch(
  base: FetchFn,
  options: { timeoutMs?: number | null | undefined; now?: () => number } = {},
): FetchFn {
  const clock = options.now ?? (() => Date.now());
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const inputMethod = typeof input === "object" && "method" in input ? input.method : "GET";
    const method = (init?.method ?? inputMethod).toUpperCase();
    const label = routeLabel(url);
    const limit = options.timeoutMs === undefined ? timeoutFor(label) : options.timeoutMs;

    const started = clock();
    const controller = limit ? new AbortController() : null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach: (() => void) | undefined;

    if (controller && limit) {
      const outer = init?.signal ?? undefined;
      if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else {
          const onAbort = () => controller.abort(outer.reason);
          outer.addEventListener("abort", onAbort, { once: true });
          detach = () => outer.removeEventListener("abort", onAbort);
        }
      }
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("The request timed out", "TimeoutError"));
      }, limit);
    }

    try {
      const response = await base(
        input,
        controller ? { ...init, signal: controller.signal } : init,
      );
      const ms = clock() - started;
      report(
        {
          label,
          method,
          status: response.status,
          ms,
          outcome: response.status >= 400 ? "http_error" : "ok",
          at: started,
        },
        clock(),
      );
      return response;
    } catch (error) {
      const ms = clock() - started;
      // A request the caller cancelled on purpose (navigated away) is not a failure.
      const cancelled = !timedOut && (error as { name?: string } | null)?.name === "AbortError";
      if (!cancelled) {
        const outcome = timedOut ? "timeout" : "network_error";
        report({ label, method, status: 0, ms, outcome, at: started }, clock());
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      detach?.();
    }
  };
}

declare global {
  interface Window {
    __sabzoneMetrics?: () => {
      byEndpoint: Record<string, LabelSummary>;
      recentProblems: RequestRecord[];
    };
  }
}

if (typeof window !== "undefined") {
  window.__sabzoneMetrics = () => ({
    byEndpoint: metrics.summary(),
    recentProblems: metrics.recentProblems(),
  });
}
