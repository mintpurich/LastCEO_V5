# The CEO's Last Meeting — Supabase + Vercel edition

This is the Supabase version of the classroom multiplayer game.

## What changed from Firebase

Firebase has been removed. The app now uses:

- Supabase Anonymous Auth for host/student browser sessions
- Supabase Postgres for rooms, players and submissions
- Supabase Realtime for live classroom updates
- Supabase Presence for the live player roster
- Row Level Security (RLS) so students cannot control the host room state
- server-side SQL scoring so a browser cannot simply award itself points

The original Firebase Realtime Database rules file is no longer used.

Two unrelated bugs in the original project were also fixed:

- duplicate `const clues` declaration in `app.js`
- duplicate `id="qrcode"` element in `index.html`

## Files

- `index.html` — interface and browser libraries
- `styles.css` — UI
- `app.js` — Supabase multiplayer/game logic
- `config.js` — your Supabase Project URL + Publishable key
- `supabase-schema.sql` — tables, RLS, RPC functions and Realtime setup
- `haunted_ceo_boardroom.png` — existing artwork

## Supabase setup

### 1. Create a project

Create a project at Supabase.

### 2. Enable Anonymous Sign-Ins

In the Supabase Dashboard, open Authentication settings/providers and enable Anonymous Sign-Ins.

The game does not require students to create accounts. Each browser receives an anonymous authenticated user session.

### 3. Run the database SQL

Open Supabase Dashboard -> SQL Editor.

Create a new query, paste the full contents of `supabase-schema.sql`, and run it.

This creates:

- `rooms`
- `players`
- `submissions`
- RLS policies
- `create_game_room(...)`
- `join_game_room(...)`
- `submit_game_answer(...)`
- Realtime publication entries

### 4. Add your browser-safe Supabase values

Open `config.js` and replace:

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY"
};
```

Get these values from your Supabase project's Connect dialog or Settings -> API Keys.

Use only:

- Project URL
- Publishable key (or legacy anon key)

NEVER put a Supabase secret key, service-role key, database password or JWT signing secret into this GitHub repository.

The publishable key is designed to be used in browser code. Database access is restricted by RLS.

## GitHub -> Vercel deployment

This project is static HTML/CSS/JS, so there is no build step required.

1. Put these files in your GitHub repository.
2. Make sure `config.js` contains the Project URL and Publishable key.
3. Push to GitHub.
4. Import/connect the repository in Vercel.
5. Framework Preset: `Other` is fine.
6. Build Command: leave empty.
7. Output Directory: leave empty / project root.
8. Deploy.

Every later GitHub push can redeploy through Vercel as normal.

### Why the Supabase key can be in GitHub

This is a browser-only app. Anything the browser uses can ultimately be viewed by a user, including a Vercel-injected public environment variable. The Supabase Publishable key is therefore not treated as a secret. RLS is the security boundary.

Do not substitute a secret/service-role key.

## Classroom flow

1. Lecturer opens the Vercel URL.
2. Click **Create host room**.
3. A six-character room code and QR code appear.
4. Students scan the QR code or enter the code/name.
5. Students are distributed across four teams.
6. Host starts the game.
7. Submissions, activity and scores update through Supabase Realtime.
8. Host advances rounds and shows results.

## Important implementation notes

### Scores

Scores are not written by the browser. `submit_game_answer(...)` calculates correctness and points inside Postgres. The leaderboard sums the stored submissions.

### Live player list

The player records are stored in Postgres, while the visible live roster uses Supabase Presence. Presence disappears automatically when a browser disconnects, which replaces the Firebase `onDisconnect()` behaviour for the classroom roster.

### Room access

A student can join only while the room is in the lobby. A student who already joined can reconnect from the same anonymous Supabase browser session after the game begins.

### Classroom Auth rate limit

Supabase currently defaults Anonymous Sign-Ins to 30 per hour per IP address. If your students share the same school/university internet connection, check **Authentication -> Rate Limits** before class and raise the anonymous-user limit to suit your class size. Consider CAPTCHA/Turnstile if the site will be broadly public.

### Room code security

The room code acts as the classroom join credential. Use a fresh room for each class. For a large public deployment, add CAPTCHA/rate limiting and scheduled cleanup of old rooms.
