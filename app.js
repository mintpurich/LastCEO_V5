/*
  The CEO's Last Meeting — Supabase multiplayer version

  Backend:
  - Supabase Anonymous Auth
  - Postgres tables: rooms, players, submissions
  - Supabase Realtime for live room/player/submission updates
  - Row Level Security + SQL RPC functions from supabase-schema.sql
*/

const config = window.SUPABASE_CONFIG || {};
const configured = Boolean(
  config.url &&
  config.publishableKey &&
  !String(config.url).includes("YOUR_PROJECT_REF") &&
  !String(config.publishableKey).includes("YOUR_SUPABASE")
);

let supabaseClient = null;
let currentUser = null;

const state = {
  room: null,
  roomCode: null,
  playerId: null,
  isHost: false,
  selected: null,
  unsubscribe: null,
  realtimeChannel: null,
  presencePlayers: null,
  timer: null,
  timerRound: null,
  seconds: 60,
  phaseTimer: null,
  refreshQueued: false,
  lastEventKey: null
};

const hauntedEvents = [
  "A cold wind passes through the boardroom.",
  "The CEO’s desk phone rings. Nobody is there.",
  "A chair slowly turns toward the screen.",
  "The lights flicker. The ghost is listening.",
  "A file appears on the CEO’s desk: MAKE OR BUY.",
  "Someone whispers: “Co-create…”"
];

const PHASES = {
  evidence_hunt: { title: "THE EVIDENCE HUNT", sub: "Search the boardroom and collect the truth before the other teams.", seconds: 240, kicker: "INVESTIGATION" },
  ghost_event: { title: "THE CFO RETURNS", sub: "A second ghost has entered the meeting. The rules have changed.", seconds: 90, kicker: "GHOST INTERVENTION" },
  corporate_war: { title: "CORPORATE WAR", sub: "Attack, defend or curse another team. Your resources are limited.", seconds: 180, kicker: "TEAM BATTLE" },
  negotiation: { title: "THE ALLIANCE ROOM", sub: "Make deals with another team. Trust is a resource.", seconds: 120, kicker: "NEGOTIATION" },
  betrayal: { title: "THE BETRAYAL", sub: "The ghosts are offering one team a dangerous shortcut.", seconds: 120, kicker: "SECRET DEAL" },
  final_boardroom: { title: "THE FINAL BOARDROOM", sub: "Use what you learned to make the final business decisions.", seconds: 60, kicker: "STRATEGY" },
  ending: { title: "THE CEO'S JUDGMENT", sub: "The board has decided. Face the consequences.", seconds: 0, kicker: "ENDING" }
};

const PHASE_ORDER = ["evidence_hunt","ghost_event","corporate_war","negotiation","betrayal","final_boardroom","ending"];

const GHOST_EVENTS = {
  ghost_event: {
    icon: "💼",
    title: "THE CFO HAS RETURNED",
    text: "You thought the CEO was the only ghost in this room.",
    rule: "The CFO reveals a hidden truth: every team will need evidence AND allies to survive the boardroom."
  },
  betrayal: {
    icon: "🩸",
    title: "THE MARKETING DIRECTOR OFFERS A DEAL",
    text: "One alliance can become a weapon.",
    rule: "Betray an active alliance for +600 bonus points. But everyone will see that the deal was broken."
  }
};

const clues = {
  portrait: {
    title: "The CEO’s Portrait",
    body: "Behind the portrait is a handwritten note: “Customers are not outside the value process. They are part of it.”",
    concept: "CO-CREATION · Customers can actively contribute to value creation."
  },
  computer: {
    title: "CEO’s Computer",
    body: "A presentation is frozen on screen: “From marketing TO clients → creating value WITH clients.”",
    concept: "CO-PRODUCTION · Clients can become active participants in an organisation’s work."
  },
  cabinet: {
    title: "Filing Cabinet 7B",
    body: "Three supplier folders are stamped SAFEGUARDING, ADAPTATION and MEASUREMENT.",
    concept: "TRANSACTION COST THEORY · Outsourcing can create transaction costs beyond the supplier’s quoted price."
  },
  safe: {
    title: "The CEO’s Safe",
    body: "The keypad flashes: “MAKE / BUY.” A note says: “Do not compare the supplier price alone.”",
    concept: "MAKE OR BUY · Compare internal production costs with outsourcing costs plus transaction costs."
  },
  phone: {
    title: "The Black Phone",
    body: "A voicemail from a lead user describes a problem mainstream customers have not noticed yet.",
    concept: "OPEN INNOVATION · Lead users can reveal emerging needs and inspire innovation."
  },
  table: {
    title: "The Last Board Meeting",
    body: "Cards around the table name customers, suppliers, competitors and partners.",
    concept: "OPEN INNOVATION · Innovation can draw on knowledge and ideas from outside the firm."
  }
};

