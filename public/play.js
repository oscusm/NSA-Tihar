// play.js — the player's phone.
// The phone never decides who won. It only says "I buzzed" and then shows
// whatever the server says.

const socket = io();
const $ = (id) => document.getElementById(id);
Theme.load();

// ----- Remember who this phone is (survives reloads) -----
// A random id per phone, saved in localStorage. The server uses it to
// recognise you when you reconnect, so you keep your name and group.
function makeId() {
  // crypto.randomUUID only works on https/localhost, so we have a fallback
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
let playerId = store.get('quiz.playerId');
if (!playerId) { playerId = makeId(); store.set('quiz.playerId', playerId); }

let me = null;            // { name, groupId } once joined
let state = null;         // latest state from the server
let selectedGroup = null; // group picked on the join screen
let pressedRound = -1;    // roundId we already buzzed in (stops double taps)
let deadline = 0;         // local time when the countdown ends (0 = none)

// ----- Joining -----
function join(name, groupId) {
  $('join-btn').disabled = true;
  socket.emit('player:join', { playerId, name, groupId }, (res) => {
    $('join-btn').disabled = false;
    if (res.ok) {
      me = res.player;
      store.set('quiz.joined', '1');
      store.set('quiz.groupId', me.groupId);
      $('join-error').textContent = '';
    } else {
      store.del('quiz.joined');
      me = null;
      $('join-error').textContent = res.error;
    }
    render();
  });
}

$('join-btn').addEventListener('click', () => {
  Sounds.unlock(); // this tap lets the phone play sounds later
  const name = $('name-input').value.trim();
  if (!name) { $('join-error').textContent = 'Please type your name.'; return; }
  if (!selectedGroup) { $('join-error').textContent = 'Please pick a team.'; return; }
  store.set('quiz.name', name);
  join(name, selectedGroup);
});
$('name-input').value = store.get('quiz.name') || '';
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// Every time we (re)connect, rejoin automatically if this phone joined before.
// We also send the saved group, so even after a server restart you land
// back in the same group without typing anything.
socket.on('connect', () => {
  $('offline').classList.add('hidden');
  if (store.get('quiz.joined')) join(store.get('quiz.name'), store.get('quiz.groupId'));
});
socket.on('disconnect', () => $('offline').classList.remove('hidden'));

// Host pressed "remove all players" (or your team was deleted)
socket.on('kicked', () => {
  store.del('quiz.joined');
  me = null;
  render();
});

// ----- Buzzing -----
// 'pointerdown' fires the moment a finger touches the screen — faster than 'click'.
$('buzz-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  Sounds.unlock();
  if (!canBuzz()) return;
  pressedRound = state.roundId;          // lock locally right away (double-tap guard)
  socket.emit('player:buzz', { roundId: state.roundId });
  if (navigator.vibrate) navigator.vibrate(80);
  render();
});
// Stop the long-press menu on phones
$('buzz-btn').addEventListener('contextmenu', (e) => e.preventDefault());

function canBuzz() {
  return me && state && state.phase === 'open'
    && !state.locked.includes(me.groupId)
    && pressedRound !== state.roundId;
}

// Any tap anywhere also unlocks sound (needed after a page reload + auto-rejoin)
document.addEventListener('pointerdown', () => Sounds.unlock(), { once: true });

// ----- Sound: play the winning group's sound, but only on that group's phones -----
socket.on('buzzed', ({ groupId, sound }) => {
  if (me && groupId === me.groupId) {
    Sounds.play(sound);
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
  }
});

// ----- Drawing the page -----
socket.on('state', (s) => {
  state = s;
  const left = s.timeLeftMs != null ? s.timeLeftMs : s.introLeftMs;
  deadline = left != null ? Date.now() + left : 0;
  const myGroup = me && s.groups.find((g) => g.id === me.groupId);
  if (myGroup) Sounds.preload([myGroup.sound]);
  render();
});

function setStatus(text, small = false) {
  $('status').textContent = text;
  $('status').classList.toggle('small', small);
}

