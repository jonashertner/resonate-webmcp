// style.test.mjs — the stylesheet has to mean what it reads like.
//
// A stylesheet does not fail. It absorbs a mistake and goes on rendering
// something, and the something is plausible enough that nobody looks. Four
// of these had been shipping:
//
//   A rule opened at css/style.css:167 was never closed, so .sr-only,
//   #addConfirmStatus and #addConfirmInput became nested rules under
//   :is(.halo, .fm, .add-confirm, .map-label). The id selectors then outran
//   the class rules written for the same elements, and the field a person
//   types a place's name into rendered at 260px and 15px instead of the full
//   column at clamp(20px, 3.4vw, 30px). Measured in a browser, not inferred.
//
//   .cp-place asked for var(--line), which is declared nowhere, so the
//   declaration was invalid at computed-value time and the underline fell
//   back to currentColor: an affordance drawn in the same ink as the word.
//
//   .index-x declared padding twice, one line apart. The first has never
//   rendered.
//
//   VERBS in js/app.js held `here` twice. A duplicate key keeps its first
//   position and its last value, so the word ran standHere while the legend
//   printed it between two rows promising to mark the middle of the field.
//
// None of the four could be caught by anything else here: the browser suite
// asks whether things work, and all four of these worked. What they did not
// do is the thing the file says they do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const cssSrc = read('css/style.css');

// Comments are blanked rather than removed, so every line number this file
// reports is the line number in the file a person will open.
const css = cssSrc.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// Walk the file once and hand back every block: where it opened, what its
// prelude was, whether that prelude is an at-rule, and how deep it sat.
function blocks(text) {
  const out = [];
  const stack = [];
  let line = 1, buf = '';
  for (const ch of text) {
    if (ch === '\n') { line++; buf += ch; continue; }
    if (ch === '{') {
      const prelude = buf.trim().split('\n').pop().trim();
      const b = { line, prelude, at: prelude.startsWith('@'), depth: stack.length, props: [], parent: stack[stack.length - 1] || null };
      out.push(b); stack.push(b); buf = '';
    } else if (ch === '}') {
      if (!stack.length) { out.push({ line, prelude: '', at: false, depth: -1, props: [], parent: null, unbalanced: true }); }
      else stack.pop();
      buf = '';
    } else if (ch === ';') {
      const decl = buf.trim();
      const i = decl.indexOf(':');
      const name = i > 0 ? decl.slice(0, i).trim() : '';
      if (stack.length && /^[a-z-]+$/.test(name)) stack[stack.length - 1].props.push({ name, line });
      buf = '';
    } else buf += ch;
  }
  return { out, open: stack };
}

const { out: all, open } = blocks(css);

test('every block in the stylesheet closes, and closes where it was opened', () => {
  assert.deepEqual(
    open.map(b => `${b.prelude} (opened at css/style.css:${b.line})`), [],
    'a block was never closed. everything after it is nested inside it.');
  assert.deepEqual(
    all.filter(b => b.unbalanced).map(b => `css/style.css:${b.line}`), [],
    'a closing brace with nothing open above it');
});

