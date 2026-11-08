// celebrate.js — the big-screen party when a team answers correctly.
// ---------------------------------------------------------------
// Celebrate.run({ team, emoji, color, player, points }) — CORRECT answer, ~5 seconds:
//   • confetti + falling marigold petals in Tihar colours (drawn on a canvas)
//   • a marigold garland (sayapatri mala) that swings down across the top
//   • Tihar "stickers" popping in around the edges: diyo, marigold, Nepal flag…
//   • big "स्याबास!" (Shabash = well done!) with the team name
//
// Celebrate.wrong({ team, emoji, player, points }) — WRONG answer, ~3.5 seconds:
//   • big "धत्तेरिका!" (dhattérika = "dang it!"), the screen shakes
//   • gloomy red-grey backdrop with rain falling, funny stickers 😭 🤦 💔 ❌
// Everything is built in code (no image files), so it works offline.
// To add your own sticker images later, put them in STICKER_IMAGES below.
// ---------------------------------------------------------------

const Celebrate = (() => {
  // Marigold orange/yellow, Nepal crimson + blue, lotus pink, gold
  const COLORS = ['#FF8C00', '#FFB300', '#FFD54F', '#DC143C', '#003893', '#F06292', '#FFFFFF', '#FFAB00'];
  const STICKERS = ['🪔', '🌼', '🇳🇵', '🪔', '🌸', '🌼', '✨', '🪔', '🌺', '🌼', '🇳🇵', '✨'];
  // Optional: image stickers, e.g. ['/img/stickers/diyo.png', '/img/stickers/garland.png']
  const STICKER_IMAGES = [];
  const WRONG_STICKERS = ['😭', '🤦', '💔', '❌', '🙈', '😵', '😭', '❌', '🤦', '💔', '🙈', '😵'];
  const DURATION = 5200;
  const WRONG_DURATION = 3600;
  let mode = 'correct';

  let layer, canvas, ctx, raf = 0, hideTimer = 0, parts = [];

  function build() {
    layer = document.createElement('div');
    layer.className = 'celebrate hidden';
    layer.innerHTML = `
      <canvas class="cel-canvas"></canvas>
      <div class="cel-garland"></div>
      <div class="cel-stickers"></div>
      <div class="cel-text">
        <div class="cel-nep"></div>
        <div class="cel-team display"></div>
        <div class="cel-sub"></div>
      </div>`;
    document.body.appendChild(layer);
    canvas = layer.querySelector('.cel-canvas');
    ctx = canvas.getContext('2d');

    // Garland: two swags of marigold flowers, alternating orange and yellow
    const g = layer.querySelector('.cel-garland');
    const N = 44;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);                       // 0..1 across the screen
      const swag = Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5; // two dips
      const f = document.createElement('span');
      f.className = 'cel-flower' + (i % 3 === 2 ? ' red' : i % 2 ? ' yellow' : '');
      f.style.left = `${t * 100}%`;
      f.style.top = `${swag * 9}vh`;
      g.appendChild(f);
    }
    // Hanging tassels (jhalar) from the lowest points
    [0.25, 0.75].forEach((x) => {
      const tassel = document.createElement('span');
      tassel.className = 'cel-tassel';
      tassel.style.left = `${x * 100}%`;
      g.appendChild(tassel);
    });
  }

  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  }

  // ----- Confetti + petals -----
  function burst() {
    const W = canvas.width, H = canvas.height, s = devicePixelRatio;
    if (mode === 'wrong') { // gloomy rain instead of confetti
      for (let i = 0; i < 220; i++) {
        parts.push({ x: Math.random() * W * 1.1, y: -Math.random() * H, vx: -1.5 * s, vy: (14 + Math.random() * 8) * s,
          w: 2 * s, h: (18 + Math.random() * 22) * s, color: 'rgba(170,190,220,0.55)', rain: true, rot: 0.1, vr: 0, sway: 0 });
      }
      return;
    }
    // two cannons from the bottom corners + a gentle rain from the top
    for (let i = 0; i < 160; i++) {
      const left = i % 2 === 0;
      parts.push({
        x: left ? W * 0.05 : W * 0.95, y: H * 0.95,
        vx: (left ? 1 : -1) * (6 + Math.random() * 12) * s,
        vy: -(14 + Math.random() * 16) * s,
        ...piece(s),
      });
    }
    for (let i = 0; i < 120; i++) {
      parts.push({ x: Math.random() * W, y: -Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 2 * s, vy: (1 + Math.random() * 3) * s, ...piece(s) });
    }
  }
  function piece(s) {
    const petal = Math.random() < 0.4; // marigold petals: rounder, orange/yellow
    return {
      w: (petal ? 9 : 7 + Math.random() * 7) * s,
      h: (petal ? 13 : 4 + Math.random() * 6) * s,
      color: petal ? COLORS[Math.floor(Math.random() * 3)] : COLORS[Math.floor(Math.random() * COLORS.length)],
      petal,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      sway: Math.random() * Math.PI * 2,
    };
  }
  function tick() {
    const s = devicePixelRatio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      if (p.rain) { // straight, fast streaks
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(0, 0, p.w, p.h); ctx.restore();
        return;
      }
      p.vy += 0.32 * s;                 // gravity
      p.vx *= 0.985; p.vy *= 0.985;     // air
      p.sway += 0.08;
      p.x += p.vx + Math.sin(p.sway) * 0.8 * s;
      p.y += Math.min(p.vy, 7 * s);     // flutter down slowly
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.petal) { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.scale(1, Math.cos(p.sway)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      ctx.restore();
    });
    parts = parts.filter((p) => p.y < canvas.height + 40);
    if (parts.length) raf = requestAnimationFrame(tick);
  }

  // ----- Stickers around the edges (never over the middle text) -----
  function stickers() {
    const box = layer.querySelector('.cel-stickers');
    box.innerHTML = '';
    const spots = [
      [6, 22], [92, 22], [4, 50], [95, 50], [7, 80], [91, 80],
      [22, 86], [78, 86], [18, 30], [82, 30], [35, 90], [65, 90],
    ];
    spots.forEach(([x, y], i) => {
      const el = document.createElement('div');
      el.className = 'cel-sticker';
      const img = STICKER_IMAGES.length && i % 2 ? STICKER_IMAGES[i % STICKER_IMAGES.length] : null;
      if (img) el.innerHTML = `<img src="${img}" alt="">`;
      else el.textContent = (mode === 'wrong' ? WRONG_STICKERS : STICKERS)[i % STICKERS.length];
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.setProperty('--tilt', `${(Math.random() - 0.5) * 36}deg`);
      el.style.animationDelay = `${0.15 + i * 0.07}s`;
      box.appendChild(el);
    });
  }

  function run(opts = {}) { show('correct', opts); }
  function wrong(opts = {}) { show('wrong', opts); }

  function show(kind, { team = '', emoji = '', color = '#FFAB00', player = '', points = 0 } = {}) {
    if (!layer) { build(); addEventListener('resize', () => layer && resize()); }
    mode = kind;
    resize();
    layer.classList.toggle('is-wrong', mode === 'wrong');
    layer.style.setProperty('--team', mode === 'wrong' ? '#8B1E2B' : color);
    layer.querySelector('.cel-nep').textContent = mode === 'wrong' ? 'धत्तेरिका!' : 'स्याबास!';
    layer.querySelector('.cel-team').textContent = `${emoji} ${team}`.trim();
    layer.querySelector('.cel-sub').textContent = mode === 'wrong'
      ? [player && `${player} got it wrong`, points && `${points} points`].filter(Boolean).join('  ·  ')
      : [player && `well done ${player}`, points && `+${points} points`].filter(Boolean).join('  ·  ');
    // shake the whole game screen on a wrong answer
    const stage = document.querySelector('.stage');
    if (stage) { stage.classList.remove('cel-shake'); void stage.offsetWidth; if (mode === 'wrong') stage.classList.add('cel-shake'); }
    stickers();
    // restart the CSS animations
    layer.classList.add('hidden');
    void layer.offsetWidth;
    layer.classList.remove('hidden', 'leaving');
    parts = [];
    burst();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      layer.classList.add('leaving');
      hideTimer = setTimeout(() => { layer.classList.add('hidden'); cancelAnimationFrame(raf); parts = []; }, 600);
    }, mode === 'wrong' ? WRONG_DURATION : DURATION);
  }

  function stop() {
    if (!layer) return;
    clearTimeout(hideTimer);
    cancelAnimationFrame(raf);
    parts = [];
    layer.classList.add('hidden');
  }

  return { run, wrong, stop };
})();
