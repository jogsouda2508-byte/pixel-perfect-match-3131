# Private chat media

Only the people in a conversation can read its messages, photos, files and voice messages.

## What was wrong

* The `chat-media` and `voice` storage buckets were **public**. Anyone holding a file's address
  (signed in or not) could open it, and the address was stored in plain text in every message.
* `chat-media` accepted **any file type**, including HTML, SVG and APK files.
* `send_chat_message` / `send_voice_message` only checked that the address *contained* the sender's
  folder, so a foreign address with that text inside was accepted.

Messages themselves were already protected correctly (row level security: members only, no direct
media columns, no direct edits); that is now covered by automated tests so it stays that way.

## What changed

| Where | Change |
| --- | --- |
| `supabase/migrations/20261116000000_private_chat_media.sql` | Both buckets private. Public read rules removed. New read rule `can_read_chat_media`: *you uploaded it, or it is attached to a message in a conversation you belong to* (leave a group and you lose access). `chat-media` accepts only photos, video, audio, PDFs and common documents. Uploads must be a plain file name in your own folder. The two send functions now check strictly (`chat_media_path`). Nothing is moved or deleted. |
| `src/lib/chat-media.ts` | Turns a stored address into a **signed URL** (valid 1 hour, cached, refreshed on failure). Refuses any address that is not one of our chat files. File-type allow-list. |
| `src/components/chat-media-img.tsx`, `chat-parts.tsx`, `voice-recorder.tsx` | Photos, quoted photos, the full-screen viewer, file links and voice playback all go through signing. |
| `src/lib/chat-extras.ts`, `src/routes/chat.$id.tsx` | Unsafe files (SVG, HTML, scripts, programs) are refused before anything is uploaded. The document picker lists only allowed extensions. |
| `src/lib/auth.tsx` | Signed links are forgotten on sign-out. |
| `supabase/tests/replay/chat_media.assert.sql` | Database tests (run by CI's migration replay). |
| `src/test/chat-media*.test.ts(x)`, `chat-upload-safety.test.ts` | App tests. |

Existing messages keep their stored value, which still has the old `.../object/public/<bucket>/...`
shape. The app reads the path out of it and signs that, so **no data migration is needed**.

## Rollout order (important)

The new app works with the public *and* the private database. An **old** app cannot show chat photos
or play voice messages once the buckets are private. So:

1. Merge and deploy the new app (web, then the Android build).
2. Wait until people have updated (or accept that old installs lose chat media until they do).
3. Run `20261116000000_private_chat_media.sql` in the Supabase SQL Editor. It is safe to run twice.
4. Run the checks below.

If something goes wrong after step 3, the quickest way back is to set the buckets to public again in
the dashboard (Storage → bucket → Edit) and re-create the old "public read" policy; the new app keeps
working either way. This is a manual step; the migration does not do it for you.

## Checks after step 3 (read-only)

* Open a conversation: photos, files and voice messages still load; a photo's `src` starts with
  `https://<project>.supabase.co/storage/v1/object/sign/`.
* Take a photo's old public address (`.../object/public/chat-media/...`) and open it in a private
  window: it must **not** show the picture.
* A signed link for a photo, opened while signed out, works until it expires (one hour). That is how
  signed links behave; see the limits below.
* Look for old risky files that were uploaded before the type list existed (they stay readable only
  by the people in their chat, but you may want to remove them):

  ```sql
  select name, metadata->>'mimetype' as type
  from storage.objects
  where bucket_id = 'chat-media'
    and (metadata->>'mimetype') in ('image/svg+xml', 'text/html', 'application/vnd.android.package-archive');
  ```

## Limits to know about

* A signed link is a key: while it lasts (1 hour), anyone who is *given* it can open that one file.
  Participants can also save, screenshot or forward what they can see. Private storage stops
  strangers, not members.
* Shared **posts** and stories keep using their own public media buckets (public posts are public).
* The type list is enforced by the bucket for new uploads. Files uploaded earlier are not rewritten.
* Signed links are unique per request, so the browser/CDN can't share one cached copy between
  people. The app keeps a one-hour in-memory cache to avoid asking again while scrolling.
* This change does not add upload rate limiting (a separate item in the audit).

## Running the tests

```
npm test                                      # app tests
PGHOST=localhost PGUSER=postgres sh supabase/tests/replay/run.sh   # replays every migration, then the *.assert.sql tests
```