function render() {
  if (!state) return;
  const joined = !!me;
  $('join-view').classList.toggle('hidden', joined);
  $('game-view').classList.toggle('hidden', !joined);
  if (!joined) return renderJoin();

  const myGroup = state.groups.find((g) => g.id === me.groupId);
  if (!myGroup) return; // group vanished; server will ask us to rejoin
  $('me-bar').style.setProperty('--c', myGroup.color);
  $('me-group').textContent = `${myGroup.emoji} ${myGroup.name}`;
  $('me-name').textContent = me.name;
  $('me-score').textContent = `${myGroup.score} pts`;

  // Category chip while a question is on
  const q = state.question;
  $('q-chip').classList.toggle('hidden', !q);
  if (q) {
    $('q-chip').querySelector('.dot').style.background = q.categoryColor;
    $('q-chip').querySelector('.txt').textContent = [`Question ${state.used}`, `${q.points} pts`].filter(Boolean).join(' · ');
  }

  const btn = $('buzz-btn');
  btn.style.setProperty('--c', myGroup.color);
  btn.disabled = !canBuzz();
  btn.classList.toggle('ready', canBuzz());
  btn.classList.remove('won');

  const winner = state.buzz && state.groups.find((g) => g.id === state.buzz.groupId);
  const lockedOut = state.locked.includes(me.groupId);

  switch (state.phase) {
    case 'lobby':
      setStatus("You're in! Waiting for the host…", true); break;
    case 'board':
      setStatus('Next question coming…', true); break;
    case 'intro':
      setStatus('Get ready…'); break;
    case 'open':
      if (lockedOut) setStatus('Your team is locked out', true);
      else if (pressedRound === state.roundId) setStatus('Buzzed! Waiting…', true);
      else setStatus('BUZZ NOW!');
      break;
    case 'buzzed':
      if (winner && winner.id === me.groupId) {
        setStatus(state.buzz.playerId === playerId ? 'You were first!' : `Your team got it! (${state.buzz.name})`);
        btn.classList.add('won');
      } else if (winner) {
        setStatus(`${winner.emoji} ${winner.name} team was faster`, true);
      }
      break;
    case 'closed':
      setStatus("Time's up!"); break;
    case 'reveal': {
      const award = state.lastAward;
      const wrong = state.lastWrong;
      if (award && award.groupId === me.groupId) setStatus(`+${award.points} for your team!`);
      else if (wrong && wrong.groupId === me.groupId) setStatus(`Wrong answer (${wrong.points})`, true);
      else setStatus('Answer is on the big screen', true);
      break;
    }
    case 'end': {
      const top = [...state.groups].sort((a, b) => b.score - a.score)[0];
      setStatus(top && top.id === me.groupId && top.score > 0 ? 'Your team won!' : 'Game over! Look at the big screen', true);
      break;
    }
    default: setStatus('Waiting…', true);
  }
  updateCountdown();
}

function updateCountdown() {
  const el = $('countdown');
  if (!state || !deadline || !['open', 'intro'].includes(state.phase)) { el.textContent = ''; return; }
  const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  el.textContent = state.phase === 'intro' ? `Buzzers open in ${secs}…` : `${secs}s left`;
}
setInterval(updateCountdown, 250);

function renderJoin() {
  const picker = $('group-picker');
  picker.innerHTML = '';
  state.groups.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'group-option' + (selectedGroup === g.id ? ' selected' : '');
    b.style.setProperty('--c', g.color);
    b.innerHTML = '<span class="emoji"></span><span class="label-name"></span><span class="count"></span>';
    b.querySelector('.emoji').textContent = g.emoji;
    b.querySelector('.label-name').textContent = g.name;
    b.querySelector('.count').textContent = `${g.players.length} player${g.players.length === 1 ? '' : 's'}`;
    b.onclick = () => { selectedGroup = g.id; Sounds.unlock(); renderJoin(); };
    picker.appendChild(b);
  });
}
