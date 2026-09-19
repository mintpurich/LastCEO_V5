import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

/*
  1. Create a Firebase project.
  2. Enable Anonymous Authentication and Realtime Database.
  3. Paste your web-app config below.
*/
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_DATABASE_URL",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const configured = !Object.values(firebaseConfig).some(v => String(v).includes("PASTE_YOUR"));
let app, db, auth, currentUser;
const state = {
  room: null, roomCode: null, playerId: null, isHost: false,
  selected: null, idea: "", unsubscribe: null, timer: null, seconds: 60
};

const hauntedEvents = [
  "A cold wind passes through the boardroom.",
  "The CEO’s desk phone rings. Nobody is there.",
  "A chair slowly turns toward the screen.",
  "The lights flicker. The ghost is listening.",
  "A file appears on the CEO’s desk: MAKE OR BUY.",
  "Someone whispers: “Co-create…”"
];


const clues = {
  portrait: {
    title:"The CEO’s Portrait",
    body:"Behind the portrait you find an old note: “The customer is not outside the value process. The customer is part of it.”",
    concept:"CO-CREATION · Customers can actively contribute to value creation."
  },
  computer: {
    title:"CEO’s Computer",
    body:"A presentation is open: “From marketing TO clients → creating value WITH clients.”",
    concept:"CO-PRODUCTION · Clients can become active participants in an organisation’s work."
  },
  cabinet: {
    title:"Filing Cabinet 7B",
    body:"A supplier contract lists three hidden costs: safeguarding, adaptation and measurement.",
    concept:"TRANSACTION COST THEORY · Buy = outsourcing cost + transaction costs."
  },
  safe: {
    title:"The Locked Safe",
    body:"A label reads: “Never outsource what gives us customer intimacy.” The keypad is waiting for a team decision.",
    concept:"MAKE OR BUY · Consider transaction costs, core competencies and the risk of losing direct customer contact."
  },
  phone: {
    title:"The CEO’s Phone",
    body:"The voicemail is from a lead user asking for a product that mainstream customers do not yet need.",
    concept:"OPEN INNOVATION · Lead users can reveal future needs and inspire innovation."
  },
  table: {
    title:"The Last Board Meeting",
    body:"Around the table are notes from customers, suppliers, competitors and partners. The CEO had been collecting ideas from outside the firm.",
    concept:"OPEN INNOVATION · Innovation can draw on customers, competitors, lead users and partners."
  }
};


const clues = {
  portrait:{title:"The CEO’s Portrait",body:"Behind the portrait is a handwritten note: “Customers are not outside the value process. They are part of it.”",concept:"CO-CREATION · Customers can actively contribute to value creation."},
  computer:{title:"CEO’s Computer",body:"A presentation is frozen on screen: “From marketing TO clients → creating value WITH clients.”",concept:"CO-PRODUCTION · Clients can become active participants in an organisation’s work."},
  cabinet:{title:"Filing Cabinet 7B",body:"Three supplier folders are stamped SAFEGUARDING, ADAPTATION and MEASUREMENT.",concept:"TRANSACTION COST THEORY · Outsourcing can create transaction costs beyond the supplier’s quoted price."},
  safe:{title:"The CEO’s Safe",body:"The keypad flashes: “MAKE / BUY.” A note says: “Do not compare the supplier price alone.”",concept:"MAKE OR BUY · Compare internal production costs with outsourcing costs plus transaction costs."},
  phone:{title:"The Black Phone",body:"A voicemail from a lead user describes a problem mainstream customers have not noticed yet.",concept:"OPEN INNOVATION · Lead users can reveal emerging needs and inspire innovation."},
  table:{title:"The Last Board Meeting",body:"Cards around the table name customers, suppliers, competitors and partners.",concept:"OPEN INNOVATION · Innovation can draw on knowledge and ideas from outside the firm."}
};
let collectedClues=new Set();
function openEvidence(key){
  const c=clues[key]; if(!c) return;
  $("clueTitle").textContent=c.title;
  $("clueBody").textContent=c.body;
  $("clueConcept").textContent=c.concept;
  $("clueModal").classList.remove("hidden");
  if(!collectedClues.has(key)){
    collectedClues.add(key);
    const slots=document.querySelectorAll("#evidenceSlots span");
    const i=Array.from(collectedClues).indexOf(key);
    if(slots[i]){slots[i].classList.add("found");slots[i].textContent="✓";}
    const counter=$("evidenceCount");
    if(counter) counter.textContent=`${collectedClues.size} / 6 CLUES FOUND`;
  }
}

