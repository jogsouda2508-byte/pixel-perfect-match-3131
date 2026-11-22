# SabZone security audit and patch: 18 Nov 2026

Scope: every table, RLS policy, SECURITY DEFINER function, RPC grant, storage bucket/policy and
edge function in `supabase/`, plus the client code that calls them.

**Nothing in this work touched your live Supabase project.** The audit ran the 41 migrations on a
throwaway local Postgres 16 that mirrors Supabase's roles and default grants. No migration was run
against your database, no setting was changed, no permission was revoked there. The two new
migrations in this patch are **files only**; they take effect when *you* apply them.

## What was checked, and how

Reading 138 policies and 103 functions is not proof, so the audit also **attacked** the schema: it
seeded users and data, then tried to read and write as a signed-out visitor, a stranger, a blocked
user and an account owner. 110 checks now run on every build (`supabase/tests/replay/security.assert.sql`).
The same suite run on the *original* schema fails 19 checks; on the patched schema, 0.

Held up under attack (no change needed):

- All 52 tables have RLS. No table is writable as another user. Strangers cannot read DMs, group chats,
  friends-only or private-account posts, stories, close-friends lists, blocks, saved posts, reports,
  notes, bookings, referrals, push subscriptions, device tokens, quiz answer keys or `account_emails`.
- All 13 `*_hide_blocked` policies are RESTRICTIVE (a permissive one would have exposed every post).
- All 79 SECURITY DEFINER functions pin `search_path`. The RPCs that take ids (`react_to_message`,
  `edit/delete_message`, `join_group`, `invite_to_group`, `remove_group_member`, `share_post_to_user`,
  `send_story_reply`, `set_post_tags`, `respond_to_booking`, `get_or_create_dm`, ...) all enforce
  ownership, membership, visibility and blocking. Blocked users cannot follow, DM or request.
- Profile `username` and `account_type` are constrained by CHECKs. No secrets or keys in the repo.
  `send-push` compares its shared secret in constant time. Realtime publishes only `messages`,
  `message_reactions`, `poll_options` (all RLS-gated).

## Findings and fixes

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | `get_login_email(username)` and `get_reset_emails(...)` returned any account's real email to **anyone with the public anon key**, even logged out (and to every logged-in user). Verified. | Fixed (edge function + `20261118000001`) |
| 2 | **High** | All five storage buckets had a world-readable `SELECT` policy, so anyone with the anon key could **list every file**: all DM photos/files (`chat-media`) and **voice messages (`voice`: missed by the earlier audit)**. Verified. | Listing closed (`20261118000000`). Bucket stays public by URL: see "Remaining" |
| 3 | Medium | `profiles.created_at` was user-writable; `claim_referral` trusts it, so anyone could reset their account age and bypass the 7-day referral window. Verified. | Fixed |
| 4 | Medium | `chat-media` accepted any file type (HTML/SVG/scripts) on your Supabase domain. | Fixed: allow-list (SVG/HTML excluded) |
| 5 | Low | 24 functions (incl. 11 trigger functions) were callable by signed-out visitors; the signed-out role held full grants on 14 tables behind RLS alone. | Fixed: visitors keep exactly 3 RPCs and zero table grants |
| 6 | Low | `get_login_emails` (unused by the app) let anyone test which emails are registered. | Fixed (revoked) |
| 7 | Low | No throttle on login / reset. | Added for these two endpoints (see edge function) |

A mistake found and fixed during the work (so you can trust the diff): my first draft of the
function-permission reset re-granted `can_view_post`, `blocked_between` and `is_profile_visible_for`
to signed-in users. Those were deliberately locked (they take arbitrary user ids, so they would let
anyone probe who blocked whom). The migration now only re-grants access that **already existed**,
and a test pins those three as uncallable. A full before/after permission diff confirms: signed-in
users lose only the three email lookups and 11 trigger functions; table access is identical; nothing
was widened.

## What's in the patch

