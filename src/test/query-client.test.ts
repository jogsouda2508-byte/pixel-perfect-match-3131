import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_MS,
  MAX_QUERY_RETRIES,
  createQueryClient,
  isPermanentError,
  shouldRetryQuery,
} from "@/lib/query-client";

describe("isPermanentError", () => {
  it("treats refused or malformed requests as permanent", () => {
    expect(isPermanentError({ status: 401 })).toBe(true);
    expect(isPermanentError({ status: 403 })).toBe(true);
    expect(isPermanentError({ status: 404 })).toBe(true);
    expect(isPermanentError({ statusCode: "406" })).toBe(true);
  });

  it("treats database permission, missing-object and integrity codes as permanent", () => {
    expect(isPermanentError({ code: "42501" })).toBe(true); // row-level security / permission
    expect(isPermanentError({ code: "42883" })).toBe(true); // missing function (migration not run)
    expect(isPermanentError({ code: "42P01" })).toBe(true); // missing table
    expect(isPermanentError({ code: "23505" })).toBe(true); // duplicate
    expect(isPermanentError({ code: "22P02" })).toBe(true); // bad input
    expect(isPermanentError({ code: "PGRST202" })).toBe(true);
    expect(isPermanentError({ code: "PGRST116" })).toBe(true);
  });

  it("keeps retrying what can recover: timeouts, throttling, 5xx, a busy database, a bad network", () => {
    expect(isPermanentError({ status: 408 })).toBe(false);
    expect(isPermanentError({ status: 429 })).toBe(false);
    expect(isPermanentError({ status: 500 })).toBe(false);
    expect(isPermanentError({ status: 503 })).toBe(false);
    expect(isPermanentError({ code: "PGRST000" })).toBe(false);
    expect(isPermanentError({ code: "PGRST002" })).toBe(false);
    expect(isPermanentError({ code: "57014" })).toBe(false); // statement timeout
    expect(isPermanentError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentError(null)).toBe(false);
    expect(isPermanentError("boom")).toBe(false);
  });
});

describe("shouldRetryQuery", () => {
  it("retries a transient failure up to the limit, then stops", () => {
    const transient = { status: 503 };
    expect(shouldRetryQuery(0, transient)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, transient)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, transient)).toBe(false);
  });

  it("never retries a permanent failure", () => {
    expect(shouldRetryQuery(0, { code: "42501" })).toBe(false);
    expect(shouldRetryQuery(0, { status: 403 })).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("applies the app defaults", () => {
    const q = createQueryClient().getDefaultOptions().queries;
    expect(q?.staleTime).toBe(DEFAULT_STALE_MS);
    expect(q?.retry).toBe(shouldRetryQuery);
  });

  it("caps the retry delay so a failing screen settles quickly", () => {
    const delay = createQueryClient().getDefaultOptions().queries?.retryDelay;
    if (typeof delay !== "function") throw new Error("retryDelay should be a function");
    expect(delay(0, new Error("x"))).toBe(1_000);
    expect(delay(1, new Error("x"))).toBe(2_000);
    expect(delay(10, new Error("x"))).toBe(5_000);
  });

  it("returns an independent client each time (one per server request)", () => {
    expect(createQueryClient() === createQueryClient()).toBe(false);
  });
});
