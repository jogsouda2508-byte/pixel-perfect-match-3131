import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANDROID_CHANNEL_ID,
  base64url,
  buildFcmMessage,
  fcmErrorCode,
  getAccessToken,
  isDeadFcmToken,
  parseServiceAccount,
  resetAccessTokenCache,
  sendFcm,
  signServiceAccountJwt,
} from "../../supabase/functions/send-push/fcm";

async function makeServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return {
    publicKey: pair.publicKey,
    sa: {
      project_id: "gicco-test",
      client_email: "push@gicco-test.iam.gserviceaccount.com",
      private_key: pem,
    },
  };
}

const fromB64Url = (s: string) =>
  atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));

const payload = { title: "Ana", body: "hi", url: "/chat/1", tag: "chat:1" };

describe("parseServiceAccount", () => {
  it("reads the Firebase JSON and fixes escaped newlines", () => {
    const sa = parseServiceAccount(
      JSON.stringify({ project_id: "p", client_email: "e@x", private_key: "A\\nB", extra: 1 }),
    );
    expect(sa).toEqual({ project_id: "p", client_email: "e@x", private_key: "A\nB" });
  });

  it("rejects missing or broken input", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("nope")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "p" }))).toBeNull();
  });
});

describe("Google sign-in", () => {
  beforeEach(() => resetAccessTokenCache());

  it("signs a JWT that verifies with the matching public key", async () => {
    const { sa, publicKey } = await makeServiceAccount();
    const jwt = await signServiceAccountJwt(sa, 1_800_000_000_000);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(fromB64Url(h))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(fromB64Url(c))).toMatchObject({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const sig = Uint8Array.from(fromB64Url(s), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("exchanges it for an access token and reuses it until it nearly expires", async () => {
    const { sa } = await makeServiceAccount();
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })),
    );
    const f = fetchFn as unknown as typeof fetch;
    expect(await getAccessToken(sa, f, 1_000)).toBe("tok");
    expect(await getAccessToken(sa, f, 2_000)).toBe("tok");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await getAccessToken(sa, f, 1_000 + 3600 * 1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("explains a failed sign-in", async () => {
    const { sa } = await makeServiceAccount();
    const fetchFn = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(getAccessToken(sa, fetchFn as unknown as typeof fetch)).rejects.toThrow(
      /sign-in for FCM failed/,
    );
  });
});

describe("FCM messages", () => {
  it("builds a high-priority notification on the app's channel, with the link in data", () => {
    const m = buildFcmMessage("TOKEN", payload).message;
    expect(m.token).toBe("TOKEN");
    expect(m.notification).toEqual({ title: "Ana", body: "hi" });
    expect(m.data).toEqual({ url: "/chat/1", tag: "chat:1" });
    expect(m.android.priority).toBe("HIGH");
    expect(m.android.notification).toEqual({ channel_id: ANDROID_CHANNEL_ID, tag: "chat:1" });
    expect(Object.values(m.data).every((v) => typeof v === "string")).toBe(true);
  });

  it("leaves the tag out when there is none", () => {
    const m = buildFcmMessage("T", { ...payload, tag: "" }).message;
    expect(m.android.notification).toEqual({ channel_id: ANDROID_CHANNEL_ID });
  });

  it("recognises dead tokens but not other errors", () => {
    const unregistered = { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } };
    expect(fcmErrorCode(unregistered)).toBe("UNREGISTERED");
    expect(isDeadFcmToken(404, unregistered)).toBe(true);
    expect(
      isDeadFcmToken(400, {
        error: {
          status: "INVALID_ARGUMENT",
          message: "The registration token is not a valid FCM registration token",
        },
      }),
    ).toBe(true);
    expect(
      isDeadFcmToken(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } }),
    ).toBe(false);
    expect(isDeadFcmToken(500, { error: { status: "INTERNAL" } })).toBe(false);
    expect(isDeadFcmToken(429, null)).toBe(false);
  });

  it("sends to the project's endpoint with the bearer token", async () => {
    const { sa } = await makeServiceAccount();
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await sendFcm(sa, "ACCESS", "TOKEN", payload, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/gicco-test/messages:send");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer ACCESS");
  });

  it("reports a dead token from a failed send", async () => {
    const { sa } = await makeServiceAccount();
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } }), {
          status: 404,
        }),
    );
    const r = await sendFcm(sa, "A", "T", payload, fetchFn as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, dead: true, status: 404 });
  });

  it("base64url has no padding or unsafe characters", () => {
    expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
  });
});
