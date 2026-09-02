// evening.test.mjs — the opening is a composition, and a composition can be
// measured.
//
// Everything the evening does lives in js/app.js as numbers: six cubics in a
// unit box, a score in seconds, and a phase per mark. None of it is exported,
// because none of it is anyone else's business, and all of it is read here out
// of the source for the same reason the stylesheet is read in style.test.mjs.
// A picture does not fail. It renders something, and the something is
// plausible enough that nobody looks.
//
// Three of these were written against defects that had shipped:
//
//   Two ways ran together at a few degrees across the lower third and grazed
//   without crossing, which is the one meeting a pen makes by accident.
//
//   A mark landed on another way's road, so one of the six read as a bead on a
//   thread rather than as a place somebody stopped at.
//
//   And the wordmark spans the middle band of the frame at every size the
//   clamp allows, wider on a phone than on a desk, so a road that clears it at
//   1280 crosses it at 390. Measured: the word occupies x 0.164 to 0.836 and
//   y 0.400 to 0.647 across every viewport this app is used at, which is the
//   union of six of them and not the desktop one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const appSrc = read('js/app.js');
const cssSrc = read('css/style.css');

// the score, read where it is written
const num = (name) => {
  const m = appSrc.match(new RegExp(`^const ${name}\\s*=\\s*([0-9.]+);`, 'm'));
  assert.ok(m, `${name} is not a plain number in js/app.js any more`);
  return Number(m[1]);
};

// the six cubics, read where they are drawn
const WAYS = (() => {
  const m = appSrc.match(/^const WAYS = \[$([\s\S]*?)^\];$/m);
  assert.ok(m, 'the WAYS table is not where this test reads it');
  return [...m[1].matchAll(/\{\s*p:\s*(\[[\s\S]*?\])\s*(?:,\s*near:\s*(true))?\s*\},/g)]
    .map(w => ({ p: JSON.parse(w[1].replace(/\s+/g, '')), near: !!w[2] }));
})();

const onWay = (P, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0],
    a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1],
  ];
};
const N = 400;
const road = (w) => Array.from({ length: N + 1 }, (_, i) => onWay(w.p, i / N));
const roads = WAYS.map(road);
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('the table is six ways, each a cubic, and two of them are near', () => {
  assert.equal(WAYS.length, 6);
  for (const w of WAYS) {
    assert.equal(w.p.length, 4, 'a way is four points or it is not a cubic');
    for (const pt of w.p) assert.equal(pt.length, 2);
  }
  assert.equal(WAYS.filter(w => w.near).length, 2,
    'the two weights are what read as distance: one weight reads as a diagram');
});

// The word, measured rather than guessed: the union of the box `.intro-mark-word`
// occupies at 1280x800, 1512x982, 768x1024, 430x932, 390x844 and 360x780, with a
// little air added on every side.
//
// Measured again on 19 Aug 2026, because the name stopped being a billboard.
// At `clamp(22px, 5.6vw, 60px)` and 0.42em of tracking the union is x 0.260 to
// 0.765 and y 0.455 to 0.593, against x 0.164 to 0.836 and y 0.400 to 0.647 at
// a hundred and thirty two points. The band is a third narrower and half as
// tall, and the six ways came back in to stand around it.
//
// The widest case is still a phone and not a desk: the clamp holds the name at
// its floor on a 360 wide screen, where the frame is narrowest.
const WORD = { x0: 0.25, x1: 0.78, y0: 0.44, y1: 0.61 };

test('no way enters the band the name stands in, at the widest the name gets', () => {
  const inside = ([x, y]) => x > WORD.x0 && x < WORD.x1 && y > WORD.y0 && y < WORD.y1;
  const trespass = roads
    .map((ps, i) => [i, ps.filter(inside)])
    .filter(([, hits]) => hits.length);
  assert.deepEqual(trespass.map(([i, hits]) =>
    `way ${i} crosses the word at (${hits[0][0].toFixed(2)}, ${hits[0][1].toFixed(2)})`), []);
});

