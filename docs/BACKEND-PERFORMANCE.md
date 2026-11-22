# Backend performance audit (Nov 2026)

Scope: database queries and indexes, API response times, caching, error handling, logging and
monitoring, without weakening security. This was a **code and schema audit**: every finding comes
from reading the 42 migrations that precede this patch, the client data layer and the `send-push` Edge Function. Nothing was
run against the live Supabase project, so no query plan or timing from production is quoted. Section
"How to measure" shows how to get those numbers; run it before and after applying the patch.

## Findings

| # | Area | Finding | Evidence | Status |
|---|------|---------|----------|--------|
| P1 | Indexes | 26 foreign-key columns had no index starting with them. Deleting an account (and joins by author) scanned whole tables, including `messages`, `post_comments`, `saved_posts`, `story_views`. | a static check over every `create table` / `alter table add column` / `create index`; now enforced by `src/test/migration-perf.test.ts` and `performance.assert.sql` | **Fixed** (migration `20261117000000`) |
| P2 | RLS | All 121 policies (123 uses) wrote `auth.uid()` bare, so Postgres calls it again for every row checked; none used `(select auth.uid())`. | grep over migrations: 123 bare, 0 wrapped | **Fixed** (migration `20261117000001`) |
| P3 | API time | `get_unread_notification_count()` built the whole notification list (7 sources + a scan of every chat message that shared a post, sorted, joined to profiles) only to count it. The home screen asks every 30 s. | function body in `20261018000000` calling `get_notifications(200)` | **Fixed** (counts each kind directly; shares were never counted) |
| P4 | Caching | `new QueryClient()` with library defaults: data is stale immediately (every mount refetches) and every failed read is retried 3 times, even "permission denied" or "function missing". | `src/router.tsx` | **Fixed** (`src/lib/query-client.ts`) |
| P5 | Monitoring | No timing, no slow-request signal, no crash monitor. A stalled mobile connection waited forever. | audit F: "Crash monitoring: none" | **Fixed in the app** (`src/lib/telemetry.ts`); external monitor still a choice for you |
| P6 | Edge function | `send-push` fired every delivery at once (up to 500 people times their devices), with no deadline on the push services or Google, no size limit on the body and no timing in its logs. | `supabase/functions/send-push/index.ts` | **Fixed in the patch**, deploy is yours |
| P7 | Search | Feed search and people search use `ilike '%text%'`. A leading wildcard cannot use a normal index, so they scan. A trigram index alone will **not** help: the `p_search is null or ...` shape and the function's `set search_path` stop the planner using it. | `get_feed`, `get_people` | Not changed (needs a query rewrite; see below) |
| P8 | Notifications list | `get_notifications` still walks all of a person's likes, comments, follows and shared chat messages before sorting and keeping 30. Fine now; grows with account age. | `20261025000000` | Not changed (needs a design decision) |
| P9 | Realtime | `chat-unread` and the chat list subscribe to `postgres_changes` on **all** of `messages` with no filter. Supabase checks row-level security per subscriber per change, which gets expensive with many users online. | `use-chat-unread.tsx`, `chat.index.tsx` | Not changed (see below) |
| P10 | Feed | `posts_select_visible` calls `can_view_post()` per row. Needed for private accounts, and P2 cuts its per-row cost. | `20261021000001` | Not changed |

What was already good (kept): indexes on feeds, chat, notifications sources and cascade children;
long-lived `cacheControl` on content-addressed uploads; page sizes capped in every RPC
(`least(p_limit, 50)`); the push function's token cache, shared-secret check and dead-subscription
clean-up; cursor pagination (`p_before`) on the feed.

## What the patch changes

**Database** (run in order, both idempotent, neither touches data)

1. `20261117000000_backend_performance.sql`
   - 26 `create index if not exists`, one per foreign key (reports uses a partial index: most rows are null).
   - `get_unread_notification_count()` rewritten as seven direct counts. Same rules as before: the
     same seven kinds, chat shares never count, only things newer than `profiles.notifications_seen_at`,
     capped at 100. It stays a plain function (not `security definer`), so row-level security still
     decides what is counted, and it stays open to signed-in users only.
     *One difference:* the old version counted among the newest 100 items *including* shares, so with
     more than 100 new items it could show slightly less than 100. The new count is exact up to 100.
2. `20261117000001_rls_initplan.sql` reads the policies that exist, wraps each `auth.uid()` as
   `(select auth.uid())` and re-applies them with `alter policy`. It never drops or creates a
   policy, never touches roles or commands, and compares a fingerprint of every policy's name,
   command, roles and kind before and after; if anything differs it raises an error and rolls back.

**App** (`src/`)

- `lib/query-client.ts`: data stays fresh 15 s; failed reads retry at most twice and not at all for
  permanent errors (HTTP 4xx except 408/429, permission/missing-object/constraint codes). Screens
  that set their own `staleTime` keep it. Mutations still refresh with `invalidateQueries`.
