import { Capacitor } from "@capacitor/core";

/** Links that bring the person back INTO the Android app (see AndroidManifest.xml). */
export const NATIVE_AUTH_REDIRECT = "sabzone://auth-callback";
export const NATIVE_RESET_REDIRECT = "sabzone://reset-password";

export const isNativeApp = (): boolean =>
  typeof window !== "undefined" && Capacitor.isNativePlatform();

/**
 * Where Supabase should send the person after an emailed link / Google sign-in.
 * In the Android app that is the app itself (no website needed); on the web it is the site.
 */
export function authRedirect(webPath: string, nativeUrl = NATIVE_AUTH_REDIRECT): string {
  if (!isNativeApp()) return `${window.location.origin}${webPath}`;
  // The app is about to send the person away (Google / email link) and expects to be opened again by
  // `nativeUrl`. Remember that, so only a callback we really asked for is accepted (see below).
  markNativeAuthPending(nativeUrl === NATIVE_RESET_REDIRECT ? "reset" : "auth");
  return nativeUrl;
}

/* -------------------------------------------------------------------------------------------
 * Login-CSRF protection for the sabzone:// callbacks. ANY web page or app can fire such a link,
 * so a callback is accepted only once, and only shortly after the app itself started the flow.
 * Parsing lives in lib/native-auth-callback.ts. Tests: src/test/security-native-auth.test.ts
 * ----------------------------------------------------------------------------------------- */
export type NativeAuthKind = "auth" | "reset";

/** How long after the app starts the flow a callback is still accepted. */
export const PENDING_TTL_MS: Record<NativeAuthKind, number> = {
  auth: 10 * 60_000, // Google sign-in: a few minutes in the browser
  reset: 2 * 60 * 60_000, // reset email: the link can sit in the inbox (Supabase expires it after 1 hour)
};

const KEY = "sabzone.native-auth-pending";

type Pending = Partial<Record<NativeAuthKind, number>>;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(s: Storage): Pending {
  try {
    const parsed: unknown = JSON.parse(s.getItem(KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Pending = {};
    for (const k of ["auth", "reset"] as const) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Call right before opening Google sign-in or requesting a password-reset email in the app. */
export function markNativeAuthPending(kind: NativeAuthKind, now = Date.now(), s = storage()): void {
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ ...read(s), [kind]: now }));
  } catch {
    /* private mode: callbacks will simply be refused */
  }
}

/** True once, if the app started this kind of flow recently. The flag is cleared either way. */
export function consumeNativeAuthPending(
  kind: NativeAuthKind,
  now = Date.now(),
  s = storage(),
): boolean {
  if (!s) return false;
  const pending = read(s);
  const at = pending[kind];
  delete pending[kind];
  try {
    if (Object.keys(pending).length === 0) s.removeItem(KEY);
    else s.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* ignore */
  }
  return typeof at === "number" && now - at >= 0 && now - at <= PENDING_TTL_MS[kind];
}