test('every mark rests outside that band too, and none of them level with another', () => {
  const ends = roads.map(ps => ps[N]);
  for (const [x, y] of ends) {
    assert.ok(!(x > WORD.x0 && x < WORD.x1 && y > WORD.y0 && y < WORD.y1),
      `a mark rests on the name at (${x.toFixed(2)}, ${y.toFixed(2)})`);
  }
  assert.equal(ends.filter(([, y]) => y < WORD.y0).length, 3, 'three above the word');
  assert.equal(ends.filter(([, y]) => y > WORD.y1).length, 3, 'three below it');
  // a clearing is made of marks that are not a row
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      assert.ok(Math.abs(ends[i][1] - ends[j][1]) > 0.02,
        `marks ${i} and ${j} rest level with each other`);
      assert.ok(gap(ends[i], ends[j]) > 0.15, `marks ${i} and ${j} rest on top of each other`);
    }
  }
});

// A crossing is a road meeting a road, which is what roads do. A graze is two
// of them running together at a few degrees for a third of the frame, which is
// what a pen does by accident, and the old composition had one low and centre.
// The difference is measurable: two ways either meet, or they stay a clear
// distance apart, and the thing forbidden here is the state in between.
test('no way grazes another, and no mark lands on another way road', () => {
  const seg = (a, b, c, d) => {
    const s = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
  };
  const onScreen = ([x, y]) => x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05;
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      let crosses = false;
      for (let a = 0; a < N && !crosses; a++)
        for (let b = 0; b < N && !crosses; b++)
          if (seg(roads[i][a], roads[i][a + 1], roads[j][b], roads[j][b + 1])) crosses = true;
      if (crosses) continue;
      let near = 9;
      for (const p of roads[i]) {
        if (!onScreen(p)) continue;
        for (const q of roads[j]) { if (onScreen(q)) near = Math.min(near, gap(p, q)); }
      }
      assert.ok(near > 0.05,
        `ways ${i} and ${j} run together to within ${near.toFixed(3)} without ever meeting`);
    }
  }
  // and a mark is a place, not a bead on somebody else's thread
  for (let i = 0; i < roads.length; i++) {
    const end = roads[i][N];
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const near = Math.min(...roads[j].filter(onScreen).map(q => gap(end, q)));
      assert.ok(near > 0.05, `mark ${i} rests ${near.toFixed(3)} from way ${j}`);
    }
  }
});

// The whole point of the change: six marks that start at six phases and end at
// one. The pull opens when the last way sets out and closes as the field
// arrives, and the two halves of that sentence are two expressions that have to
// keep agreeing. Nothing else in the file would notice if one of them moved.
test('the phases close exactly as the evening ends, not before it and not after', () => {
  const WAY_S = num('WAY_S'), WAY_GAP = num('WAY_GAP');
  const MARK_S = num('MARK_S'), REST_S = num('REST_S');
  const scene = WAY_GAP * (WAYS.length - 1) + WAY_S + MARK_S + REST_S;
  const tieAt = WAY_GAP * (WAYS.length - 1);
  const tieFor = WAY_S + MARK_S + REST_S;
  assert.equal(tieAt + tieFor, scene, 'the marks are still gathering when the field arrives');
  assert.ok(tieAt > 0, 'the phases are tied before a single way has set out');
  assert.ok(tieFor > WAY_S, 'the gathering is over before the last way has finished travelling');
  // and the source says the same thing, in the same two terms
  assert.match(appSrc, /^const TIE_AT = WAY_GAP \* \(WAYS\.length - 1\);$/m);
  assert.match(appSrc, /^const TIE_S = WAY_S \+ MARK_S \+ REST_S;$/m);
});

test('the marks are given six phases to start from, and the pull closes them onto one', () => {
  assert.match(appSrc, /^const PHASE = 0\.\d+;/m, 'the phase between two marks is not a constant');
  assert.match(appSrc, /mark\(P, clamp01\(\(s - WAY_S\) \/ MARK_S\), t, i \* PHASE \* \(1 - tie\), tie\);/,
    'the phase handed to a mark no longer closes with the tie');
});