let collectedClues = new Set();

const rounds = [
  {
    tag: "👻 CO-DESIGN",
    title: "The student experience crisis",
    text: "A university wants to redesign its orientation experience. Students say the current process is confusing, but staff already have a proposed solution. Which action best represents value co-creation?",
    choices: [
      ["A", "Design the new process internally and announce it to students."],
      ["B", "Invite students to critique, redesign and test the orientation experience with the university."],
      ["C", "Outsource orientation to an agency and ask students to complete a survey afterward."],
      ["D", "Ask staff to choose the solution because they understand operations best."]
    ],
    answer: "B",
    points: 100,
    debrief: "Co-design involves customers/stakeholders contributing through critiquing, designing and using services/products."
  },
  {
    tag: "☠ MAKE OR BUY",
    title: "The 3-cost trap",
    text: "Your team can build a customer-support system internally for $80k. A supplier charges $55k. But outsourcing adds $8k safeguarding costs, $12k adaptation costs and $10k measurement costs. What should the team choose if total cost is the only consideration?",
    choices: [
      ["A", "Make: $80k versus Buy: $85k."],
      ["B", "Buy: $55k because outsourcing price is lower."],
      ["C", "Buy: $77k because transaction costs are ignored."],
      ["D", "Make because outsourcing is always risky."]
    ],
    answer: "A",
    points: 100,
    debrief: "Transaction cost theory compares production costs with outsourcing costs plus safeguarding, adaptation and measurement costs."
  },
  {
    tag: "🕯️ OPEN INNOVATION",
    title: "Lead-user innovation lab",
    text: "Your team has 45 seconds to propose an innovation inspired by a lead user. Pick one starting point, then write a one-sentence innovation. The class will see every team's idea.",
    choices: [
      ["A", "Lead user — find a person whose needs are ahead of mainstream users."],
      ["B", "Competitor — borrow a competitor's idea without changing it."],
      ["C", "Internal team — keep the idea completely inside the firm."]
    ],
    answer: null,
    points: 150,
    debrief: "Open innovation can draw ideas from customers, competitors, lead users and partners; the lecture also highlights crowdsourcing and joint development."
  }
];

const $ = id => document.getElementById(id);
const show = id => document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
}[c]));

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function setStatus(text, cls = "") {
  const el = $("connection");
  if (!el) return;
  el.textContent = text;
  el.className = `status ${cls}`.trim();
}

function friendlyError(error, fallback = "Something went wrong.") {
  console.error(error);
  const raw = error?.message || error?.details || String(error || "");
  const match = raw.match(/GAME_ERROR:\s*([^\n]+)/i);
  if (match) return match[1].trim();
  if (/duplicate key|23505/i.test(raw)) return "That room code was already used. Please try again.";
  return fallback;
}

async function initSupabase() {
  if (!configured) {
    setStatus("Supabase setup needed", "error");
    return false;
  }

  if (!window.supabase?.createClient) {
    setStatus("Supabase library failed to load", "error");
    return false;
  }

  try {
    if (!supabaseClient) {
      supabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;

    let session = sessionData.session;
    if (!session) {
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }

    currentUser = session?.user || null;
    if (!currentUser) throw new Error("Anonymous sign-in did not return a user.");

    state.playerId = currentUser.id;
    setStatus("Supabase live", "success");
    return true;
  } catch (error) {
    console.error(error);
    setStatus("Supabase connection failed", "error");
    return false;
  }
}

async function ensureSupabase() {
  if (currentUser && supabaseClient) return true;
  const ok = await initSupabase();
  if (!ok) {
    alert("Supabase is not configured yet. Add your Project URL and Publishable key to config.js, enable Anonymous Sign-Ins, then run supabase-schema.sql in the Supabase SQL Editor.");
  }
  return ok;
}

async function createRoom() {
  if (!(await ensureSupabase())) return;

  setStatus("Creating room…");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await supabaseClient.rpc("create_game_room", { p_code: code });

    if (!error) {
      state.roomCode = code;
      state.playerId = currentUser.id;
      state.isHost = true;
      state.selected = null;
      await bindRoom({ name: "HOST", team: 0, isHost: true });
      enterLobby();
      setStatus("Supabase live", "success");
      return;
    }

    if (!/duplicate key|unique/i.test(error.message || "")) {
      setStatus("Room creation failed", "error");
      alert(friendlyError(error, "Could not create the room. Check Supabase setup and try again."));
      return;
    }
  }

  setStatus("Room creation failed", "error");
  alert("Could not generate a unique room code. Please try again.");
}

