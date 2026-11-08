// remote.js — the host's phone.
// Every button just sends a message to the server; the server checks the PIN
// for every action, so nobody else can control the game.

const socket = io();
const $ = (id) => document.getElementById(id);
Theme.load();

// The PIN comes from the link (/remote?pin=1234) or is typed in, and is remembered.
const params = new URLSearchParams(location.search);
let pin = params.get('pin') || sessionStorage.getItem('quiz.pin') || '';
let authed = false;
let state = null;
let secret = {};   // private info for the host only (answer, all questions, sheet links…)
let deadline = 0;

function auth() {
  if (!pin) { showPin(''); return; }
  socket.emit('host:auth', pin, (res) => {
    authed = res.ok;
    if (res.ok) {
      sessionStorage.setItem('quiz.pin', pin);
      $('pin-view').classList.add('hidden');
      $('host-view').classList.remove('hidden');
      render();
    } else showPin('Wrong PIN.');
  });
}
function showPin(msg) {
  $('pin-view').classList.remove('hidden');
  $('host-view').classList.add('hidden');
  $('pin-error').textContent = msg;
}
$('pin-btn').onclick = () => { pin = $('pin-input').value.trim(); auth(); };
$('pin-input').onkeydown = (e) => { if (e.key === 'Enter') $('pin-btn').click(); };

// Re-authenticate on every (re)connect — this is what makes refreshing the remote safe.
socket.on('connect', () => { $('offline').classList.add('hidden'); auth(); });
socket.on('disconnect', () => $('offline').classList.remove('hidden'));

socket.on('state', (s) => {
  state = s;
  const left = s.timeLeftMs != null ? s.timeLeftMs : s.introLeftMs;
  deadline = left != null ? Date.now() + left : 0;
  render();
});
socket.on('hostSecret', (s) => {
  const firstTime = !secret.sheetUrls;
  secret = s;
  if (firstTime) { // fill the link boxes once (don't overwrite while typing)
    $('url-questions').value = s.sheetUrls.questions;
    $('url-groups').value = s.sheetUrls.groups;
  }
  render();
});

// Send a host action; show an error toast if the server says no.
function send(event, data = {}) {
  socket.emit(event, data, (res) => { if (res && res.ok === false && res.error) toast(res.error); });
  if (navigator.vibrate) navigator.vibrate(20);
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ----- Static buttons -----
$('end-btn').onclick = () => { if (confirm('End the game and show the winner?')) send('host:end'); };
$('reset-btn').onclick = () => { if (confirm('Reset ALL scores, mark every question unplayed and go back to the lobby?')) send('host:reset'); };
$('kick-btn').onclick = () => { if (confirm('Remove all players? They will need to join again.')) send('host:kickAll'); };

$('reload-btn').onclick = () => {
  report('Loading…');
  socket.emit('host:reload', { questions: $('url-questions').value, groups: $('url-groups').value },
    (res) => report(res.messages.join('\n')));
};

// Upload a CSV: read the file in the browser, send the text to the server
// Excel files (.xlsx / .xls) are turned into CSV in the browser. The Excel reader
// (SheetJS) is only downloaded the first time someone picks an Excel file.
let xlsxLoading = null;
async function excelToCsv(file) {
  if (!window.XLSX) {
    xlsxLoading = xlsxLoading || new Promise((ok, fail) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = ok;
      sc.onerror = () => { xlsxLoading = null; fail(new Error('could not load the Excel reader (no internet?). Save the file as CSV instead.')); };
      document.head.appendChild(sc);
    });
    await xlsxLoading;
  }
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]]); // first sheet only
}

function setupUpload(inputId, kind) {
  $(inputId).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (state && state.phase !== 'lobby' && !confirm(`A game is running. Replace ${kind} anyway? Scores are kept.`)) { e.target.value = ''; return; }
    report('Uploading…');
    let text;
    try {
      text = /\.xlsx?$/i.test(file.name) ? await excelToCsv(file) : await file.text();
    } catch (err) { report(`Could not read "${file.name}": ${err.message}`); e.target.value = ''; return; }
    socket.emit('host:upload', { kind, text, fileName: file.name }, (res) => report(res.messages.join('\n')));
    e.target.value = ''; // allow choosing the same file again
  };
}
setupUpload('file-questions', 'questions');
setupUpload('file-groups', 'groups');

