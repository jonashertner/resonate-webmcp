// visible.mjs — the words a reader can actually see, and the em-dash gate.
//
// The gate used to be a grep over seven documents. Most of this app's copy is
// not in a document: every toast, every question the app asks, the poster
// bodies, the printed sheet and the rescue page are strings inside js/*.js, and
// a plain grep over those files fires on the first line of every module,
// because the comments here are written in prose and prose uses the dash. So
// the gate could see the seven files where an em-dash was least likely and none
// of the files where the next one will actually appear.
//
// The rule that holds is not about which files but about which characters. In a
// module the words a reader can see are the string literals and the text of
// template literals, and nothing else: a comment is addressed to the next
// person to read the code, a regular expression is a pattern rather than a
// sentence, and an em-dash anywhere else in a module is a syntax error that
// `node --check` refuses before this gate is ever reached. So the scan blanks
// the comments and the regular expressions, and reads everything that is left.
// On a page it blanks the markup comments. In a document, where every character
// was written to be read, it blanks nothing.
//
// Blanking rather than deleting, so a line number still means what it says.
//
// The scanner is a small one and it has to be exactly right about three shapes
// this codebase really contains: a regular expression holding a quote
// (`/[&<>"']/g`, in this same directory's neighbour), a string holding two
// slashes (every https:// in the app), and a template literal whose
// substitution holds another template literal, which is most of the interface.
// A fourth is `return /[",\n]/.test(t)`, where a slash after a keyword begins a
// pattern and a slash after a name divides. All four are pinned in the tests.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// after one of these a slash begins a pattern; after a name or a number it
// divides. this is the whole of the ambiguity, and the list is the answer.
const KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

const NAME = /[A-Za-z0-9_$]/;

// what stands before a slash decides what the slash is. a value ends in a name
// character, a closing bracket or a closing parenthesis, and a value is divided
// rather than matched. everything else opens a pattern.
function patternMayStart(prev, word) {
  if (!prev) return true;
  if (NAME.test(prev)) return KEYWORDS.has(word);
  return !/[)\]]/.test(prev);
}

// kind is 'js', 'html' or 'md'. what comes back is the same text, the same
// length and the same lines, with everything a reader cannot see replaced by
// spaces.
//
// With `speech`, a module is reduced further, to the contents of its strings
// and the text of its templates, and the code between them is blanked too.
// The em-dash rule does not need that: an em-dash cannot hide inside an
// identifier. A word can. A record here carries a field called `sample`, which
// is how a person can clear what they never touched, and no reader ever sees
// it; a rule that forbids the word on the surface must not fire on the field.
export function visible(source, kind, { speech = false } = {}) {
  const src = String(source == null ? '' : source);
  if (kind === 'md') return src;

  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // code, which only the speech scan blanks
  const hush = (a, b) => { if (speech) blank(a, b); };

  if (kind === 'html') {
    // a markup comment is the only thing in a page a browser will not show. an
    // unclosed one swallows the rest of the file, here as in the browser.
    for (const m of src.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
      blank(m.index, m.index + m[0].length);
    }
    return out.join('');
  }

  let i = 0;
  let mode = 'code';
  let prev = '';        // the last character of code that was not whitespace
  let word = '';        // and the whole of it, when it was a name
  let inClass = false;  // inside [...] of a pattern, where a slash is a slash
  const substitutions = [];  // the brace depth each open ${ was found at
  let depth = 0;

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (mode === 'code') {
      if (c === '/' && d === '/') {
        let j = i;
        while (j < n && src[j] !== '\n') j += 1;
        blank(i, j);
        i = j;
        continue;
      }
      if (c === '/' && d === '*') {
        let j = i + 2;
        while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
        j = Math.min(n, j + 2);
        blank(i, j);
        i = j;
        continue;
      }
      if (c === "'" || c === '"') {
        // the contents stand: this is the copy the gate exists for
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') j += (src[j] === '\\' ? 2 : 1);
        hush(i, i + 1); hush(Math.min(n, j), Math.min(n, j + 1));
        i = Math.min(n, j + 1);
        prev = 'x'; word = '';
        continue;
      }
      if (c === '`') { hush(i, i + 1); mode = 'template'; i += 1; continue; }
      if (c === '/' && patternMayStart(prev, word)) {
        mode = 'pattern'; inClass = false;
        blank(i, i + 1);
        i += 1;
        continue;
      }
      if (c === '{') { hush(i, i + 1); depth += 1; prev = c; word = ''; i += 1; continue; }
      if (c === '}') {
        hush(i, i + 1);
        if (substitutions.length && depth === substitutions[substitutions.length - 1]) {
          substitutions.pop();
          mode = 'template';
          i += 1;
          continue;
        }
        depth -= 1; prev = c; word = ''; i += 1;
        continue;
      }
      if (NAME.test(c)) {
        let j = i;
        while (j < n && NAME.test(src[j])) j += 1;
        word = src.slice(i, j);
        prev = src[j - 1];
        hush(i, j);
        i = j;
        continue;
      }
      if (!/\s/.test(c)) { prev = c; word = ''; }
      hush(i, i + 1);
      i += 1;
      continue;
    }

    if (mode === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { hush(i, i + 1); mode = 'code'; prev = 'x'; word = ''; i += 1; continue; }
      if (c === '$' && d === '{') {
        substitutions.push(depth);
        hush(i, i + 2);
        mode = 'code'; prev = ''; word = '';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // a pattern. it ends at an unescaped slash outside a character class, and
    // it cannot cross a line: a newline here means the slash was something else
    // after all, so the scan returns to code rather than eating the file.
    if (c === '\\') { blank(i, i + 2); i += 2; continue; }
    if (c === '\n') { mode = 'code'; prev = 'x'; word = ''; i += 1; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      let j = i + 1;
      while (j < n && /[a-z]/.test(src[j])) j += 1;
      blank(i, j);
      i = j;
      mode = 'code'; prev = 'x'; word = '';
      continue;
    }
    blank(i, i + 1);
    i += 1;
  }

  return out.join('');
}

// Every surface a person reads, and how to read it. The modules are listed by
// asking the directory rather than by name, so a module written tomorrow is
// covered the day it is written and not the day somebody remembers this file.
export function surfaces() {
  const modules = readdirSync(join(root, 'js'))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => [`js/${f}`, 'js']);
  return [
    ['index.html', 'html'],
    ['read.html', 'html'],
    ...modules,
    ['sw.js', 'js'],
    ['README.md', 'md'],
    ['SECURITY.md', 'md'],
    ['ASSISTANT-ACCESS.md', 'md'],
    ['THREATS.md', 'md'],
    ['METHOD.md', 'md'],
    ['club/SPEC.md', 'md'],
    ['TERMS.md', 'md'],
    ['PRIVACY.md', 'md'],
    ['SUPPORT.md', 'md'],
  ];
}