async function joinRoom(code, name) {
  if (!(await ensureSupabase())) return;

  code = code.trim().toUpperCase();
  name = name.trim();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !name) {
    alert("Enter a valid 6-character room code and your name.");
    return;
  }

  setStatus("Joining room…");
  const { data: team, error } = await supabaseClient.rpc("join_game_room", {
    p_room_code: code,
    p_name: name
  });

  if (error) {
    setStatus("Join failed", "error");
    alert(friendlyError(error, "Could not join that room."));
    return;
  }

  state.roomCode = code;
  state.playerId = currentUser.id;
  state.isHost = false;
  state.selected = null;
  await bindRoom({ name, team: Number(team), isHost: false });
  enterLobby();
  setStatus("Supabase live", "success");
}

function buildRoomState(roomRow, playerRows, submissionRows, resourceRows, actionRows, allianceRows) {
  const players = {};
  for (const p of playerRows || []) {
    players[p.user_id] = {
      name: p.name,
      team: Number(p.team),
      host: Boolean(p.is_host),
      joinedAt: new Date(p.joined_at).getTime()
    };
  }

  const teams = {};
  for (let i = 1; i <= 4; i++) teams[`team${i}`] = { name: `Team ${i}`, score: 0, influence: 5, evidence: 3, protection: 1, scoreBonus: 0 };
  for (const r of resourceRows || []) {
    const t = teams[`team${Number(r.team)}`];
    if (t) {
      t.influence = Number(r.influence || 0);
      t.evidence = Number(r.evidence || 0);
      t.protection = Number(r.protection || 0);
      t.scoreBonus = Number(r.score_bonus || 0);
      t.score += t.scoreBonus;
    }
  }

  const submissions = {};
  for (const s of submissionRows || []) {
    if (!submissions[s.user_id]) submissions[s.user_id] = {};
    submissions[s.user_id][Number(s.round)] = {
      answer: s.answer,
      points: Number(s.points),
      correct: Boolean(s.correct),
      idea: s.idea || "",
      name: s.player_name,
      team: Number(s.team),
      at: new Date(s.created_at).getTime()
    };

    const teamKey = `team${Number(s.team)}`;
    if (teams[teamKey]) teams[teamKey].score += Number(s.points || 0);
  }

  return {
    hostId: roomRow.host_id,
    status: roomRow.status,
    round: Number(roomRow.round),
    gamePhase: roomRow.game_phase || "lobby",
    phaseNo: Number(roomRow.phase_no || 0),
    phaseStartedAt: roomRow.phase_started_at ? new Date(roomRow.phase_started_at).getTime() : null,
    phaseEndsAt: roomRow.phase_ends_at ? new Date(roomRow.phase_ends_at).getTime() : null,
    activeEvent: roomRow.active_event || null,
    eventMessage: roomRow.event_message || "",
    createdAt: new Date(roomRow.created_at).getTime(),
    players,
    teams,
    submissions,
    actions: actionRows || [],
    alliances: allianceRows || []
  };
}

async function loadRoomState() {
  if (!state.roomCode || !supabaseClient) return;

  const code = state.roomCode;
  const [roomRes, playersRes, submissionsRes, resourcesRes, actionsRes, alliancesRes] = await Promise.all([
    supabaseClient
      .from("rooms")
      .select("code, host_id, status, round, created_at, game_phase, phase_no, phase_started_at, phase_ends_at, active_event, event_message")
      .eq("code", code)
      .maybeSingle(),
    supabaseClient
      .from("players")
      .select("user_id, name, team, is_host, joined_at")
      .eq("room_code", code)
      .order("joined_at", { ascending: true }),
    supabaseClient
      .from("submissions")
      .select("user_id, round, answer, points, correct, idea, player_name, team, created_at")
      .eq("room_code", code)
      .order("created_at", { ascending: false }),
    supabaseClient
      .from("team_resources")
      .select("team, influence, evidence, protection, score_bonus")
      .eq("room_code", code),
    supabaseClient
      .from("game_actions")
      .select("actor_team, action_type, target_team, success, result_message, created_at")
      .eq("room_code", code)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseClient
      .from("team_alliances")
      .select("team_a, team_b, status, created_at, broken_at")
      .eq("room_code", code)
  ]);

  const error = roomRes.error || playersRes.error || submissionsRes.error || resourcesRes.error || actionsRes.error || alliancesRes.error;
  if (error) {
    console.error("Room refresh failed:", error);
    setStatus("Realtime refresh failed", "error");
    return;
  }

  if (!roomRes.data) {
    state.room = null;
    show("home");
    setStatus("Room closed", "error");
    return;
  }

  state.room = buildRoomState(roomRes.data, playersRes.data, submissionsRes.data, resourcesRes.data, actionsRes.data, alliancesRes.data);
  renderRoom();
}