function report(text) {
  const el = $('load-report');
  el.textContent = text;
  el.classList.remove('hidden');
}

// ----- Drawing -----
const PHASE = {
  lobby: ['Lobby', ''], board: ['Picking', ''], intro: ['Get ready', 'alert'],
  open: ['Buzzers open', 'live'], buzzed: ['BUZZED!', 'alert'], closed: ["Time's up", ''],
  reveal: ['Answer shown', ''], end: ['Game over', ''],
};

// Small helper to build a button
function button(cls, html, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = `ctl ${cls}`;
  b.innerHTML = html;
  b.disabled = disabled;
  b.onclick = onClick;
  return b;
}

function render() {
  if (!state || !authed) return;
  const s = state;
  const groupById = Object.fromEntries(s.groups.map((g) => [g.id, g]));
  const q = s.question;

  const [label, cls] = PHASE[s.phase];
  $('phase-pill').textContent = label;
  $('phase-pill').className = `phase-pill ${cls}`;
  $('progress').textContent = `${s.used}/${s.total} played`;

  // ----- "Now" card -----
  $('now-cat').classList.toggle('hidden', !q);
  $('now-points').classList.toggle('hidden', !q);
  if (q) {
    $('now-cat').textContent = `Question ${s.used} of ${s.total}`;
    $('now-cat').style.setProperty('--c', q.categoryColor);
    $('now-points').textContent = q.difficulty ? `${q.difficulty} · ${q.points} pts` : `${q.points} pts`;
  }
  const nowText = {
    lobby: `${s.total} questions. Wait for players, then start.`,
    board: 'Tap Next question when you are ready.',
    end: 'Game over — the winner is on the big screen.',
  }[s.phase] || secret.question || '';
  $('now-text').textContent = nowText;
  const showAnswer = q && secret.answer;
  $('now-answer').classList.toggle('hidden', !showAnswer);
  $('now-answer-text').textContent = secret.answer || '';

  const bi = $('buzz-info');
  if (s.phase === 'buzzed' && s.buzz) {
    const g = groupById[s.buzz.groupId];
    bi.style.setProperty('--c', g.color);
    bi.textContent = `${g.emoji} ${g.name} — ${s.buzz.name} buzzed!`;
    bi.classList.remove('hidden');
  } else if (s.phase === 'reveal' && s.lastAward) {
    const g = groupById[s.lastAward.groupId];
    bi.style.setProperty('--c', g ? g.color : 'var(--good)');
    bi.textContent = `+${s.lastAward.points} to ${g ? g.name : ''}`;
    bi.classList.remove('hidden');
  } else if (s.phase === 'reveal' && s.lastWrong) {
    const g = groupById[s.lastWrong.groupId];
    bi.style.setProperty('--c', '#5a2a2e');
    bi.textContent = `${g ? g.name : ''} got it wrong (${s.lastWrong.points})`;
    bi.classList.remove('hidden');
  } else bi.classList.add('hidden');

  // ----- Main actions for this phase -----
  const a = $('actions');
  a.innerHTML = '';
  const pts = q ? q.points : 10;
  const wrongPts = secret.settings ? secret.settings.POINTS_WRONG : -5;
  switch (s.phase) {
    case 'lobby':
      a.append(button('primary', '▶ Start game', () => send('host:start'), !s.total));
      break;
    case 'intro':
      a.append(button('primary', 'Open buzzers now', () => send('host:next')));
      break;
    case 'open':
      a.append(button('', 'Reveal answer<small>nobody gets points</small>', () => send('host:next')));
      break;
    case 'buzzed': {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        button('good', `Correct<small>+${pts} points</small>`, () => send('host:correct')),
        button('bad big', `Wrong<small>${wrongPts} &amp; ${secret.settings && secret.settings.WRONG_REOPENS ? 'reopen' : 'move on'}</small>`, () => send('host:wrong')),
      );
      a.append(row, button('', 'Reveal answer (no points)', () => send('host:next')));
      break;
    }
    case 'closed':
      a.append(button('primary', 'Reveal answer', () => send('host:next')));
      break;
    case 'reveal':
      if (s.used < s.total) {
        a.append(button('primary', `▶ Next question<small>${s.used + 1} of ${s.total}</small>`, () => send('host:pick')));
      } else a.append(button('primary', 'Back to the board', () => send('host:next')));
      if (s.used >= s.total) a.append(button('', 'Show final scores', () => send('host:end')));
      break;
    case 'board':
      if (s.used >= s.total) a.append(button('primary', 'All done — show final scores', () => send('host:end')));
      else a.append(button('primary', `▶ Next question<small>${s.used + 1} of ${s.total}</small>`, () => send('host:pick')));
      break;
    case 'end':
      a.append(button('', 'Play again (reset scores)', () => { if (confirm('Reset scores and go back to the lobby?')) send('host:reset'); }));
      break;
  }

  // ----- Category picker -----
  const canPick = s.phase === 'board' || s.phase === 'reveal';
  $('picker').classList.toggle('hidden', !canPick);
  // Questions-only mode: the big "Next question" button replaces the category grid;
  // the full list (with answers) stays available underneath.
  $('cat-buttons').classList.add('hidden'); // no category grid: the Next question button replaces it
  if (canPick) renderPicker();

  renderScores();

  // Setup info
  if (secret.source) {
    $('src-questions').textContent = secret.source.questions;
    $('src-groups').textContent = secret.source.groups;
  }
  if (secret.settings) {
    const st = secret.settings;
    const afterWrong = st.WRONG_REOPENS ? `other teams get ${st.REOPEN_SECONDS}s` : 'answer is shown and you move on';
    $('settings-note').textContent = `Wrong answer: ${st.POINTS_WRONG} pts, then ${afterWrong} · ${st.INTRO_SECONDS}s "get ready" before buzzers open. (Change with env vars, see README.)`;
  }
  const online = s.groups.reduce((n, g) => n + g.players.filter((p) => p.connected).length, 0);
  const total = s.groups.reduce((n, g) => n + g.players.length, 0);
  $('players-online').textContent = `${online} of ${total} players connected`;
  updateTimer();
}