// ---------- the light the evening is drawn in ----------
//
// The evening used to be one fixed dark picture, whoever was watching. A
// person who keeps this app in day was shown a full screen of night and then
// handed onto paper, and the fade that was supposed to be a handover was an
// eighty point swing in lightness instead. Then there were two pictures. Now
// there is one picture and a clock: js/evening.js turns the hour and the day
// of the year into the ground, the pool of light, the ink and the vignette,
// and the theme decides only which end of the lightness scale all four sit at.
//
// That module is arithmetic, so it is imported and walked rather than read as
// text. A year at twenty minute steps is about twenty six thousand moments per
// theme, which is every light this app can ever be in.

const { evening, dials, hemisphere } = await import('../js/evening.js');

// sRGB back to oklab, so a colour can be asked what it is rather than trusted
// to be what it was asked for. This is the published inverse of the transform
// in js/evening.js and it is written out again here on purpose: a test that
// imported the module's own conversion could not catch the module getting it
// wrong.
function oklab([R, G, B]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin(R), g = lin(G), b = lin(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    C: Math.hypot(A, Bb),
    h: (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360,
  };
}

// The evening hands out three shapes, because three things read it: a hex for
// a style property, a bare triple for a stylesheet variable that is taken at
// several alphas, and a whole rgba() for the canvas. All three are three bytes.
//
// This was `v.split(',')` and it turned `rgba(45, 44, 42, 0.8)` into NaN, which
// then sailed through every comparison below without failing one of them. The
// vignette was the only surface reaching real chroma at the darkest hours, so
// it was also the one worth checking, and it was the one not being checked.
const bytes = (v) => {
  const n = v.startsWith('#')
    ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16))
    : (v.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  assert.equal(n.length, 3, `${v} is not three bytes`);
  for (const b of n) assert.ok(Number.isInteger(b) && b >= 0 && b <= 255, `${v} is not a colour`);
  return n;
};

// every light the app can be in, walked once and shared by the tests below
const YEAR = (() => {
  const out = { dark: [], light: [] };
  for (const theme of ['dark', 'light']) {
    for (let d = 0; d < 366; d++) {
      for (let m = 0; m < 1440; m += 20) {
        const when = new Date(2026, 0, 1 + d, 0, m, 0);
        out[theme].push({ when, e: evening(theme, when, 'Europe/Zurich') });
      }
    }
  }
  return out;
})();