function queueRoomRefresh() {
  if (state.refreshQueued) return;
  state.refreshQueued = true;
  setTimeout(async () => {
    state.refreshQueued = false;
    await loadRoomState();
  }, 75);
}

async function bindRoom(presenceMeta) {
  if (state.realtimeChannel && supabaseClient) {
    await supabaseClient.removeChannel(state.realtimeChannel);
  }

  state.presencePlayers = null;
  await loadRoomState();

  const channel = supabaseClient.channel(`game-room:${state.roomCode}`, {
    config: {
      presence: { key: state.playerId }
    }
  });

  channel
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "rooms",
      filter: `code=eq.${state.roomCode}`
    }, queueRoomRefresh)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "players",
      filter: `room_code=eq.${state.roomCode}`
    }, queueRoomRefresh)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "submissions",
      filter: `room_code=eq.${state.roomCode}`
    }, queueRoomRefresh)
    .on("presence", { event: "sync" }, () => {
      const presenceState = channel.presenceState();
      const online = {};
      for (const entries of Object.values(presenceState)) {
        for (const entry of entries) {
          if (!entry.user_id) continue;
          online[entry.user_id] = {
            name: entry.name || "Player",
            team: Number(entry.team || 0),
            host: Boolean(entry.is_host)
          };
        }
      }
      state.presencePlayers = online;
      renderRoom();
    })
    .on("presence", { event: "join" }, () => {
      queueRoomRefresh();
    })
    .on("presence", { event: "leave" }, () => {
      queueRoomRefresh();
    });

  state.realtimeChannel = channel;

  channel.subscribe(async status => {
    if (status === "SUBSCRIBED") {
      await channel.track({
        user_id: state.playerId,
        name: presenceMeta?.name || (state.isHost ? "HOST" : "Player"),
        team: Number(presenceMeta?.team || 0),
        is_host: Boolean(presenceMeta?.isHost),
        online_at: new Date().toISOString()
      });
      setStatus("Supabase live", "success");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setStatus("Realtime connection issue", "error");
    }
  });
}

function enterLobby() {
  show("lobby");
  $("roomCodeDisplay").textContent = state.roomCode;
  $("hostControls").classList.toggle("hidden", !state.isHost);
  $("playerLobby").classList.toggle("hidden", state.isHost);

  if (state.isHost) {
    $("qrcode").innerHTML = "";
    const joinUrl = `${location.href.split("#")[0]}#join=${state.roomCode}`;
    if (window.QRCode) {
      new window.QRCode($("qrcode"), { text: joinUrl, width: 170, height: 170 });
    } else {
      $("qrcode").innerHTML = `<div style="padding:30px;background:#f4f6f8;border-radius:10px;font-size:12px;word-break:break-all">${esc(joinUrl)}</div>`;
    }
  }
}

function getVisiblePlayers() {
  const stored = state.room?.players || {};
  const presence = state.presencePlayers || {};
  const visible = {};

  // Database is the source of truth for who joined. Presence only adds live status.
  for (const [id, player] of Object.entries(stored)) {
    visible[id] = {
      ...player,
      online: Boolean(presence[id])
    };
  }

  // Keep a just-connected player visible even if the database refresh is a few ms behind.
  for (const [id, live] of Object.entries(presence)) {
    if (!visible[id]) visible[id] = { ...live, online: true };
  }

  return visible;
}

function renderRoom() {
  if (!state.room) return;

  const players = getVisiblePlayers();
  const arr = Object.entries(players);
  const playerCount = arr.filter(([_, p]) => !p.host).length;

  $("playerCount").textContent = playerCount;
  $("roomCodeDisplay").textContent = state.roomCode;
  $("playerList").innerHTML = arr
    .map(([_, p]) => `<div class="player"><span class="dot ${p.online === false ? "offline" : ""}"></span><span>${esc(p.name)}</span><span class="team-badge">${p.host ? "HOST" : `Team ${p.team}`}</span></div>`)
    .join("");

  if (state.room.status === "game") renderGame();
  if (state.room.status === "results") renderResults();
}

