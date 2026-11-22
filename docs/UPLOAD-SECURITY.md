# Upload security

What changed, how to roll it out, and what it does **not** cover. Nothing in this change has been
applied to the live Supabase project or deployed.

## What is enforced now

| Area | Before | Now |
| --- | --- | --- |
| File type | `file.type` only (set from the file *name*) | The **bytes** are inspected (`src/lib/file-sniff.ts`). The stored extension and Content-Type come from the content, never from the name or declared type |
| Images (posts, stories, market, avatars, chat) | Uploaded as picked, with EXIF/GPS | JPEG/PNG/GIF/WebP are rewritten without metadata (`src/lib/image-sanitize.ts`): EXIF/GPS/XMP/comments/timestamps removed, data hidden after the end of the image removed, broken files refused. Pixels, transparency and GIF/WebP animation are untouched; JPEG rotation is kept |
| SVG / HTML as "image" | Chat passed SVG through unchanged | Refused everywhere |
| Videos | Extension taken from the file name; no content check | Container must really be MP4 / MOV / WebM; GPS and device make/model removed from MP4/MOV (`src/lib/media-sanitize.ts`); extension and type from content |
| Chat documents | Any extension, any `application/*` | Allow-list (pdf, doc/docx, xls/xlsx, ppt/pptx, txt, csv, json, rtf, zip, rar); content must match the extension; `report.exe.pdf`-style names, macro Office files and markup disguised as text are refused; file names are cleaned (no paths, no direction-override tricks) |
| Voice notes | No size or content check | Real audio container, 5 MB limit |
| Server (new migrations) | `chat-media` had no type limit; extension never checked | Per-bucket type **and** extension allow-lists on insert |
| Access to chat media | `chat-media` and `voice` public: any URL, and any anonymous *listing* | Private buckets; readable only by the uploader and members of a conversation containing a message that points at the file; shown through 1-hour signed URLs |
| Listing public buckets | Anyone with the anon key could list every path | Optional second migration limits listing to the owner |

Size limits are unchanged (images 10 MB, avatars 5 MB, videos 50 MB / 60 s, chat files 15 MB,
voice 5 MB) except that voice now also checks 5 MB in the app.

## Rollout (in this order)

1. **Merge and ship the app build.** It works with the buckets still public *and* once private.
2. **Run `supabase/migrations/20261116000000_upload_security.sql`** (staging first). Old app builds
   will show chat photos/voice as unavailable until updated.
3. **Optional, staging first: `20261116000001_public_bucket_listing.sql`.** Afterwards open a post
   image, a profile photo and a video in a logged-out window to confirm public URLs still load.

Each migration lists its own rollback statements at the top.

## Tests

* `src/test/upload-security.test.ts`: sniffing, each sanitizer, video scrubbing, attachment rules.
* `src/test/upload-wiring.test.ts`: drives the real upload functions with a fake Supabase and checks the
  bucket, path, Content-Type and bytes that would be sent.
* `src/test/private-media.test.tsx`: signed-URL handling and the chat components.
* `supabase/tests/replay/upload_security.assert.sql`: replays all migrations on Postgres and asserts
  the policies for owner / conversation member / outsider / anonymous. Run: `npm run db:replay`.

## Not covered (known limits)

* **Existing files** already in the buckets keep their EXIF/GPS. Cleaning them needs a one-off script
  with service access to the live project; none was run.
* **No malware scanning.** `zip`/`rar` attachments are still allowed because the chat UI already
  offered them; remove them from `DOCUMENT_TYPES` and the migration lists to stop that. Legacy
  `.doc/.xls/.ppt` can contain macros that cannot be detected cheaply.
* **Video:** WebM tags and GPS stored as a separate timed-metadata track (some action cameras, dash
  cams) are not removed. Only the `moov` metadata boxes of MP4/MOV are.
* **WebP / PNG rotation:** the EXIF orientation of those formats is dropped with the rest of EXIF
  (JPEG, where phones write it, is preserved).
* **Rate limiting** of uploads (audit finding S4) is not part of this change.
* **HEIC** from the chat picker is only accepted if the browser can decode it (it is then re-encoded
  as JPEG); otherwise the person sees a clear message.
* Not tested in a real browser, on an Android device, or against live Supabase.
