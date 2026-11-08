// screen.js — the big projector screen. Display only: it never sends game actions.

const socket = io();
const $ = (id) => document.getElementById(id);

let state = null;
let deadline = 0;        // local time (ms) when the current countdown hits 0 (0 = none)
let lastTickSecond = -1; // so the "tick" sound plays once per second
let prev = {};           // previous state bits, to detect changes (play sounds, animations)
let lastScores = {};     // groupId -> score, to animate score changes
let splashTimer = null;

const EFFECTS = ['correct', 'wrong', 'tick', 'open', 'timeup', 'intro', 'reveal', 'winner', 'join'];

// ----- Branding + decorations -----
Theme.load().then((cfg) => {
  const pretty = cfg.joinUrl.replace(/^https?:\/\//, '');
  document.querySelectorAll('.join-url-text').forEach((el) => { el.textContent = pretty; });
});

// ----- "Click to start" (unlocks sound) -----
$('start-overlay').addEventListener('click', () => {
  Sounds.unlock();
  $('start-overlay').classList.add('hidden');
  if (state) {
    Sounds.preload(state.groups.map((g) => g.sound), EFFECTS);
    playMusicFor(state.phase);
  }
});
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'f') { // full screen
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  if (k === 'm') Sounds.toggleMusic(); // music on/off
});

socket.on('connect', () => $('offline').classList.add('hidden'));
socket.on('disconnect', () => $('offline').classList.remove('hidden'));

// ----- Sounds triggered by the server -----
socket.on('buzzed', ({ sound }) => Sounds.play(sound));
socket.on('effect', (name) => Sounds.effect(name));
socket.on('music', (pct) => Sounds.setMusicPercent(pct)); // host's music slider

function playMusicFor(phase) {
  // the quiet Nepali comedy loop plays nonstop all game; it stops only for the winner podium
  if (phase === 'end') Sounds.music(null);
  else Sounds.music('lobby');
}

// ----- State updates -----
socket.on('state', (s) => {
  const newRound = !state || s.roundId !== state.roundId;
  const newQuestion = s.question && (!state || !state.question || s.question.id !== state.question.id || (state.phase !== 'intro' && s.phase === 'intro'));
  const phaseChanged = !state || s.phase !== state.phase;
  const players = s.groups.reduce((n, g) => n + g.players.length, 0);

  if (s.musicPercent != null) Sounds.setMusicPercent(s.musicPercent);
  if (Sounds.isUnlocked()) Sounds.preload(s.groups.map((g) => g.sound), EFFECTS);
  const left = s.timeLeftMs != null ? s.timeLeftMs : s.introLeftMs;
  deadline = left != null ? Date.now() + left : 0;

  // Sounds + animations on changes
  if (phaseChanged) playMusicFor(s.phase);
  if (s.phase === 'intro' && newQuestion) { Sounds.effect('intro'); showSplash(s.question, s); }
  if (s.phase === 'open' && (phaseChanged || newRound)) Sounds.effect('open');
  if (s.phase === 'closed' && prev.phase === 'open') Sounds.effect('timeup');
  if (s.phase === 'reveal' && phaseChanged && s.lastAward) { // correct answer: Tihar party!
    const g = s.groups.find((x) => x.id === s.lastAward.groupId) || {};
    Celebrate.run({ team: g.name, emoji: g.emoji, color: g.color, player: s.lastAward.name, points: s.lastAward.points });
  }
  if (s.phase === 'reveal' && phaseChanged && s.lastWrong) { // wrong answer: "dhattérika!"
    const g = s.groups.find((x) => x.id === s.lastWrong.groupId) || {};
    Celebrate.wrong({ team: g.name, emoji: g.emoji, player: s.lastWrong.name, points: s.lastWrong.points });
  }
  if (s.phase !== 'reveal') Celebrate.stop(); // host moved on: clear it straight away
  if (s.phase === 'reveal' && phaseChanged && !s.lastAward && !s.lastWrong) Sounds.effect('reveal'); // correct/wrong already played their own sound
  if (s.phase === 'end' && phaseChanged) Sounds.effect('winner');
  if (s.phase === 'lobby' && prev.players !== undefined && players > prev.players) Sounds.effect('join');

  state = s;
  prev = { phase: s.phase, players };
  render();
});

// ----- Views -----
function show(viewId) {
  ['lobby', 'board', 'question', 'end'].forEach((id) => $(id).classList.toggle('hidden', id !== viewId));
}

