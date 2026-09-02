// visible.test.mjs — the scanner that decides what a reader can see.
//
// The em-dash gate is only as honest as this. If the scanner blanks too much,
// a dash walks into a toast and nothing says so; if it blanks too little, the
// gate fires on the first line of every module in this repository, because the
// comments here are prose and prose uses the dash. Either way somebody turns
// the gate off, which is how the old one came to be a grep over the seven files
// where an em-dash was least likely to appear.
//
// So the shapes this codebase really contains are pinned here by hand, and the
// real modules are run through underneath them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { visible, surfaces, emDashes } from '../tools/visible.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const DASH = '—';
const sees = (src, kind = 'js') => visible(src, kind).includes(DASH);

test('a comment is written for the next programmer, not for a reader', () => {
  assert.equal(sees(`const a = 1; // a dash ${DASH} here\n`), false);
  assert.equal(sees(`/* a dash ${DASH} here */\nconst a = 1;\n`), false);
  assert.equal(sees(`//\n// a dash ${DASH} here\n//\n`), false);
});

test('a string is copy, wherever it stands', () => {
  assert.equal(sees(`const s = 'a ${DASH} b';\n`), true);
  assert.equal(sees(`const s = "a ${DASH} b";\n`), true);
  assert.equal(sees('const s = `a ' + DASH + ' b`;\n'), true);
});

test('a string holding two slashes is a string and not a comment', () => {
  // every https:// in the app is this shape. a gate that stops at the first
  // pair of slashes on the line reads none of the sentence that follows.
  assert.equal(sees(`const u = 'https://example.com/x ${DASH} y';\n`), true);
  assert.equal(sees(`const u = 'https://example.com/x'; // ${DASH}\n`), false);
});

test('a pattern holding a quote does not swallow the copy after it', () => {
  // js/marks.js opens with exactly this, and a scanner that reads the quote
  // inside it as the start of a string is lost for the rest of the file
  const src = `const esc = (s) => s.replace(/[&<>"']/g, c => c);\nconst say = 'a ${DASH} b';\n`;
  assert.equal(sees(src), true);
});

test('a slash after a keyword opens a pattern, and after a name divides', () => {
  // js/store.js: return /[",\n]/.test(t) ? ... , two lines from a string
  assert.equal(sees(`function f(t) { return /[",\\n]/.test(t) ? 'a ${DASH} b' : t; }\n`), true);
  assert.equal(sees(`const half = total / 2;\nconst s = 'a ${DASH} b';\n`), true);
  assert.equal(sees(`const r = Math.PI / 180;\nconst s = 'a ${DASH} b';\n`), true);
});

test('a template inside a substitution inside a template is still copy', () => {
  // most of the interface is built this way
  const src = 'const h = `<p>${on ? `a ' + DASH + ' b` : `c`}</p>`;\n';
  assert.equal(sees(src), true);
});

test('a pattern is not a sentence', () => {
  // a rule that strips the dash from what someone typed is the opposite of a
  // violation, and it must not be read as one
  assert.equal(sees(`const tidy = (s) => s.replace(/${DASH}/g, ', ');\n`), false);
});

test('a line still means what it says', () => {
  const src = `// ${DASH}\nconst s = 'a ${DASH} b';\n`;
  const out = visible(src, 'js');
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').findIndex(l => l.includes(DASH)), 1);
});

test('a page shows everything except its markup comments', () => {
  assert.equal(sees(`<!-- a dash ${DASH} here -->\n<p>hello</p>\n`, 'html'), false);
  assert.equal(sees(`<p>a ${DASH} b</p>\n`, 'html'), true);
  assert.equal(sees(`<button aria-label="a ${DASH} b">x</button>\n`, 'html'), true);
});

test('a document was written to be read, all of it', () => {
  assert.equal(sees(`A sentence ${DASH} and its second half.\n`, 'md'), true);
});

test('the real modules keep their copy and lose their comments', () => {
  const marks = visible(read('js/marks.js'), 'js');
  assert.equal(marks.includes('the documents, set in type'), false,
    'a comment survived into what a reader is said to see');
  assert.ok(marks.includes('&amp;'), 'a string was blanked with the comments');

  const app = visible(read('js/app.js'), 'js');
  assert.ok(app.includes('press to ask openstreetmap where this is'),
    'a toast was blanked with the comments');
  assert.equal(app.includes('the hue engine'), false);
});

test('every surface a person reads is scanned, and the modules are counted', () => {
  const files = surfaces().map(([f]) => f);
  for (const wanted of ['index.html', 'read.html', 'js/app.js', 'js/club.js',
    'js/marks.js', 'js/read.js', 'sw.js', 'club/SPEC.md', 'SUPPORT.md']) {
    assert.ok(files.includes(wanted), `${wanted} is not scanned`);
  }
  // the modules are listed by asking the directory, so a module written
  // tomorrow is covered the day it is written
  assert.ok(files.filter(f => f.startsWith('js/')).length >= 14);
  assert.deepEqual(emDashes(), []);
});
