const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 3000);
const UNDO_MS = 4000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "game.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Serve the single-page app at the player and projector URLs as well as "/".
const indexFile = path.join(__dirname, "public", "index.html");
app.get(["/join", "/screen"], (_req, res) => {
  res.sendFile(indexFile);
});

function makeCode(exclude) {
  const previous = Number(exclude);
  if (previous >= 1000 && previous <= 9999) {
    const code = 1000 + Math.floor(Math.random() * 8999);
    return String(code >= previous ? code + 1 : code);
  }
  return String(1000 + Math.floor(Math.random() * 9000));
}
const freshState = previousCode => ({
  roomCode: makeCode(previousCode), status: "lobby", players: [], submissions: [],
  teams: ["Team A", "Team B"], scores: [0, 0], round: 1,
  roundCount: 3, turnSeconds: 60, activeTeam: 0, turnNumber: 1, clueGiverId: null,
  deck: [], currentCardId: null, turnEndsAt: null, cardVersion: 0, roundRecaps: [],
  lastAction: "Create a room and invite players."
});
let state = freshState();
let hostSocketId = null;
let timerHandle = null;
let roundEndHandle = null;
let lastCardAction = null;
let roundStartScores = [0, 0];
const roundSkips = new Map();
let clueOrder = [[], []];

try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (saved && saved.roomCode) state = { ...freshState(), ...saved, players: [], status: "lobby", turnEndsAt: null, roundRecaps: [] };
} catch (_) {}