const rounds = [
  {
    tag:"👻 CO-DESIGN", title:"The student experience crisis",
    text:"A university wants to redesign its orientation experience. Students say the current process is confusing, but staff already have a proposed solution. Which action best represents value co-creation?",
    choices:[
      ["A","Design the new process internally and announce it to students."],
      ["B","Invite students to critique, redesign and test the orientation experience with the university."],
      ["C","Outsource orientation to an agency and ask students to complete a survey afterward."],
      ["D","Ask staff to choose the solution because they understand operations best."]
    ], answer:"B", points:100,
    debrief:"Co-design involves customers/stakeholders contributing through critiquing, designing and using services/products."
  },
  {
    tag:"☠ MAKE OR BUY", title:"The 3-cost trap",
    text:"Your team can build a customer-support system internally for $80k. A supplier charges $55k. But outsourcing adds $8k safeguarding costs, $12k adaptation costs and $10k measurement costs. What should the team choose if total cost is the only consideration?",
    choices:[
      ["A","Make: $80k versus Buy: $85k."],
      ["B","Buy: $55k because outsourcing price is lower."],
      ["C","Buy: $77k because transaction costs are ignored."],
      ["D","Make because outsourcing is always risky."]
    ], answer:"A", points:100,
    debrief:"Transaction cost theory compares production costs with outsourcing costs plus safeguarding, adaptation and measurement costs."
  },
  {
    tag:"🕯️ OPEN INNOVATION", title:"Lead-user innovation lab",
    text:"Your team has 45 seconds to propose an innovation inspired by a lead user. Pick one starting point, then write a one-sentence innovation. The class will see every team's idea.",
    choices:[
      ["A","Lead user","Find a person whose needs are ahead of mainstream users."],
      ["B","Competitor","Borrow a competitor's idea without changing it."],
      ["C","Internal team","Keep the idea completely inside the firm."]
    ], answer:null, points:150,
    debrief:"Open innovation can draw ideas from customers, competitors, lead users and partners; the lecture also highlights crowdsourcing and joint development."
  }
];