// the house rule: no em-dash reaches a reader, on any surface.
export function emDashes() {
  const found = [];
  for (const [file, kind] of surfaces()) {
    const text = visible(readFileSync(join(root, file), 'utf8'), kind);
    text.split('\n').forEach((line, i) => {
      if (line.includes('—')) found.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

// The second house rule, and the newer one: a surface explains itself in a
// breath.
//
// The copy here grew the way copy grows. Nothing was ever added carelessly:
// each sentence answered a real question, and a paragraph that answers five
// real questions is still a wall, and a wall is not read. The club room asked a
// person to take in four hundred and forty-one characters about what a backup
// is before pressing the one word that makes one. The measurement is what
// settled it: the working surfaces held 4,884 characters of prose across
// twenty-four blocks, and the page held rather more.
//
// A gate rather than a tidy-up, because a tidy-up is undone by the next honest
// sentence. These numbers are the longest block that survived the diet, rounded
// up by a few characters and no further, so the file cannot be added to without
// something else coming out. They are a ratchet: they come down as the copy
// improves and they never go up, and lowering one is a two-line commit that
// says what was cut.
//
// The unit is a leaf: an element of the interface with no element inside it, so
// a section is measured a paragraph at a time, the way a person meets it.
// Substitutions are blanked before counting, because their length belongs to
// the record they carry and not to the sentence around them.
//
// A block that reads two ways is counted with both of them, which is stricter
// than what any one reader meets. That is deliberate and not an oversight: a
// paragraph with three endings is three paragraphs to keep short, and the
// remedy when it will not fit is to make the branch its own block, which is
// also how it reads better.
//
// Only the two surfaces a reader meets while working are held to it. The
// documents are long-form by contract and are read on purpose; read.html is
// their frame and holds no copy of its own.
export const BREATH = { 'index.html': 510, 'js/app.js': 250 };

// A leaf holds no other block. The inner text may hold `<b>` or `<a>`, which
// are marks inside a sentence, and may hold a span, which is a phrase; it may
// not hold a paragraph, a list item or a heading, because then it is a section
// and a section is met a paragraph at a time. Written as a forbidden opening
// rather than as a skip, so that a section that fails to match here is not
// consumed and its own paragraphs are still found.
const LEAF = /<(p|div|li|span|small|h[1-6])\b[^>]*>((?:(?!<(?:p|div|li|ul|ol|h[1-6])\b)[\s\S])*?)<\/\1>/g;

// A module is read in speech: only its strings and the text of its templates.
// The plain scan is not enough here, because it leaves the code standing and
// `</p>` in bare code is a slash after `<`, which is where a pattern may begin.
// The scan would eat the closing tag and the block would vanish, which is a
// gate that goes quiet exactly where the copy is. Speech also blanks every
// substitution, which is the behaviour this rule wants anyway.
export function blocksOf(source, kind) {
  const src = visible(source, kind, { speech: kind === 'js' });
  const out = [];
  for (const m of src.matchAll(LEAF)) {
    const text = m[2]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    out.push({ line: src.slice(0, m.index).split('\n').length, text });
  }
  return out;
}

export function longWinded() {
  const found = [];
  for (const [file, bound] of Object.entries(BREATH)) {
    for (const b of blocksOf(readFileSync(join(root, file), 'utf8'),
      file.endsWith('.html') ? 'html' : 'js')) {
      if (b.text.length > bound) {
        found.push(`${file}:${b.line}  ${b.text.length} of ${bound}  ${b.text.slice(0, 70)}`);
      }
    }
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = emDashes();
  if (found.length) {
    console.error('an em-dash is in the copy a reader sees:');
    for (const line of found) console.error(`  ${line}`);
    process.exit(1);
  }
  const long = longWinded();
  if (long.length) {
    console.error('a surface explains itself at length:');
    for (const line of long) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`no em-dash on any of ${surfaces().length} surfaces`);
  console.log(`no block over its breath: ${Object.entries(BREATH)
    .map(([f, n]) => `${f} ${n}`).join(', ')}`);
}
