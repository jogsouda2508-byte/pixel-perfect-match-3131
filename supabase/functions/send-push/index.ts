// Supabase Edge Function: send-push
// Sends a Web Push notification to every saved browser of the given people.
//
// Called by Postgres (pg_net, from the triggers in
// supabase/migrations/20261023000000_push_triggers.sql) with the header
// `x-push-secret`. Deploy with --no-verify-jwt: the shared secret is the protection,
// so nobody else can make this function send notifications.
//
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
//   PUSH_WEBHOOK_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
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
  if (!publicKey || !privateKey || !subject) {
    console.error("send-push: VAPID secrets are missing");
    return json(500, { error: "Push is not configured." });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  let parsed;
  try {
    parsed = parsePushRequest(await req.json());
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!parsed.ok) return json(400, { error: parsed.error });

  const recipients = recipientsWithoutSender(parsed.value);
  if (recipients.length === 0) return json(200, { sent: 0, removed: 0, failed: 0 });

  // service role: reads every person's subscriptions (RLS would hide them from the browser)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", recipients);
  if (error) {
    console.error("send-push: loading subscriptions failed", error);
    return json(500, { error: "Couldn't load subscriptions." });
  }

  const payload = JSON.stringify(toPayload(parsed.value));
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    (subs ?? []).map(async (s) => {
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

  return json(200, { sent, removed: gone.length, failed });
});
