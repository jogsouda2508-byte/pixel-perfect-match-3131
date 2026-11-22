# Frontend (UI) security review

Scope: everything under `src/`, `public/sw.js` and the server entry. Method: read every place that renders
data, builds a URL, navigates, stores data in the browser or shows an error, then fix, then add tests.
Nothing here changes the database, Supabase settings or deployment: it is code, tests and docs only.

The database stays the real security boundary (RLS). The UI fixes below are defence in depth, plus a few
places where the UI itself was the weak point (the Android deep link, the route guard, the shared cache).

## Findings and status

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| UI-1 | **High** | The Android app accepted `sabzone://auth-callback#access_token=…&refresh_token=…` from ANY web page or app. An attacker could sign the victim in to the attacker's account (login CSRF / session fixation) and then read what the victim uploads. | **Fixed** |
| UI-2 | Medium | Chat file messages rendered `<a href={url}>` straight from the database. A `javascript:` or `data:` value would run script in the app's origin when tapped. | **Fixed** |
| UI-3 | Medium | Profile pictures (and other media) are `<img src={value from the database}>`. Any user can store an external URL there, which tracks everyone who views the profile (IP address, timing). | Avatar **fixed**; other media tags **mitigated** by the CSP (report-only until you enforce it) |
| UI-4 | Medium | The React Query cache was never cleared when the signed-in user changed, so one account's cached feed, chats or profile data could appear for the next account on the same device without a reload. | **Fixed** |
| UI-5 | Medium | The route guard is an allow-list. `/post/<id>`, `/group/<id>` and `/invite` were not on it, so they rendered for logged-out and un-onboarded users (blank or broken screens; data was still protected by RLS). | **Fixed** |
| UI-6 | Medium | About 60 toasts and error texts showed `error.message` verbatim. Database errors contain table, column and constraint names (`violates check constraint "posts_content_length"`). | **Fixed** (`userMessage`) |
| UI-7 | Low | The QR card is injected with `dangerouslySetInnerHTML`; the label escaped only `&` and `<`, and the colour was not validated. Not exploitable today (usernames are `[a-z0-9_]{3,20}`), but one change away from it. | **Hardened** |
| UI-8 | Low | No HTTP security headers and no CSP. | **Added** (see "Rolling out the CSP") |

### Reviewed and found sound (no change needed)

- `public/sw.js` `safeUrl` and `safeAppPath` (notification taps) already restrict targets to same-origin paths. They now have adversarial tests.
- Every `target="_blank"` link already has `rel="noopener noreferrer"`.
- No PostgREST string filters (`.or()`, `.ilike()` with interpolation); no `eval`, `innerHTML`, `document.write`, `window.open`.
- Free-text fields are bounded (`.slice(0, MAX)` in `onChange`) and the database repeats the limits with about 94 `CHECK` constraints.
- Referral codes and usernames are validated by regex before use; `AuthGate` only ever redirects to fixed paths.
- `ui/chart.tsx` uses `dangerouslySetInnerHTML` only for developer-written colour config.
- No secrets in the code, no tokens in `localStorage` beyond Supabase's own session key, no `console.log` of user data.

## What changed

**New code**

- `src/lib/security.ts`: `escapeXml`, `isHexColor`, `safeLinkUrl`, `safeMediaUrl`, `userMessage`.
- `src/lib/security-headers.ts`: security headers and CSP builder, applied in `src/server.ts` to every response (including the error page).
- `src/lib/native-auth-callback.ts` and additions to `src/lib/auth-redirect.ts`: strict parsing of `sabzone://` links plus a short-lived "pending" flag. `authRedirect()` raises the flag whenever the app itself starts Google sign-in or a password reset, so a callback is accepted only if it was asked for, once, within 10 minutes (Google) or 2 hours (reset email).

**Changed code**

