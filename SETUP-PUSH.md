# Gicco chat: Web Push setup (do these in order)

## 0. Copy the files
Copy `src/`, `public/`, `supabase/` into your project root (Replace), or `git apply gicco-push-final.patch`.
Then: `npm run lint && npm test && npm run build`.

## 1. Generate the VAPID keys (once)
    npx web-push generate-vapid-keys
Prints a **Public Key** and a **Private Key**. Keep the private key secret (never put it in the app).
Also make a random shared secret:
    openssl rand -hex 32

## 2. Give the public key to the app
Add to your `.env` (and to the environment variables of wherever the app is hosted / Lovable project settings):
    VITE_VAPID_PUBLIC_KEY=<the Public Key>
Rebuild / redeploy the app. (Without it the app says "Notifications aren't set up yet".)

## 3. Run the migrations in Supabase (SQL Editor, in this order, if not run yet)
    20261020000000_story_single_video_views_likes.sql
    20261021000000_story_like_notifications.sql
    20261022000000_push_subscriptions.sql
    20261023000000_push_triggers.sql
Each is safe to run twice. First enable pg_net: Dashboard -> Database -> Extensions -> search "pg_net" -> enable.

## 4. Set the Edge Function secrets and deploy (Supabase CLI)
    npm i -g supabase            # or: npx supabase ...
    supabase login
    supabase link --project-ref <YOUR-PROJECT-REF>
    supabase secrets set VAPID_PUBLIC_KEY="<Public Key>" VAPID_PRIVATE_KEY="<Private Key>" VAPID_SUBJECT="mailto:you@yourdomain.com" PUSH_WEBHOOK_SECRET="<the openssl secret>"
    supabase functions deploy send-push --no-verify-jwt
(`--no-verify-jwt` is required: the database calls it with the secret header, not a login token.)

## 5. Tell the database where the function is (SQL Editor, once)
    insert into private.push_config (id, function_url, webhook_secret)
    values (true, 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/send-push', '<the SAME openssl secret>')
    on conflict (id) do update set function_url = excluded.function_url, webhook_secret = excluded.webhook_secret;
Pause everything any time with: `delete from private.push_config;`

## 6. Test on desktop Chrome (use https or http://localhost)
1. Log in as user A. Wait ~8 s: the "Turn on notifications?" card appears (or Settings -> Notifications). Click Turn on -> Allow.
2. In SQL Editor: `select user_id, left(endpoint,40) from push_subscriptions;` -> you should see a row.
3. Log in as user B in another browser/profile (or phone). Send A a chat message / like / comment / follow.
4. Close A's tab completely. Send another. A desktop notification appears; click it -> the app opens on /chat/<id>, /post/<id>, /u/<name> or /notifications.
5. Several messages in one chat replace each other (one notification, not a pile).

## 7. Test on your phone
- Android (Chrome): open the deployed https site, log in, Settings -> Notifications -> Turn on -> Allow. Lock the phone, have someone message you.
- iPhone (iOS 16.4+): Safari -> Share -> **Add to Home Screen**, open Gicco **from the Home Screen icon** (not Safari), log in, Settings -> Notifications -> Turn on -> Allow. Notifications only work from the Home Screen app.

## If nothing arrives
- Settings -> Notifications says "blocked": allow notifications for the site in the browser/phone settings.
- No row in `push_subscriptions`: the browser never subscribed (check VITE_VAPID_PUBLIC_KEY is set in the BUILT app).
- Check the database call: `select id, status_code, left(content::text,200) from net._http_response order by created desc limit 5;` (401 = secret mismatch, 500 = VAPID secrets missing).
- Function logs: Dashboard -> Edge Functions -> send-push -> Logs.
- Chrome DevTools -> Application -> Service Workers -> "Push" button sends a test.
