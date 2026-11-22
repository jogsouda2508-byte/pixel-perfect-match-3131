# SabZone authentication hardening

Nothing in this patch has been deployed, migrated or applied to a live Supabase project.

## What changed
| Area | Before | After |
|---|---|---|
| Username login | Browser called `get_login_email` (returned the real email to anyone) then `signInWithPassword` | Browser calls the `auth-gateway` Edge Function; the server finds the account, checks the password and returns a session. The email never reaches the device. |
| Sign-up | `plan_signup_email` + `auth.signUp` from the browser; error text revealed "3 accounts on this email" | Gateway validates, applies per-email limits, creates the account. Answer is the same whether or not the email already has accounts. |
| Verification | `verifyOtp(email)` from the browser (the page URL carried the email) | Gateway verifies the 6-digit code per username; the page only shows a masked address (`j***@g***.com`). |
| Password reset | Browser looked up the emails for a username | Gateway sends the links; identical answer for known/unknown identifiers. |
| Username check | Open RPC anyone could script | Gateway action, rate limited. |
| Brute force | Only Supabase's built-in limits | Per-IP fixed-window limits + per-username exponential lockouts (hashed keys, fail-closed). |

## Pieces
- `supabase/functions/auth-gateway/` – Edge Function (`logic.ts`, `core.ts` are Deno-free and unit tested; `index.ts` wires Deno/Supabase).
- `supabase/migrations/20261116000000_auth_gateway.sql` – additive: counters/lockout tables and service-role-only functions.
- `supabase/manual/auth_lockdown.sql` – deliberately NOT a migration. Removes browser access to the helper RPCs. Run it last.
- `src/lib/auth-gateway.ts` – client helper; `auth.tsx`, login/signup/verify/forgot-password screens use it.
- Tests: `src/test/auth-gateway-*.test.ts`, updated `auth-context.test.tsx`, SQL replay `auth_gateway.assert.sql` and `auth_lockdown.afterlockdown.sql`.

## Rollout order (important)
1. Review, then run migration `20261116000000_auth_gateway.sql`.
2. Set function secrets (a random `AUTH_HASH_SECRET`, `AUTH_ALLOWED_ORIGINS` (comma-separated redirect origins)), then deploy `auth-gateway`.
3. Ship the new app/web build. Test log-in, sign-up, code, reset on a staging project first.
4. Only after all users are on the new build, run `supabase/manual/auth_lockdown.sql`. Older app versions stop working after it (undo statements are in the file).

## Known limits (be honest with yourself)
- Someone calling Supabase's `signInWithPassword` directly with a known email bypasses gateway lockouts; Supabase's own rate limits still apply. Close this with a Password Verification Hook or captcha (the gateway already passes `captcha_token` through).
- Lockouts are per username, so an attacker can temporarily lock a victim's login; thresholds are moderate and password reset still works.
- Client IP comes from `cf-connecting-ip`; people behind one shared IP share the IP limits.
- Sign-up no longer tells people an email hit its 3-account limit (privacy trade-off).
- `index.ts` has not been executed on a real Deno runtime here; test on staging.
