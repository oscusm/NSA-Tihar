// server.js
// ---------------------------------------------------------------
// The "brain" of the quiz. It keeps the whole game in memory and is the
// ONLY place that decides who buzzed first. Phones and the big screen just
// send requests ("I buzzed!", "host picked Food") and draw whatever state
// the server sends back.
//
// NOTE: Everything lives in memory: if the server restarts (or Render puts it
// to sleep), scores and players are reset.
//
// How a game flows:
//   lobby ──Start──▶ board ──host picks a category/question──▶ intro (3 s "get ready")
//     ▲                ▲                                          │
//     │                └────────── Back to board ◀── reveal ◀── open ⇄ buzzed
//   Reset                                                         (closed = time up)
//   … and at any point the host can End the game → end (winner screen)
// ---------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const sample = require('./sample-data');
const sheets = require('./sheets');

// ----- Settings (can be changed with environment variables) -----
const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1234';       // CHANGE THIS on Render!
const POINTS_WRONG = Number(process.env.POINTS_WRONG ?? -5);      // "Wrong" button
// After a wrong answer the game MOVES ON (answer is shown, host picks the next question).
// Set WRONG_REOPENS=true to instead give the other teams a chance to buzz for REOPEN_SECONDS.
const WRONG_REOPENS = /^(1|true|yes)$/i.test(process.env.WRONG_REOPENS || '');
const REOPEN_SECONDS = Number(process.env.REOPEN_SECONDS ?? 10);
const INTRO_SECONDS = Number(process.env.INTRO_SECONDS ?? 3);
const MUSIC_PERCENT = Number(process.env.MUSIC_PERCENT ?? 20);   // starting background-music level on the big screen (0-100)     // "get ready" time before buzzers open
const EVENT_TITLE = process.env.EVENT_TITLE || 'Katti Garo';
const EVENT_SUBTITLE = process.env.EVENT_SUBTITLE || 'Nepalese Student Association · Southern Miss';
// Optional: the public address players should open, e.g. https://my-quiz.onrender.com
// If empty, the server works it out from the address the big screen is using.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Google Sheet CSV links. The host can also change these from the remote page.
const sheetUrls = {
  questions: process.env.QUESTIONS_CSV_URL || '',
  groups: process.env.GROUPS_CSV_URL || '',
};

// Colors given to categories, in order (gold first — Southern Miss!)
const CATEGORY_COLORS = ['#FFAB00', '#DC143C', '#2F6FDB', '#1FA463', '#8E44AD', '#E8590C', '#0FA3B1', '#C2185B'];

// ----- Web server -----
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 }); // allow CSV uploads up to 2 MB

// Render (and most hosts) sit behind a proxy; this makes req.protocol say "https".
app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public')));
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/', (req, res) => res.redirect('/play'));
app.get('/play', page('play.html'));
app.get('/screen', page('screen.html'));
app.get('/remote', page('remote.html'));

// ----- Join link, QR code and branding -----
// Finds this computer's Wi-Fi address (e.g. 192.168.1.20). Used when you open
// the big screen as "localhost" — phones can't reach "localhost".
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
function joinUrl(req) {
  if (PUBLIC_URL) return `${PUBLIC_URL}/play`;
  const host = req.get('host').replace(/^(localhost|127\.0\.0\.1)/, lanAddress());
  return `${req.protocol}://${host}/play`;
}
// Your logo: drop a file called logo.png (or .svg / .jpg / .webp) into public/img/
function findLogo() {
  for (const ext of ['svg', 'png', 'webp', 'jpg', 'jpeg']) {
    if (fs.existsSync(path.join(__dirname, 'public', 'img', `logo.${ext}`))) return `/img/logo.${ext}`;
  }
  return null;
}
app.get('/api/config', (req, res) => res.json({
  joinUrl: joinUrl(req), title: EVENT_TITLE, subtitle: EVENT_SUBTITLE, logo: findLogo(),
}));
app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(joinUrl(req), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0b0b', light: '#ffffff' },
  });
  res.type('image/svg+xml').send(svg);
});