```
supabase/migrations/20261118000000_security_hardening.sql   additive, safe to apply alone
supabase/migrations/20261118000001_revoke_email_lookup.sql  APPLY LAST (see rollout)
supabase/functions/auth-lookup/{index.ts,logic.ts}          server-side username login + reset
src/lib/auth-lookup.ts, src/lib/auth.tsx, src/routes/forgot-password.tsx
supabase/tests/replay/security.assert.sql  (+ stub now mirrors Supabase default grants)
src/test/auth-lookup-{logic,client}.test.ts, auth-signin-server.test.tsx,
  forgot-password.test.tsx, no-email-lookup-in-client.test.ts
.github/workflows/db-security.yml
```

Client behaviour: username login and "forgot password" call the `auth-lookup` function. Unknown
username and wrong password give the same answer; reset always answers "sent". The email is never
sent to the browser. One UI line changed: the "this email has more than one account" hint on the
forgot-password page is now shown to everyone (showing it only sometimes revealed how many accounts
an email has).

## Rollout order (important)

Applying step 4 early breaks username login and forgot-password until steps 2 and 3 are done.

1. Apply `20261118000000_security_hardening.sql`. Safe on its own; the app keeps working.
2. `supabase functions deploy auth-lookup` (keep JWT verification on; no new secrets needed).
3. Ship the app build from this patch. If step 2 was missed, it detects the missing function (404)
   and falls back to the old lookups, so nobody is locked out. Server errors never fall back.
4. Apply `20261118000001_revoke_email_lookup.sql`. Then delete the two clearly-marked
   `TODO: remove once 20261118000001...` fallbacks (a test fails if anything else starts calling
   those RPCs).

Rollback: step 4 is reversible with
`grant execute on function public.get_login_email(text), public.get_reset_emails(text) to anon, authenticated;`
(do this only as an emergency; it re-opens finding 1). Step 1's storage change is reversible by
recreating the `*_public_read` policies; public image/video URLs do not depend on them.

## Verify after applying (on your project, by you)

- Logged out: `POST /storage/v1/object/list/chat-media` with the anon key returns `[]`.
- Logged out: `rpc/get_login_email` returns a permission error.
- Log in with a username, sign up, upload an avatar/post/voice note/chat file, delete your account.
- Forgot password with a username and with an email: both show "check your inbox".

## Remaining risks and decisions (not changed, on purpose)

- **DM photos/files and voice notes are still reachable by anyone who has the exact URL.** Names are
  random UUIDs (unguessable) and can no longer be listed, so this is now "capability link" security.
  Truly private media means private buckets + signed URLs rendered in the 1,300-line chat screen +
  rewriting stored URLs. That is a coordinated client and data change I did not want to do blind.
  I recommend it as the next phase.
- **Follow graph is visible to every signed-in user, including who follows a *private* account**
  (`follows_select_authenticated` is `using (true)`). Fixing it changes follower counts for private
  profiles and needs a counts RPC. Profile rows (name, bio, city, avatar) of private accounts are
  also visible to all signed-in users. Both look like deliberate product choices; confirm them.
- **`plan_signup_email` / `is_username_available` stay open to visitors** (sign-up needs them). They
  reveal whether an email/username is registered. Mitigate in the Supabase dashboard (CAPTCHA on
  sign-up, Auth rate limits); I did not touch live settings.
- **Edge function and Supabase Auth's per-IP limit:** `auth-lookup` signs users in from the function's
  own IP, so Supabase's built-in sign-in rate limit applies to all users combined. Check the Auth
  rate-limit setting before a large launch. The function's own per-IP/per-username throttle
  (20 / 8 attempts per 10 min) is separate.
- Users can set `avatar_url` to any URL (tracking pixel / hotlink). Low; a CHECK would risk breaking
  Google sign-in avatars, so it is left as is.
- No rate limits on messages, follows or uploads (earlier audit item S4) beyond reports and the
  new auth endpoints: needs product numbers.
- SVG uploads in chat now fail with the generic upload error (blocked on purpose).

## Running the tests

```
npm test                                       # 498 tests, includes the new client/logic tests
PGHOST=localhost PGUSER=postgres sh supabase/tests/replay/run.sh   # migrations + security suite
deno check supabase/functions/auth-lookup/index.ts
```
