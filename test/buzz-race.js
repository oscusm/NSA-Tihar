// test/buzz-race.js
// Simulates many players buzzing at the SAME moment and checks that the server
// picks exactly one winner, ignores double taps, handles "Wrong" lockouts,
// and that questions play in order (there are no categories).
//
// Run with:  npm test

process.env.HOST_PIN = 'test-pin';
process.env.INTRO_SECONDS = '0.4'; // short "get ready" so the test runs fast
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, game } = require('../server');

const PLAYERS = 40;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (msg) => console.log(`  PASS  ${msg}`);

// Wait until a socket receives a state that matches `check`
const waitForState = (sock, check) => new Promise((resolve) => {
  const handler = (s) => { if (check(s)) { sock.off('state', handler); resolve(s); } };
  sock.on('state', handler);
});
// Send a host action and wait for the server's reply
const ask = (sock, event, data = {}) => new Promise((r) => sock.emit(event, data, r));

async function main() {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const open = () => connect(url, { transports: ['websocket'], forceNew: true });
  const groupIds = game.groups.map((g) => g.id);

  // ---- Host joins ----
  const host = open();
  const auth = await new Promise((r) => host.emit('host:auth', 'test-pin', r));
  assert.equal(auth.ok, true, 'host should log in with the right PIN');

  const bad = open();
  const badAuth = await new Promise((r) => bad.emit('host:auth', 'nope', r));
  assert.equal(badAuth.ok, false, 'wrong PIN must be rejected');
  const badStart = await ask(bad, 'host:start');
  assert.equal(badStart.ok, false);
  assert.equal(game.phase, 'lobby', 'non-host cannot control the game');
  pass('wrong PIN cannot control the game');

  // ---- Players join, spread across all groups ----
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const sock = open();
    const groupId = groupIds[i % groupIds.length];
    const res = await new Promise((r) => sock.emit('player:join',
      { playerId: `id-${i}`, name: `Player ${i}`, groupId }, r));
    assert.equal(res.ok, true, `player ${i} should join`);
    let buzzedCount = 0;
    sock.on('buzzed', () => { buzzedCount++; });
    players.push({ sock, groupId, buzzed: () => buzzedCount });
  }
  pass(`${PLAYERS} players joined ${groupIds.length} teams`);

  // Duplicate name is rejected
  const dup = open();
  const dupRes = await new Promise((r) => dup.emit('player:join',
    { playerId: 'dup', name: 'player 0', groupId: groupIds[1] }, r));
  assert.equal(dupRes.ok, false, 'duplicate name must be rejected');
  dup.close();
  pass('duplicate name rejected');

  // ---- Lobby -> "next question" screen -> host taps Next question ----
  await ask(host, 'host:start');
  assert.equal(game.phase, 'board');
  const board = await new Promise((r) => { players[0].sock.once('state', r); host.emit('host:points', { groupId: groupIds[0], amount: 0 }); });
  assert.equal(board.noCategories, true, 'the game has no categories');
  assert.equal(JSON.stringify(board).includes('Kathmandu'), false, 'board must not contain answers');
  assert.equal(JSON.stringify(board).includes('capital of Nepal'), false, 'board must not contain question text');
  pass('board has no categories, no question text or answers');

  const intro = waitForState(players[0].sock, (s) => s.phase === 'intro');
  const opened = waitForState(players[0].sock, (s) => s.phase === 'open');
  await ask(host, 'host:pick');
  const sIntro = await intro;
  assert.equal(sIntro.question.text, 'How many days is Tihar celebrated?', 'the first question in the sheet plays first');
  assert.equal(sIntro.question.answer, null, 'answer must NOT be sent during intro');
  players.forEach((p) => p.sock.emit('player:buzz', { roundId: sIntro.roundId })); // too early!
  const s1 = await opened;
  assert.equal(game.buzz, null, 'buzzes during the "get ready" intro are ignored');
  assert.equal(s1.question.answer, null, 'answer must NOT be sent while buzzers are open');
  pass('Next question plays the first question; early buzzes ignored');

  // ---- Everybody buzzes at once, each one taps 3 times (double-tap test) ----
  for (const p of players) {
    for (let t = 0; t < 3; t++) p.sock.emit('player:buzz', { roundId: s1.roundId });
  }
  await wait(500);

  assert.equal(game.phase, 'buzzed');
  assert.ok(game.buzz, 'there must be a winner');
  for (const p of players) assert.equal(p.buzzed(), 1, 'every phone gets exactly ONE buzzed event');
  const firstWinner = game.buzz.groupId;
  pass(`${PLAYERS * 3} simultaneous taps -> exactly 1 winner: ${game.buzz.name} (${firstWinner})`);

  // ---- Host says Wrong: -5, answer shown, game moves on (no second chance) ----
  const afterWrong = waitForState(players[0].sock, (s) => s.phase === 'reveal');
  await ask(host, 'host:wrong');
  const s2 = await afterWrong;
  assert.equal(game.groups.find((g) => g.id === firstWinner).score, -5, 'wrong answer costs 5 points');
  assert.equal(s2.lastWrong.groupId, firstWinner);
  assert.equal(s2.question.answer, 'Five days', 'answer is shown after a wrong answer');
  players.forEach((p) => p.sock.emit('player:buzz', { roundId: s1.roundId })); // late taps
  await wait(200);
  assert.equal(game.phase, 'reveal', 'nobody can buzz after a wrong answer');
  pass('"Wrong" costs 5 points, shows the answer and moves on');

  // ---- Host picks a specific question from the list (the 3rd one) ----
  const hard = game.questions[2];
  const openHard = waitForState(players[0].sock, (s) => s.phase === 'open' && s.question && s.question.id === hard.id);
  assert.equal((await ask(host, 'host:pick', { questionId: hard.id })).ok, true, 'can pick straight from the reveal');
  const s3open = await openHard;
  assert.equal(s3open.question.points, 10, 'every question is worth 10');
  pass('host can pick a specific question from the list');

  // ---- Correct: gives the question's points (10), answer revealed ----
  players[2].sock.emit('player:buzz', { roundId: s3open.roundId });
  await wait(200);
  const winner2 = game.buzz.groupId;
  const before = game.groups.find((g) => g.id === winner2).score;
  const revealed = waitForState(players[0].sock, (s) => s.phase === 'reveal');
  await ask(host, 'host:correct');
  const s3 = await revealed;
  assert.equal(s3.question.answer, 'Bhai Tika', 'answer is sent once revealed');
  assert.equal(game.groups.find((g) => g.id === winner2).score, before + 10);
  assert.equal(s3.lastAward.points, 10);
  assert.equal(s3.lastWrong, null);
  pass("correct answer gives the question's points and reveals the answer");

  // ---- Next question skips played ones: plays question 2 (1 and 3 are done) ----
  const intro2 = waitForState(players[0].sock, (s) => s.phase === 'intro');
  await ask(host, 'host:pick');
  const sQ2 = await intro2;
  assert.equal(sQ2.question.text, 'On which day of Tihar are dogs worshipped?');
  assert.equal(sQ2.used, 3);
  await ask(host, 'host:next'); // skip intro -> open
  await ask(host, 'host:next'); // reveal
  await ask(host, 'host:next'); // back to board
  assert.equal(game.phase, 'board');
  game.questions.forEach((q) => { q.used = true; });
  const empty = await ask(host, 'host:pick');
  assert.equal(empty.ok, false, 'Next question is refused when all are played');
  game.questions.forEach((q, i) => { q.used = i < 3; });
  pass('Next question plays the next unplayed one; refused when none left');

  // ---- A player reloads (disconnect + reconnect with same id) ----
  players[0].sock.close();
  await wait(100);
  const again = open();
  const rejoin = await new Promise((r) => again.emit('player:join',
    { playerId: 'id-0', name: 'Someone Else', groupId: groupIds[3] }, r));
  assert.equal(rejoin.ok, true);
  assert.equal(rejoin.player.name, 'Player 0', 'rejoin keeps original name');
  assert.equal(rejoin.player.groupId, players[0].groupId, 'rejoin cannot switch group');
  pass('reconnecting player keeps name and team');

  // ---- Host resets, then uploads a 2-column questions CSV (A = question, B = answer) ----
  await ask(host, 'host:reset');
  assert.equal(game.groups.every((g) => g.score === 0), true, 'reset clears scores');
  assert.equal(game.questions.every((q) => !q.used), true, 'reset marks all questions unplayed');
  const up = await ask(host, 'host:upload', {
    kind: 'questions', fileName: 'q.csv',
    text: 'New Q?,New A\nQ2,A2\nQ3,A3\n',
  });
  assert.equal(up.ok, true, up.messages.join(' '));
  assert.equal(game.questions.length, 3, 'no header row needed');
  assert.equal(game.questions[0].answer, 'New A');
  assert.equal(game.questions[1].points, 10, 'every question = 10 points');
  const badUp = await ask(host, 'host:upload', { kind: 'groups', text: 'name\nOnlyOne\n' });
  assert.equal(badUp.ok, false, 'a single group is rejected');
  pass('2-column CSV upload works, bad CSV is rejected without breaking the game');

  // ---- The answer never leaks before reveal ----
  await ask(host, 'host:start');
  const leak = waitForState(again, (s) => s.phase === 'open');
  await ask(host, 'host:pick');
  const s4 = await leak;
  assert.equal(s4.question.text, 'New Q?');
  assert.equal(JSON.stringify(s4).includes('New A'), false, 'answer must not be in the public state');
  pass('answer is not sent to players/screen while the question is open');

  console.log('\nAll tests passed.');
  process.exit(0);
}

main().catch((err) => { console.error('TEST FAILED:', err.message); process.exit(1); });
setTimeout(() => { console.error('TEST TIMED OUT'); process.exit(1); }, 20000);
