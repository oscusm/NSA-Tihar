// sheets.js
// ---------------------------------------------------------------
// Loads questions and groups from CSV text. The CSV can come from:
//   1. a Google Sheet tab you "Published to web" as CSV (no API key needed), or
//   2. a .csv file the host uploads from the remote page.
// ---------------------------------------------------------------

// Sounds that ship with the game (files in /public/sounds).
// A group's "sound" column can also be a full https://... link to an mp3.
const BUILT_IN_SOUNDS = ['crow', 'cow', 'ox', 'dog', 'rooster', 'goat', 'cat', 'duck', 'sheep'];
const DEFAULT_TIMER = 15;
const DEFAULT_POINTS = 10;

// ----- A small CSV parser -----
// Handles commas and new lines inside "quoted text", and "" as an escaped quote.
// Returns an array of rows, each row an array of strings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = String(text).replace(/^﻿/, ''); // strip Excel's invisible BOM character

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }   // "" -> "
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== '')); // drop empty lines
}

// Turn CSV rows into objects using the header row: { question: '...', answer: '...' }
// Headers are made lowercase with spaces -> underscores, so "Image URL" works too.
function csvToObjects(text) {
  const [header = [], ...rows] = parseCsv(text);
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

// ----- Google Drive image links -> direct image links -----
// "https://drive.google.com/file/d/ABC123/view?usp=sharing"
//   -> "https://drive.google.com/thumbnail?id=ABC123&sz=w1600"
// (The image must be shared as "Anyone with the link".)
function fixImageUrl(url) {
  if (!url) return '';
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600`;
  return url;
}

// ----- Accept almost any Google Sheet link and turn it into a CSV link -----
// Handles: "Publish to web" links (pubhtml or pub?output=csv) and normal
// /edit links (those only work if the sheet is shared "Anyone with the link").
function toCsvUrl(url) {
  url = String(url || '').trim();
  if (!url) return '';
  // "Publish to web" link: .../spreadsheets/d/e/LONG_ID/pubhtml?gid=123 -> .../pub?gid=123&output=csv
  if (/\/spreadsheets\/d\/e\/[\w-]+\/pub(html)?/.test(url)) {
    const u = new URL(url.replace('/pubhtml', '/pub'));
    u.searchParams.set('output', 'csv');
    u.searchParams.delete('widget');
    u.searchParams.delete('headers');
    return u.toString();
  }
  // Normal link: .../spreadsheets/d/ID/edit#gid=123 -> .../export?format=csv&gid=123
  const edit = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/(?:edit|view)[^#]*(?:#gid=(\d+))?/);
  if (edit && !url.includes('/d/e/')) {
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    return `https://docs.google.com/spreadsheets/d/${edit[1]}/export?format=csv&gid=${gid}`;
  }
  return url;
}

// Download a CSV from a URL (Node 18+ has fetch built in)
async function fetchCsv(url) {
  const res = await fetch(toCsvUrl(url), { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download the sheet (HTTP ${res.status}). Is it published to the web?`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('Got a web page instead of CSV. Use File → Share → Publish to web → CSV.');
  }
  return text;
}

// ----- Turn rows into clean questions / groups -----
// Each returns { items, warnings } so the host can see problems on the remote.

// Questions sheet: column A = question, column B = answer. Nothing else.
// A header row ("Question | Answer") is optional and skipped if present.
// Every question is worth DEFAULT_POINTS with a DEFAULT_TIMER countdown.
function parseQuestions(text) {
  const warnings = [];
  const items = [];
  const rows = parseCsv(text);
  const isHeader = (r) => /^(questions?|qsn|qns|q|prashna)$/i.test((r[0] || '').trim()) || /^answers?$/i.test((r[1] || '').trim());
  const start = rows.length && isHeader(rows[0]) ? 1 : 0;
  rows.slice(start).forEach((r, i) => {
    const line = i + start + 1; // row number as shown in the sheet
    const question = (r[0] || '').trim();
    const answer = (r[1] || '').trim();
    if (!question) { warnings.push(`Row ${line}: no question in column A, skipped`); return; }
    if (!answer) warnings.push(`Row ${line}: no answer in column B`);
    items.push({ question, answer, points: DEFAULT_POINTS, timer: DEFAULT_TIMER });
  });
  if (!items.length) warnings.push('No questions found. Put questions in column A and answers in column B.');
  return { items, warnings };
}

function parseGroups(text) {
  const warnings = [];
  const items = [];
  const seen = new Set();
  csvToObjects(text).forEach((r, i) => {
    const line = i + 2;
    if (!r.name) { warnings.push(`Row ${line}: no name, skipped`); return; }
    if (seen.has(r.name.toLowerCase())) { warnings.push(`Row ${line}: "${r.name}" is listed twice, skipped`); return; }
    seen.add(r.name.toLowerCase());
    const sound = (r.sound || '').trim();
    const soundKey = sound.toLowerCase();
    if (sound && !sound.startsWith('http') && !BUILT_IN_SOUNDS.includes(soundKey)) {
      warnings.push(`Row ${line}: unknown sound "${sound}" (built-in: ${BUILT_IN_SOUNDS.join(', ')}). A beep will play instead.`);
    }
    let color = r.color || '';
    if (color && !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) && !/^[a-z]+$/i.test(color)) {
      warnings.push(`Row ${line}: color "${color}" not understood, using purple`);
      color = '';
    }
    if (/^[0-9a-f]{6}$/i.test(color)) color = '#' + color;
    items.push({ name: r.name, emoji: r.emoji || '', color: color || '#6c5ce7', sound: sound.startsWith('http') ? sound : soundKey });
  });
  if (items.length < 2) warnings.push('You need at least 2 groups. The first row must be: name, emoji, color, sound');
  return { items, warnings };
}

module.exports = { DEFAULT_TIMER, DEFAULT_POINTS, parseCsv, parseQuestions, parseGroups, fetchCsv, fixImageUrl, toCsvUrl, BUILT_IN_SOUNDS };