async function updateRoom(patch) {
  if (!state.isHost || !state.roomCode) return;
  const { error } = await supabaseClient
    .from("rooms")
    .update(patch)
    .eq("code", state.roomCode);

  if (error) {
    alert(friendlyError(error, "Could not update the room."));
    return;
  }
  queueRoomRefresh();
}

async function startGame() {
  state.selected = null;
  if (!state.isHost || !state.roomCode) return;
  const { error } = await supabaseClient.rpc("start_v6_game", { p_room_code: state.roomCode });
  if (error) {
    alert(friendlyError(error, "Could not start the game. Run v6-migration.sql first."));
    return;
  }
  queueRoomRefresh();
}

function currentRound() {
  return rounds[Math.min(Number(state.room?.round || 0), rounds.length - 1)];
}

function phaseInfo() {
  return PHASES[state.room?.gamePhase] || PHASES.evidence_hunt;
}

function isFinalBoardroom() {
  return state.room?.gamePhase === "final_boardroom";
}

function renderResources() {
  const myTeam = state.isHost ? 0 : Number(state.room?.players?.[state.playerId]?.team || 0);
  const html = Object.entries(state.room?.teams || {}).map(([key, t]) => {
    const teamNo = Number(key.replace("team",""));
    const mine = teamNo === myTeam ? " mine" : "";
    return `<div class="resource-card${mine}">
      <b>${esc(t.name)}</b>
      <span>⚡ ${t.influence}</span>
      <span>🧾 ${t.evidence}</span>
      <span>🛡 ${t.protection}</span>
    </div>`;
  }).join("");
  $("teamResources").innerHTML = html;
}

function renderPhaseActions() {
  const phase = state.room?.gamePhase;
  const controls = $("battleControls");
  const buttons = $("actionButtons");
  if (!controls || !buttons) return;

  const battle = phase === "corporate_war";
  const negotiation = phase === "negotiation";
  const betrayal = phase === "betrayal";
  const canAct = !state.isHost && (battle || negotiation || betrayal);

  controls.classList.toggle("hidden", !canAct);
  if (!canAct) {
    buttons.innerHTML = "";
    return;
  }

  const actions = battle
    ? [
        ["STEAL","🗡 STEAL","Take 1 evidence if the target has no Protection."],
        ["PROTECT","🛡 PROTECT","Add 1 Protection to your team."],
        ["CURSE","👻 CURSE","Spend 2 Influence to remove 1 Influence from another team."]
      ]
    : negotiation
      ? [["ALLY","🤝 ALLY","Form an alliance with another team."]]
      : [["BETRAY","🩸 BETRAY","Break an active alliance for +600 bonus points."]];

  buttons.innerHTML = actions.map(([key,label,desc]) =>
    `<button type="button" class="battle-action" data-action="${key}">
      <strong>${label}</strong><span>${desc}</span>
    </button>`).join("");

  buttons.querySelectorAll(".battle-action").forEach(btn => {
    btn.addEventListener("click", () => performTeamAction(btn.dataset.action));
  });
}

async function performTeamAction(action) {
  if (state.isHost) return;
  const target = Number($("targetTeam")?.value || 0);
  if (["STEAL","CURSE","ALLY","BETRAY"].includes(action) && (!target || target === Number(state.room?.players?.[state.playerId]?.team))) {
    alert("Choose another team first.");
    return;
  }

  document.querySelectorAll(".battle-action").forEach(b => b.disabled = true);
  const { error } = await supabaseClient.rpc("v6_team_action", {
    p_room_code: state.roomCode,
    p_action_type: action,
    p_target_team: target || null
  });

  if (error) {
    alert(friendlyError(error, "That move could not be completed."));
  }
  queueRoomRefresh();
}

function renderPhaseActionLog() {
  const actions = state.room?.actions || [];
  const alliances = state.room?.alliances || [];
  const recent = actions.slice(0, 8).map(a =>
    `<div class="phase-log-item"><b>TEAM ${a.actor_team}</b> · ${esc(a.action_type)}${a.target_team ? ` → TEAM ${a.target_team}` : ""}<span>${esc(a.result_message || "")}</span></div>`
  ).join("");

  const allianceText = alliances.filter(a => a.status === "active").map(a =>
    `<span class="alliance-chip">🤝 T${a.team_a} + T${a.team_b}</span>`
  ).join("");

  $("phaseActionLog").innerHTML = allianceText || recent
    ? `<div class="log-title">LIVE BOARDROOM EVENTS</div>${allianceText}${recent}`
    : `<div class="muted">No moves yet. The room is watching.</div>`;
}

