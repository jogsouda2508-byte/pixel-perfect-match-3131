// Firebase Cloud Messaging (HTTP v1) helpers for the send-push Edge Function.
// No Deno-only imports: Web Crypto + fetch exist in Deno and Node, so this is unit-tested
// with the app's normal test runner (src/test/fcm.test.ts).

import type { PushPayload } from "./logic.ts";

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };

/** Must match ANDROID_CHANNEL_ID in src/lib/native-push.ts and the AndroidManifest meta-data. */
export const ANDROID_CHANNEL_ID = "gicco_default";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** The FCM_SERVICE_ACCOUNT secret is the whole JSON file downloaded from Firebase. */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!j.project_id || !j.client_email || !j.private_key) return null;
    // secrets pasted through some shells turn real newlines into the two characters \n
    return {
      project_id: j.project_id,
      client_email: j.client_email,
      private_key: j.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

export function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A signed (RS256) login request for Google, valid for one hour. */
export async function signServiceAccountJwt(sa: ServiceAccount, nowMs = Date.now()): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64url(new Uint8Array(sig))}`;
}

let cached: { token: string; expiresAt: number } | null = null;

/** An OAuth access token for the FCM API, reused until shortly before it expires. */
export async function getAccessToken(
  sa: ServiceAccount,
  fetchFn: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > nowMs) return cached.token;
  const jwt = await signServiceAccountJwt(sa, nowMs);
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google sign-in for FCM failed (${res.status}).`);
  }
  cached = { token: data.access_token, expiresAt: nowMs + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

export function resetAccessTokenCache() {
  cached = null;
}

/** One FCM message for one phone. `data` values must all be strings. */
export function buildFcmMessage(token: string, payload: PushPayload) {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: { url: payload.url, tag: payload.tag },
      android: {
        priority: "HIGH",
        ttl: "86400s",
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          // same tag = the newer notification replaces the older one
          ...(payload.tag ? { tag: payload.tag } : {}),
        },
      },
    },
  };
}

type FcmErrorBody = {
  error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
};

export function fcmErrorCode(body: unknown): string | null {
  const e = (body as FcmErrorBody | null)?.error;
  if (!e) return null;
  return e.details?.find((d) => d.errorCode)?.errorCode ?? e.status ?? null;
}

/** Google says this phone's token is gone for good (app uninstalled, token rotated). */
export function isDeadFcmToken(httpStatus: number, body: unknown): boolean {
  const code = fcmErrorCode(body);
  if (code === "UNREGISTERED" || httpStatus === 404) return true;
  const message = (body as FcmErrorBody | null)?.error?.message ?? "";
  return code === "INVALID_ARGUMENT" && /registration token/i.test(message);
}

export async function sendFcm(
  sa: ServiceAccount,
  accessToken: string,
  token: string,
  payload: PushPayload,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; dead: boolean; status: number; code: string | null }> {
  const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(buildFcmMessage(token, payload)),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, dead: isDeadFcmToken(res.status, body), status: res.status, code: fcmErrorCode(body) };
}
