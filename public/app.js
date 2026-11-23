const pathName = location.pathname;
function playerToken() {
 const bytes = crypto.getRandomValues(new Uint8Array(32));
 const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
 try {
  const key = "monikersPlayerToken";
  const saved = localStorage.getItem(key);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
  localStorage.setItem(key, token);
 } catch (_) {}
 return token;
}
const socket = io({ auth: pathName === "/join" ? { playerToken: playerToken() } : {} });
const app = document.getElementById("app");
let S = null;
let secondsLeft = null;
let startError = "";
let syncing = false;
let lastPlayerName = "";
let undoTimer = null;
let screenAudio = null;
let screenSound = false;
let lastCountdownSecond = null;
const ROUND_RULES = [
 "Talk it up! Describe the phrase and use gestures, but don’t say any part of the answer.",
 "Make it count! Give one word only. No gestures or sound effects.",
 "Go full charades! Act it out. Sound effects are fair game, but no words."
];
const roundRule = n => ROUND_RULES[(Math.max(1, Number(n)) - 1) % ROUND_RULES.length];
const timerText = () => S.turnEndsAt && !S.roundEnding ? (secondsLeft ?? Math.max(0, Math.ceil((S.turnEndsAt - Date.now()) / 1000))) + "s" : "—";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
function emit(name,data={},cb){socket.emit(name,data,cb)}
socket.on("state", s=>{
 if(s.roomCode!==S?.roomCode || s.status!=="lobby")startError="";
 if(s.turnEndsAt!==S?.turnEndsAt || s.roundEnding!==S?.roundEnding){
  secondsLeft=null;
  lastCountdownSecond=null;
 }
 if(pathName==="/join" && s.roomCode!==S?.roomCode){
  const codeInput=document.getElementById("joinCode");
  if(codeInput)codeInput.value=s.roomCode;
 }
 S=s;
 render();
});
socket.on("tick", n=>{
 secondsLeft=n;
 const timer=document.getElementById("timer");
 if(timer){
  timer.textContent=n+"s";
  timer.classList.toggle("countdown-low",n<=3);
 }
 if(pathName==="/screen" && n<=3 && n!==lastCountdownSecond){
  lastCountdownSecond=n;
  playScreenTone(n===0?330:660,n===0?0.32:0.11);
 }
});
socket.on("notice", toast);
socket.on("host:claimed", r=>{
 if(!r.ok && !["localhost","127.0.0.1","[::1]"].includes(location.hostname))toast(r.error);
});
socket.on("connect",()=>{if(pathName==="/")emit("host:claim");});
if (pathName === "/join") {
 socket.on("disconnect", () => {
  secondsLeft = null;
  render();
 });
 function syncPlayer() {
  if (!socket.connected) {
   socket.connect();
   return;
  }
  if (syncing) return;
  syncing = true;
  const socketId = socket.id;
  socket.timeout(2500).emit("player:sync", {}, err => {
   syncing = false;
   if (err && socket.id === socketId) socket.disconnect().connect();
  });
 }
 document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncPlayer();
 });
 window.addEventListener("online", syncPlayer);
 window.addEventListener("pageshow", event => { if (event.persisted) syncPlayer(); });
}
function header(){return `<div class="topbar"><div class="brand">MONIKERS<span>.</span></div><div class="row wrap"><span class="pill"><i class="dot"></i> LOCAL PARTY SERVER</span></div></div>`}
function gameResult(){
 const [a,b]=S.scores;
 return a===b?"It’s a tie!":`${S.teams[a>b?0:1]} wins!`;
}
function roundRecapView(){
 if(!S.roundRecaps?.length)return "";
 const recaps=S.status==="finished"?S.roundRecaps:S.roundRecaps.slice(-1);
 return `<div class="round-recaps">${recaps.map(recap=>`<section class="hint">
  <h3>Round ${recap.round} recap</h3>
  <p>${recap.points.map((points,team)=>`${esc(S.teams[team])} +${points}`).join(" · ")}</p>
  <p>${recap.mostSkipped?`Most skipped · <strong>${esc(recap.mostSkipped.phrase)}</strong> (${recap.mostSkipped.count})`:"No phrases skipped."}</p>
 </section>`).join("")}</div>`;
}
function cardList(){
 if(!S.submissions.length)return `<div class="empty">No phrases yet. Ask everyone to submit a few from their phones.</div>`;
 return S.submissions.map(c=>`<div class="phrase-row"><div><div class="phrase-title">${esc(c.phrase)}</div><div class="tiny">${esc(c.description||"No description")} · by ${esc(c.submittedBy)}</div></div>${S.status==="lobby"?`<button class="danger" data-remove-card="${esc(c.id)}">Remove</button>`:""}</div>`).join("");
}
function playerList(){
 if(!S.players.length)return `<div class="empty">Waiting for players to join…</div>`;
 return S.players.map(p=>`<div class="player-row"><div><div class="player-name">${esc(p.name)}</div><span class="team-tag ${p.team?"b":""}">${esc(S.teams[p.team])}</span>${p.connected?"":' <span class="tiny">Offline</span>'}</div><div class="row"><select data-team="${esc(p.id)}"><option value="0" ${p.team===0?"selected":""}>${esc(S.teams[0])}</option><option value="1" ${p.team===1?"selected":""}>${esc(S.teams[1])}</option></select><button class="danger" data-remove-player="${esc(p.id)}">×</button></div></div>`).join("");
}
function hostView(){
 const initialJoinUrl=`http://${location.hostname}:3000/join`;
 const activePlayers=S.players.filter(p=>p.team===S.activeTeam);
 const clueOptions=activePlayers.map(p=>`<option value="${esc(p.id)}" ${S.clueGiverId===p.id?"selected":""} ${p.connected?"":"disabled"}>${esc(p.name)}${p.connected?"":" (offline)"}</option>`).join("");
 const current=S.currentCard;
 const isLive=S.status==="playing";
 app.innerHTML=`<div class="shell">${header()}<div class="tabs"><a class="active" href="/">Host dashboard</a><a href="/screen" target="_blank">Big-screen view ↗</a><a href="/join" target="_blank">Player view ↗</a></div>
 <div class="grid two">
 <section class="stack">
  <div class="hero"><div class="row between wrap"><span class="pill">ROOM CODE</span><span class="tiny">${S.status.toUpperCase()}</span></div><div class="code">${S.roomCode}</div><div class="row wrap" style="margin-top:14px"><img class="qr" id="hostQr" src="/api/qr?text=${encodeURIComponent(initialJoinUrl)}" alt="QR code to join"><div><h3>Join on your phone</h3><div class="muted">Scan the QR code, or visit:</div><b id="hostJoinUrl">${esc(initialJoinUrl)}</b><div class="tiny" style="margin-top:8px">Everyone must be on the same Wi-Fi.</div></div></div></div>
  <div class="card"><div class="card-head"><h2>Players & teams</h2><span class="pill">${S.players.length} joined</span></div>${playerList()}</div>
  <div class="card"><div class="card-head"><h2>Phrase deck</h2><span class="pill">${S.submissions.length} phrases</span></div>${cardList()}</div>
 </section>
 <section class="stack">
  <div class="card"><div class="card-head"><h2>Scoreboard</h2><span class="pill">Round ${S.round}/${S.roundCount}</span></div><div class="grid two"><div><div class="stat">${esc(S.teams[0])}</div><div class="score">${S.scores[0]}</div></div><div><div class="stat">${esc(S.teams[1])}</div><div class="score">${S.scores[1]}</div></div></div><p class="muted">${esc(S.lastAction)}</p></div>
  <div class="card"><div class="card-head"><h2>Game controls</h2><span class="pill">${S.remaining} cards in deck</span></div>
   <label>Team names</label><div class="grid two"><input id="team0" value="${esc(S.teams[0])}" maxlength="20"><input id="team1" value="${esc(S.teams[1])}" maxlength="20"></div>
   <div class="grid two"><div><label>Turn length (seconds)</label><input id="turnSeconds" type="number" min="20" max="180" value="${S.turnSeconds}"></div><div><label>Number of rounds</label><input id="roundCount" type="number" min="1" max="5" value="${S.roundCount}"></div></div>
   <div class="actions"><button class="secondary" id="saveSettings">Save settings</button><button id="startGame" ${S.status!=="lobby"?"disabled":""}>Start game</button><button class="danger" id="newRoom">New room</button></div>
   <div class="error" id="startError" role="status">${esc(startError)}</div>
  </div>
  ${isLive?`<div class="card"><div class="card-head"><h2>Round ${S.round}</h2><span class="pill">${esc(S.teams[S.activeTeam])}</span></div>
    <p class="hint">${esc(roundRule(S.round))}</p>
    <label for="clueGiver">Change clue giver</label><select id="clueGiver"><option value="">Choose player…</option>${clueOptions}</select>
    <div class="game-card" style="margin-top:14px"><div><div class="stat">CURRENT PHRASE · HIDDEN FROM TEAM</div><h2>${current?esc(current.phrase):"Deck complete"}</h2><div class="tiny">${current?esc(current.description):""}</div></div></div>
    <div class="row between" style="margin-top:14px"><div><div class="stat">TIME REMAINING</div><div class="timer" id="timer">${timerText()}</div></div><div class="stack"><button class="secondary" id="setClueGiver" ${S.roundEnding?"disabled":""}>Set clue giver</button><button class="danger" id="nextTeam" ${S.roundEnding?"disabled":""}>End ${esc(S.teams[S.activeTeam])}'s turn</button></div></div>
  </div>`:""}
  ${S.status==="finished"?`<div class="card"><h2>Game over!</h2><p class="result">${esc(gameResult())}</p><p class="muted">${esc(S.teams[0])}: ${S.scores[0]} · ${esc(S.teams[1])}: ${S.scores[1]}</p><button id="newRoom2">Create another game</button></div>`:""}
  ${roundRecapView()}
 </section></div><p class="tiny" style="margin-top:20px">Tip: open <b>/screen</b> on a TV or second monitor for the shared display. Keep this dashboard on the host PC.</p></div>`;
 bindHost();
 fetch("/api/network").then(r=>r.json()).then(n=>{const ip=n.addresses&&n.addresses[0];if(ip){const u=`http://${ip}:${n.port}/join`;const link=document.getElementById("hostJoinUrl");const qr=document.getElementById("hostQr");if(link)link.textContent=u;if(qr)qr.src="/api/qr?text="+encodeURIComponent(u);}}).catch(()=>{});
}
function bindHost(){
 document.querySelectorAll("[data-remove-card]").forEach(b=>b.onclick=()=>emit("host:remove-card",{cardId:b.dataset.removeCard}));
 document.querySelectorAll("[data-remove-player]").forEach(b=>b.onclick=()=>emit("host:remove-player",{playerId:b.dataset.removePlayer}));
 document.querySelectorAll("[data-team]").forEach(s=>s.onchange=()=>emit("host:set-team",{playerId:s.dataset.team,team:Number(s.value)}));
 const byId=id=>document.getElementById(id);
 if(byId("saveSettings"))byId("saveSettings").onclick=()=>emit("host:settings",{turnSeconds:Number(byId("turnSeconds").value),roundCount:Number(byId("roundCount").value),teamNames:[byId("team0").value,byId("team1").value]});
 if(byId("startGame"))byId("startGame").onclick=()=>{
  startError="";
  byId("startError").textContent="";
  if(!socket.connected){
   startError="Disconnected from the game server. Wait for the dashboard to reconnect.";
   byId("startError").textContent=startError;
   return;
  }
  socket.timeout(5000).emit("host:start-game", {}, (err, result)=>{
   if(S?.status!=="lobby")return;
   startError=err?"The server did not respond. Try Start game again.":result.ok?"":result.error;
   byId("startError").textContent=startError;
  });
 };
 const {roomCode}=S;
 if(byId("newRoom"))byId("newRoom").onclick=()=>{if(confirm("Start a new room? This clears the current game."))emit("host:new-room",{roomCode})};
 if(byId("newRoom2"))byId("newRoom2").onclick=()=>emit("host:new-room",{roomCode});
 if(byId("setClueGiver"))byId("setClueGiver").onclick=()=>emit("host:set-clue-giver",{playerId:byId("clueGiver").value});
 if(byId("nextTeam")){
  const {turnNumber}=S;
  byId("nextTeam").onclick=()=>emit("host:next-team",{turnNumber,roomCode});
 }
}
function joinView(){
 const code=document.getElementById("joinCode")?.value ?? S.roomCode;
 const name=document.getElementById("playerName")?.value ?? lastPlayerName;
 const finished=S.status==="finished";
 app.innerHTML=`<div class="player-wrap">${header()}<div class="card"><span class="pill">JOIN THE GAME</span><h1 style="margin-top:15px">You're in?</h1><p class="muted">${finished?"This game has ended. You can join when a new room opens.":"Enter the room code shown on the host's screen."}</p><label>Room code</label><input id="joinCode" inputmode="numeric" maxlength="4" placeholder="4821" value="${esc(code)}"><label>Your name</label><input id="playerName" maxlength="22" placeholder="Your nickname" value="${esc(name)}"><button class="big-button" id="joinBtn" style="margin-top:18px" ${socket.connected&&!finished?"":"disabled"}>Join game</button><p id="joinError" class="error" role="status">${socket.connected?"":"Reconnecting to the game…"}</p></div></div>`;
 document.getElementById("joinBtn").onclick=()=>{
  if(!socket.connected)return;
  socket.timeout(5000).emit("player:join",{code:document.getElementById("joinCode").value,name:document.getElementById("playerName").value},(err,r)=>{
   const status=document.getElementById("joinError");
   if(status)status.textContent=err?"The server did not respond. Try joining again.":r.ok?"":r.error;
  });
 };
}
function refreshPhraseHints(){
 const list=document.getElementById("phraseHints");
 const previous=new Set(Array.from(list.children, item=>item.dataset.phrase));
 const pool=PHRASE_HINTS.filter(([phrase])=>!previous.has(phrase));
 const hints=[];
 for(let i=0;i<3;i++){
  hints.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
 }
 list.innerHTML=hints.map(([phrase,description])=>`<li data-phrase="${esc(phrase)}"><button type="button" class="secondary phrase-hint-option"><strong>${esc(phrase)}</strong><span>${esc(description)}</span></button></li>`).join("");
 list.querySelectorAll("button").forEach((button,index)=>{
  button.onclick=()=>{
   const [phrase,description]=hints[index];
   document.getElementById("phrase").value=phrase;
   document.getElementById("description").value=description;
   const status=document.getElementById("submitStatus");
   status.textContent="Hint added. Edit it or submit it.";
   status.className="tiny";
  };
 });
}
function updateLobby(me){
 document.getElementById("playerTeam").textContent=S.teams[me.team];
 document.getElementById("submissionCount").textContent=S.submissions.length;
 document.getElementById("playerConnection").hidden=socket.connected;
 document.getElementById("submitPhrase").disabled=!socket.connected;
}
function undoActionView(disabled){
 return S.undo?`<button class="secondary undo-action" id="undoCard" ${disabled}>Undo ${S.undo.action==="skip"?"skip":"point"}</button>`:"";
}
function playerTurnView(isClue, disabled){
 if(S.roundEnding) {
  return `<p class="turn-callout" role="status">Deck cleared! ${S.round<S.roundCount?"Next round in a moment.":"Final scores in a moment."}</p>
  ${undoActionView(disabled)}`;
 }
 if(!isClue) {
  const clueGiver=S.players.find(player=>player.id===S.clueGiverId);
  return `<p class="muted">It's ${esc(S.teams[S.activeTeam])}'s turn. ${clueGiver?esc(clueGiver.name)+" is giving clues.":"Waiting for a player on that team to connect."}</p>`;
 }
 if(!S.turnEndsAt) {
  return `<div class="turn-callout" role="status"><strong>You’re up!</strong><p>You are the clue giver. You have ${S.turnSeconds} seconds once you start.</p></div>
  <button class="big-button" id="startPlayerTurn" ${disabled}>Start turn</button>`;
 }
 return `<div class="game-card" style="margin:18px 0"><div><div class="stat">GET YOUR TEAM TO GUESS</div><h1>${esc(S.currentCard?.phrase)}</h1></div></div>
 <div class="row between wrap"><span class="tiny">Time remaining</span>${undoActionView(disabled)}<span class="timer" id="timer">${timerText()}</span></div>
 <div class="clue-actions"><button class="big-button score-card" id="gotIt" ${disabled}><span>✓ Got it</span><span class="point-label">+1 point</span></button><button class="skip-card" id="skip" ${disabled}>Skip phrase →</button></div>`;
}
function playerView(){
 const me=S.players.find(p=>p.id===S.playerId);
 if(!me){joinView();return}
 lastPlayerName=me.name;
 const inLobby=S.status==="lobby";
 if(inLobby && document.getElementById("lobbyForm")?.dataset.playerId===me.id){
  updateLobby(me);
  return;
 }
 const isClue= S.clueGiverId===me.id;
 const disabled=socket.connected?"":"disabled";
 app.innerHTML=`<div class="player-wrap">${header()}<div class="card"><div class="row between"><span class="pill" id="playerTeam">${esc(S.teams[me.team])}</span><span class="tiny">${inLobby?`ROOM PIN ${esc(S.roomCode)}`:S.status==="playing"?`ROUND ${S.round}`:S.status.toUpperCase()}</span></div><h2 style="margin-top:18px">Hey, ${esc(me.name)}!</h2>
 <p class="hint" id="playerConnection" role="status" ${socket.connected?"hidden":""}>Reconnecting. Your spot is saved.</p>
 ${S.status==="playing"?`<p class="hint" id="playerRoundRule">${esc(roundRule(S.round))}</p>`:""}
 ${inLobby?`<div id="lobbyForm" data-player-id="${esc(me.id)}">
 <label for="phrase">Phrase</label><input id="phrase" maxlength="90" placeholder="e.g. Shrek">
 <label for="description">Optional description</label><textarea id="description" maxlength="180" placeholder="A little context for the host"></textarea>
 <button class="big-button" id="submitPhrase" style="margin-top:14px" ${disabled}>Submit phrase</button>
 <p class="tiny" id="submitStatus" role="status"></p>
 <p class="muted"><span id="submissionCount">${S.submissions.length}</span> phrases submitted so far.</p>
 <section class="hint phrase-hints" aria-labelledby="phraseHintsTitle">
  <div class="row between wrap"><h3 id="phraseHintsTitle">Phrase hints</h3><button class="secondary" id="refreshHints" type="button">Refresh hints</button></div>
  <ul id="phraseHints" aria-live="polite"></ul>
 </section></div>`:
 S.status==="playing"?playerTurnView(isClue,disabled):
 `<h2>Game over!</h2><p class="result">${esc(gameResult())}</p>
 <div class="row between wrap" aria-label="Final scores">
  <div><div class="stat">${esc(S.teams[0])}</div><div class="score">${S.scores[0]}</div></div>
  <div><div class="stat">${esc(S.teams[1])}</div><div class="score">${S.scores[1]}</div></div>
 </div>
 <p class="muted">Rematch keeps the deck and teams. A new room starts with an empty deck.</p>
 <div class="stack"><button class="big-button" id="rematch" ${disabled}>Rematch</button><button class="secondary" id="playerNewRoom" ${disabled}>Start new room</button><button class="secondary" id="leaveGame" ${disabled}>Leave game</button></div>`}
 ${roundRecapView()}
 </div></div>`;
 if(inLobby){
  refreshPhraseHints();
  document.getElementById("refreshHints").onclick=refreshPhraseHints;
 }
 if(S.status==="finished"){
  const {roomCode}=S;
  const actions=[["rematch","player:rematch"],["playerNewRoom","player:new-room"],["leaveGame","player:leave"]]
   .map(([id,event])=>[document.getElementById(id),event]);
  for(const [button,event] of actions){
   button.onclick=()=>{
    if(!socket.connected)return;
    actions.forEach(([control])=>{control.disabled=true;});
    socket.timeout(5000).emit(event,{roomCode},(err,result)=>{
     if(!err && result.ok)return;
     actions.forEach(([control])=>{control.disabled=!socket.connected;});
     toast(err?"The server did not respond. Try again.":result.error);
    });
   };
  }
 }
 const sub=document.getElementById("submitPhrase");
 if(sub)sub.onclick=()=>{
  if(!socket.connected)return;
  const inputs=["phrase","description"];
  const values=inputs.map(id=>document.getElementById(id).value);
  socket.timeout(5000).emit("player:submit",{phrase:values[0],description:values[1]},(err,r)=>{
   const status=document.getElementById("submitStatus");
   if(!status)return;
   if(err || !r.ok){
    status.textContent=err?"The server did not respond.":r.error;
    status.className="tiny error";
    return;
   }
   status.textContent="Phrase submitted! Add another.";
   status.className="tiny success";
   inputs.forEach((id,index)=>{
    const input=document.getElementById(id);
    if(input.value===values[index])input.value="";
   });
  });
 };
 const {turnNumber,currentCard,cardVersion,roomCode,undo}=S;
 const startTurn=document.getElementById("startPlayerTurn");
 if(startTurn)startTurn.onclick=()=>{
  if(!socket.connected)return;
  startTurn.disabled=true;
  socket.timeout(5000).emit("player:start-turn",{turnNumber,roomCode},(err,r)=>{
   if(!err && r.ok)return;
   startTurn.disabled=!socket.connected;
   toast(err?"The server did not respond.":r.error);
  });
 };
 for(const [id,action] of [["gotIt","got-it"],["skip","skip"]]){
  const button=document.getElementById(id);
  if(button)button.onclick=()=>{
   if(!socket.connected || !currentCard)return;
   socket.timeout(2500).emit("player:card-action",{action,turnNumber,cardId:currentCard.id,cardVersion,roomCode},(err,r)=>{
    if(err || !r.ok)toast(err?"The server did not respond.":r.error);
   });
  };
 }
 clearTimeout(undoTimer);
 const undoButton=document.getElementById("undoCard");
 if(undoButton){
  undoTimer=setTimeout(()=>{undoButton.hidden=true;},undo.remainingMs);
  undoButton.onclick=()=>{
   if(!socket.connected)return;
   undoButton.disabled=true;
   socket.timeout(2500).emit("player:undo",{roomCode,version:undo.version},(err,r)=>{
    if(err || !r.ok)toast(err?"The server did not respond.":r.error);
   });
  };
 }
}
function playScreenTone(frequency,duration){
 if(!screenSound || screenAudio?.state!=="running")return;
 const now=screenAudio.currentTime;
 const oscillator=screenAudio.createOscillator();
 const gain=screenAudio.createGain();
 oscillator.frequency.value=frequency;
 gain.gain.setValueAtTime(0.14,now);
 gain.gain.exponentialRampToValueAtTime(0.001,now+duration);
 oscillator.connect(gain).connect(screenAudio.destination);
 oscillator.start(now);
 oscillator.stop(now+duration);
}
async function toggleScreenSound(){
 if(screenSound){
  screenSound=false;
 }else{
  try{
   const Audio=window.AudioContext || window.webkitAudioContext;
   screenAudio ??= new Audio();
   await screenAudio.resume();
   screenSound=true;
   playScreenTone(660,0.11);
  }catch(_){
   toast("Countdown sound is unavailable in this browser.");
  }
 }
 const button=document.getElementById("screenSound");
 if(button)button.textContent=screenSound?"Mute sound":"Enable sound";
}
function screenView(){
 const live=S.status==="playing";
 fetch("/api/network").then(r=>r.json()).then(n=>{const ip=n.addresses&&n.addresses[0];if(ip){const u=`http://${ip}:${n.port}/join`;const qr=document.getElementById("screenQr");const link=document.getElementById("screenJoinUrl");if(qr)qr.src="/api/qr?text="+encodeURIComponent(u);if(link)link.textContent="Visit "+u;}}).catch(()=>{});
 app.innerHTML=`<div class="bigscreen">${header()}<button class="secondary screen-sound" id="screenSound">${screenSound?"Mute sound":"Enable sound"}</button><div class="hero"><div class="stat">JOIN THE GAME · SCAN TO PLAY</div><div class="code">${S.roomCode}</div><div class="row" style="justify-content:center;margin-top:12px"><img class="qr" id="screenQr" src="/api/qr?text=${encodeURIComponent(`http://${location.hostname}:3000/join`)}" alt="Join QR code"></div><div class="tiny" id="screenJoinUrl" style="margin-top:10px">Visit http://${esc(location.hostname)}:3000/join</div></div>
 <div class="grid two" style="margin-top:20px"><div class="card"><div class="stat">${esc(S.teams[0])}</div><div class="score">${S.scores[0]}</div><div class="tiny">${S.players.filter(p=>p.team===0).map(p=>esc(p.name)).join(" · ")||"No players yet"}</div></div><div class="card"><div class="stat">${esc(S.teams[1])}</div><div class="score">${S.scores[1]}</div><div class="tiny">${S.players.filter(p=>p.team===1).map(p=>esc(p.name)).join(" · ")||"No players yet"}</div></div></div>
 <div class="card" style="margin-top:20px;text-align:center"><div class="row between"><span class="pill">ROUND ${S.round}${live?" · "+esc(S.teams[S.activeTeam]):""}</span><span class="pill">${S.players.length} PLAYERS</span></div><h1 style="margin:22px 0">${S.status==="lobby"?"Waiting for players":S.status==="finished"?"GAME OVER":esc(S.lastAction)}</h1>${S.status==="finished"?`<p class="result">${esc(gameResult())}</p>`:""}<div class="timer" id="timer">${S.turnEndsAt&&!S.roundEnding?timerText():""}</div><p class="muted">${live?`${S.remaining} phrases left in the deck · ${esc(roundRule(S.round))}`:""}</p></div>${roundRecapView()}</div>`;
 document.getElementById("screenSound").onclick=toggleScreenSound;
}
function render(){
 if(!S){app.innerHTML='<div class="loading">Connecting to the game server…</div>';return}
 if(pathName==="/screen")screenView();
 else if(pathName==="/join")playerView();
 else hostView();
}