function showGhostEvent(eventKey) {
  const data = GHOST_EVENTS[eventKey];
  if (!data || !state.room) return;
  const key = `${state.room.roomCode || state.roomCode}:${state.room.phaseNo}:${eventKey}`;
  if (state.lastEventKey === key) return;
  state.lastEventKey = key;

  $("ghostEventIcon").textContent = data.icon;
  $("ghostEventTitle").textContent = data.title;
  $("ghostEventText").textContent = data.text;
  $("ghostEventRule").textContent = data.rule;
  $("ghostEventModal").classList.remove("hidden");
}

function renderPhase() {
  const phase = state.room?.gamePhase || "lobby";
  const info = phaseInfo();
  const panel = $("phasePanel");
  const quiz = $("quizChallenge");
  if (!panel || !quiz) return;

  $("phaseTitle").textContent = info.title;
  $("phaseSub").textContent = info.sub;
  $("phaseKicker").textContent = info.kicker;
  $("phasePanelTitle").textContent = info.title;
  $("phasePanelText").textContent = info.sub;
  $("investigateBtn")?.classList.toggle("hidden", phase !== "evidence_hunt");
  $("phaseWarning").textContent = phase === "corporate_war"
    ? "⚠️ CORPORATE WAR · TEAMS CAN ATTACK EACH OTHER"
    : phase === "betrayal"
      ? "🩸 SECRET DEAL · SOMEONE IS ABOUT TO BETRAY AN ALLIANCE"
      : "⚠️ PARANORMAL BOARDROOM ALERT · THE CEO IS PRESENT";

  quiz.classList.toggle("hidden", !isFinalBoardroom());
  panel.classList.toggle("hidden", isFinalBoardroom() || phase === "ending");
  renderResources();
  renderPhaseActions();
  renderPhaseActionLog();

  if (phase === "evidence_hunt") {
    $("phasePanelText").textContent = "Explore the boardroom first. Every clue you find reveals part of the company's value-creation problem.";
  } else if (phase === "ghost_event") {
    $("phasePanelText").textContent = state.room.eventMessage || GHOST_EVENTS.ghost_event.rule;
    showGhostEvent("ghost_event");
  } else if (phase === "corporate_war") {
    $("phasePanelText").textContent = "Every team starts with Influence, Evidence and Protection. Choose your move carefully — the other teams are playing too.";
  } else if (phase === "negotiation") {
    $("phasePanelText").textContent = "Make an alliance with another team. Alliances can later be betrayed.";
  } else if (phase === "betrayal") {
    $("phasePanelText").textContent = GHOST_EVENTS.betrayal.rule;
    showGhostEvent("betrayal");
  }

  if (state.room?.activeEvent === "ghost_event" || phase === "ghost_event") {
    showGhostEvent("ghost_event");
  }
}

function startPhaseTimer() {
  clearInterval(state.phaseTimer);
  const tick = () => {
    const ends = Number(state.room?.phaseEndsAt || 0);
    const remaining = ends ? Math.max(0, Math.ceil((ends - Date.now()) / 1000)) : 0;
    state.seconds = remaining;
    const phaseEl = $("phaseTimer");
    if (phaseEl) phaseEl.textContent = `${String(Math.floor(remaining/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`;
    const old = $("timer");
    if (old) old.textContent = remaining;
  };
  tick();
  if (state.room?.phaseEndsAt) state.phaseTimer = setInterval(tick, 1000);
}

function renderGame() {
  show("game");
  const r = currentRound();
  const idx = Number(state.room.round || 0);
  const phase = state.room?.gamePhase || "final_boardroom";
  const mySubmission = state.room.submissions?.[state.playerId]?.[idx];

  $("roundNo").textContent = isFinalBoardroom() ? idx + 1 : "—";
  $("roundTag").textContent = isFinalBoardroom() ? r.tag : phaseInfo().kicker;
  $("challengeTitle").textContent = r.title;
  $("challengeText").textContent = r.text;
  $("teamName").textContent = state.isHost ? "HOST" : `Team ${state.room.players?.[state.playerId]?.team || "?"}`;
  if ($("homeNext")) $("homeNext").textContent = "RETURN TO MISSION ›";
  $("hostGameControls").classList.toggle("hidden", !state.isHost);
  $("innovationInput").classList.toggle("hidden", !isFinalBoardroom() || idx !== 2);

  $("choices").innerHTML = r.choices
    .map(([key, label]) => `<button class="choice ${state.selected === key ? "selected" : ""}" data-key="${key}" ${mySubmission || state.isHost || !isFinalBoardroom() ? "disabled" : ""}><b>${key}</b>${esc(label)}</button>`)
    .join("");

  document.querySelectorAll(".choice").forEach(button => {
    button.addEventListener("click", () => {
      state.selected = button.dataset.key;
      document.querySelectorAll(".choice").forEach(x => x.classList.remove("selected"));
      button.classList.add("selected");
    });
  });

  $("submitBtn").disabled = Boolean(mySubmission) || state.isHost || !isFinalBoardroom();
  $("submitted").classList.toggle("hidden", !mySubmission && !state.isHost);
  $("submitted").textContent = state.isHost ? "Host mode: control the mission." : "Submitted! Watch the room.";

  renderLeaderboard();
  renderActivity();
  renderPhase();
  startPhaseTimer();
}

