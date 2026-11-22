import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ value: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.value } }));

import {
  PENDING_TTL_MS,
  authRedirect,
  consumeNativeAuthPending,
  markNativeAuthPending,
} from "@/lib/auth-redirect";
import { parseNativeAuthUrl } from "@/lib/native-auth-callback";

const JWT_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
const JWT_R = "refreshTokenValue123";

beforeEach(() => {
  localStorage.clear();
  native.value = false;
});

describe("parseNativeAuthUrl (strict parsing of sabzone:// callbacks)", () => {
  it("accepts a Google sign-in callback with tokens in the fragment", () => {
    expect(
      parseNativeAuthUrl(
        `sabzone://auth-callback#access_token=${JWT_A}&refresh_token=${JWT_R}&type=bearer`,
      ),
    ).toEqual({
      kind: "auth",
      accessToken: JWT_A,
      refreshToken: JWT_R,
    });
  });
  it("accepts a reset callback, and a code instead of tokens", () => {
    expect(
      parseNativeAuthUrl(`sabzone://reset-password#access_token=${JWT_A}&refresh_token=${JWT_R}`),
    ).toMatchObject({ kind: "reset" });
    expect(parseNativeAuthUrl("sabzone://auth-callback?code=abc123-DEF_456")).toEqual({
      kind: "auth",
      code: "abc123-DEF_456",
    });
  });
  it("accepts a trailing slash before the query or fragment", () => {
    expect(parseNativeAuthUrl("sabzone://auth-callback/?code=abcdef")).toMatchObject({
      code: "abcdef",
    });
  });
  it.each([
    [
      "another host that merely starts the same",
      `sabzone://auth-callback.evil.example#access_token=${JWT_A}&refresh_token=${JWT_R}`,
    ],
    ["a longer host name", `sabzone://auth-callbackX#access_token=${JWT_A}&refresh_token=${JWT_R}`],
    ["another scheme", `https://auth-callback#access_token=${JWT_A}&refresh_token=${JWT_R}`],
    ["another sabzone path", `sabzone://open-chat#access_token=${JWT_A}&refresh_token=${JWT_R}`],
    ["no credentials", "sabzone://auth-callback"],
    ["only an access token", `sabzone://auth-callback#access_token=${JWT_A}`],
    [
      "tokens with markup in them",
      `sabzone://auth-callback#access_token=<script>alert(1)</script>&refresh_token=${JWT_R}`,
    ],
    ["a too-short token", "sabzone://auth-callback#access_token=a&refresh_token=b"],
    ["a code with odd characters", "sabzone://auth-callback?code=../../etc/passwd"],
    ["an enormous link", "sabzone://auth-callback#" + "a".repeat(5000)],
    ["an empty string", ""],
  ])("refuses %s", (_name, url) => {
    expect(parseNativeAuthUrl(url)).toBeNull();
  });
  it("refuses non-strings", () => {
    for (const v of [null, undefined, 5, {}]) expect(parseNativeAuthUrl(v)).toBeNull();
  });
});

describe("pending flag (login-CSRF protection)", () => {
  const T0 = 1_000_000;

  it("refuses a callback the app never asked for", () => {
    expect(consumeNativeAuthPending("auth", T0)).toBe(false);
    expect(consumeNativeAuthPending("reset", T0)).toBe(false);
  });
  it("accepts a callback shortly after the app started the flow, and only once", () => {
    markNativeAuthPending("auth", T0);
    expect(consumeNativeAuthPending("auth", T0 + 60_000)).toBe(true);
    expect(consumeNativeAuthPending("auth", T0 + 61_000)).toBe(false);
  });
  it("expires: Google sign-in after 10 minutes, a reset email after 2 hours", () => {
    markNativeAuthPending("auth", T0);
    expect(consumeNativeAuthPending("auth", T0 + PENDING_TTL_MS.auth + 1)).toBe(false);
    markNativeAuthPending("reset", T0);
    expect(consumeNativeAuthPending("reset", T0 + 90 * 60_000)).toBe(true);
    markNativeAuthPending("reset", T0);
    expect(consumeNativeAuthPending("reset", T0 + PENDING_TTL_MS.reset + 1)).toBe(false);
  });
  it("keeps the two kinds apart: a reset request does not authorise a sign-in callback", () => {
    markNativeAuthPending("reset", T0);
    expect(consumeNativeAuthPending("auth", T0 + 1000)).toBe(false);
    expect(consumeNativeAuthPending("reset", T0 + 1000)).toBe(true);
  });
  it("ignores a flag from the future and tolerates corrupted storage", () => {
    markNativeAuthPending("auth", T0 + 10_000_000);
    expect(consumeNativeAuthPending("auth", T0)).toBe(false);
    localStorage.setItem("sabzone.native-auth-pending", "{not json");
    expect(consumeNativeAuthPending("auth", T0)).toBe(false);
    localStorage.setItem(
      "sabzone.native-auth-pending",
      JSON.stringify({ auth: "yesterday", reset: null }),
    );
    expect(consumeNativeAuthPending("auth", T0)).toBe(false);
  });
});

describe("authRedirect raises the flag only inside the Android app", () => {
  it("web: returns the site URL and sets nothing", () => {
    expect(authRedirect("/reset-password", "sabzone://reset-password")).toBe(
      `${window.location.origin}/reset-password`,
    );
    expect(localStorage.getItem("sabzone.native-auth-pending")).toBeNull();
  });
  it("app: returns the sabzone:// link and remembers that a reset link is expected", () => {
    native.value = true;
    expect(authRedirect("/reset-password", "sabzone://reset-password")).toBe(
      "sabzone://reset-password",
    );
    expect(consumeNativeAuthPending("reset")).toBe(true);
    expect(consumeNativeAuthPending("auth")).toBe(false);
  });
  it("app: the default redirect is the Google sign-in callback", () => {
    native.value = true;
    expect(authRedirect("/onboarding")).toBe("sabzone://auth-callback");
    expect(consumeNativeAuthPending("auth")).toBe(true);
  });
});