// The one thing the owner has said twice about this screen, and the reason the
// colour is carried as two coordinates rather than as a hue.
//
// A hue is an angle, and there are two roads between the blue of night and the
// amber of the horizon. One goes through violet and magenta, and that is what
// an interpolated hue does: the first build of this walked 296 to 385 and put
// a lilac wash over January and a pink one over October, at exactly the hour
// the chroma peaked. The other road goes through green, which is worse.
//
// Read as a pair of coordinates the journey crosses the middle instead, and
// the middle is no colour at all. This test is the fence around that decision.
// Plant the old hue table back and every twilight in the year fails it.
test('no hour of any day is allowed to come out purple', () => {
  const bad = [];
  for (const theme of ['dark', 'light']) {
    for (const { when, e } of YEAR[theme]) {
      for (const part of ['base', 'pool', 'ink', 'out']) {
        const px = bytes(e[part]);
        const c = oklab(px);
        // A hue needs a colour to be the hue of. The ground at three in the
        // morning is rgb(9, 10, 13), where one integer of rounding is a third
        // of what little chroma there is and the recovered angle wanders
        // twenty degrees; the eye has the same problem and calls it black. So
        // the gate is the plainest statement of what is on the screen: how far
        // from grey the three bytes are.
        if (Math.max(...px) - Math.min(...px) < 6 || c.C < 0.006) continue;
        if (c.h > 280 && c.h < 355) bad.push(`${theme} ${part} ${when.toString().slice(0, 21)} h=${c.h.toFixed(0)} C=${c.C.toFixed(3)}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 6), [], `${bad.length} moments of the year are violet or magenta`);
});

// The season has to be on the screen, and this is the test that would have
// stopped it being a sentence in a comment instead.
//
// The first build of the seasonal light said, in its own header, that the year
// read clearest at noon, where nothing else was happening. It did not. Measured
// across the two solstices, a January noon and a July noon came out five bytes
// apart on one channel of one surface, which is nothing, in both themes. The
// cause was structural rather than a number being too small: the day arc was
// normalised, so the sun stood at the very top of the sky at midday on every
// date in the year, and the only lever the season had left was a scale on a
// colour the table deliberately sets to near zero at the top of the day.
//
// So the season stopped being a tint and became what it is outdoors: a sun that
// does not get as high. That reads as less light, and as light arriving from
// lower down, and it reads at every hour rather than at one.
//
// Plant `const high = 1` back and this fails on its first assertion, because
// the two solstices go back to putting the pool in exactly the same place.
test('a midwinter day and a midsummer day are not the same picture', () => {
  const Z = 'Europe/Zurich';
  const at = (mo, d, h) => new Date(2026, mo, d, h, 30);
  const solstice = (theme, h) => ({
    w: evening(theme, at(0, 15, h), Z),
    s: evening(theme, at(6, 15, h), Z),
  });

  // Where the light falls. This is the half of the answer that survives the
  // paper theme, where lightness has almost nowhere to go and the geometry has
  // all the room in the world.
  for (const theme of ['dark', 'light']) {
    const { w, s } = solstice(theme, 12);
    assert.ok(w.at[1] - s.at[1] > 0.05,
      `${theme}: the midwinter noon pool sits ${((w.at[1] - s.at[1]) * 100).toFixed(1)}% of the frame from the midsummer one`);
    assert.ok(s.reach > w.reach, `${theme}: midwinter noon carries as far as midsummer noon`);
  }

  // How much of it there is, and which way round. Every hour of the day, not
  // the one that flatters the claim.
  for (const theme of ['dark', 'light']) {
    for (let h = 0; h < 24; h++) {
      const { w, s } = solstice(theme, h);
      const dim = (e) => oklab(bytes(e.pool)).L;
      // Half past midnight is the same deep night in both months and lands on
      // the same byte, so what is forbidden here is an inversion somebody could
      // see, not a difference in the last place of the rounding.
      assert.ok(dim(s) - dim(w) > -0.006,
        `${theme} at ${h}:30, midwinter is the brighter of the two by ${(dim(w) - dim(s)).toFixed(3)}`);
    }
    // and at the shoulders of the day it is a difference anybody would see,
    // because half past six is night in January and broad in July. This is the
    // one the paper theme carries too.
    for (const h of [6, 18]) {
      const { w, s } = solstice(theme, h);
      const apart = Math.max(...bytes(w.pool).map((v, i) => Math.abs(v - bytes(s.pool)[i])));
      assert.ok(apart >= 5, `${theme} at ${h}:30: the two solstices are ${apart} bytes apart`);
    }
  }

  // At the top of the day only the night carries it in amount, and that is not
  // a shortfall to be tuned out. Paper lives in the top four percent of the
  // lightness scale, where a byte is a large step and the whole day has two
  // percent to move in; widening it far enough to read at noon is the same
  // change as making the paper grey, which was tried and looked like a card
  // laid on the app rather than the app's own sheet. On paper a January midday
  // is a bright room with the light coming in low, which is what it is.
  {
    const { w, s } = solstice('dark', 12);
    const apart = Math.max(...bytes(w.pool).map((v, i) => Math.abs(v - bytes(s.pool)[i])));
    assert.ok(apart >= 6, `dark: the two noons are ${apart} bytes apart, which is nothing`);
  }

  // And not by recolouring it. The season is a magnitude, so the top of the day
  // stays the quiet end of the table in every month; if this ever fails, some
  // well-meant offset has been added and the purple test is the next to go.
  for (const theme of ['dark', 'light']) {
    const { w, s } = solstice(theme, 12);
    for (const [tag, e] of [['midwinter', w], ['midsummer', s]]) {
      const px = bytes(e.pool);
      assert.ok(Math.max(...px) - Math.min(...px) <= 4,
        `${theme}: ${tag} noon is a colour (${px.join(', ')}), and the top of the day is meant to be colourless`);
    }
  }
});

// The colour of a dusk is a fact about the light coming in along the ground,
// and that happens at every sunset there has ever been. What a December dusk
// and a June dusk differ in is how long they last and how much light is left
// around them, which is why the table is indexed by the arc and the season is
// kept out of it.
test('every dusk of the year is the same amber, and it arrives when the sun sets', () => {
  const Z = 'Europe/Zurich';
  const hues = [];
  for (let d = 0; d < 366; d += 7) {
    const { set } = dials(new Date(2026, 0, 1 + d, 12, 30), Z);
    // this day's own sunset, to the minute, which is the top of the amber and
    // moves by three hours across the year
    const dusk = new Date(2026, 0, 1 + d, Math.floor(set), Math.round((set % 1) * 60));
    // the pool, because that is the lit surface. The vignette is a near black
    // by design and has no hue to read at any hour of any day.
    const c = oklab(bytes(evening('dark', dusk, Z).pool));
    assert.ok(c.C > 0.006, `the dusk of day ${d} has no colour in it at all`);
    hues.push(c.h);
  }
  // A scale cannot rotate a hue: multiplying both coordinates by the same k
  // leaves the angle exactly where it was, so every sunset of the year should
  // come back the same number and the only spread is the trip out to bytes and
  // home again. Measured, that is four degrees. The bound is six, which is
  // tight on purpose: the quantity has no randomness in it, and the failure
  // being fenced off is an offset added to one axis, which opens the angle at
  // one solstice and closes it at the other.
  const lo = Math.min(...hues), hi = Math.max(...hues);
  assert.ok(hi - lo < 6,
    `dusk wanders ${(hi - lo).toFixed(1)} degrees of hue across the year (${lo.toFixed(1)} to ${hi.toFixed(1)})`);
  assert.ok(lo > 40 && hi < 90, `dusk is not amber, it runs ${lo.toFixed(0)} to ${hi.toFixed(0)}`);
});

// Two evenings, and the failure this pins is the quiet one: not a picture going
// missing, which anybody would notice, but one of the two wandering into the
// other's half. A person who keeps this app in day is never shown a dark
// screen, at three in the morning in January or at any other hour of any other
// day, and a person who keeps it at night is never flashed a white one.
test('the night never goes to paper and the day never goes dark', () => {
  const L = (theme, part) => YEAR[theme].map(({ e }) => oklab(bytes(e[part])).L);
  const darkest = Math.min(...L('light', 'base'), ...L('light', 'pool'));
  const lightest = Math.max(...L('dark', 'base'), ...L('dark', 'pool'));
  assert.ok(lightest < 0.45, `the night reaches ${lightest.toFixed(3)} lightness at its brightest hour`);
  assert.ok(darkest > 0.80, `the day falls to ${darkest.toFixed(3)} lightness at its darkest hour`);

  // and the letters stay on the far side of their own ground in both
  for (const theme of ['dark', 'light']) {
    for (const { when, e } of YEAR[theme]) {
      const ink = oklab(bytes(e.ink)).L, ground = oklab(bytes(e.pool)).L;
      assert.ok(Math.abs(ink - ground) > 0.35,
        `${theme}: the name is ${Math.abs(ink - ground).toFixed(2)} from the light behind it at ${when}`);
    }
  }
});

// The two arms describe the same picture. A colour added to the night and
// forgotten on the paper is a word nobody can read, on the first screen anybody
// sees, in the half of the app the author is not looking at.
test('the two evenings are the same picture at two lightnesses', () => {
  const src = read('js/evening.js');
  // the terminator is looked at rather than eaten, so the line that closes the
  // first arm is still there to open the second
  const arms = [...src.matchAll(/^  (?:const p = dark \? |\} : )\{$([\s\S]*?)(?=^  \})/gm)];
  assert.equal(arms.length, 2, 'an evening has appeared or gone from js/evening.js');
  const [a, b] = arms.map(m => [...m[1].matchAll(/^ {4}(\w+):/gm)].map(k => k[1]).sort());
  assert.deepEqual(a, b, `the two evenings do not describe the same picture: ${a} against ${b}`);

  // and every one of them is given the light, rather than a colour of its own.
  // The prose is allowed to quote a colour; the arithmetic is not.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...code.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0]), [],
    'js/evening.js names a colour, and a named colour belongs to one hour');
});

// Light drifts. Nothing on this screen may step, because a step is the one
// thing that would make a person look at the ground instead of at the name.
test('the light drifts, and never in ten minutes by as much as a person could see', () => {
  for (const theme of ['dark', 'light']) {
    let worst = 0, at = null, prev = null;
    for (let d = 0; d < 366; d++) {
      for (let m = 0; m < 1440; m += 10) {
        const when = new Date(2026, 0, 1 + d, 0, m, 0);
        const e = evening(theme, when, 'Europe/Zurich');
        const c = ['base', 'pool', 'ink', 'out'].flatMap(k => bytes(e[k]));
        if (prev) {
          const step = Math.max(...c.map((v, i) => Math.abs(v - prev[i])));
          if (step > worst) { worst = step; at = when; }
        }
        prev = c;
      }
    }
    assert.ok(worst <= 18, `${theme} moves ${worst} of 255 in the ten minutes around ${at}`);
  }
});

// The same instant is the same light, on every device and on every visit. A
// composition that shuffled itself would be a novelty; this is supposed to be
// the light in the room.
test('the same instant always gives the same light', () => {
  const src = read('js/evening.js');
  assert.doesNotMatch(src, /Math\.random|crypto\./, 'the evening has something random in it');
  for (const when of [new Date(2026, 1, 3, 7, 12), new Date(2026, 7, 19, 21, 40)]) {
    for (const theme of ['dark', 'light']) {
      assert.deepEqual(evening(theme, when, 'Europe/Zurich'), evening(theme, when, 'Europe/Zurich'));
    }
  }
  // and a clock that answers nonsense is a picture, not an error
  for (const bad of [new Date('nonsense'), null, undefined, 'today', 0]) {
    assert.ok(evening('dark', bad, 'Europe/Zurich').base.startsWith('#'));
  }
});

// Nobody is asked anything. The date and the hour are on the device already,
// and the zone name is read for exactly one fact. This is the whole argument
// for building the light out of arithmetic rather than out of a sunrise table
// somebody would have to be asked their position to be found in.
test('the evening asks for nothing and sends nothing', () => {
  const src = read('js/evening.js');
  for (const asked of ['geolocation', 'fetch(', 'XMLHttpRequest', 'navigator.', 'localStorage', 'permissions']) {
    assert.ok(!src.includes(asked), `the evening reaches for ${asked}`);
  }
  // Intl, once, for the zone, and the failure of it is a picture too
  assert.equal((src.match(/Intl\./g) || []).length, 1);
  assert.match(src, /catch \{ return ''; \}/);
});

// Below the equator the year runs the other way, and a zone this does not know
// is treated as northern, which is where most of the people are.
test('the year runs backwards south of the equator', () => {
  const midsummer = new Date(2026, 6, 15, 12, 30);
  assert.ok(dials(midsummer, 'Europe/Zurich').year > 0.85);
  assert.ok(dials(midsummer, 'Australia/Sydney').year < -0.85);
  assert.ok(dials(midsummer, 'America/Argentina/Buenos_Aires').year < -0.85);
  assert.equal(hemisphere('Pacific/Auckland'), -1);
  for (const unknown of ['', null, undefined, 'Mars/Olympus', 'Europe/Zurich']) {
    assert.equal(hemisphere(unknown), 1);
  }
  // and the day itself is longer in one and shorter in the other, on one date
  assert.ok(dials(midsummer, 'Europe/Zurich').rise < dials(midsummer, 'Australia/Sydney').rise - 2);
});

// The drawing takes every colour from the evening rather than holding one of
// its own that only ever suited the dark, and the stylesheet is told which of
// the two it is dressing.
test('the opening paints no colour the clock did not give it', () => {
  const draw = appSrc.slice(appSrc.indexOf('function runIntro'));
  const literals = [...draw.slice(0, draw.indexOf('\n  const finish'))
    .matchAll(/rgba\((\d+), *(\d+), *(\d+)/g)]
    .filter(m => !(m[1] === '0' && m[2] === '0' && m[3] === '0'));
  assert.deepEqual(literals.map(m => m[0]), [],
    'the evening still paints a colour of its own, which is a colour for one theme');

  assert.match(appSrc, /el\.dataset\.evening = resolvedTheme\(\);/,
    'the stylesheet is never told which evening this is');
  assert.match(appSrc, /const EV = evening\(resolvedTheme\(\), new Date\(\), deviceZone\(\)\);/,
    'the canvas no longer reads the clock, or no longer reads the theme');
  assert.match(appSrc, /el\.style\.setProperty\('--ev-ink', EV\.ink\);/,
    'the stylesheet is never handed the ink, so the name is drawn in last visit\'s light');

  // and the stylesheet's own fallback, for the frame before any of that runs,
  // is declared once per evening rather than repeated inside every rgba() that
  // reads it. Three of the five used to carry the night's bone, which on the
  // paper evening is bone letters on cream.
  assert.match(cssSrc, /^#intro \{[\s\S]*?^  --ev-ink: [\d, ]+;$/m,
    'the night evening has no ink of its own before the script runs');
  assert.match(cssSrc, /^#intro\[data-evening="light"\] \{ --ev-ink: [\d, ]+;/m,
    'the paper evening has no ink of its own before the script runs');
  assert.deepEqual([...cssSrc.matchAll(/--ev-ink, /g)].map(m => m[0]), [],
    'a rule carries its own fallback ink, and a fallback written twice is a fallback that disagrees');
});

// The name is set in Bricolage at a hundred and thirty two points and the face
// is declared `font-display: swap`. Measured, RESONATE is 661px in Bricolage and
// 713px in the fallback: a face arriving mid-evening resizes the title by eight
// percent and drags the rule under it, which is being drawn left to right at the
// time. So the stylesheet gives the name no ink at all until the face is here.
test('nothing of the name is drawn before the face it is set in has arrived', () => {
  assert.match(cssSrc, /#intro:not\(\.lettered\) \.intro-mark,\s*\n#intro:not\(\.lettered\) \.intro-mark-word::after \{[^}]*opacity: 0;/,
    'the name has ink before `lettered`');
  for (const [sel, anim] of [['.intro-mark', 'mark-in'], ['.intro-mark-word::after', 'mark-rule']]) {
    const rules = [...cssSrc.matchAll(new RegExp(`([^\\n{}]*${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})\\s*\\{([^}]*)\\}`, 'g'))]
      .filter(m => m[2].includes(`animation: ${anim}`));
    assert.ok(rules.length, `nothing animates ${sel} any more`);
    for (const r of rules) {
      assert.match(r[1], /\.lettered/,
        `${sel} is animated by a rule that does not wait for the face: ${r[1].trim()}`);
    }
  }
  assert.match(appSrc, /el\.classList\.add\('lettered'\)/, 'nobody ever says the face has arrived');
  assert.match(appSrc, /document\.fonts\?\.check\(FACE\)/, 'the face is no longer asked for');
});

// The evening ends on the marks, not on the title. The claim it used to make,
// that the letters change colour rather than vanish because the field's own
// wordmark stands in the same place, was false twice over: a first visit
// arrives at the threshold, whose heading is set left and small, and even at
// the field the two words are about forty five pixels apart.
// And it leaves by animation, not by transition, because the engines disagree
// about the other thing: a property a filling animation owns is one blink and
// gecko will not start a transition on, so as a transition the withdrawal was
// a fade in webkit and a one-frame cut in the other two. The mechanism is
// pinned here so a well-meaning simplification back to `transition` cannot
// quietly reintroduce the cut.
test('the name does not survive the dissolve', () => {
  const m = cssSrc.match(/#intro\.dissolve \.intro-mark \{([^}]*)\}/);
  assert.ok(m, 'nothing takes the name off the dissolve');
  assert.match(m[1], /opacity: 0;/);
  assert.doesNotMatch(m[1], /transition/,
    'a transition on a property mark-in owns is a cut in two engines of three');
  const t = m[1].match(/animation: mark-out calc\(var\(--intro-fade[^)]*\) \* (0\.\d+)\)/);
  assert.ok(t, 'the name leaves on a duration unrelated to the fade it leaves under');
  assert.ok(Number(t[1]) < 0.6,
    'the name is still on the screen when the room underneath is legible');
  assert.match(cssSrc, /@keyframes mark-out \{ from \{ opacity: 1; \} to \{ opacity: 0; \} \}/,
    'mark-out is named but never defined');
  assert.doesNotMatch(cssSrc, /body\.hero[^\n]*#intro\.dissolve \.intro-mark/,
    'an arrival is being given the old hold, which never lined up');
});
