/**
 * The public address of the app. Links and QR codes people share must always point here, even
 * while you test on localhost or a local network address (e.g. http://172.24.208.1:8081).
 * To use another domain later, set VITE_PUBLIC_URL (for example https://mysite.com).
 */
const DEFAULT_PUBLIC_URL = "https://pixel-perfect-match-3131.onrender.com";

export const PUBLIC_URL: string = (
  ((import.meta.env["VITE_PUBLIC_URL"] as string | undefined) ?? "").trim() ||
  DEFAULT_PUBLIC_URL
).replace(/\/+$/, "");

export function profileUrl(username: string): string {
  return `${PUBLIC_URL}/u/${encodeURIComponent(username)}`;
}