const $ = id => document.getElementById(id);
const show = id => document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id===id));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function randomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out=""; for(let i=0;i<6;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
function randomId(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now(); }

function setStatus(text, cls=""){ $("connection").textContent=text; $("connection").className="status "+cls; }

async function initFirebase(){
  if(!configured){
    setStatus("Demo mode");
    $("firebaseHint").innerHTML = "The downloadable project is ready for multiplayer. Add your Firebase config in <code>app.js</code> to enable live rooms.";
    return false;
  }
  try{
    app=initializeApp(firebaseConfig); db=getDatabase(app); auth=getAuth(app);
    const cred=await signInAnonymously(auth); currentUser=cred.user;
    setStatus("Live database","success");
    return true;
  }catch(e){
    console.error(e); setStatus("Firebase setup needed","error");
    $("firebaseHint").textContent="Firebase could not connect. Check app.js config and Firebase Authentication/Realtime Database setup.";
    return false;
  }
}

async function createRoom(){
  if(!configured){ alert("Add your Firebase config to app.js first."); return; }
  if(!currentUser) await initFirebase();
  const code=randomCode();
  state.roomCode=code; state.playerId=currentUser.uid; state.isHost=true;
  const hostName="HOST";
  const room={hostId:state.playerId,status:"lobby",round:0,createdAt:Date.now(),players:{},teams:{}};
  room.players[state.playerId]={name:hostName,team:0,host:true,joinedAt:Date.now()};
  for(let i=1;i<=4;i++) room.teams["team"+i]={name:"Team "+i,score:0};
  await set(ref(db,"rooms/"+code),room);
  state.room=room;
  bindRoom();
  enterLobby();
}

async function joinRoom(code,name){
  if(!configured){ alert("Add Firebase config to app.js first."); return; }
  if(!currentUser) await initFirebase();
  code=code.trim().toUpperCase(); name=name.trim();
  if(code.length!==6 || !name){ alert("Enter a 6-character room code and your name."); return; }
  const roomSnap=await get(ref(db,"rooms/"+code));
  if(!roomSnap.exists()){ alert("Room not found."); return; }
  const room=roomSnap.val();
  if(room.status!=="lobby"){ alert("That mission has already started."); return; }
  state.roomCode=code; state.playerId=currentUser.uid; state.isHost=false;
  const players=room.players||{};
  const active=[...Object.values(players)].filter(p=>!p.host);
  const team=(active.length%4)+1;
  await update(ref(db,`rooms/${code}/players/${state.playerId}`),{name,team,host:false,joinedAt:Date.now()});
  await onDisconnect(ref(db,`rooms/${code}/players/${state.playerId}`)).remove();
  bindRoom(); enterLobby();
}

function bindRoom(){
  if(state.unsubscribe) state.unsubscribe();
  state.unsubscribe=onValue(ref(db,"rooms/"+state.roomCode),snap=>{
    if(!snap.exists()){ show("home"); return; }
    state.room=snap.val(); renderRoom();
  });
}

function enterLobby(){
  show("lobby"); $("roomCodeDisplay").textContent=state.roomCode;
  $("hostControls").classList.toggle("hidden",!state.isHost);
  $("playerLobby").classList.toggle("hidden",state.isHost);
  if(state.isHost){
    $("qrcode").innerHTML="";
    const joinUrl=location.href.split("#")[0]+"#join="+state.roomCode;
    // QRCode.js loaded below if available; fallback shows the URL.
    if(window.QRCode) new QRCode($("qrcode"),{text:joinUrl,width:170,height:170});
    else $("qrcode").innerHTML=`<div style="padding:30px;background:#f4f6f8;border-radius:10px;font-size:12px;word-break:break-all">${esc(joinUrl)}</div>`;
  }
}

function renderRoom(){
  if(!state.room) return;
  const players=state.room.players||{};
  const arr=Object.entries(players);
  $("playerCount").textContent=arr.filter(([_,p])=>!p.host).length;
  $("roomCodeDisplay").textContent=state.roomCode;
  $("playerList").innerHTML=arr.map(([id,p])=>`<div class="player"><span class="dot"></span><span>${esc(p.name)}</span><span class="team-badge">${p.host?"HOST":"Team "+p.team}</span></div>`).join("");
  if(state.room.status==="game") renderGame();
  if(state.room.status==="results") renderResults();
}

function startGame(){
  update(ref(db,"rooms/"+state.roomCode),{status:"game",round:0});
}
function currentRound(){ return rounds[Math.min(Number(state.room?.round||0),rounds.length-1)]; }

function renderGame(){
  show("game");
  const r=currentRound(), idx=Number(state.room.round||0);
  $("roundNo").textContent=idx+1;
  $("roundTag").textContent=r.tag;
  $("challengeTitle").textContent=r.title;
  $("challengeText").textContent=r.text;
  $("teamName").textContent=state.isHost?"HOST":`Team ${state.room.players?.[state.playerId]?.team||"?"}`;
  $("hostGameControls").classList.toggle("hidden",!state.isHost);
  $("innovationInput").classList.toggle("hidden",idx!==2);
  if(idx!==2) $("innovationInput").classList.add("hidden");
  $("choices").innerHTML=r.choices.map(([key,label])=>`<button class="choice ${state.selected===key?"selected":""}" data-key="${key}"><b>${key}</b>${esc(label)}</button>`).join("");
  document.querySelectorAll(".choice").forEach(b=>b.addEventListener("click",()=>{state.selected=b.dataset.key;document.querySelectorAll(".choice").forEach(x=>x.classList.remove("selected"));b.classList.add("selected")}));
  $("submitBtn").disabled=!!state.room.submissions?.[state.playerId]?.[idx];
  $("submitted").classList.toggle("hidden",!state.room.submissions?.[state.playerId]?.[idx]);
  renderLeaderboard();
  renderActivity();
  renderHauntedEvent();
  startTimer();
}

function updateGadgets(){const emf=String(Math.floor(3+Math.random()*9)).padStart(2,"0");const radios=["STATIC","HELP…","RUN","LISTEN","…"];const radio=radios[Math.floor(Math.random()*radios.length)];const cam=Math.random()>.75?"NO SIGNAL":"● LIVE";const safe=Math.random()>.82?"OPEN?":"LOCKED";document.querySelectorAll(".gadget").forEach((g,i)=>{const v=g.querySelector(".gvalue");if(!v)return;if(i%4===0)v.textContent=emf;if(i%4===1)v.textContent=radio;if(i%4===2)v.textContent=cam;if(i%4===3)v.textContent=safe})}
function startTimer(){
  clearInterval(state.timer);
  state.seconds=60;
  $("timer").textContent=state.seconds;
  updateGadgets();
  state.timer=setInterval(()=>{state.seconds--; $("timer").textContent=Math.max(0,state.seconds); if(state.seconds%5===0) updateGadgets(); if(state.seconds<=0) clearInterval(state.timer)},1000);
}

async function submitAnswer(){
  const idx=Number(state.room.round||0), r=currentRound();
  let answer=state.selected;
  if(idx===2 && !answer) answer="A";
  if(idx===2 && $("ideaText").value.trim()===""){ alert("Write a one-sentence innovation first."); return; }
  if(!answer){ alert("Choose an answer first."); return; }
  const correct=r.answer ? answer===r.answer : true;
  const points=correct ? r.points : 0;
  const submission={answer,points,correct,idea:idx===2?$("ideaText").value.trim():"",name:state.room.players?.[state.playerId]?.name||"Player",team:state.room.players?.[state.playerId]?.team||1,at:Date.now()};
  await set(ref(db,`rooms/${state.roomCode}/submissions/${state.playerId}/${idx}`),submission);
  const team=state.room.players?.[state.playerId]?.team||1;
  if(points) await update(ref(db,`rooms/${state.roomCode}/teams/team${team}`),{score:(state.room.teams?.[`team${team}`]?.score||0)+points});
}

function renderLeaderboard(){
  const teams=Object.entries(state.room.teams||{}).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  $("leaderboard").innerHTML=teams.map(([id,t],i)=>`<div class="score-row"><span>${i+1}</span><span>${esc(t.name)}</span><span class="score">${t.score||0}</span></div>`).join("");
}
function renderHauntedEvent(){
  const feed = $("activity");
  const msg = hauntedEvents[Math.floor(Math.random()*hauntedEvents.length)];
  const el = document.createElement("div");
  el.className = "feed-item";
  el.innerHTML = `<span class="horror-mark">THE GHOST</span> · ${esc(msg)}`;
  feed.prepend(el);
}

function renderActivity(){
  const subs=state.room.submissions||{}, idx=Number(state.room.round||0);
  const items=[];
  Object.values(subs).forEach(ps=>{if(ps[idx]) items.push(ps[idx])});
  items.sort((a,b)=>(b.at||0)-(a.at||0));
  $("activity").innerHTML=items.slice(0,12).map(x=>`<div class="feed-item"><b>${esc(x.name)}</b> · Team ${x.team} ${x.correct?"✓ correct":"· submitted"}${x.idea?`<div>${esc(x.idea)}</div>`:""}</div>`).join("") || "<div class='muted'>Submissions will appear here live.</div>";
}
async function nextRound(){
  const idx=Number(state.room.round||0);
  if(idx<rounds.length-1) await update(ref(db,"rooms/"+state.roomCode),{round:idx+1});
  else await update(ref(db,"rooms/"+state.roomCode),{status:"results"});
}
async function endGame(){ await update(ref(db,"rooms/"+state.roomCode),{status:"results"}); }

function renderResults(){
  show("results");
  clearInterval(state.timer);
  const teams=Object.entries(state.room.teams||{}).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  $("finalBoard").innerHTML=`<div class="final-score">${teams.map(([id,t],i)=>`<div class="score-row"><span>${i+1}</span><span>${esc(t.name)}</span><span class="score">${t.score||0} pts</span></div>`).join("")}</div>`;
}



let homeSeconds=599;
setInterval(()=>{
  homeSeconds=Math.max(0,homeSeconds-1);
  const m=String(Math.floor(homeSeconds/60)).padStart(2,"0");
  const s=String(homeSeconds%60).padStart(2,"0");
  const el=$("homeCountdown");
  if(el) el.textContent=`${m}:${s}`;
},1000);

$("homeNext").addEventListener("click",()=>{
  $("joinCode").focus();
});


const clueModal = $("clueModal");
document.querySelectorAll(".art-hotspot").forEach(el=>{
  el.addEventListener("click",()=>openEvidence(el.dataset.clue));
});
if($("closeClue")) $("closeClue").addEventListener("click",()=>clueModal.classList.add("hidden"));
clueModal.addEventListener("click",e=>{if(e.target===clueModal) clueModal.classList.add("hidden")});

$("hostBtn").addEventListener("click",createRoom);
$("joinForm").addEventListener("submit",e=>{e.preventDefault();joinRoom($("joinCode").value,$("joinName").value)});
$("startBtn").addEventListener("click",startGame);
$("submitBtn").addEventListener("click",submitAnswer);
$("nextBtn").addEventListener("click",nextRound);
$("endBtn").addEventListener("click",endGame);
$("againBtn").addEventListener("click",()=>location.reload());

if(location.hash.startsWith("#join=")){ $("joinCode").value=location.hash.slice(6,12).toUpperCase(); }
initFirebase();