function save() {
  const persisted = { ...state, players: state.players.map(({ id, name, team }) => ({ id, name, team })), turnEndsAt: null };
  fs.writeFileSync(DATA_FILE, JSON.stringify(persisted, null, 2));
}
function publicState(socket) {
  const player = currentPlayer(socket);
  const canUndo = lastCardAction && player && lastCardAction.playerId === player.id && player.id === state.clueGiverId;
  const undoMs = canUndo
    ? Math.max(0, Math.min(lastCardAction.expiresAt, roundEndHandle ? Infinity : state.turnEndsAt) - Date.now())
    : 0;
  return {
    ...state,
    players: state.players.map(({ id, name, team, socketIds }) => ({ id, name, team, connected: socketIds.size > 0 })),
    playerId: player?.id ?? null,
    submissions: state.submissions.map(s => ({ ...s })),
    currentCard: (isHost(socket) || (state.turnEndsAt && player?.id === state.clueGiverId)) ? (state.submissions.find(s => s.id === state.currentCardId) || null) : null,
    roundEnding: Boolean(roundEndHandle),
    undo: undoMs ? { version: lastCardAction.version, action: lastCardAction.action, remainingMs: undoMs } : null,
    remaining: state.deck.length
  };
}
function broadcastState() {
  for (const client of io.sockets.sockets.values()) client.emit("state", publicState(client));
}
function emitState() {
  broadcastState();
  save();
}
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function currentPlayer(socket) {
  return state.players.find(p => p.id === socket.data.playerId);
}
function attachPlayer(socket, player) {
  socket.data.playerId = player.id;
  player.socketIds.add(socket.id);
  if (state.status === "playing" && !state.clueGiverId && player.team === state.activeTeam) assignClueGiver();
}
function removePlayer(playerId) {
  state.players = state.players.filter(p => p.id !== playerId);
  if (state.status === "playing" && state.clueGiverId === playerId) assignClueGiver();
  emitState();
}
function openNewRoom({ initiator, rematch = false } = {}) {
  const { roomCode, roundCount, turnSeconds, teams, players, submissions } = state;
  stopTurnTimers();
  lastCardAction = null;
  state = freshState(roomCode);
  if (initiator || rematch) {
    state.roundCount = roundCount;
    state.turnSeconds = turnSeconds;
    state.teams = teams;
  }
  if (rematch) {
    state.players = players;
    state.submissions = submissions;
    const error = startGameError();
    if (error) state.lastAction = `Rematch ready. ${error}`;
    else beginGame();
  } else if (initiator) {
    state.players.push(initiator);
    state.lastAction = "New room is open. Invite players and submit phrases.";
  }
  emitState();
}
function finishedRoomPlayer(socket, roomCode, ack) {
  const player = currentPlayer(socket);
  if (state.status === "finished" && state.roomCode === roomCode && player) return player;
  ack({ ok: false, error: "This game is no longer open for that action." });
  return null;
}
function isHost(socket) { return socket.id === hostSocketId; }
function isLocalSocket(socket) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.handshake.address);
}
function nextCard() {
  if (state.deck.length) state.currentCardId = state.deck[0];
  else state.currentCardId = null;
}
function assignClueGiver(prefix = "", preferredPlayerId) {
  const team = state.activeTeam;
  const roster = state.players.filter(p => p.team === team);
  const order = clueOrder[team].filter(id => roster.some(p => p.id === id));
  const newPlayers = roster.filter(p => !order.includes(p.id));
  order.push(...shuffle(newPlayers.map(p => p.id)));
  clueOrder[team] = order;
  const index = preferredPlayerId
    ? order.indexOf(preferredPlayerId)
    : order.findIndex(id => roster.some(p => p.id === id && p.socketIds.size > 0));
  const [id] = index < 0 ? [] : order.splice(index, 1);
  state.clueGiverId = id ?? null;
  if (id) order.push(id);
  const player = roster.find(p => p.id === id);
  const message = player
    ? `${player.name} is ${state.teams[team]}'s clue giver.`
    : `Waiting for a player on ${state.teams[team]} to connect.`;
  state.lastAction = prefix + message;
}
function prepareRound(startingTeam = 0, prefix = "") {
  state.activeTeam = startingTeam;
  roundStartScores = [...state.scores];
  roundSkips.clear();
  clueOrder = [[], []];
  state.deck = shuffle(state.submissions.map(s => s.id));
  nextCard();
  assignClueGiver(`${prefix}Round ${state.round}. `);
}
function recordRound() {
  let mostSkipped = null;
  for (const [id, count] of roundSkips) {
    if (count > (mostSkipped?.count ?? 0)) {
      mostSkipped = { phrase: state.submissions.find(card => card.id === id).phrase, count };
    }
  }
  state.roundRecaps.push({
    round: state.round,
    points: state.scores.map((score, team) => score - roundStartScores[team]),
    mostSkipped
  });
}
function advanceCard(guessed) {
  if (!state.deck.length) return;
  const cardId = state.deck.shift();
  if (!guessed) state.deck.push(cardId);
  nextCard();
}
function stopTurnTimers() {
  clearInterval(timerHandle);
  timerHandle = null;
  clearTimeout(roundEndHandle);
  roundEndHandle = null;
}
function endTurn(reason) {
  stopTurnTimers();
  lastCardAction = null;
  state.turnEndsAt = null;
  state.clueGiverId = null;
  if (state.deck.length) {
    state.activeTeam = 1 - state.activeTeam;
    state.turnNumber += 1;
    assignClueGiver(`${reason} `);
    return;
  }
  recordRound();
  if (state.round < state.roundCount) {
    state.round += 1;
    state.turnNumber += 1;
    const startingTeam = state.scores[0] <= state.scores[1] ? 0 : 1;
    prepareRound(startingTeam, `${reason} `);
  } else {
    state.status = "finished";
    state.lastAction = `${reason} Game over!`;
  }
}
function runTurnClock() {
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (Date.now() >= state.turnEndsAt) {
      io.emit("tick", 0);
      endTurn("Time's up!");
      emitState();
    } else io.emit("tick", Math.ceil((state.turnEndsAt - Date.now()) / 1000));
  }, 250);
}
function startGameError() {
  if (state.submissions.length < 2) return "Add at least two phrases before starting.";
  const connected = state.players.filter(player => player.socketIds.size > 0);
  if (connected.length < 2) return "At least two players must be connected from different devices or browser profiles.";
  if (![0, 1].every(team => connected.some(player => player.team === team))) {
    return "Assign at least one connected player to each team before starting.";
  }
}
function beginGame() {
  state.status = "playing";
  state.round = 1;
  state.turnNumber = 1;
  state.scores = [0, 0];
  prepareRound();
}
function requireHost(socket, ack) {
  if (!isHost(socket)) { if (ack) ack({ ok: false, error: "Host permission required." }); return false; }
  return true;
}

