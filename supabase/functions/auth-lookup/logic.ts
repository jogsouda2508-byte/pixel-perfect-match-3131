// Pure decision logic for the auth-lookup edge function (no Deno or network here, so it is unit
// tested with vitest like supabase/functions/send-push/logic.ts).

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export type LoginRequest = { action: "login"; username: string; password: string };
export type ResetRequest = { action: "reset"; identifier: string; redirectTo?: string };
export type ParsedRequest = LoginRequest | ResetRequest;

/** Attempts allowed per window. Per-IP stops one machine; per-name stops a spread-out guesser. */
export const LIMITS = {
  loginPerIp: { max: 20, windowSeconds: 600 },
  loginPerName: { max: 8, windowSeconds: 600 },
  resetPerIp: { max: 5, windowSeconds: 3600 },
  resetPerIdentifier: { max: 3, windowSeconds: 3600 },
} as const;

/** "@Alice " -> "alice". Only ONE leading @ is dropped, like the rest of the app. */
export function normalizeUsername(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t.startsWith("@") ? t.slice(1) : t;
}

/** Mirrors get_reset_emails: lower-case, trimmed, and a lone "@name" means the username. */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 254);
}

export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@") && !identifier.startsWith("@");
}

/**
 * Where the reset link may send the person back to: a normal web address or the app's own
 * sabzone:// link. Anything else (javascript:, data:, huge strings) is dropped, and Supabase then
 * uses the project's default Site URL. Supabase additionally checks its own redirect allow-list.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "sabzone:")
      return value;
  } catch {
    /* not a URL */
  }
  return undefined;
}

export function parseRequest(body: unknown): ParsedRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as {
    action?: unknown;
    username?: unknown;
    password?: unknown;
    identifier?: unknown;
    redirectTo?: unknown;
  };
  if (b.action === "login") {
    if (typeof b.username !== "string" || typeof b.password !== "string") return null;
    const username = normalizeUsername(b.username);
    if (!USERNAME_RE.test(username)) return null;
    if (b.password.length === 0 || b.password.length > 200) return null;
    return { action: "login", username, password: b.password };
  }
  if (b.action === "reset") {
    if (typeof b.identifier !== "string") return null;
    const identifier = normalizeIdentifier(b.identifier);
    if (identifier.length < 2) return null;
    const redirectTo = safeRedirect(b.redirectTo);
    return redirectTo
      ? { action: "reset", identifier, redirectTo }
      : { action: "reset", identifier };
  }
  return null;
}

/** The caller's address for throttling. Falls back to one shared bucket rather than none. */
export function clientKey(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for") ?? headers.get("cf-connecting-ip") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}

/** Reset targets for a request: what the lookup found, or the typed email as a harmless fallback. */
export function resetTargets(identifier: string, found: unknown): string[] {
  const list = Array.isArray(found) ? found.filter((e): e is string => typeof e === "string") : [];
  if (list.length === 0 && looksLikeEmail(identifier)) return [identifier];
  return [...new Set(list)].slice(0, 3); // an email can own at most 3 accounts
}