- `lib/auth.tsx`: deep-link handler uses the guard; the query cache is cleared when the user id changes.
- `components/auth-gate.tsx`: `/post/`, `/group/`, `/invite` are protected.
- `components/chat-parts.tsx` (`FileBody`), `components/ediraa.tsx` (`Avatar`), `components/profile-qr.tsx`: URL and SVG hardening.
- About 35 components and routes: error text goes through `userMessage`.
- `routes/__root.tsx`: `referrer` meta tag (also covers the Android app's bundled pages).
- Several files were re-formatted by Prettier. That is required: CI runs `prettier --check` on every changed `src` file in a pull request.

## Tests

All new tests are in `src/test/security-*.test.ts(x)` and run with the normal `npm test`.

| File | What it proves |
| --- | --- |
| `security-lib.test.ts` | Every URL scheme trick (`javascript:`, mixed case, tabs, `data:`, `//host`, backslashes, over-long) is refused; `userMessage` hides database/network internals and keeps deliberate messages; no "upload failed" false positive. |
| `security-native-auth.test.ts` | Strict `sabzone://` parsing; the pending flag is one-time, expires, and keeps sign-in and reset separate. |
| `security-native-deeplink.test.tsx` | The real `appUrlOpen` listener: a well-formed but unrequested callback signs nobody in. |
| `security-auth-cache.test.tsx` | Cache cleared on user change and sign-out, kept on token refresh. |
| `security-ui.test.tsx` | QR card with hostile label/colour, `FileBody` and `Avatar` with hostile URLs and names, route guard for the new paths. |
| `security-headers.test.ts` | CSP contents (no `unsafe-eval`, no wildcard images, Supabase + known hosts only), report-only vs enforced, HSTS only on https. |
| `security-static.test.ts` | Repository-wide guards: `dangerouslySetInnerHTML` only in 2 reviewed files, no HTML/eval sinks, `_blank` rel, only known third-party hosts, no secrets, no raw error messages, service-worker validator and `safeAppPath` adversarial cases. |

I checked the tests can fail: reverting each fix (file link, deep-link check, route list, QR escaping, cache clear,
avatar URL) makes the matching tests fail.

Run: `npm test`, or `npx vitest run src/test/security-` for just these.

Manual checks worth doing on a device or browser:

1. Android: open `sabzone://auth-callback#access_token=aaaaaaaaaa.bbbb.cccc&refresh_token=dddddddddd` from the browser. Nothing should happen (no session, no screen change).
2. Android: Google sign-in and a password-reset email still log you in (they set the pending flag themselves).
3. Log in as user A, log out, log in as user B on the same tab: no data of A is visible, even briefly.
4. Logged out, open `/post/anything`, `/group/anything`, `/invite`: you land on `/login`.
5. Send a PDF in a chat: it opens; the open-in-new-tab link works.
6. Trigger a database error (for example post an over-long caption by editing the request): the toast is a friendly sentence, never a constraint name.

## Rolling out the CSP

`src/server.ts` sends `Content-Security-Policy-Report-Only` by default, so a wrong entry can only create browser
console reports, never a broken page. I could not exercise it in a real browser, so tune it first:

1. Deploy, browse every screen (feed, reels, chat with photos/voice/files, stories with GIFs and music, community, places search, Google sign-in, notifications).
2. Open the browser console and look for `Content Security Policy` reports. Add each legitimate origin to the lists at the top of `src/lib/security-headers.ts` (and to `security-headers.test.ts`).
3. When a full pass is clean, set `CSP_ENFORCE=1` in the server environment.

Known limits of this CSP: `script-src` keeps `'unsafe-inline'` because TanStack Start inlines its hydration script (nonces
would remove that). It does still block remote script hosts. The Android app loads bundled pages, so server headers do not
apply there; only the `referrer` meta tag does.

## Not changed (recommended next steps)

- **Server-side media URL check.** Several tables (`posts.image_url`, `profiles.avatar_url`, …) accept any string. Messages already require the storage prefix inside their RPC. Add a `CHECK (col ~ '^https://<project-ref>\.supabase\.co/storage/')` (or an RPC) for the others. This is a database change, so it is not included.
- **PKCE.** `client.ts` uses Supabase's default implicit flow, so tokens travel in the URL hash. `flowType: 'pkce'` is safer but changes Google sign-in and reset links, so it needs device testing first. (The new pending-flag guard already blocks the fixation attack for the current flow.)
- **Android App Links.** Only the `sabzone://` custom scheme exists; any app can claim a custom scheme. Verified `https` App Links need a hosted `assetlinks.json`.
- **Remaining `<img>/<video>` tags** that take URLs from the database rely on the CSP (once enforced) rather than per-tag checks.
- **Password length cap.** Supabase hashes only the first 72 bytes; add `maxLength={72}` to the password fields.
- **Repository hygiene.** `supabase/.temp/` and the stale `android-web/assets/*.js` bundles are committed; remove them from version control.
- **Open from the earlier audit** (database side): the email-lookup RPCs (see `docs/AUTH-EDGE-FUNCTIONS.md` if you applied that patch) and the public `chat-media` bucket.

## Keeping it fixed

`security-static.test.ts` fails when someone adds a new `dangerouslySetInnerHTML`, an HTML sink, a `_blank` link without
`rel`, a new third-party host, or a raw `error.message` toast. If a failure is intentional, review it, then update the
allow-list in the test and this document together.
