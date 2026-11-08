// theme.js — shared look & feel helpers used by all three pages.
//   • fills in the event title / subtitle / logo from the server (/api/config)
//   • draws the Nepali prayer flags (still, no animation)

const Theme = (() => {
  // Lungta prayer-flag colours, always in this order: blue, white, red, green, yellow
  const FLAG_COLORS = ['#1E5BB8', '#F4F1E8', '#D62828', '#2A9D4B', '#F4C430'];
  let config = { title: 'Katti Garo', subtitle: '', logo: null, joinUrl: '' };

  async function load() {
    try { config = await (await fetch('/api/config')).json(); } catch { /* keep defaults */ }
    document.querySelectorAll('[data-title]').forEach((el) => { el.textContent = config.title; });
    document.querySelectorAll('[data-subtitle]').forEach((el) => { el.textContent = config.subtitle; });
    document.querySelectorAll('[data-logo]').forEach((el) => {
      el.innerHTML = '';
      if (config.logo) {
        const img = document.createElement('img');
        img.src = config.logo;
        img.alt = 'logo';
        el.appendChild(img);
      } else {
        el.textContent = 'NSA'; // no logo file yet -> gold "NSA" badge
      }
    });
    if (config.title) document.title = `${config.title} — ${document.title}`;
    return config;
  }

  // Fill every <div class="flags"> with little flags
  function flags() {
    document.querySelectorAll('.flags').forEach((el) => {
      const count = Math.max(10, Math.round(el.clientWidth / 38));
      el.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const s = document.createElement('span');
        s.style.background = FLAG_COLORS[i % 5];
        el.appendChild(s);
      }
    });
  }
  window.addEventListener('resize', flags);
  document.addEventListener('DOMContentLoaded', flags);

  return { load, flags, get config() { return config; } };
})();
