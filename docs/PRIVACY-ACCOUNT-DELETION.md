# Privacy and account deletion (Nov 2026)

## What changed

**Account deletion (`src/lib/account.ts`, `src/components/delete-account.tsx`)**

1. Email accounts must type their password. Google accounts have no password, so the server instead requires a sign-in from the last 10 minutes and the dialog offers "Sign out and sign in again".
2. The server checks that sign-in age (`my_session_is_fresh()`) **before** any file is touched. A stale session can no longer delete an account, and a refused request never strands a person with their photos already gone.
3. Files are removed before the account, as before, but a listing or removal error now stops the deletion with a clear message instead of being skipped. (Skipping left public avatars and videos online for people who no longer had an account.) A missing bucket counts as empty, and each removal is retried once.
4. After a successful deletion, the data this app keeps on the device for that person is wiped.

**Database (`20261116000000_privacy_account_deletion.sql`)**

- `delete_my_account()` now refuses stale sessions, hands a group the person created to another member (admins first, then longest-standing) instead of destroying the group and its chat for everybody, and deletes chat rooms nobody is left in.
- `get_login_emails(text)` is closed to the public key. The app does not use it (log-in is by username) and it turned a mailbox into the account emails behind it.

**Text:** Privacy Policy and the public /delete-account page describe the password step and the group hand-over.

## Apply order (nothing here deploys itself)

1. Apply the patch to the repo and review it.
2. Run `supabase/migrations/20261116000000_privacy_account_deletion.sql` (SQL Editor or `supabase db push`) **before** shipping the new web/app build. The new client calls `my_session_is_fresh()`; without it the dialog shows the "run the migration" hint.
3. Ship the build.

## Tests

- `src/test/account.test.ts`: order of operations, wrong password, stale session, file failures, missing bucket, error mapping, device wipe.
- `supabase/tests/replay/delete_account.assert.sql`: stale/foreign/fresh sessions, group hand-over, orphan chats, other people's data untouched, closed email lookup, and a guard that fails if any new table pointing at a person lacks `on delete cascade` / `set null`.

## Still open (not changed on purpose)

- **S1: username to email lookup is public.** `get_login_email(username)` and `get_reset_emails(identifier)` still answer to the public key, so anyone can learn the login email behind a username. The fix is a server-side log-in and reset step (an Edge Function holding the service key) so the browser never sees the email. That changes how everyone signs in and needs a deployment, so it is not part of this patch.
- **S2: `chat-media` is a public bucket.** Chat photos and videos are reachable by anyone who has the URL. Making it private means signed URLs everywhere chat media is shown, plus rewriting stored URLs.
- **Reports** that mention a deleted person are kept with the person unlinked (the policy says so). The free-text `details` of a report is kept as written.
- Backups follow the provider's normal cycle.