function renderPicker() {
  // A grid like the big-screen board: one column per category, one button
  // per question showing its difficulty + points. Tap = play that question.
  const box = $('cat-buttons');
  box.innerHTML = '';
  box.style.gridTemplateColumns = `repeat(${state.categories.length}, minmax(0, 1fr))`;
  state.categories.forEach((cat) => {
    const col = document.createElement('div');
    col.className = 'pick-col';
    const head = document.createElement('div');
    head.className = 'pick-head';
    head.style.setProperty('--c', cat.color);
    head.textContent = cat.name;
    col.appendChild(head);
    cat.questions.forEach((x) => {
      const b = document.createElement('button');
      b.className = 'pick-cell' + (x.used ? ' used' : '');
      b.style.setProperty('--c', cat.color);
      b.innerHTML = '<span class="lvl"></span><span class="pts"></span>';
      b.querySelector('.lvl').textContent = x.used ? 'played' : (x.difficulty || '');
      b.querySelector('.pts').textContent = x.points;
      b.onclick = () => {
        if (x.used && !confirm('This question was already played. Play it again?')) return;
        send('host:pick', { questionId: x.id });
      };
      col.appendChild(b);
    });
    box.appendChild(col);
  });

  // Specific question list (with answers — host only)
  const list = $('question-list');
  if (!secret.questions) return;
  const openDetails = list.closest('details').open;
  if (!openDetails && list.childElementCount) return; // don't rebuild while closed
  list.innerHTML = '';
  state.categories.forEach((cat) => {
    const grp = document.createElement('div');
    grp.className = 'q-group';
    grp.innerHTML = '<h4><span class="dot"></span><span></span></h4>';
    grp.querySelector('.dot').style.background = cat.color;
    grp.querySelector('h4 span:last-child').textContent = cat.name;
    grp.querySelector('h4').remove(); // no category headings
    secret.questions.filter((x) => x.category === cat.name).forEach((x) => {
      const row = document.createElement('div');
      row.className = 'q-row' + (x.used ? ' used' : '');
      row.innerHTML = '<span class="p"></span><span class="t"><span class="qq"></span><small></small></span>';
      row.querySelector('.p').textContent = x.points;
      if (x.difficulty) row.querySelector('small').dataset.lvl = x.difficulty;
      row.querySelector('.qq').textContent = (x.used ? '[played] ' : '') + x.question;
      row.querySelector('small').textContent = `A: ${x.answer}`;
      const play = document.createElement('button');
      play.className = 'play';
      play.textContent = x.used ? 'Replay' : 'Play';
      play.onclick = () => {
        if (!x.used || confirm('This question was already played. Play it again?')) send('host:pick', { questionId: x.id });
      };
      const toggle = document.createElement('button');
      toggle.textContent = x.used ? 'Unmark' : 'Skip';
      toggle.title = x.used ? 'Mark as not played' : 'Mark as played without asking';
      toggle.onclick = () => send('host:toggleUsed', { questionId: x.id });
      row.append(play, toggle);
      grp.appendChild(row);
    });
    list.appendChild(grp);
  });
}
// rebuild the list when the "specific question" section is opened
document.querySelector('.specific').addEventListener('toggle', () => render());

