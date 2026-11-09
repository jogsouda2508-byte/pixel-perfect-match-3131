# Android notifications (Firebase Cloud Messaging) — step by step

Why: the Android app is a web view, and a web view cannot receive Web Push. Android delivers
"app is closed" notifications only through Google's FCM, so the app now registers with FCM
(official `@capacitor/push-notifications` plugin) and the `send-push` Edge Function sends to it.
Browsers keep using Web Push exactly as before. You use Firebase ONLY for delivery
(not for database, login or storage — Supabase stays as it is).

Do the steps in this order.

---------------------------------------------------------------------------
## A. Put the code in the project
1. Copy the files from the zip into your project root (replace when asked).
2. In the project folder run:

   ```
   npm install @capacitor/push-notifications@^8.1.3
   ```

   This adds the plugin to `package.json` and the lock file. (If you use bun: `bun add @capacitor/push-notifications@^8.1.3`.)
   Commit `package.json` + the lock file(s) together with the other files.
   The website code does NOT import this package, so the Render build keeps working either way;
   the package is only needed so `npx cap sync android` puts the native part into the APK.

## B. Database (Supabase -> SQL Editor)
Run `supabase/migrations/20261031000000_device_tokens.sql` (safe to run twice).

## C. Create the Firebase project (one time, free)
1. Go to https://console.firebase.google.com -> "Create a project" -> name it (e.g. Gicco).
   Google Analytics can be turned OFF.
2. On the project home click the Android icon ("Add app"):
   - **Android package name** = the `appId` in your `capacitor.config.ts`
     (e.g. `com.gicco.app`). It must match EXACTLY, letter for letter.
   - App nickname: anything. SHA-1: leave empty.
   - Click "Register app".
3. Click **Download google-services.json** and put it here:
   `android/app/google-services.json`
   (The `android` folder may be git-ignored, so keep a copy of this file somewhere safe.)
4. Click Next / Continue until the wizard closes. You do NOT need to paste any Gradle code:
   Capacitor's Android template already applies the Google services plugin when
   `google-services.json` exists.

## D. Give the server permission to send (Firebase service account)
1. Firebase console -> the gear icon -> **Project settings** -> tab **Service accounts**.
2. Click **Generate new private key** -> Generate. A `.json` file downloads.
   This file is a password: never commit it, never put it in the app.
3. Supabase -> your project -> **Edge Functions -> Secrets** -> add a secret:
   - Name: `FCM_SERVICE_ACCOUNT`
   - Value: open the downloaded .json in a text editor, copy EVERYTHING, paste it.
   (CLI alternative: `supabase secrets set FCM_SERVICE_ACCOUNT="$(cat path/to/file.json)"`)
4. Deploy the updated function from the project folder (this uploads the new `fcm.ts` too):
   `supabase functions deploy send-push --no-verify-jwt`
   Your existing secrets (PUSH_WEBHOOK_SECRET, VAPID_*) stay as they are.
5. If "Firebase Cloud Messaging API (V1)" shows as disabled in Project settings ->
   Cloud Messaging, enable it (new projects have it on).

## E. Android project changes (Android Studio, one time)
1. In the project folder run: `npx cap sync android`
   (adds the push plugin's native code to the android folder)
2. Open `android/app/src/main/AndroidManifest.xml` and add:

   Inside `<manifest ...>` (next to the other `<uses-permission>` lines):
   ```xml
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   ```
   Inside `<application ...>` (e.g. right before `</application>`):
   ```xml
   <meta-data
       android:name="com.google.firebase.messaging.default_notification_channel_id"
       android:value="gicco_default" />
   <meta-data
       android:name="com.google.firebase.messaging.default_notification_icon"
       android:resource="@drawable/ic_stat_gicco" />
   ```
3. Create the small status-bar icon `ic_stat_gicco` (otherwise Android shows a grey square):
   Android Studio -> right-click `app/src/main/res` -> New -> Image Asset ->
   Icon Type **Notification Icons** -> Name `ic_stat_gicco` -> pick your logo / a clip-art
   -> Next -> Finish.
4. `android/app/google-services.json` must be in place (step C3).
5. In Android Studio: File -> Sync Project with Gradle Files, then Build -> Build APK(s)
   (or Run on your phone). Install this new APK on the phone.

## F. Deploy the website
Push the code to GitHub so Render redeploys. The app loads your Render site, so the new
screens go live there; the new APK (step E) is only needed once, for the native plugin.

## G. Try it
1. Open the new app, sign in. After a few seconds "Turn on notifications?" appears
   (or Settings -> Notifications). Tap **Turn on** -> **Allow**.
2. Supabase -> Table editor -> `device_tokens`: you should see a row for your user.
3. Close the app completely (swipe it away). From another account send a message to this
   account. The notification must appear; tapping it opens that chat.

Quick server-side test without a second account (replace the three values):
```
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/send-push" \
  -H "x-push-secret: <your PUSH_WEBHOOK_SECRET>" -H "content-type: application/json" \
  -d '{"recipient_ids":["<your user id>"],"sender_id":null,"title":"Test","body":"Hello","url":"/chat","tag":"test"}'
```
The answer shows `"android":{"sent":1,...}` when it worked.

---------------------------------------------------------------------------
## If it does not work
| Symptom | Cause / fix |
|---|---|
| Settings says "install the latest version of the app" | The phone still has the OLD APK. Do steps A and E and install the new one. |
| "Notifications didn't start" / registration error | `google-services.json` missing or its package name differs from `appId`. Fix, `npx cap sync android`, rebuild. |
| "needs a one-time database update" | Run the SQL in step B. |
| `android.sent` is 0 and `failed` > 0 in the curl answer | Wrong/missing `FCM_SERVICE_ACCOUNT` secret; see Edge Functions -> send-push -> Logs. |
| Nothing shows, `sent` is 1 | Phone settings: Settings -> Apps -> Gicco -> Notifications must be ON. On Xiaomi/Redmi/Oppo/Vivo/Realme also set Battery -> "No restrictions" and turn on "Autostart", otherwise the phone maker blocks notifications. |
| "Notifications are blocked" | Android remembers a double "Don't allow". Enable it in Settings -> Apps -> Gicco -> Notifications. |
| Works for you but not another phone | Each phone must open the new app once, sign in and tap Turn on. |
