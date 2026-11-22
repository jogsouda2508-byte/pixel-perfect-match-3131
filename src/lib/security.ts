/**
 * Small, dependency-free helpers for rendering untrusted data safely.
 * Everything here is pure so it can be unit-tested (src/test/security-lib.test.ts).
 * See docs/SECURITY-UI.md.
 */

/** Escapes text for use inside XML / SVG (element text AND attribute values). */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** #rgb, #rgba, #rrggbb or #rrggbbaa. Used before a colour goes into an SVG attribute. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

const MAX_URL_LENGTH = 2048;
// control characters, spaces and backslashes are exactly what must not appear in a URL we trust
// eslint-disable-next-line no-control-regex
const HAS_UNSAFE_CHAR = /[\u0000-\u0020\u007f-\u009f\\]/;

function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_URL_LENGTH || HAS_UNSAFE_CHAR.test(v)) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol === "https:") return u;
  // plain http only for local development
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
    return u;
  return null;
}

/**
 * A URL that is safe to put in `<a href>`: https only (http only for localhost). Anything else
 * (`javascript:`, `data:`, `vbscript:`, `file:`, `intent:`, relative or malformed values) -> null.
 */
export function safeLinkUrl(raw: unknown): string | null {
  const u = parseHttpUrl(raw);
  return u ? (raw as string).trim() : null;
}

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i;

/**
 * A URL that is safe to put in `<img src>` / `<video src>`: everything `safeLinkUrl` allows,
 * plus this app's own paths ("/assets/x.png"), `blob:` previews made in this browser, and
 * base64 raster images. SVG data URLs are refused.
 */
export function safeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  if (v.startsWith("blob:"))
    return v.length <= MAX_URL_LENGTH && !HAS_UNSAFE_CHAR.test(v) ? v : null;
  if (v.startsWith("data:")) return v.length <= 2_000_000 && DATA_IMAGE.test(v) ? v : null;
  if (v.startsWith("/") && !v.startsWith("//")) return HAS_UNSAFE_CHAR.test(v) ? null : v;
  return safeLinkUrl(v);
}

// Browsers word a failed request differently: "Failed to fetch" (Chrome), "Load failed" (Safari),
// "NetworkError when attempting to fetch resource" (Firefox). \b keeps "Video upload failed" out.
const NETWORK_ERROR =
  /\bfailed to fetch\b|\bnetworkerror\b|\bnetwork request failed\b|\bload failed\b|\btimed out\b|\btimeout\b/i;
// Words that only appear in database / framework internals, never in a sentence written for people.
const INTERNAL_DETAIL =
  /violates|constraint|relation "|column "|duplicate key|syntax error|permission denied|row-level security|\bpolicy\b|\bschema\b|function public\.|pgrst|\bjwt\b|sqlstate|\bstack\b|\bat \S+ \(|typeerror|referenceerror|\bundefined\b|\bnull value\b|\[object /i;

/**
 * Turns anything that was thrown into text that is safe to show in a toast.
 *
 * Messages we wrote on purpose are kept ("Your note is too long", from a `raise exception` or a
 * `new Error("Choose a photo")`). Raw database / network / framework errors are replaced by
 * `fallback`, because they reveal table, column and constraint names.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return fallback;
  const msg = message.trim();
  if (!msg) return fallback;
  if (NETWORK_ERROR.test(msg)) return "Network error. Check your connection and try again.";
  if (msg.length > 200 || /[\r\n]/.test(msg)) return fallback;
  // Database errors carry a SQLSTATE `code`. Only P0001 (`raise exception 'text'`) is written for people.
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code !== "P0001") return fallback;
  if (INTERNAL_DETAIL.test(msg)) return fallback;
  return msg;
}