function renderScores() {
  const list = $('score-list');
  list.innerHTML = '';
  const sorted = [...state.groups];
  sorted.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (state.locked.includes(g.id) ? ' locked' : '');
    row.style.setProperty('--c', g.color);
    row.innerHTML = `
      <button class="minus" aria-label="take points">−</button>
      <div class="info"><div class="gname"></div><div class="gplayers"></div></div>
      <div class="pts"></div>
      <button class="plus" aria-label="give points">+</button>`;
    row.querySelector('.gname').textContent = `${g.emoji} ${g.name}${state.locked.includes(g.id) ? ' (locked)' : ''}`;
    const online = g.players.filter((p) => p.connected).length;
    row.querySelector('.gplayers').textContent = `${online}/${g.players.length} players online`;
    row.querySelector('.pts').textContent = g.score;
    const amount = () => Math.abs(parseInt($('amount').value, 10) || 0);
    row.querySelector('.plus').onclick = () => send('host:points', { groupId: g.id, amount: amount() });
    row.querySelector('.minus').onclick = () => send('host:points', { groupId: g.id, amount: -amount() });
    list.appendChild(row);
  });
}

function updateTimer() {
  const el = $('timer-label');
  if (!state || !['open', 'intro'].includes(state.phase)) { el.textContent = ''; return; }
  if (!deadline) { el.textContent = '∞'; return; }
  el.textContent = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`;
}
setInterval(updateTimer, 250);

// ----- Background-music slider -----
// Sends while dragging (at most every 80 ms) and once more when let go.
// The server only remembers the level and passes it to the big screen.
(() => {
  const slider = $('music-slider');
  const label = $('music-value');
  let dragging = false;
  let lastSent = 0;
  let pending = null;
  const show = (v) => { label.textContent = `${v}%`; };
  const push = () => {
    lastSent = Date.now();
    pending = null;
    socket.emit('host:music', { percent: Number(slider.value) });
  };
  slider.addEventListener('input', () => {
    dragging = true;
    show(slider.value);
    if (Date.now() - lastSent > 80) push();
    else if (!pending) pending = setTimeout(push, 80);
  });
  slider.addEventListener('change', () => { dragging = false; clearTimeout(pending); push(); });
  // Keep the slider in sync with the server (another host phone, or after a refresh)
  socket.on('state', (s) => {
    if (dragging || s.musicPercent == null) return;
    slider.value = s.musicPercent;
    show(s.musicPercent);
  });
  socket.on('music', (pct) => { if (!dragging) { slider.value = pct; show(pct); } });
})();