// ----- Game state -----
const game = {
  phase: 'lobby',      // lobby | board | intro | open | buzzed | closed | reveal | end
  groups: [],          // [{ id, name, emoji, color, sound, score }]
  questions: [],       // [{ id, category, question, answer, points, image, timer, used }]
  currentId: null,     // id of the question on screen
  roundId: 0,          // goes up EVERY time buzzers open, so late/old buzzes are ignored
  players: new Map(),  // playerId -> { id, name, groupId, socketId, connected }
  buzz: null,          // { playerId, name, groupId } of the current buzz winner
  locked: new Set(),   // groupIds locked out for the current question
  endsAt: 0,           // when the current countdown ends (server clock, ms). 0 = no countdown
  timerTotal: 0,       // length of the current countdown (ms), for the countdown ring
  lastAward: null,     // { groupId, points, name } after a correct answer (shown on reveal)
  lastWrong: null,     // { groupId, points, name } after a wrong answer (shown on reveal)
  musicPercent: MUSIC_PERCENT, // background-music level set by the host's slider (0-100)
};
let timer = null;      // the setTimeout handle for intro / buzz countdown

// Where the current questions/groups came from (shown on the remote)
const source = { questions: 'sample questions', groups: 'sample groups' };

// Turn a name into a stable id: "Black Crow" -> "black-crow"
const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const findGroup = (id) => game.groups.find((g) => g.id === id);
const findQuestion = (id) => game.questions.find((q) => q.id === id);
const currentQuestion = () => findQuestion(game.currentId);
const QUESTION_PHASES = ['intro', 'open', 'buzzed', 'closed', 'reveal'];

// Category names in the order they first appear in the sheet
function categoryNames() {
  return [...new Set(game.questions.map((q) => q.category))];
}

// ----- Loading data -----

// Replace the groups. Scores of groups that still exist are kept, so
// reloading mid-game is safe. Players whose group disappeared must re-pick.
function setGroups(groups) {
  const oldScores = new Map(game.groups.map((g) => [g.id, g.score]));
  game.groups = groups.map((g) => {
    const id = slug(g.name) || 'group';
    return { id, name: g.name, emoji: g.emoji || '', color: g.color || '#FFAB00',
             sound: g.sound || '', score: oldScores.get(id) || 0 };
  });
  for (const p of game.players.values()) {
    if (!findGroup(p.groupId)) {
      game.players.delete(p.id);
      if (p.socketId) io.to(p.socketId).emit('kicked');
    }
  }
  if (game.buzz && !findGroup(game.buzz.groupId)) game.buzz = null;
}

// Replace the questions. Questions that were already played stay "used"
// (matched by category + text), so you can fix a typo mid-game.
function setQuestions(items) {
  const key = (q) => `${q.category}|${q.question}`.toLowerCase();
  const usedBefore = new Set(game.questions.filter((q) => q.used).map(key));
  const current = currentQuestion();
  const currentKey = current && key(current);

  game.questions = items.map((q, i) => ({
    id: `q${i + 1}`,
    category: 'General', // categories were removed: the host announces them out loud
    difficulty: '',
    question: q.question,
    answer: q.answer || '',
    points: Number.isFinite(Number(q.points)) ? Number(q.points) : sheets.DEFAULT_POINTS,
    image: q.image || '',
    timer: Number.isFinite(Number(q.timer)) ? Number(q.timer) : sheets.DEFAULT_TIMER,
    used: usedBefore.has(key(q)),
  }));

  // Keep showing the same question if it still exists, otherwise go back to the board
  const same = currentKey && game.questions.find((q) => key(q) === currentKey);
  game.currentId = same ? same.id : null;
  if (!same && QUESTION_PHASES.includes(game.phase)) {
    stopTimer();
    Object.assign(game, { phase: 'board', buzz: null, lastAward: null, lastWrong: null });
    game.locked.clear();
  }
}

// Start with the built-in sample data. If sheet links are set, they are loaded at startup.
setGroups(sample.groups);
setQuestions(sample.questions);

// Parse CSV text and use it. Returns a list of messages (summary + warnings).
function applyCsv(kind, text, from) {
  const parsed = kind === 'groups' ? sheets.parseGroups(text) : sheets.parseQuestions(text);
  const minimum = kind === 'groups' ? 2 : 1;
  if (parsed.items.length < minimum) {
    throw new Error(parsed.warnings.join(' ') || `No ${kind} found`);
  }
  if (kind === 'groups') setGroups(parsed.items); else setQuestions(parsed.items);
  let summary = `${parsed.items.length} ${kind}`;
  if (kind === 'questions') summary += ` in ${categoryNames().length} categories`;
  source[kind] = `${from} (${summary})`;
  return [`OK: loaded ${summary} from ${from}`, ...parsed.warnings.map((w) => `Warning: ${w}`)];
}

