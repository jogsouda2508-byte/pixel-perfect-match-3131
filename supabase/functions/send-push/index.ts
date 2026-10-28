// Supabase Edge Function: send-push
// Sends a notification to every saved device of the given people:
//   - browsers (Web Push, table push_subscriptions)
//   - the Android app (Firebase Cloud Messaging, table device_tokens)
//
// Called by Postgres (pg_net, from the triggers in
// supabase/migrations/20261023000000_push_triggers.sql) with the header
// `x-push-secret`. Deploy with --no-verify-jwt: the shared secret is the protection,
// so nobody else can make this function send notifications.
//
// Secrets (supabase secrets set ...):
//   PUSH_WEBHOOK_SECRET
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)  -> browsers
//   FCM_SERVICE_ACCOUNT (the whole Firebase service-account JSON file)            -> Android
// Either group may be left out; at least one must be set.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { getAccessToken, parseServiceAccount, sendFcm } from "./fcm.ts";
import {
  isGoneStatus,
  parsePushRequest,
  recipientsWithoutSender,
  safeEqual,
  toPayload,
} from "./logic.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-push-secret") ?? "", secret)) {
    return json(401, { error: "Unauthorized." });
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  const webReady = !!(publicKey && privateKey && subject);
  const serviceAccount = parseServiceAccount(Deno.env.get("FCM_SERVICE_ACCOUNT"));
  if (!webReady && !serviceAccount) {
    console.error("send-push: neither the VAPID secrets nor FCM_SERVICE_ACCOUNT are set");
    return json(500, { error: "Push is not configured." });
  }
  if (webReady) webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  else console.warn("send-push: VAPID secrets are missing, browsers will not be notified");

  let parsed;
  try {
    parsed = parsePushRequest(await req.json());
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!parsed.ok) return json(400, { error: parsed.error });

  const recipients = recipientsWithoutSender(parsed.value);
  if (recipients.length === 0) {
    return json(200, { sent: 0, removed: 0, failed: 0, android: { sent: 0, removed: 0, failed: 0 } });
  }

  // service role: reads every person's devices (RLS would hide them from the browser)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const [webRows, phoneRows] = await Promise.all([
    webReady
      ? supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients)
      : Promise.resolve({ data: [], error: null }),
    serviceAccount
      ? supabase.from("device_tokens").select("id, token").in("user_id", recipients)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (webRows.error) {
    console.error("send-push: loading subscriptions failed", webRows.error);
    return json(500, { error: "Couldn't load subscriptions." });
  }
  // device_tokens only exists after its migration: a missing table must not stop browser push
  if (phoneRows.error) console.error("send-push: loading device tokens failed", phoneRows.error);

  const pushPayload = toPayload(parsed.value);
  const payload = JSON.stringify(pushPayload);
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    (webRows.data ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (isGoneStatus(status)) gone.push(s.id);
        else {
          failed++;
          console.error("send-push: delivery failed", status, (e as Error).message);
        }
      }
    }),
  );

  // 404 / 410 = the browser unsubscribed or the subscription expired: forget it
  if (gone.length > 0) {
    const { error: delError } = await supabase.from("push_subscriptions").delete().in("id", gone);
    if (delError) console.error("send-push: removing dead subscriptions failed", delError);
  }

  // Android app (Firebase Cloud Messaging)
  let phoneSent = 0;
  let phoneFailed = 0;
  const deadPhones: string[] = [];
  const phones = phoneRows.error ? [] : (phoneRows.data ?? []);
  if (serviceAccount && phones.length > 0) {
    try {
      const accessToken = await getAccessToken(serviceAccount);
      await Promise.all(
        phones.map(async (p) => {
          try {
            const r = await sendFcm(serviceAccount, accessToken, p.token, pushPayload);
            if (r.ok) phoneSent++;
            else if (r.dead) deadPhones.push(p.id);
            else {
              phoneFailed++;
              console.error("send-push: FCM delivery failed", r.status, r.code);
            }
          } catch (e) {
            phoneFailed++;
            console.error("send-push: FCM request failed", (e as Error).message);
          }
        }),
      );
    } catch (e) {
      phoneFailed += phones.length;
      console.error("send-push: FCM sign-in failed", (e as Error).message);
    }
  }
  // UNREGISTERED = the app was uninstalled or its token rotated: forget it
  if (deadPhones.length > 0) {
    const { error: delError } = await supabase.from("device_tokens").delete().in("id", deadPhones);
    if (delError) console.error("send-push: removing dead device tokens failed", delError);
  }

  return json(200, {
    sent,
    removed: gone.length,
    failed,
    android: { sent: phoneSent, removed: deadPhones.length, failed: phoneFailed },
  });
});
