// test/sheets.js — checks the CSV reader and the Google link converters.
const assert = require('node:assert/strict');
const s = require('../sheets');

// CSV with commas, quotes and new lines inside a cell, plus Windows line endings
const rows = s.parseCsv('a,b\r\n"Hello, world","He said ""hi""\nbye"\r\n\r\n');
assert.deepEqual(rows, [['a', 'b'], ['Hello, world', 'He said "hi"\nbye']]);

// Questions: column A = question, column B = answer. Header row optional.
const q = s.parseQuestions('Question,Answer\nQ1,A1\n"Q2, with comma",A2\n,missing question\nQ4,\n');
assert.equal(q.items.length, 3, 'header skipped, row without a question skipped');
assert.deepEqual([q.items[0].question, q.items[0].answer], ['Q1', 'A1']);
assert.equal(q.items[1].question, 'Q2, with comma');
assert.equal(q.items[0].points, 10, 'every question = 10 points');
assert.equal(q.items[0].timer, 15, 'every question = 15 s');
assert.equal(q.warnings.length, 2, 'one skipped row + one missing answer');
const noHeader = s.parseQuestions('What is the capital of Nepal?,Kathmandu\nQ2,A2\n');
assert.equal(noHeader.items.length, 2, 'no header row: first row is a question');
assert.equal(noHeader.items[0].answer, 'Kathmandu');

// Drive image links still convert (used for group/logo images)
assert.equal(s.fixImageUrl('https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing'), 'https://drive.google.com/thumbnail?id=1AbC_d-9&sz=w1600');

// Groups: unknown sound gives a warning, colour without # is fixed
const g = s.parseGroups('name,emoji,color,sound\nDog,🐶,00b894,dog\nLion,🦁,orange,roar\n');
assert.equal(g.items[0].color, '#00b894');
assert.equal(g.items[1].sound, 'roar');
assert.match(g.warnings[0], /unknown sound/);

// Google link conversion
assert.equal(s.toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?gid=55&single=true'),
  'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=55&single=true&output=csv');
assert.equal(s.toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=55&single=true&output=csv'),
  'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=55&single=true&output=csv');
assert.equal(s.toCsvUrl('https://docs.google.com/spreadsheets/d/1XyZ/edit#gid=777'),
  'https://docs.google.com/spreadsheets/d/1XyZ/export?format=csv&gid=777');

console.log('  PASS  CSV parsing, 2-column questions, Drive image links and Google Sheet links all OK');