// Download both tabs from Google Sheets (only the ones that have a link).
async function loadFromSheets() {
  const messages = [];
  let ok = true;
  for (const kind of ['groups', 'questions']) {
    if (!sheetUrls[kind]) { messages.push(`No ${kind} sheet link set (using ${source[kind]}).`); continue; }
    try {
      const text = await sheets.fetchCsv(sheetUrls[kind]);
      messages.push(...applyCsv(kind, text, 'Google Sheet'));
    } catch (err) {
      ok = false;
      messages.push(`Error (${kind}): ${err.message}`);
    }
  }
  return { ok, messages };
}

// ----- What each page is allowed to see -----
// The answer is ONLY included once the phase is 'reveal'. The host gets
// answers separately through the private 'host' room (see sendState).
function publicState() {
  const q = currentQuestion();
  const showQuestion = q && QUESTION_PHASES.includes(game.phase);
  const cats = categoryNames();
  const now = Date.now();
  return {
    phase: game.phase,
    roundId: game.roundId,
    used: game.questions.filter((x) => x.used).length,
    total: game.questions.length,
    question: showQuestion ? {
      id: q.id,
      category: q.category,
      difficulty: q.difficulty,
      categoryColor: CATEGORY_COLORS[cats.indexOf(q.category) % CATEGORY_COLORS.length],
      points: q.points,
      text: q.question,
      image: q.image,
      answer: game.phase === 'reveal' ? q.answer : null,
    } : null,
    // Times are sent as "ms left" (not clock times) because phone clocks
    // are often a few seconds off from the server.
    timeLeftMs: game.phase === 'open' && game.endsAt ? Math.max(0, game.endsAt - now) : null,
    introLeftMs: game.phase === 'intro' && game.endsAt ? Math.max(0, game.endsAt - now) : null,
    timerTotalMs: game.timerTotal,
    buzz: game.buzz,
    locked: [...game.locked],
    lastAward: game.lastAward,
    lastWrong: game.lastWrong,
    musicPercent: game.musicPercent,
    // No categories in the game: screens show "Question 4 of 30" instead of a category board.
    noCategories: true,
    // The board: only points + used/not used. Never the question text!
    categories: cats.map((name, i) => ({
      name,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      questions: game.questions.filter((x) => x.category === name)
        .map((x) => ({ id: x.id, points: x.points, difficulty: x.difficulty, used: x.used })),
    })),
    groups: game.groups.map((g) => ({
      ...g,
      players: [...game.players.values()]
        .filter((p) => p.groupId === g.id)
        .map((p) => ({ name: p.name, connected: p.connected })),
    })),
  };
}

// Send the latest state to everybody. With <50 players this is cheap.
function sendState() {
  io.emit('state', publicState());
  const q = currentQuestion();
  io.to('host').emit('hostSecret', {
    question: q ? q.question : null,
    answer: q ? q.answer : null,
    // full list (with answers) so the host can pick a specific question
    questions: game.questions.map(({ id, category, difficulty, question, answer, points, used }) => ({ id, category, difficulty, question, answer, points, used })),
    source,
    sheetUrls,
    settings: { POINTS_WRONG, WRONG_REOPENS, REOPEN_SECONDS, INTRO_SECONDS },
  });
}

// ----- Timers -----
function stopTimer() { clearTimeout(timer); timer = null; game.endsAt = 0; }

// seconds = 0 means "no time limit" (buzzers stay open until someone buzzes).
function openBuzzers(seconds) {
  stopTimer();
  game.phase = 'open';
  game.buzz = null;
  game.roundId += 1;
  game.timerTotal = seconds > 0 ? seconds * 1000 : 0;
  game.endsAt = seconds > 0 ? Date.now() + seconds * 1000 : 0;
  if (seconds > 0) {
    timer = setTimeout(() => {
      if (game.phase === 'open') { // nobody buzzed in time
        game.phase = 'closed';
        game.endsAt = 0;
        sendState();
      }
    }, seconds * 1000);
  }
}

// Put a question on screen: short "get ready" intro, then buzzers open.
function startQuestion(q) {
  stopTimer();
  q.used = true;
  game.currentId = q.id;
  game.locked.clear();
  game.buzz = null;
  game.lastAward = null;
  game.lastWrong = null;
  if (INTRO_SECONDS > 0) {
    game.phase = 'intro';
    game.timerTotal = INTRO_SECONDS * 1000;
    game.endsAt = Date.now() + INTRO_SECONDS * 1000;
    timer = setTimeout(() => { openBuzzers(q.timer); sendState(); }, INTRO_SECONDS * 1000);
  } else {
    openBuzzers(q.timer);
  }
}

// Groups that still could buzz: has at least one player and isn't locked out.
function groupsStillInPlay() {
  const withPlayers = new Set([...game.players.values()].map((p) => p.groupId));
  return game.groups.filter((g) => withPlayers.has(g.id) && !game.locked.has(g.id));
}

