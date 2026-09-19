# The CEO's Last Meeting — MKTG90037 Week 8

A horror-themed browser multiplayer classroom game for 20+ students. An old CEO has died, but his ghost has called one final board meeting. Teams must co-create value, make governance decisions, and invent something before the meeting ends.

## Game structure

**Round 1 — Co-Design**
Students decide how a university should involve students in redesigning orientation.

**Round 2 — Make or Buy**
Teams apply transaction cost theory. The game explicitly includes:
- safeguarding costs
- adaptation costs
- measurement costs

**Round 3 — Open Innovation**
Students use a lead-user starting point and submit a one-sentence innovation. Every team's idea appears live.

The lecture frames Week 8 around co-creation, the make-or-buy decision and co-creation of innovation. The DART model is also represented in the in-game concept panel.

## Multiplayer setup

This version uses Firebase Realtime Database. Firebase describes Realtime Database as a cloud-hosted database that synchronizes JSON data to connected clients in real time.

### 1. Create Firebase project
Go to https://console.firebase.google.com/

Create a project and add a Web App.

### 2. Enable Anonymous Authentication
Firebase Console → Authentication → Sign-in method → Anonymous → Enable.

### 3. Create Realtime Database
Firebase Console → Realtime Database → Create database.

For a classroom prototype you can initially use test mode, but do NOT leave a public test database open permanently. Replace the rules with your own production rules before wider use.

### 4. Paste your Firebase config
Open `app.js` and replace:

PASTE_YOUR_API_KEY
PASTE_YOUR_PROJECT
PASTE_YOUR_DATABASE_URL
etc.

Firebase's current browser-module documentation uses the `https://www.gstatic.com/firebasejs/12.19.0/...` module pattern used by this project.

### 5. Run locally
Because browser modules and Firebase work best from a web server, do not double-click `index.html`.

Easy options:
- VS Code + Live Server extension
- Python: `python -m http.server 8000`
- Firebase Hosting

Then open the local URL.

### 6. Put it online
Firebase Hosting is a simple option:
1. Install Firebase CLI.
2. `firebase login`
3. `firebase init hosting`
4. Select your project.
5. Use the project folder as the public directory.
6. `firebase deploy`

### 7. Classroom flow
1. Lecturer opens the game.
2. Click **Create host room**.
3. Display the QR code.
4. 20+ students scan it and enter names.
5. Students are automatically distributed across four teams.
6. Lecturer starts the mission.
7. Each 60-second round updates live.
8. Use the leaderboard and activity feed for the class debrief.

## Suggested 20-minute teaching flow

2 min — Join room
4 min — Round 1: Co-design
4 min — Round 2: Make/buy
6 min — Round 3: Open innovation
4 min — Debrief

## Important security note

The included Realtime Database rules are deliberately simple for a classroom prototype. For a public production game, add stronger authorization so a player cannot write another player's score or alter room state.

## Files

- `index.html` — interface
- `styles.css` — responsive classroom UI
- `app.js` — Firebase multiplayer logic + game content
- `firebase-rules.json` — starting rules
- `README.md` — setup guide


## Horror theme

The horror is atmospheric rather than graphic: haunted boardroom narrative, ghost messages, dark interface, survival-style leaderboard, escalating timed rounds, and a live ghost activity feed. The academic mechanics remain based on Week 8 concepts.


## SCARY v2 visual gadgets
The haunted-boardroom version adds an EMF meter, ghost radio, CCTV camera, CEO safe, haunted portrait, dark window, abandoned desk and paranormal alert. Gadget readings change during timed rounds. The horror is atmospheric and classroom-safe.


## V3: cinematic haunted office

The home screen is now designed as a horror-game command centre rather than a standard landing page. Students can click the CEO portrait, computer, filing cabinet, safe, phone and meeting table to reveal evidence. Each clue is tied to a Week 8 concept.

The layout is intentionally inspired by the supplied visual reference: dark cinematic boardroom, left-side/central investigation objects, ghost console, mission timer, evidence note, team/join controls and a survival-style atmosphere.


## V5 deployment fix

The cinematic boardroom artwork is embedded directly into `index.html` as a data URI. This avoids broken-image problems when deploying through GitHub/Vercel. The old generic header was also removed so only the cinematic game interface appears.
