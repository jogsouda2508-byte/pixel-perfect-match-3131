import { QueryClient } from "@tanstack/react-query";

/**
 * Data stays "fresh" this long, so going back to a screen or switching tabs does not fire the
 * same request again straight away. Screens that need something different set their own
 * staleTime (community lists use 10-30 s, locations 5 min); mutations still refresh what they
 * change with invalidateQueries, which ignores this.
 */
export const DEFAULT_STALE_MS = 15_000;

/** Failed reads are retried at most this many times (React Query's default is 3). */
export const MAX_QUERY_RETRIES = 2;

type ErrorLike = { status?: unknown; statusCode?: unknown; code?: unknown };

/**
 * True when asking again cannot succeed: the request was refused or is wrong (HTTP 4xx other
 * than "timed out" / "slow down", database permission / missing-object / constraint codes), as
 * opposed to a dropped connection, a 5xx, or the database being busy.
 */
export function isPermanentError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, statusCode, code } = error as ErrorLike;

  const http = Number(status ?? statusCode);
  if (Number.isInteger(http) && http >= 400 && http < 500) return http !== 408 && http !== 429;

  if (typeof code === "string") {
    // PostgREST's own codes: PGRST000-003 = database unreachable / schema cache loading (transient)
    if (/^PGRST00[0-3]$/.test(code)) return false;
    if (code.startsWith("PGRST")) return true;
    // SQLSTATE classes: 22 data, 23 integrity, 42 syntax / permission / missing object
    if (/^(22|23|42)[0-9A-Z]{3}$/.test(code)) return true;
  }
  return false;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && !isPermanentError(error);
}

/** One place for the app's React Query defaults (router.tsx). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_MS,
        retry: shouldRetryQuery,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
      },
    },
  });
}