function render() {
  const s = state;
  const groupById = Object.fromEntries(s.groups.map((g) => [g.id, g]));

  // Header bits
  const inGame = s.phase !== 'lobby';
  document.body.classList.toggle('in-lobby', !inGame);
  $('round-chip').classList.toggle('hidden', !inGame || s.phase === 'end');
  $('round-chip').textContent = `Question ${Math.max(1, s.used)} of ${s.total}`;
  if (s.phase === 'board') $('round-chip').textContent = `${s.total - s.used} questions left`;

  // Buzzed takeover
  const buzzedNow = s.phase === 'buzzed' && s.buzz;
  $('buzzed').classList.toggle('hidden', !buzzedNow);
  if (buzzedNow) {
    const g = groupById[s.buzz.groupId];
    $('buzzed').style.setProperty('--c', g.color);
    $('buzz-emoji').textContent = g.emoji;
    $('buzz-group').textContent = g.name;
    $('buzz-name').textContent = `${s.buzz.name} buzzed first`;
    // The question is NOT shown here: only the team and who buzzed.
  }

  // Scoreboard (shown during the game, not on lobby / end)
  $('scorebar').classList.toggle('hidden', s.phase === 'lobby' || s.phase === 'end');

  if (s.phase === 'lobby') { show('lobby'); renderLobby(); }
  else if (s.phase === 'board') { show('board'); renderBoard(); }
  else if (s.phase === 'end') { show('end'); renderEnd(); }
  else { show('question'); renderQuestion(); }

  renderScoreboard();
  updateCountdown();
}

function renderLobby() {
  const total = state.groups.reduce((n, g) => n + g.players.length, 0);
  $('player-count').textContent = total === 0 ? 'Waiting for players…' : `${total} player${total === 1 ? '' : 's'} joined`;
  const box = $('lobby-groups');
  box.innerHTML = '';
  // 4 teams -> 2x2, more teams -> 3 per row
  box.style.gridTemplateColumns = `repeat(${state.groups.length <= 4 ? 2 : 3}, minmax(0, 1fr))`;
  state.groups.forEach((g) => {
    const card = document.createElement('div');
    card.className = 'lobby-group';
    card.style.setProperty('--c', g.color);
    card.innerHTML = '<h3><span class="t"></span><span class="n"></span></h3><div class="chips"></div>';
    card.querySelector('.t').textContent = `${g.emoji} ${g.name}`;
    card.querySelector('.n').textContent = g.players.length;
    const chips = card.querySelector('.chips');
    g.players.forEach((p) => {
      const c = document.createElement('span');
      c.className = 'chip' + (p.connected ? '' : ' offline');
      c.textContent = p.name;
      chips.appendChild(c);
    });
    box.appendChild(card);
  });
}

// "Board" = the screen between questions: just "Question 4 of 30" (no categories)
function renderBoard() {
  const grid = $('board-grid');
  const done = state.used >= state.total;
  grid.style.gridTemplateColumns = '1fr';
  grid.innerHTML = '<div class="board-next"><div class="big display"></div><div class="sub"></div></div>';
  grid.querySelector('.big').textContent = done ? 'All done!' : `Question ${state.used + 1}`;
  grid.querySelector('.sub').textContent = done ? 'Final scores coming up' : `of ${state.total}`;
}

function renderQuestion() {
  const s = state;
  const q = s.question || { text: '', image: '', points: 0, categoryColor: '#FFAB00' };
  $('q-cat').textContent = `Question ${s.used}`;
  $('q-cat').style.setProperty('--c', q.categoryColor);
  $('q-points').textContent = q.difficulty ? `${q.difficulty} · ${q.points} pts` : `${q.points} pts`;
  $('q-text').textContent = q.text;

  const img = $('q-image');
  if (q.image) {
    if (img.getAttribute('src') !== q.image) img.src = q.image;
    img.classList.remove('hidden');
    img.onerror = () => img.classList.add('hidden'); // broken link: just hide it
  } else img.classList.add('hidden');

  // Status line
  const st = $('q-status');
  st.classList.toggle('open', s.phase === 'open');
  if (s.phase === 'intro') st.textContent = 'Get ready…';
  else if (s.phase === 'open') {
    const locked = s.groups.filter((g) => s.locked.includes(g.id));
    st.textContent = locked.length ? 'Buzzers open — other teams, go!' : 'Buzzers open!';
  } else if (s.phase === 'closed') st.textContent = "Time's up!";
  else st.textContent = '';

  // Answer + who got the points
  const showAns = s.phase === 'reveal' && q.answer;
  $('q-answer').classList.toggle('hidden', !showAns);
  $('q-answer-text').textContent = q.answer || '';
  const award = s.phase === 'reveal' && (s.lastAward || s.lastWrong);
  const aw = $('q-award');
  aw.classList.toggle('hidden', !award);
  aw.classList.toggle('wrong', !!(award && !s.lastAward));
  if (award) {
    const g = s.groups.find((x) => x.id === award.groupId);
    const team = g ? `${g.emoji} ${g.name}` : '';
    if (s.lastAward) {
      aw.style.background = g ? g.color : 'var(--good)';
      aw.textContent = `+${award.points} to ${team} — well done ${award.name}!`;
    } else {
      aw.style.background = '';
      aw.textContent = `${team} got it wrong (${award.points})`;
    }
  }
  // Hide the image when the answer is shown, so the answer has room
  if (showAns) img.classList.add('hidden');
}