function updateGadgets() {
  const emf = String(Math.floor(3 + Math.random() * 9)).padStart(2, "0");
  const radios = ["STATIC", "HELP…", "RUN", "LISTEN", "…"];
  const radio = radios[Math.floor(Math.random() * radios.length)];
  const cam = Math.random() > 0.75 ? "NO SIGNAL" : "● LIVE";
  const safe = Math.random() > 0.82 ? "OPEN?" : "LOCKED";

  document.querySelectorAll(".gadget").forEach((g, i) => {
    const v = g.querySelector(".gvalue");
    if (!v) return;
    if (i % 4 === 0) v.textContent = emf;
    if (i % 4 === 1) v.textContent = radio;
    if (i % 4 === 2) v.textContent = cam;
    if (i % 4 === 3) v.textContent = safe;
  });
}

function startTimer() {
  clearInterval(state.timer);
  state.seconds = Number(state.room?.round || 0) === 2 ? 45 : 60;
  $("timer").textContent = state.seconds;
  updateGadgets();

  state.timer = setInterval(() => {
    state.seconds--;
    $("timer").textContent = Math.max(0, state.seconds);
    if (state.seconds % 5 === 0) updateGadgets();
    if (state.seconds <= 0) clearInterval(state.timer);
  }, 1000);
}

async function submitAnswer() {
  if (state.isHost) return;

  const idx = Number(state.room.round || 0);
  let answer = state.selected;
  const idea = idx === 2 ? $("ideaText").value.trim() : "";

  if (idx === 2 && !answer) answer = "A";
  if (idx === 2 && !idea) {
    alert("Write a one-sentence innovation first.");
    return;
  }
  if (!answer) {
    alert("Choose an answer first.");
    return;
  }

  $("submitBtn").disabled = true;

  const { error } = await supabaseClient.rpc("submit_game_answer", {
    p_room_code: state.roomCode,
    p_round: idx,
    p_answer: answer,
    p_idea: idea
  });

  if (error) {
    $("submitBtn").disabled = false;
    alert(friendlyError(error, "Could not submit your answer."));
    return;
  }

  queueRoomRefresh();
}

function renderLeaderboard() {
  const teams = Object.entries(state.room.teams || {})
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  $("leaderboard").innerHTML = teams
    .map(([_, t], i) => `<div class="score-row"><span>${i + 1}</span><span>${esc(t.name)}</span><span class="score">${t.score || 0}</span></div>`)
    .join("");
}

function renderActivity() {
  const subs = state.room.submissions || {};
  const idx = Number(state.room.round || 0);
  const items = [];

  Object.values(subs).forEach(playerSubs => {
    if (playerSubs[idx]) items.push(playerSubs[idx]);
  });

  items.sort((a, b) => (b.at || 0) - (a.at || 0));

  $("activity").innerHTML = items.length
    ? items.slice(0, 12).map(x => `<div class="feed-item"><b>${esc(x.name)}</b> · Team ${x.team} ${x.correct ? "✓ correct" : "· submitted"}${x.idea ? `<div>${esc(x.idea)}</div>` : ""}</div>`).join("")
    : `<div class="feed-item"><span class="horror-mark">THE GHOST</span> · ${esc(hauntedEvents[Math.floor(Math.random() * hauntedEvents.length)])}</div><div class="muted">Submissions will appear here live.</div>`;
}

