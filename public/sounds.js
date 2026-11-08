// sounds.js — shared by the big screen and the phones.
// ---------------------------------------------------------------
// Every sound in the game is a file you can replace:
//
//   public/sounds/<name>.mp3          group sounds (crow, cow, dog, ox, …)
//   public/sounds/effects/<name>.mp3  game effects (correct, wrong, tick, …)
//   public/sounds/music/<name>.mp3    looping background music (lobby, board)
//
// If a group/effect file is missing, a synthesized sound plays instead,
// so the game never goes silent. Missing music = no music (that's fine).
//
// Browsers block sound until the user taps/clicks once. Call
// Sounds.unlock() inside a tap or click handler.
// ---------------------------------------------------------------

const Sounds = (() => {
  let ctx = null;              // the AudioContext (created on first use)
  let master = null;           // master volume
  const cache = new Map();     // url -> Promise<AudioBuffer | null>
  let musicNode = null;        // the currently looping music
  let musicName = null;
  let musicGain = null;
  let musicMuted = false;
  // Background music level, set by the host's slider (0-100 %). Effects play at 0.7.
  // 100 % = 0.4 gain, so even "full" music stays under the effects. Default 20 % = 0.08.
  const MUSIC_MAX = 0.4;
  let musicLevel = 0.2 * MUSIC_MAX;
  const musicVolume = () => (musicMuted ? 0 : musicLevel);
  function setMusicPercent(pct) {
    musicLevel = (Math.min(100, Math.max(0, Number(pct) || 0)) / 100) * MUSIC_MAX;
    if (musicGain && ctx) musicGain.gain.setTargetAtTime(musicVolume(), ctx.currentTime, 0.1);
  }

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  // Must be called from a user gesture (tap/click)
  function unlock() {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    // Playing a tiny silent sound "wakes up" audio on older iPhones
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  }
  const isUnlocked = () => !!ctx && ctx.state === 'running';

  // Download + decode a sound file once, then reuse it. null = missing.
  function load(url) {
    if (!cache.has(url)) {
      const p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
        // the callback form of decodeAudioData works on old Safari too
        .then((data) => new Promise((ok, fail) => getCtx().decodeAudioData(data, ok, fail)))
        .catch(() => null);
      cache.set(url, p);
    }
    return cache.get(url);
  }
  const groupUrl = (name) => (name.startsWith('http') ? name : `/sounds/${encodeURIComponent(name)}.mp3`);
  const effectUrl = (name) => `/sounds/effects/${name}.mp3`;
  const musicUrl = (name) => `/sounds/music/${name}.mp3`;

  function playBuffer(buffer, volume = 1) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain).connect(master);
    src.start();
    return src;
  }

  // Start downloading sounds early so they play instantly.
  function preload(groupSounds = [], effects = []) {
    if (!getCtx()) return;
    groupSounds.filter(Boolean).forEach((n) => load(groupUrl(n)));
    effects.forEach((n) => load(effectUrl(n)));
  }

  // Play a group's sound by name ("dog", "cow", or a full https link)
  async function play(name) {
    if (!getCtx() || !name) return;
    if (ctx.state === 'suspended') ctx.resume();
    const buffer = await load(groupUrl(name));
    if (buffer) playBuffer(buffer);
    else (ANIMALS[name] || SYNTH.chime)();
  }

  // Play a game effect: correct, wrong, tick, open, timeup, intro, reveal, winner, join
  async function effect(name) {
    if (!getCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const buffer = await load(effectUrl(name));
    if (buffer) playBuffer(buffer, 0.7); // effects a bit quieter than team sounds
    else if (SYNTH[name]) SYNTH[name]();
  }

  // Loop background music ('lobby', 'board') or stop it (null). Fades smoothly.
  async function music(name) {
    if (!getCtx() || name === musicName) return;
    musicName = name;
    // fade out the old track
    if (musicNode) {
      const old = musicNode, oldGain = musicGain;
      oldGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => { try { old.stop(); } catch { /* already stopped */ } }, 2000);
      musicNode = null;
    }
    if (!name) return;
    const buffer = await load(musicUrl(name));
    if (!buffer || musicName !== name) return; // missing file, or changed while loading
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.gain.setTargetAtTime(musicVolume(), ctx.currentTime, 0.5);
    musicNode = ctx.createBufferSource();
    musicNode.buffer = buffer;
    musicNode.loop = true;
    musicNode.connect(musicGain).connect(master);
    musicNode.start();
  }
  function toggleMusic() {
    musicMuted = !musicMuted;
    if (musicGain) musicGain.gain.setTargetAtTime(musicVolume(), ctx.currentTime, 0.2);
    return !musicMuted;
  }

  // ---------- Synthesized fallbacks ----------
  // One "note": an oscillator that slides between frequencies, through a filter,
  // with a quick fade in/out. Every fallback sound is built from these.
  function note({ type = 'sawtooth', freqs, start = 0, dur = 0.4, vol = 0.35, filter = 2000, vibrato = 0 }) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const lp = c.createBiquadFilter();
    osc.type = type;
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    osc.frequency.setValueAtTime(freqs[0], t0);
    freqs.slice(1).forEach((f, i) => {
      osc.frequency.linearRampToValueAtTime(f, t0 + (dur * (i + 1)) / (freqs.length - 1));
    });
    if (vibrato) { // wobble, for goat / sheep "baaa"
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = vibrato;
      depth.gain.value = freqs[0] * 0.06;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
    gain.gain.setValueAtTime(vol, t0 + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp).connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  const tone = (f, start, dur, vol = 0.35, type = 'triangle') => note({ type, freqs: [f, f], start, dur, vol, filter: 6000 });

  const ANIMALS = {
    cow:     () => note({ freqs: [140, 130, 110], dur: 1.3, filter: 900 }),
    ox:      () => note({ freqs: [100, 95, 80], dur: 1.4, filter: 700, vol: 0.45 }),
    dog:     () => { note({ type: 'square', freqs: [500, 300], dur: 0.15, filter: 1500 });
                     note({ type: 'square', freqs: [520, 320], dur: 0.15, start: 0.25, filter: 1500 }); },
    crow:    () => [0, 0.35, 0.7].forEach((s) => note({ freqs: [700, 520], dur: 0.25, start: s, filter: 2500 })),
    rooster: () => note({ freqs: [500, 800, 760, 820, 500], dur: 1.2, filter: 3000 }),
    goat:    () => note({ freqs: [420, 400], dur: 0.9, vibrato: 14, filter: 2500 }),
    sheep:   () => note({ freqs: [330, 310], dur: 0.9, vibrato: 10, filter: 2000 }),
    cat:     () => note({ type: 'triangle', freqs: [450, 900, 600], dur: 0.7, vol: 0.5 }),
    duck:    () => [0, 0.2, 0.4].forEach((s) => note({ type: 'square', freqs: [320, 260], dur: 0.14, start: s, filter: 1200 })),
  };

  const SYNTH = {
    chime:   () => { tone(880, 0, 0.3, 0.4, 'sine'); tone(1320, 0.12, 0.5, 0.3, 'sine'); },
    tick:    () => tone(1000, 0, 0.07, 0.25, 'sine'),
    open:    () => note({ type: 'sine', freqs: [660, 990], dur: 0.25, vol: 0.3 }),
    intro:   () => note({ type: 'sine', freqs: [300, 1200], dur: 0.6, vol: 0.25, filter: 4000 }),
    timeup:  () => note({ type: 'square', freqs: [220, 180], dur: 0.7, vol: 0.3, filter: 1200 }),
    correct: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.3, 0.35)),
    wrong:   () => { note({ type: 'sawtooth', freqs: [220, 200], dur: 0.25, vol: 0.3, filter: 900 });
                     note({ type: 'sawtooth', freqs: [180, 120], dur: 0.5, start: 0.25, vol: 0.3, filter: 900 }); },
    reveal:  () => { tone(784, 0, 0.18, 0.3); tone(1175, 0.15, 0.4, 0.3); },
    join:    () => note({ type: 'sine', freqs: [900, 1400], dur: 0.12, vol: 0.18 }),
    winner:  () => {
      [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45]].forEach(([f, s]) => tone(f, s, 0.35, 0.4));
      tone(1047, 0.8, 1.2, 0.4); tone(784, 0.8, 1.2, 0.25); tone(659, 0.8, 1.2, 0.2);
    },
  };

  return { unlock, isUnlocked, preload, play, effect, music, toggleMusic, setMusicPercent };
})();