function renderScoreboard() {
  const bar = $('scorebar');
  bar.innerHTML = '';
  const best = Math.max(...state.groups.map((g) => g.score));
  state.groups.forEach((g) => {
    const card = document.createElement('div');
    const locked = state.locked.includes(g.id) && ['open', 'buzzed', 'closed'].includes(state.phase);
    card.className = 'score-item'
      + (best > 0 && g.score === best ? ' leader' : '')
      + (locked ? ' locked' : '')
      + (lastScores[g.id] !== undefined && lastScores[g.id] !== g.score ? ' bump' : '');
    card.style.setProperty('--c', g.color);
    card.innerHTML = '<span class="em"></span><span class="nm"></span><span class="pts"></span>';
    card.querySelector('.em').textContent = g.emoji;
    card.querySelector('.nm').textContent = g.name;
    card.querySelector('.pts').textContent = g.score;
    bar.appendChild(card);
    lastScores[g.id] = g.score;
  });
}

function renderEnd() {
  const sorted = [...state.groups].sort((a, b) => b.score - a.score);
  const podium = $('podium');
  podium.innerHTML = '';
  // Podium order on screen: 2nd, 1st, 3rd. A team tied with the winner also gets 1st.
  [1, 0, 2].forEach((i) => {
    const g = sorted[i];
    if (!g) return;
    const place = g.score === sorted[0].score ? 1 : i + 1;
    const pod = document.createElement('div');
    pod.className = `pod p${place}`;
    pod.innerHTML = '<div class="em"></div><div class="nm"></div><div class="block"><div class="place"></div><div class="pts"></div></div>';
    pod.querySelector('.em').textContent = g.emoji;
    pod.querySelector('.nm').textContent = g.name;
    pod.querySelector('.place').textContent = place;
    pod.querySelector('.pts').textContent = `${g.score} pts`;
    podium.appendChild(pod);
  });
  // Everyone after 3rd place
  const rest = $('rest');
  rest.innerHTML = '';
  sorted.slice(3).forEach((g, i) => {
    const item = document.createElement('div');
    item.className = 'score-item';
    item.style.setProperty('--c', g.color);
    item.innerHTML = '<span class="em"></span><span class="nm"></span><span class="pts"></span>';
    item.querySelector('.em').textContent = g.emoji;
    item.querySelector('.nm').textContent = `${i + 4}. ${g.name}`;
    item.querySelector('.pts').textContent = g.score;
    rest.appendChild(item);
  });
}

// ----- "Question 4" splash (when the host starts a question) -----
function showSplash(q, s = state) {
  const sp = $('splash');
  sp.style.setProperty('--c', q.categoryColor);
  $('splash-cat').textContent = `Question ${s.used}`;
  $('splash-pts').textContent = `For ${q.points} points`;
  // restart the CSS animation
  sp.classList.add('hidden');
  void sp.offsetWidth;
  sp.classList.remove('hidden');
  clearTimeout(splashTimer);
  splashTimer = setTimeout(() => sp.classList.add('hidden'), 2300);
}

// ----- Countdown ring (runs 5x a second) -----
const RING = 326.7; // circumference of the ring (2 × π × 52)
function updateCountdown() {
  const ring = $('ring');
  const active = state && ['open', 'intro'].includes(state.phase) && deadline;
  ring.classList.toggle('hidden', !active);
  if (!active) { ring.classList.remove('low'); return; }
  const leftMs = Math.max(0, deadline - Date.now());
  const secs = Math.ceil(leftMs / 1000);
  const total = state.timerTotalMs || 1;
  $('ring-num').textContent = secs;
  $('ring-label').textContent = state.phase === 'intro' ? 'READY' : 'SECONDS';
  $('ring-fg').style.strokeDashoffset = String(RING * (1 - leftMs / total));
  const low = state.phase === 'open' && secs <= 3;
  ring.classList.toggle('low', low);
  if (low && secs > 0 && secs !== lastTickSecond) Sounds.effect('tick');
  lastTickSecond = secs;
}
setInterval(updateCountdown, 200);
