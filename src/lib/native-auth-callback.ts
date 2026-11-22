import {
  NATIVE_AUTH_REDIRECT,
  NATIVE_RESET_REDIRECT,
  type NativeAuthKind,
} from "@/lib/auth-redirect";

export {
  PENDING_TTL_MS,
  consumeNativeAuthPending,
  markNativeAuthPending,
  type NativeAuthKind,
} from "@/lib/auth-redirect";

/**
 * The Android app is opened by `sabzone://auth-callback#access_token=...` (Google sign-in) and
 * `sabzone://reset-password#...` (password-reset email). ANY web page or app can fire such a link,
 * so without checks an attacker could push THEIR session into the victim's app (login CSRF /
 * session fixation) and then read whatever the victim uploads.
 *
 * Two defences, both here and both unit-tested (src/test/security-native-auth.test.ts):
 *   1. parseNativeAuthUrl: strict parsing, exact scheme + host, credentials in a safe format.
 *   2. a short-lived "pending" flag that only the app itself sets when IT starts Google sign-in or a
 *      password reset. A callback is accepted once, and only while the flag is fresh.
 */

export type NativeAuthLink =
  | { kind: NativeAuthKind; accessToken: string; refreshToken: string; code?: undefined }
  | { kind: NativeAuthKind; code: string; accessToken?: undefined; refreshToken?: undefined };

const MAX_LINK_LENGTH = 4096;
const TOKEN_RE = /^[A-Za-z0-9._-]{10,3000}$/;
const CODE_RE = /^[A-Za-z0-9._~-]{6,512}$/;

export function parseNativeAuthUrl(url: unknown): NativeAuthLink | null {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_LINK_LENGTH) return null;
  const base = [
    { prefix: NATIVE_AUTH_REDIRECT, kind: "auth" as const },
    { prefix: NATIVE_RESET_REDIRECT, kind: "reset" as const },
  ].find((b) => url.startsWith(b.prefix));
  if (!base) return null;
  // the character after the prefix must end the host: "sabzone://auth-callback.evil" is not ours
  const next = url.charAt(base.prefix.length);
  if (next !== "" && next !== "/" && next !== "?" && next !== "#") return null;

  const rest = url.slice(base.prefix.length);
  const hashAt = rest.indexOf("#");
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : rest.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);

  const params = new URLSearchParams(fragment || query);
  const queryParams = new URLSearchParams(query);
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (access && refresh && TOKEN_RE.test(access) && TOKEN_RE.test(refresh)) {
    return { kind: base.kind, accessToken: access, refreshToken: refresh };
  }
  const code = queryParams.get("code") ?? params.get("code");
  if (code && CODE_RE.test(code)) return { kind: base.kind, code };
  return null;
}
