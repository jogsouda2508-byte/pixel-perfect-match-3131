/**
 * HTTP security headers for the server entry (src/server.ts).
 *
 *  - Low-risk headers are ALWAYS sent (nosniff, referrer policy, permissions policy, HSTS on https).
 *  - The Content-Security-Policy is sent as `Content-Security-Policy-Report-Only` by default, so a
 *    mistake can only produce console reports, never a broken page. Set CSP_ENFORCE=1 on the server
 *    once the reports are clean (docs/SECURITY-UI.md, "Rolling out the CSP").
 *
 * Pure functions, unit-tested in src/test/security-headers.test.ts.
 */

export type HeaderOptions = {
  /** e.g. https://abcd.supabase.co (VITE_SUPABASE_URL). */
  supabaseUrl?: string | undefined;
  /** true -> send an enforced Content-Security-Policy instead of Report-Only. */
  enforceCsp?: boolean | undefined;
  /** true when the request arrived over https (adds HSTS). */
  https?: boolean | undefined;
};

function originOf(url: string | undefined): { http: string; ws: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { http: u.origin, ws: `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}` };
  } catch {
    return null;
  }
}

/** Third parties this app talks to on purpose (GIFs, music search, place search, fonts, Google avatars). */
const IMG_HOSTS = [
  "https://*.giphy.com",
  "https://*.googleusercontent.com",
  "https://*.mzstatic.com",
];
const MEDIA_HOSTS = ["https://*.mzstatic.com", "https://*.itunes.apple.com", "https://*.giphy.com"];
const CONNECT_HOSTS = [
  "https://api.giphy.com",
  "https://itunes.apple.com",
  "https://photon.komoot.io",
];

export function buildCsp(opts: Pick<HeaderOptions, "supabaseUrl"> = {}): string {
  const sb = originOf(opts.supabaseUrl);
  const sbHttp = sb ? [sb.http] : [];
  const sbWs = sb ? [sb.ws] : [];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // TanStack Start inlines its hydration script, so 'unsafe-inline' stays until nonces are added.
    // Remote script hosts are still blocked, which is what stops injected <script src=...>.
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com"]],
    ["img-src", ["'self'", "data:", "blob:", ...sbHttp, ...IMG_HOSTS]],
    ["media-src", ["'self'", "blob:", "data:", ...sbHttp, ...MEDIA_HOSTS]],
    ["connect-src", ["'self'", ...sbHttp, ...sbWs, ...CONNECT_HOSTS]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function securityHeaders(opts: HeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    // the app needs the camera, microphone and location itself; nothing else, and no payments
    "permissions-policy": "camera=(self), microphone=(self), geolocation=(self), payment=()",
  };
  if (opts.https) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  headers[opts.enforceCsp ? "content-security-policy" : "content-security-policy-report-only"] =
    buildCsp(opts);
  return headers;
}

/** Copies `response` and adds each header that the response does not already set. */
export function withSecurityHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra))
    if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