- `lib/telemetry.ts` wired in at `integrations/supabase/client.ts`:
  times every Supabase request, keeps per-endpoint count / errors / slow / p50 / p95 / max, logs
  **one JSON line** for a slow (> 2 s) or failed request, at most once per endpoint per 10 s, and
  stops database and sign-in requests that get no answer for 30 s. Storage uploads are never timed
  out. Labels are like `rpc/get_feed`; ids, filters, file names, headers and bodies are never recorded.
  Read it in the browser console: `__sabzoneMetrics()`.

**Edge function** (`supabase/functions/send-push/`, deploy yourself): at most 25 deliveries at once,
10 s deadline for each push service / Google call, a 413 for a body over 64 KB (checked after the
shared-secret check), and one numbers-only summary line per request (`send_push_done`, with the
duration). The secret check, payload rules and clean-up are unchanged.

## Security: what is preserved and how it is checked

- No policy is added, removed or loosened (P2 aborts itself if the policy set changes).
- `get_unread_notification_count` is still invoker-rights, `revoke ... from public, anon`, `grant ... to authenticated` (asserted in both test suites).
- Telemetry and logs carry no ids, filters, bodies, tokens, endpoints or error messages (asserted).
- The push function authenticates exactly as before and the new size check cannot run for an unauthenticated caller.

## Apply order and rollback

1. Apply the patch; review it.
2. Run the two migrations (SQL Editor or `supabase db push`). **Index builds block writes to that table while they run.** The tables are small today, but if `messages`, `post_comments` or `post_likes` are already large, create those few indexes outside the transaction at a quiet time, for example `create index concurrently if not exists messages_sender_id_idx on public.messages (sender_id);` as a separate statement, then run the migration (it will skip them).
3. Ship the app build. Deploy `send-push` when convenient (`supabase functions deploy send-push --no-verify-jwt`).

Rollback, if ever needed:

- Indexes: `drop index if exists public.<name>;` (names end in `_idx`; the list is in the migration).
- Unread count: re-run the `get_unread_notification_count` block from `20261018000000_activity_vs_messages.sql`.
- RLS wrapping is behaviour-neutral; to undo it anyway, reverse the replacement in the same style: `regexp_replace(qual, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g')` and `alter policy`.
- App: revert `src/router.tsx` to `new QueryClient()` and remove `global.fetch` from `client.ts`.

## How to measure (run in the Supabase SQL Editor, read-only)

```sql
-- slowest queries since the stats were last reset (extension pg_stat_statements is on by default)
select calls, round(mean_exec_time::numeric, 1) as mean_ms,
       round(total_exec_time::numeric) as total_ms, left(query, 120) as query
from pg_stat_statements order by total_exec_time desc limit 20;

-- tables read by sequential scan most often
select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
from pg_stat_user_tables order by seq_tup_read desc limit 15;

-- indexes that are never used (check again after a few weeks; the new FK indexes are for deletes)
select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
from pg_stat_user_indexes where idx_scan = 0 order by pg_relation_size(indexrelid) desc;

-- how long does the polled call take for a real account? (replace the id)
set local role authenticated; select set_config('request.jwt.claim.sub', '<user uuid>', true);
explain (analyze, buffers) select public.get_unread_notification_count();
```

In the app: `__sabzoneMetrics().byEndpoint` shows p50 / p95 per endpoint; `.recentProblems` the last 50
slow or failed requests. To forward them to a monitoring service, call
`setTelemetrySink((event) => ...)` once at start-up (it receives only the label, status and timing).

## Not done, and why

- **Search (P7):** rewrite `get_feed` / `get_people` so the no-search path and the search path are separate
  statements (plpgsql `if`), then add `pg_trgm` GIN indexes on `posts.content`, `profiles.full_name`,
  `profiles.username`. Needs a database to verify the plans, so it is left for a change you can `EXPLAIN`.
- **Notifications (P8):** if it becomes slow, move to a small `notifications` table written by triggers
  (the push triggers already see each event) and keep a counter on `profiles`.
- **Realtime (P9):** prefer one Broadcast channel per person for "new message" pings over a table-wide
  `postgres_changes` subscription.
- **Rate limits (earlier audit S4), the public username-to-email lookup (S1) and the public `chat-media` bucket (S2)** are still open; see `AUDIT-2026-11.md` and `PRIVACY-ACCOUNT-DELETION.md`.
- Polling intervals (30 s unread counts) were left alone; they pause while the tab is hidden and the count is now cheap.

## Tests added

| File | What it proves |
|------|----------------|
| `src/test/migration-perf.test.ts` | every foreign key has a leading index (and the checker itself works); the RLS migration only alters policies and self-checks; the performance migration only adds indexes and keeps the permissions; later migrations keep using `(select auth.uid())` |
| `src/test/query-client.test.ts` | permanent vs retryable errors, retry cap, defaults, delay cap |
| `src/test/telemetry.test.ts` | id-free labels, percentiles, log throttling, no PII in logs, timeouts, caller aborts not counted as failures, sink isolation |
| `src/test/send-push-perf.test.ts` | bounded concurrency keeps order, size guard fits a 500-person request, log line holds numbers only |
| `supabase/tests/replay/performance.assert.sql` | on a real Postgres: no bare `auth.uid()`, every FK indexed, the new unread count equals the old way on seeded data, anon is still refused |