app.get("/api/qr", async (req, res) => {
  const target = String(req.query.text || "");
  if (!target || target.length > 500) return res.status(400).send("Invalid QR text");
  try {
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, width: 240, color: { dark: "#111827", light: "#ffffff" } });
    res.type("image/svg+xml").send(svg);
  } catch (_) { res.status(500).send("Could not create QR code"); }
});
function localAddresses() {
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch (_) {
    // Some Android environments restrict interface enumeration.
    return [];
  }
  const addresses = [];
  for (const list of Object.values(interfaces)) {
    for (const item of list || []) if (item.family === "IPv4" && !item.internal) addresses.push(item.address);
  }
  return addresses;
}
app.get("/api/network", (_req, res) => {
  res.json({ addresses: localAddresses(), port: PORT });
});

io.on("connection", socket => {
  const { playerToken } = socket.handshake.auth;
  const validToken = typeof playerToken === "string" && /^[0-9a-f]{64}$/.test(playerToken);
  const returningPlayer = validToken && state.players.find(p => p.token === playerToken);
  const wasOffline = returningPlayer && returningPlayer.socketIds.size === 0;
  if (returningPlayer) attachPlayer(socket, returningPlayer);
  if (wasOffline) broadcastState();
  else socket.emit("state", publicState(socket));

  socket.on("host:claim", () => {
    if (!hostSocketId || hostSocketId === socket.id) {
      hostSocketId = socket.id;
      socket.emit("host:claimed", { ok: true });
      socket.emit("state", publicState(socket));
    } else socket.emit("host:claimed", { ok: false, error: "Another browser currently controls the host dashboard." });
  });

  socket.on("host:new-room", ({ roomCode } = {}) => {
    if (!requireHost(socket) || roomCode !== state.roomCode) return;
    openNewRoom();
  });

  socket.on("player:join", ({ code, name } = {}, ack = () => {}) => {
    const cleanName = String(name || "").trim().slice(0, 22);
    if (String(code || "") !== state.roomCode) return ack({ ok: false, error: "That room code isn't correct." });
    if (!validToken) return ack({ ok: false, error: "Refresh this page before joining." });
    const existing = state.players.find(p => p.token === playerToken);
    if (existing) {
      attachPlayer(socket, existing);
      ack({ ok: true, playerId: existing.id });
      broadcastState();
      return;
    }
    if (!cleanName) return ack({ ok: false, error: "Enter a player name." });
    if (state.status === "finished") return ack({ ok: false, error: "This game has finished. Join when a new room opens." });
    const duplicate = state.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) return ack({ ok: false, error: "That name is already in use." });
    const teamA = state.players.filter(p => p.team === 0).length;
    const player = { id: randomUUID(), name: cleanName, team: teamA <= state.players.length - teamA ? 0 : 1, token: playerToken, socketIds: new Set() };
    state.players.push(player);
    attachPlayer(socket, player);
    ack({ ok: true, playerId: player.id });
    emitState();
  });

  socket.on("player:sync", (_data, ack = () => {}) => {
    socket.emit("state", publicState(socket));
    ack();
  });

  socket.on("player:new-room", ({ roomCode } = {}, ack = () => {}) => {
    const player = finishedRoomPlayer(socket, roomCode, ack);
    if (!player) return;
    openNewRoom({ initiator: player });
    ack({ ok: true });
  });

  socket.on("player:rematch", ({ roomCode } = {}, ack = () => {}) => {
    if (!finishedRoomPlayer(socket, roomCode, ack)) return;
    openNewRoom({ rematch: true });
    ack({ ok: true });
  });

  socket.on("player:leave", ({ roomCode } = {}, ack = () => {}) => {
    const player = finishedRoomPlayer(socket, roomCode, ack);
    if (!player) return;
    removePlayer(player.id);
    ack({ ok: true });
  });

  socket.on("player:submit", ({ phrase, description } = {}, ack = () => {}) => {
    const player = currentPlayer(socket);
    if (!player) return ack({ ok: false, error: "Join the room first." });
    if (state.status !== "lobby") return ack({ ok: false, error: "Submissions are closed." });
    const cleanPhrase = String(phrase || "").trim().slice(0, 90);
    const cleanDescription = String(description || "").trim().slice(0, 180);
    if (!cleanPhrase) return ack({ ok: false, error: "Enter a phrase." });
    if (state.submissions.some(s => s.phrase.toLowerCase() === cleanPhrase.toLowerCase()))
      return ack({ ok: false, error: "That phrase has already been submitted." });
    state.submissions.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, phrase: cleanPhrase, description: cleanDescription, submittedBy: player.name, approved: true });
    ack({ ok: true });
    emitState();
  });

  socket.on("host:remove-player", ({ playerId }) => {
    if (!requireHost(socket)) return;
    removePlayer(playerId);
  });
  socket.on("host:remove-card", ({ cardId }) => {
    if (!requireHost(socket) || state.status !== "lobby") return;
    state.submissions = state.submissions.filter(c => c.id !== cardId);
    state.deck = state.deck.filter(id => id !== cardId);
    if (state.currentCardId === cardId) nextCard();
    emitState();
  });
  socket.on("host:set-team", ({ playerId, team }) => {
    if (!requireHost(socket)) return;
    const p = state.players.find(x => x.id === playerId);
    if (!p || ![0, 1].includes(Number(team))) return;
    p.team = Number(team);
    if (state.status === "playing" && (
      (p.id === state.clueGiverId && p.team !== state.activeTeam) ||
      (!state.clueGiverId && p.team === state.activeTeam)
    )) assignClueGiver();
    emitState();
  });
  socket.on("host:settings", ({ turnSeconds, roundCount, teamNames }) => {
    if (!requireHost(socket)) return;
    if (Number.isFinite(Number(turnSeconds))) state.turnSeconds = Math.max(20, Math.min(180, Number(turnSeconds)));
    if (Number.isFinite(Number(roundCount))) state.roundCount = Math.max(1, Math.min(5, Number(roundCount)));
    if (Array.isArray(teamNames)) state.teams = teamNames.slice(0, 2).map((n, i) => String(n || `Team ${i + 1}`).slice(0, 20));
    emitState();
  });
  socket.on("host:start-game", (_data, ack = () => {}) => {
    // A deliberate Start Game click on the host PC can recover control from an old tab.
    if (!isHost(socket)) {
      if (!isLocalSocket(socket)) {
        return ack({ ok: false, error: "Open http://localhost:" + PORT + " on the host PC to start the game." });
      }
      if (state.status === "lobby") hostSocketId = socket.id;
    }
    if (state.status !== "lobby") return ack({ ok: false, error: "This game has already started." });
    const error = startGameError();
    if (error) return ack({ ok: false, error });
    beginGame();
    emitState();
    ack({ ok: true });
  });
  socket.on("host:set-clue-giver", ({ playerId }) => {
    if (!requireHost(socket) || state.status !== "playing" || roundEndHandle) return;
    const p = state.players.find(x => x.id === playerId && x.team === state.activeTeam && x.socketIds.size > 0);
    if (!p) return socket.emit("notice", "Choose a connected player from the active team.");
    if (state.clueGiverId === p.id) return;
    assignClueGiver("", p.id);
    emitState();
  });
  socket.on("player:start-turn", ({ turnNumber, roomCode } = {}, ack = () => {}) => {
    const player = currentPlayer(socket);
    if (!player || player.id !== state.clueGiverId || state.status !== "playing" || turnNumber !== state.turnNumber ||
      (roomCode !== undefined && roomCode !== state.roomCode)) {
      return ack({ ok: false, error: "Only the selected clue giver can start this turn." });
    }
    if (state.turnEndsAt) return ack({ ok: false, error: "The timer is already running." });
    state.lastAction = `${state.teams[state.activeTeam]} is playing.`;
    state.turnEndsAt = Date.now() + state.turnSeconds * 1000;
    runTurnClock();
    emitState();
    ack({ ok: true });
  });
  socket.on("host:next-team", ({ turnNumber, roomCode } = {}) => {
    if (!requireHost(socket)) return;
    if (state.status !== "playing" || turnNumber !== state.turnNumber || roundEndHandle ||
      (roomCode !== undefined && roomCode !== state.roomCode)) return;
    endTurn("Turn ended.");
    emitState();
  });
  socket.on("player:card-action", ({ action, turnNumber, cardId, cardVersion, roomCode } = {}, ack = () => {}) => {
    const player = currentPlayer(socket);
    if (!player || player.id !== state.clueGiverId || !state.turnEndsAt || Date.now() >= state.turnEndsAt)
      return ack({ ok: false, error: "Only the active clue giver can use these buttons." });
    if (roundEndHandle || !state.currentCardId || turnNumber !== state.turnNumber || cardId !== state.currentCardId ||
      (cardVersion !== undefined && cardVersion !== state.cardVersion) || (roomCode !== undefined && roomCode !== state.roomCode))
      return ack({ ok: false, error: "The card has changed. Use the card now on screen." });
    if (action !== "got-it" && action !== "skip") return ack({ ok: false, error: "Unknown action." });
    state.cardVersion += 1;
    lastCardAction = { playerId: player.id, cardId, action, version: state.cardVersion, expiresAt: Date.now() + UNDO_MS };
    if (action === "got-it") {
      state.scores[state.activeTeam] += 1;
      const scoringTeam = state.teams[state.activeTeam];
      advanceCard(true);
      if (state.currentCardId) state.lastAction = `${scoringTeam} scored a point!`;
      else {
        clearInterval(timerHandle);
        timerHandle = null;
        state.lastAction = `${scoringTeam} cleared the deck!`;
        roundEndHandle = setTimeout(() => {
          endTurn(`${scoringTeam} cleared the deck!`);
          emitState();
        }, UNDO_MS);
      }
    } else {
      roundSkips.set(cardId, (roundSkips.get(cardId) ?? 0) + 1);
      advanceCard(false);
      state.lastAction = "Phrase skipped.";
    }
    ack({ ok: true });
    emitState();
  });
  socket.on("player:undo", ({ roomCode, version } = {}, ack = () => {}) => {
    const player = currentPlayer(socket);
    const last = lastCardAction;
    const now = Date.now();
    if (!player || player.id !== state.clueGiverId || last?.playerId !== player.id ||
      roomCode !== state.roomCode || version !== last.version || now >= last.expiresAt ||
      (!roundEndHandle && now >= state.turnEndsAt)) {
      return ack({ ok: false, error: "That tap can’t be undone anymore." });
    }
    if (last.action === "got-it") {
      state.scores[state.activeTeam] -= 1;
    } else {
      state.deck.pop();
      roundSkips.set(last.cardId, roundSkips.get(last.cardId) - 1);
    }
    state.deck.unshift(last.cardId);
    nextCard();
    lastCardAction = null;
    state.cardVersion += 1;
    state.lastAction = "Last tap undone.";
    if (roundEndHandle) {
      clearTimeout(roundEndHandle);
      roundEndHandle = null;
      if (now >= state.turnEndsAt) endTurn("Time's up!");
      else runTurnClock();
    }
    emitState();
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    if (hostSocketId === socket.id) hostSocketId = null;
    const player = currentPlayer(socket);
    if (player && player.socketIds.delete(socket.id) && player.socketIds.size === 0) broadcastState();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Monikers is running on http://localhost:${PORT}`);
  const ips = localAddresses();
  if (ips.length) console.log("On your Wi-Fi, players can join at:");
  else console.log("For Wi-Fi access, use the host device's Wi-Fi IP address and port " + PORT + ".");
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
});
