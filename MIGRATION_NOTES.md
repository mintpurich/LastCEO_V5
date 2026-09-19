# Firebase -> Supabase migration notes

## Files changed

### `app.js`
Replaced all Firebase imports and APIs with Supabase:

- Firebase `initializeApp()` -> Supabase `createClient()`
- Firebase Anonymous Auth -> Supabase Anonymous Auth
- Firebase Realtime Database reads/writes -> Supabase Postgres queries/RPCs
- Firebase `onValue()` -> Supabase Realtime Postgres Changes
- Firebase `onDisconnect()` roster behaviour -> Supabase Realtime Presence

Also fixed:

- duplicate `const clues` syntax error
- score race condition caused by read/modify/write team scores
- browser-trusted score values; scoring is now performed by SQL
- round timer resetting whenever another student submits
- host accidentally being able to submit as a team player

### `index.html`

- added Supabase JS browser library
- added `config.js` before `app.js`
- removed the duplicate `qrcode` element ID

### `config.js` — new
Contains only the browser-safe Supabase Project URL and Publishable key.

### `supabase-schema.sql` — new
Creates:

- `rooms`
- `players`
- `submissions`
- indexes
- RLS policies
- `create_game_room()`
- `join_game_room()`
- `submit_game_answer()`
- Realtime publication entries

### `firebase-rules.json`
Removed. It is not used by Supabase.

### `README.md`
Rewritten with Supabase + GitHub + Vercel setup instructions.

## Values you need from Supabase

Only two values go into the frontend:

1. Project URL
2. Publishable key (legacy anon key also works)

Do not use a secret key or service-role key in browser code.

## Vercel note

This repository is plain static HTML/CSS/JavaScript. There is no build framework reading `process.env`, so a Vercel environment variable does not automatically become available to the browser.

For this version, put the Project URL and Publishable key in `config.js` and commit it. That is appropriate because the Publishable key is specifically designed for client-side code, while access is restricted using Row Level Security.

## Classroom rate-limit note

Supabase Anonymous Auth is IP-rate-limited. Before a large class, check **Authentication -> Rate Limits** in Supabase. The current default for anonymous sign-ins is 30 per hour per IP, which can matter if many students share one school/university public IP.