async function advanceGame() {
  if (!state.isHost) return;
  const phase = state.room?.gamePhase || "lobby";

  if (phase === "final_boardroom") {
    const idx = Number(state.room.round || 0);
    if (idx < rounds.length - 1) {
      await updateRoom({
        round: idx + 1,
        phase_started_at: new Date().toISOString(),
        phase_ends_at: new Date(Date.now() + (idx === 1 ? 45 : 60) * 1000).toISOString(),
        active_event: null,
        event_message: ""
      });
    } else {
      await updateRoom({
        status: "results",
        game_phase: "ending",
        phase_no: PHASE_ORDER.indexOf("ending") + 1,
        phase_started_at: new Date().toISOString(),
        phase_ends_at: null,
        active_event: null,
        event_message: "The CEO has judged the board."
      });
    }
    return;
  }

  const orderIndex = PHASE_ORDER.indexOf(phase);
  const next = PHASE_ORDER[Math.min(orderIndex + 1, PHASE_ORDER.length - 1)];
  const info = PHASES[next];
  const now = new Date();
  const end = info.seconds ? new Date(Date.now() + info.seconds * 1000) : null;
  const patch = {
    game_phase: next,
    phase_no: orderIndex + 2,
    phase_started_at: now.toISOString(),
    phase_ends_at: end ? end.toISOString() : null,
    active_event: next === "ghost_event" ? "ghost_event" : next === "betrayal" ? "betrayal" : null,
    event_message: next === "ghost_event"
      ? GHOST_EVENTS.ghost_event.rule
      : next === "betrayal"
        ? GHOST_EVENTS.betrayal.rule
        : ""
  };
  if (next === "final_boardroom") patch.round = 0;
  await updateRoom(patch);
}


async function endGame() {
  await updateRoom({ status: "results" });
}

function renderResults() {
  show("results");
  clearInterval(state.timer);
  clearInterval(state.phaseTimer);
  state.timerRound = null;

  const teams = Object.entries(state.room.teams || {})
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  $("finalBoard").innerHTML = `<div class="final-score">${teams
    .map(([_, t], i) => `<div class="score-row"><span>${i + 1}</span><span>${esc(t.name)}</span><span class="score">${t.score || 0} pts</span></div>`)
    .join("")}</div>`;
}

function openEvidence(key) {
  const c = clues[key];
  if (!c) return;

  $("clueTitle").textContent = c.title;
  $("clueBody").textContent = c.body;
  $("clueConcept").textContent = c.concept;
  $("clueModal").classList.remove("hidden");

  if (!collectedClues.has(key)) {
    collectedClues.add(key);
    const slots = document.querySelectorAll("#evidenceSlots span");
    const i = Array.from(collectedClues).indexOf(key);
    if (slots[i]) {
      slots[i].classList.add("found");
      slots[i].textContent = "✓";
    }
    const counter = $("evidenceCount");
    if (counter) counter.textContent = `${collectedClues.size} / 6 CLUES FOUND`;
  }
}

let homeSeconds = 599;
setInterval(() => {
  homeSeconds = Math.max(0, homeSeconds - 1);
  const m = String(Math.floor(homeSeconds / 60)).padStart(2, "0");
  const s = String(homeSeconds % 60).padStart(2, "0");
  const el = $("homeCountdown");
  if (el) el.textContent = `${m}:${s}`;
}, 1000);

$("homeNext")?.addEventListener("click", () => {
  if (state.room?.status === "game") {
    show("game");
    renderGame();
  } else {
    $("joinCode")?.focus();
  }
});
$("investigateBtn")?.addEventListener("click", () => show("home"));

const clueModal = $("clueModal");
document.querySelectorAll(".art-hotspot").forEach(el => {
  el.addEventListener("click", () => openEvidence(el.dataset.clue));
});
$("closeClue")?.addEventListener("click", () => clueModal?.classList.add("hidden"));
$("closeGhostEvent")?.addEventListener("click", () => $("ghostEventModal")?.classList.add("hidden"));
clueModal?.addEventListener("click", e => {
  if (e.target === clueModal) clueModal.classList.add("hidden");
});

$("hostBtn")?.addEventListener("click", createRoom);
$("joinForm")?.addEventListener("submit", e => {
  e.preventDefault();
  joinRoom($("joinCode").value, $("joinName").value);
});
$("startBtn")?.addEventListener("click", startGame);
$("submitBtn")?.addEventListener("click", submitAnswer);
$("nextBtn")?.addEventListener("click", advanceGame);
$("endBtn")?.addEventListener("click", endGame);
$("againBtn")?.addEventListener("click", () => location.reload());

if (location.hash.startsWith("#join=")) {
  $("joinCode").value = location.hash.slice(6, 12).toUpperCase();
}

initSupabase();
