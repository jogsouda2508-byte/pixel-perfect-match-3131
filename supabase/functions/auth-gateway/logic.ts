// Pure helpers for the auth-gateway Edge Function. No Deno or network code here, so they are
// unit-tested with vitest (src/test/auth-gateway-logic.test.ts).

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
// Deliberately simple; the real check is that the mailbox receives the code.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "@Susheel_08 " -> "susheel_08". Returns null when it is not a valid username. */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let v = input.trim().toLowerCase();
  if (v.startsWith("@")) v = v.slice(1);
  return USERNAME_RE.test(v) ? v : null;
}

/** Lower-cased, trimmed email, or null when it does not look like one (max 254 characters). */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** "john.doe@gmail.com" -> "j***@g***.com". Never shows more than the first letter of each part. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "iloveyou",
  "abc12345",
  "admin123",
  "welcome1",
  "letmein1",
  "sabzone123",
  "sabzone1",
]);

export type PasswordProblem = "too_short" | "too_long" | "too_common" | "too_similar";

/**
 * Server-side password rules (the form checks length too, but the server must not trust it).
 * Supabase rejects passwords over 72 bytes, so we say so clearly instead of failing late.
 */
export function checkPassword(
  password: unknown,
  who: { username?: string | null; email?: string | null } = {},
): PasswordProblem | null {
  if (typeof password !== "string" || password.length < 8) return "too_short";
  if (new TextEncoder().encode(password).length > 72) return "too_long";
  const p = password.toLowerCase();
  if (COMMON_PASSWORDS.has(p) || /^(.)\1+$/.test(p)) return "too_common";
  const username = who.username?.toLowerCase();
  const local = who.email?.toLowerCase().split("@")[0];
  if ((username && p === username) || (local && local.length >= 4 && p === local))
    return "too_similar";
  return null;
}

/** The caller's address, for rate limits. Cloudflare sets cf-connecting-ip and cannot be spoofed. */
export function clientIp(headers: Record<string, string | undefined>): string {
  const cf = headers["cf-connecting-ip"]?.trim();
  if (cf) return cf;
  const xff = headers["x-forwarded-for"]?.split(",")[0]?.trim();
  if (xff) return xff;
  return headers["x-real-ip"]?.trim() || "unknown";
}

/** Splits a comma list from a secret into clean origins ("https://a.com, https://b.com"). */
export function parseOrigins(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Origins the Android app (Capacitor) and local development use. Always allowed. */
export const BUILT_IN_ORIGINS = [
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return !!origin && [...BUILT_IN_ORIGINS, ...allowed].includes(origin);
}

/** App links that bring the person back INTO the Android app (see src/lib/auth-redirect.ts). */
export const NATIVE_REDIRECTS = ["sabzone://auth-callback", "sabzone://reset-password"];

/**
 * A link in an emailed message may only point at our own site or app. Without this, anyone could
 * ask for a reset email whose button leads to a look-alike page.
 */
export function redirectAllowed(url: unknown, allowedOrigins: string[]): url is string {
  if (typeof url !== "string" || url.length > 300) return false;
  if (NATIVE_REDIRECTS.includes(url)) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost"))
    return false;
  return allowedOrigins.includes(u.origin);
}

/** HMAC-SHA256 of `${label}:${value}`, shortened. Keeps raw IPs, emails and usernames out of the database. */
export async function keyHash(secret: string, label: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${label}:${value}`)),
  );
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
