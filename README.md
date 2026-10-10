# Pixel Perfect Match

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pixel-perfect-match-3131.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/51db013a-d78d-49c6-a6c8-fb0a8933f786).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Database setup (Supabase)

All app data (profiles, follows, posts, likes, comments, stories, notifications) lives in Supabase.
Run the migrations **in order** in the Supabase Dashboard -> SQL Editor (or `supabase db push`):

1. `supabase/migrations/20261011000000_auth_profiles_follows.sql`
2. `supabase/migrations/20261012000000_posts_feed.sql`

Both are safe to re-run. Then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`
(anon / publishable key only, never the service-role key).

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