// The file uses no CSS nesting at all: zero ampersands, and every rule stands
// on its own. That makes "a style rule containing another rule" an unambiguous
// signature for a brace that never closed, rather than a style choice. If this
// file ever adopts nesting on purpose, this assertion is the thing to rewrite,
// and rewriting it is a decision somebody should have to make out loud.
test('no style rule contains another rule: the file does not nest', () => {
  assert.ok(!/(^|[\s{;])&/.test(css), 'the stylesheet has started using & and this assertion needs rewriting');
  const nested = all.filter(b => b.parent && !b.parent.at);
  assert.deepEqual(
    nested.map(b => `css/style.css:${b.line} "${b.prelude}" is inside "${b.parent.prelude}" (css/style.css:${b.parent.line})`),
    [],
    'a rule is nested inside another rule, which is what a missing brace looks like');
});

// A property set from a template literal is as declared as one written here,
// and there is no way to tell from the stylesheet alone which is which. So the
// union is the truth: what the css declares, plus what the app sets on an
// element it builds.
const fromScript = new Set();
for (const p of ['js/app.js', 'js/map.js', 'js/marks.js', 'js/read.js', 'index.html', 'read.html']) {
  const src = read(p);
  for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) fromScript.add(m[1]);
  for (const m of src.matchAll(/style\s*=\s*["'`][^"'`]*?(--[a-zA-Z0-9-]+)\s*:/g)) fromScript.add(m[1]);
  for (const m of src.matchAll(/--[a-zA-Z0-9-]+(?=\s*:\s*\$\{)/g)) fromScript.add(m[0]);
}

test('every custom property the stylesheet reads is one somebody writes', () => {
  const declared = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
  const orphans = [];
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
    const [, name, next] = m;
    if (declared.has(name) || fromScript.has(name)) continue;
    const line = css.slice(0, m.index).split('\n').length;
    // A fallback is a decision. No fallback is a hole: the whole declaration
    // is invalid at computed-value time, and what renders instead is the
    // inherited value, or the initial one, and never a word about it.
    orphans.push(`css/style.css:${line} var(${name})${next === ',' ? ' (has a fallback)' : ' (no fallback)'}`);
  }
  assert.deepEqual(orphans, [], 'a custom property is read and never written');
});

test('no rule declares the same property twice', () => {
  const dupes = [];
  for (const b of all) {
    const seen = new Map();
    for (const p of b.props) {
      if (seen.has(p.name)) {
        dupes.push(`css/style.css:${p.line} "${b.prelude}" sets ${p.name} again (first at :${seen.get(p.name)})`);
      }
      seen.set(p.name, p.line);
    }
  }
  assert.deepEqual(dupes, [], 'a declaration in this block has never rendered');
});

// A short screen is allowed to buy height and scrolling; it is never allowed
// to buy silence. Ellipsis looks tidy enough to survive a visual review while
// removing the exact part of a name that distinguishes one saved place,
// person, tag, or city from another. The browser suite drives the long real
// labels through every component that once used it; this keeps a future use
// from entering through a component the sweep does not know yet.
test('the interface never substitutes an ellipsis for meaningful content', () => {
  assert.doesNotMatch(css, /text-overflow\s*:\s*ellipsis/,
    'wrap the content or give its surface a scroller; do not erase it behind an ellipsis');
  assert.doesNotMatch(css, /(?:-webkit-)?line-clamp\s*:/,
    'line clamping removes content just as surely as an ellipsis');
});

// Read as text on purpose. Evaluating the module gives an object that has
// already thrown the duplicate away, and the whole defect is that it does so
// in silence.
test('the command line has no verb defined twice', () => {
  const app = read('js/app.js');
  const start = app.indexOf('const VERBS = {');
  assert.ok(start > 0, 'VERBS is not where this test expects it');
  let depth = 0, end = start;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  const body = app.slice(start, end);
  const seen = new Map();
  const dupes = [];
  for (const m of body.matchAll(/^\s{2}([a-z][a-z0-9]*)\s*:\s*\{/gm)) {
    const line = app.slice(0, start + m.index).split('\n').length;
    if (seen.has(m[1])) dupes.push(`js/app.js:${line} \`${m[1]}\` again (first at :${seen.get(m[1])})`);
    else seen.set(m[1], line);
  }
  assert.deepEqual(dupes, [], 'one of these two definitions runs and the other only takes up a row in the legend');
  assert.ok(seen.size > 30, `only ${seen.size} verbs matched: the shape of VERBS has changed and this test is reading past it`);
});

// The close word on a board is bare type over a wash, and the wash has to
// reach both edges of the glass or it is a rectangle floating on it. It gets
// there by hanging a hundred viewport widths off each side, which is only
// not a defect because `.index` clips it: one line, in a different block,
// forty lines away from the thing that depends on it.
//
// Nothing else would catch its removal. The browser suite never scrolls a
// board sideways, so it would go on passing while the board carried two
// viewport widths of empty sideways travel on a phone. This binds the pair
// in both directions: a second bleeding decoration has to come and say so
// here, and the clip cannot leave while one exists.
test('the one thing hung off the glass sits inside the one thing that clips it', () => {
  const bleeding = [];
  for (const m of css.matchAll(/(?:left|right)\s*:\s*-\s*\d+vw/g)) {
    const line = css.slice(0, m.index).split('\n').length;
    const owner = all.filter(b => b.line <= line && !b.at).pop();
    bleeding.push(owner ? owner.prelude : `css/style.css:${line}`);
  }
  assert.deepEqual([...new Set(bleeding)], ['.index-x::before'],
    'something else now hangs off the glass, and this file has not been told who clips it');

  const at = css.indexOf('\n.index {');
  assert.ok(at > 0, '.index is not where this test expects it');
  const body = css.slice(at, css.indexOf('}', at));
  assert.match(body, /overflow-x\s*:\s*hidden/,
    'the board stopped clipping sideways, and the close word\'s wash is now scrollable emptiness');
});

// ---------- palette ----------
//
// The palette is solved from roles, but the solution used to live only in a
// comment. Quiet text is mostly ten-point mono on a map or a translucent room;
// 4.5:1 is the conformance line and not enough optical margin for that setting.
// This evaluates the declarations the stylesheet actually carries, across
// every field hue a person can choose and in both themes. A future palette may
// change every number below without changing this test; it must keep the floor.

function numberIn(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = source.match(new RegExp(`${escaped}\\s*:\\s*(-?[0-9.]+)`));
  assert.ok(found, `${name} is not declared where the palette test expects it`);
  return Number(found[1]);
}

function ruleBody(source, selector) {
  const at = source.indexOf(selector);
  assert.ok(at >= 0, `${selector} is not where the palette test expects it`);
  const open = source.indexOf('{', at), close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

function linearSrgb({ L, C, h }) {
  const angle = h * Math.PI / 180;
  const a = C * Math.cos(angle), b = C * Math.sin(angle);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(v => Math.max(0, Math.min(1, v)));
}

function luminance(rgb) { return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; }
function contrast(a, b) {
  const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
}

function mixOklch(first, second, firstWeight) {
  const secondWeight = 1 - firstWeight;
  const arc = ((second.h - first.h + 540) % 360) - 180;
  return {
    L: first.L * firstWeight + second.L * secondWeight,
    C: first.C * firstWeight + second.C * secondWeight,
    h: (first.h + arc * secondWeight + 360) % 360,
  };
}

function hexRgb(value) {
  const h = value.replace('#', '');
  const channel = i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [channel(0), channel(2), channel(4)];
}

test('quiet ink keeps an optical contrast margin in every palette', () => {
  const app = read('js/app.js');
  const tonesAt = app.indexOf('const FIELD_TONES = [');
  const tonesEnd = app.indexOf('];', tonesAt);
  const hues = [...app.slice(tonesAt, tonesEnd).matchAll(/hue:\s*(-?[0-9.]+)/g)]
    .map(m => Number(m[1]));
  assert.equal(hues.length, 8, 'the palette test did not find the eight field tones');

  const dark = ruleBody(css, ':root[data-theme="dark"]');
  const daySplit = Number(css.match(/:root\s*\{\s*--hue:\s*-?[0-9.]+;\s*--split:\s*(-?[0-9.]+)/)[1]);
  const darkSplit = numberIn(dark, '--split');
  const weightMatch = css.match(/--ink-3\s*:\s*color-mix\(in oklch,\s*var\(--ink\)\s*([0-9.]+)%/);
  assert.ok(weightMatch, '--ink-3 is no longer an oklch mix the palette test can evaluate');
  const inkWeight = Number(weightMatch[1]) / 100;

  const themes = [
    { name: 'day', source: css, split: daySplit },
    { name: 'night', source: dark, split: darkSplit },
  ];
  const quiet = [], counter = [];
  for (const theme of themes) {
    const fieldRole = { L: numberIn(theme.source, '--L-f'), C: numberIn(theme.source, '--C-f') };
    const inkRole = { L: numberIn(theme.source, '--L-i'), C: numberIn(theme.source, '--C-i') };
    const counterRole = { L: numberIn(theme.source, '--L-c'), C: numberIn(theme.source, '--C-c') };
    for (const hue of hues) {
      const field = { ...fieldRole, h: (hue + theme.split + 720) % 360 };
      const ink = { ...inkRole, h: hue };
      const other = { ...counterRole, h: (hue + 150) % 360 };
      quiet.push({ theme: theme.name, hue,
        ratio: contrast(linearSrgb(mixOklch(ink, field, inkWeight)), linearSrgb(field)) });
      counter.push({ theme: theme.name, hue,
        ratio: contrast(linearSrgb(other), linearSrgb(field)) });
    }
  }
  const quietFloor = quiet.reduce((a, b) => a.ratio < b.ratio ? a : b);
  const counterFloor = counter.reduce((a, b) => a.ratio < b.ratio ? a : b);
  assert.ok(quietFloor.ratio >= 5.1,
    `quiet ink falls to ${quietFloor.ratio.toFixed(2)}:1 in ${quietFloor.theme} at hue ${quietFloor.hue}`);
  assert.ok(counterFloor.ratio >= 6.4,
    `counter ink falls to ${counterFloor.ratio.toFixed(2)}:1 in ${counterFloor.theme} at hue ${counterFloor.hue}`);

  const fallbackAt = cssSrc.indexOf('@supports (not (color: oklch');
  const fallbackEnd = cssSrc.indexOf('\n}\n\n* {', fallbackAt);
  const fallback = cssSrc.slice(fallbackAt, fallbackEnd);
  const fallbackRules = [...fallback.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)];
  assert.equal(fallbackRules.length, 2, 'the old-browser palette no longer has two complete themes');
  for (const [i, match] of fallbackRules.entries()) {
    const role = name => {
      const value = match[1].match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
      assert.ok(value, `${name} is missing from the fallback palette`);
      return hexRgb(value[1]);
    };
    const ratio = contrast(role('--ink-3'), role('--field'));
    assert.ok(ratio >= 5.1, `${i ? 'night' : 'day'} fallback quiet ink is only ${ratio.toFixed(2)}:1`);
  }
});

// ---------- tempo ----------
//
// Easing was tokenised from the beginning and duration was not, so nineteen
// timings were picked by hand at the point of use and the `rise` keyframe ran
// at three different ones. Nothing was broken, which is the whole difficulty:
// a hand-picked 240ms renders exactly as well as a 280ms and only the
// accumulation of them is felt. So the scale needs a gate, or it decays back
// into hand-picked numbers one merge at a time.
//
// The rule is narrow on purpose. Below a second, a duration is tempo and must
// come from the scale. Above a second it is choreography, measured against a
// particular thing rather than against the rest of the app, and stays written
// where a person can see it next to the thing it is measured against. Delays
// are never constrained: a delay is a position in a stagger, not a speed.

const TEMPO = new Set(['--mo-cut', '--mo-reflex', '--mo-rise', '--mo-enter', '--mo-settle']);

// Each exception is a real timing under a second that is choreography anyway,
// and each has to say why. A name here that no longer appears in the file is
// itself a failure: a stale exception is how a gate quietly stops gating.
const NOT_TEMPO = [
  ['--hue 800ms', 'the station crossfade is ambient, not a response to anyone'],
  ['--split 500ms', 'trails the hue on purpose, and the gap is the point'],
  ['hbName 900ms', 'the third beat of the four-part heart bloom, timed to the two before it'],
  ['hbLeave 700ms', 'the fourth beat, and it leaves rather than arrives'],
  ['hbDraw 900ms', 'the first beat, and the 820ms delay on the second is measured off its end'],
  ['hbFill 700ms', 'the second beat, and it has to finish under hbBeat at 900ms'],
  ['animation-duration: 500ms', 'the brief intro mark, measured against the 600ms brief fade in js/app.js:7177'],
];

// var() may carry a time in a fallback (`var(--intro-fade, 1.4s)`), which is
// not a hand-picked duration in this rule's sense. Blank them before looking.
const noVars = css.replace(/var\([^()]*\)/g, 'var()');

function timings() {
  const out = [];
  // The longhands matter as much as the shorthands, and were where two of
  // these hid: the reduced-motion tier snapped surfaces in at 100ms one line
  // below a 120ms, and a shorthand-only sweep would never have looked.
  const re = /\b(animation|transition)(-duration)?:([^;}]*)/g;
  let m;
  while ((m = re.exec(noVars))) {
    const line = noVars.slice(0, m.index).split('\n').length;
    const longhand = !!m[2];
    for (const part of m[3].split(',')) {
      const t = part.match(/(\d*\.?\d+)(ms|s)\b/);
      if (!t) continue;
      // In a shorthand the first time is the duration and any second one is a
      // delay, so only the first is this rule's business. A var() reaching that
      // slot first is the scale doing its job, and the delay behind it is free.
      const v = part.indexOf('var()');
      if (!longhand && v >= 0 && v < t.index) continue;
      const ms = parseFloat(t[1]) * (t[2] === 's' ? 1000 : 1);
      // a longhand carries no clue on its own, so it is reported as written
      out.push({ line, ms, text: longhand ? `${m[1]}-duration: ${part.trim()}` : part.trim() });
    }
  }
  return out;
}

test('every duration under a second comes from the tempo scale', () => {
  const loose = timings()
    .filter(t => t.ms < 1000)
    .filter(t => !NOT_TEMPO.some(([needle]) => t.text.includes(needle)))
    .map(t => `css/style.css:${t.line}  ${t.text}`);
  assert.deepEqual(loose, []);
});

test('no exception is claimed for a timing that is no longer in the file', () => {
  const stale = NOT_TEMPO.filter(([needle]) => !noVars.includes(needle)).map(([n]) => n);
  assert.deepEqual(stale, []);
});

test('the tempo scale is declared, ordered, and every step of it is used', () => {
  const declared = [...cssSrc.matchAll(/^\s*(--mo-[a-z]+):\s*(\d+)ms;/gm)]
    .map(m => [m[1], Number(m[2])]);
  assert.deepEqual(new Set(declared.map(d => d[0])), TEMPO);
  // a scale whose steps are not in order is a list
  const ms = declared.map(d => d[1]);
  assert.deepEqual(ms, [...ms].sort((a, b) => a - b), `out of order: ${ms}`);
  // and a step nobody reaches for is one somebody will invent a number beside
  for (const [name] of declared) {
    assert.ok(css.includes(`var(${name})`), `${name} is declared and never used`);
  }
});

test('interactive surfaces finish promptly and mobile rooms do no hidden compositing', () => {
  const declared = new Map([...cssSrc.matchAll(/^\s*(--mo-[a-z]+):\s*(\d+)ms;/gm)]
    .map(m => [m[1], Number(m[2])]));
  assert.ok(Math.max(...declared.values()) <= 500,
    `interactive motion runs for ${Math.max(...declared.values())}ms before it rests`);
  assert.match(cssSrc, /\.poster-word::after, \.index-count::after\s*\{[\s\S]*?animation:\s*underline-greet var\(--mo-settle\)/,
    'the repeated surface signature escaped the interaction tempo');
  assert.match(cssSrc, /\.index\.opening \.ix\s*\{[\s\S]*?animation:\s*rise var\(--mo-rise\)/,
    'atlas rows take the full surface tempo to arrive');
  assert.match(cssSrc,
    /@media \(max-width: 1024px\), \(hover: none\) and \(pointer: coarse\)\s*\{[\s\S]*?\.cmd, \.index, \.poster, \.report\s*\{[\s\S]*?backdrop-filter:\s*none/,
    'a handheld full-screen room still composites the live map beneath it');
  assert.doesNotMatch(cssSrc, /animation-timeline:\s*scroll|@keyframes\s+(?:poster-yield|head-tighten)/,
    'a poster title still changes layout on every scroll frame');
});

// ---------- reduced motion, actually reduced ----------
//
// `@media (prefers-reduced-motion: reduce) { .toast, .hand-bar { animation:
// none; } }` sat four lines above .hand-bar's own rule. A media query adds no
// specificity, so the later rule won and the bar went on rising for everyone
// who had asked their device to stop it. The toast, written 600 lines earlier,
// was quietly fine, which is why the pair looked correct: half of it was.
//
// Nothing else here could catch it. The declaration is valid, the selector is
// right, the intent is legible, and the browser suite runs with motion allowed.
// It is only wrong in the order it appears in the file.

const ANIM = /^animation(-name)?\s*:\s*(.+)$/s;

// Every rule with its declarations as written, and whether any at-rule above
// it asks for reduced motion.
function rules(text) {
  const out = [];
  const stack = [];
  let line = 1, buf = '';
  for (const ch of text) {
    if (ch === '\n') { line++; buf += ch; continue; }
    if (ch === '{') {
      const prelude = buf.trim().split('\n').pop().trim();
      stack.push({ prelude, at: prelude.startsWith('@'), line, decls: [] });
      buf = '';
    } else if (ch === '}' || ch === ';') {
      const top = stack[stack.length - 1];
      const decl = buf.trim();
      if (top && !top.at && decl.includes(':')) top.decls.push({ decl, line });
      if (ch === '}') {
        const done = stack.pop();
        if (done && !done.at) {
          out.push({ ...done, reduce: stack.some(s => /prefers-reduced-motion:\s*reduce/.test(s.prelude)) });
        }
      }
      buf = '';
    } else buf += ch;
  }
  return out;
}

test('a reduced-motion rule that stops an animation is not undone by the rule it stops', () => {
  const stops = [], starts = [];
  for (const r of rules(css)) {
    for (const sel of r.prelude.split(',').map(s => s.trim()).filter(Boolean)) {
      for (const { decl, line } of r.decls) {
        const m = decl.match(ANIM);
        if (!m) continue;
        const value = m[2].trim();
        const off = /^none\b/.test(value);
        // !important outranks source order, so a rule that carries it is safe
        // wherever it is written
        if (r.reduce && off) { if (!/!important/.test(value)) stops.push({ sel, line }); }
        else if (!off) starts.push({ sel, line });
      }
    }
  }
  const undone = [];
  for (const s of stops) {
    for (const a of starts) {
      if (a.sel === s.sel && a.line > s.line) {
        undone.push(`css/style.css:${s.line} stops ${s.sel}, then css/style.css:${a.line} starts it again`);
      }
    }
  }
  assert.deepEqual(undone, []);
});