// ----- Socket.IO: real-time messages -----
io.on('connection', (socket) => {
  // Anyone who connects gets the current state right away
  // (this is what makes "join mid-game" and "refresh the page" work).
  socket.emit('state', publicState());

  // ===== PLAYER =====
  socket.on('player:join', (data = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    const id = String(data.playerId || '').slice(0, 64);
    const name = String(data.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!id) return ack({ ok: false, error: 'Something went wrong, reload the page.' });

    let player = game.players.get(id);

    if (!player) {
      // New player
      if (!name) return ack({ ok: false, error: 'Please type your name.' });
      const group = findGroup(data.groupId);
      if (!group) return ack({ ok: false, error: 'Please pick a group.' });

      const sameName = [...game.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (sameName) {
        // If that name belongs to a DISCONNECTED player in the SAME group, it's
        // probably the same person on a new phone/browser -> let them take it over.
        if (!sameName.connected && sameName.groupId === group.id) {
          game.players.delete(sameName.id);
        } else {
          return ack({ ok: false, error: `"${name}" is already taken. Please use a different name.` });
        }
      }
      player = { id, name, groupId: group.id, socketId: null, connected: true };
      game.players.set(id, player);
    }
    // Existing player reconnecting: keep their original name + group (no switching!)

    player.socketId = socket.id;
    player.connected = true;
    socket.data.playerId = id;
    ack({ ok: true, player: { name: player.name, groupId: player.groupId } });
    sendState();
  });

  socket.on('player:buzz', (data = {}) => {
    const player = game.players.get(socket.data.playerId);
    // All these checks protect against double taps, late taps and cheating:
    if (!player) return;                                // not joined
    if (game.phase !== 'open') return;                  // buzzers closed / someone already won
    if (!data || data.roundId !== game.roundId) return; // tap from an older round
    if (game.locked.has(player.groupId)) return;        // group locked out

    // This is the FIRST valid buzz. Node handles one message at a time,
    // so two buzzes "at the same time" are still processed one after the other,
    // and the second one fails the phase check above.
    stopTimer();
    game.phase = 'buzzed';
    game.buzz = { playerId: player.id, name: player.name, groupId: player.groupId };
    const group = findGroup(player.groupId);
    io.emit('buzzed', { groupId: group.id, name: player.name, sound: group.sound });
    sendState();
  });

  socket.on('disconnect', () => {
    const player = game.players.get(socket.data.playerId);
    // Only mark offline if this socket is still the player's latest connection
    if (player && player.socketId === socket.id) {
      player.connected = false;
      sendState();
    }
  });

  // ===== HOST (remote) =====
  socket.on('host:auth', (pin, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    if (String(pin) !== HOST_PIN) return ack({ ok: false });
    socket.data.isHost = true;
    socket.join('host');
    ack({ ok: true });
    sendState();
  });

  // Small helper: only run the action if this socket entered the right PIN.
  // Every host action may reply with { ok, error } through `ack`.
  const hostOnly = (event, fn) => socket.on(event, (data, ack) => {
    if (typeof data === 'function') { ack = data; data = {}; }
    if (typeof ack !== 'function') ack = () => {};
    if (!socket.data.isHost) return ack({ ok: false, error: 'Not logged in' });
    const result = fn(data || {});
    ack(result || { ok: true });
    sendState();
  });

  // Lobby -> category board
  hostOnly('host:start', () => {
    if (game.phase === 'lobby') game.phase = 'board';
  });

  // Pick what to play: { category: 'Food' } plays the next unplayed question
  // in that category; { questionId: 'q7' } plays that exact question.
  hostOnly('host:pick', ({ questionId }) => {
    if (!['lobby', 'board', 'reveal', 'closed'].includes(game.phase)) {
      return { ok: false, error: 'Finish the current question first' };
    }
    // questionId = a specific question; otherwise the next unplayed one, top to bottom
    const q = questionId
      ? findQuestion(questionId)
      : game.questions.find((x) => !x.used);
    if (!q) return { ok: false, error: 'No questions left' };
    startQuestion(q);
    return { ok: true };
  });

  // The "next step" button:
  //   lobby -> board · intro -> open buzzers now · open/buzzed/closed -> reveal · reveal -> board
  hostOnly('host:next', () => {
    const q = currentQuestion();
    if (game.phase === 'intro' && q) openBuzzers(q.timer);
    else if (['open', 'buzzed', 'closed'].includes(game.phase)) { stopTimer(); game.phase = 'reveal'; }
    else if (game.phase === 'reveal' || game.phase === 'lobby') game.phase = 'board';
  });

  hostOnly('host:correct', () => {
    if (game.phase !== 'buzzed') return;
    const q = currentQuestion();
    const points = q ? q.points : sheets.DEFAULT_POINTS;
    findGroup(game.buzz.groupId).score += points;
    game.lastAward = { groupId: game.buzz.groupId, points, name: game.buzz.name };
    game.phase = 'reveal';
    io.emit('effect', 'correct');
  });

  hostOnly('host:wrong', () => {
    if (game.phase !== 'buzzed') return;
    const group = findGroup(game.buzz.groupId);
    group.score += POINTS_WRONG;
    io.emit('effect', 'wrong');
    if (!WRONG_REOPENS) {
      // Default: move on. Show the answer, then the host picks the next question.
      game.lastWrong = { groupId: group.id, points: POINTS_WRONG, name: game.buzz.name };
      stopTimer();
      game.phase = 'reveal';
      return;
    }
    // Optional mode: lock this team out and let the others buzz.
    game.locked.add(group.id);
    game.buzz = null;
    if (groupsStillInPlay().length > 0) openBuzzers(REOPEN_SECONDS);
    else { stopTimer(); game.phase = 'closed'; } // nobody left who can answer
  });

  hostOnly('host:points', ({ groupId, amount }) => {
    const group = findGroup(groupId);
    const n = Math.round(Number(amount));
    if (group && Number.isFinite(n)) group.score += n;
  });

  // Mark a question as played / not played (e.g. it was asked by mistake)
  hostOnly('host:toggleUsed', ({ questionId }) => {
    const q = findQuestion(questionId);
    if (q && q.id !== game.currentId) q.used = !q.used;
  });

  hostOnly('host:end', () => { stopTimer(); game.phase = 'end'; });

  // Background-music slider. Sent many times while dragging, so it does NOT go
  // through hostOnly (which re-sends the whole game state to every phone):
  // only the new level is broadcast, and the big screen applies it.
  socket.on('host:music', (data = {}) => {
    if (!socket.data.isHost) return;
    const pct = Math.round(Number(data.percent));
    if (!Number.isFinite(pct)) return;
    game.musicPercent = Math.min(100, Math.max(0, pct));
    socket.broadcast.emit('music', game.musicPercent);
  });

  // Reset scores + played questions and go back to the lobby. Players stay joined.
  hostOnly('host:reset', () => {
    stopTimer();
    Object.assign(game, { phase: 'lobby', currentId: null, buzz: null, lastAward: null, lastWrong: null });
    game.locked.clear();
    game.groups.forEach((g) => { g.score = 0; });
    game.questions.forEach((q) => { q.used = false; });
  });

  // Remove everyone (e.g. after testing, before the real event)
  hostOnly('host:kickAll', () => {
    game.players.clear();
    io.emit('kicked');
  });

  // Download questions + groups again from the Google Sheet.
  // Optionally the host can paste new sheet links first.
  socket.on('host:reload', async (data = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    if (!socket.data.isHost) return ack({ ok: false, messages: ['Not logged in'] });
    if (typeof data.questions === 'string') sheetUrls.questions = data.questions.trim();
    if (typeof data.groups === 'string') sheetUrls.groups = data.groups.trim();
    const report = await loadFromSheets();
    ack(report);
    sendState();
  });

  // The host uploaded a .csv file from their phone/laptop.
  socket.on('host:upload', (data = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    if (!socket.data.isHost) return ack({ ok: false, messages: ['Not logged in'] });
    const kind = data.kind === 'groups' ? 'groups' : 'questions';
    try {
      ack({ ok: true, messages: applyCsv(kind, String(data.text || ''), `file "${String(data.fileName || 'upload').slice(0, 40)}"`) });
    } catch (err) {
      ack({ ok: false, messages: [`Error: ${err.message}`] });
    }
    sendState();
  });
});

// Start listening (only when run directly, so the test can start it itself)
if (require.main === module) {
  loadFromSheets().then((r) => r.messages.forEach((m) => console.log(m)));
  server.listen(PORT, () => {
    console.log(`Quiz running on http://localhost:${PORT}`);
    console.log(`  Big screen: http://localhost:${PORT}/screen`);
    console.log(`  Host:       http://localhost:${PORT}/remote?pin=${HOST_PIN}`);
    console.log(`  Players:    http://localhost:${PORT}/play`);
  });
}

module.exports = { server, game, applyCsv };
