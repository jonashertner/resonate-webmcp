// find.test.mjs — the city key, and the words a question is made of.
//
// Both of these decide what a person is shown and neither could be tested
// where it used to live. The city key was a line inside buildSheet, and the
// question matcher was a line inside openAskReport's helper, and js/app.js
// reaches for a document on its first line, so node can never import it. The
// consequence is written down in the repository already: `npm test` passes on
// a completely broken app.js. These are the two rules least able to afford
// that, so they were moved out here and are pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACELESS, cityLabel, oneSpelling, groupByCity, citiesHeld, wordsOf, hasWord, answers,
  cityTyped,
} from '../js/find.js?v=test';

// ---------- the city ----------

test('a city is written the way the atlas holds it, with its country', () => {
  assert.equal(cityLabel({ city: 'Lisboa', country: 'Portugal' }), 'Lisboa, Portugal');
  assert.equal(cityLabel({ city: 'Basel' }), 'Basel');
  assert.equal(cityLabel({ country: 'Iceland' }), 'Iceland');
});

test('a place with no city waits under the words the printed sheet uses', () => {
  assert.equal(cityLabel({}), 'off the map');
  assert.equal(cityLabel({ city: '', country: '' }), PLACELESS);
  assert.equal(cityLabel(null), PLACELESS);
  assert.equal(cityLabel(undefined), PLACELESS);
});

test('a city name is never translated', () => {
  // An atlas that stores Lisboa is not corrected to Lisbon. The world's own
  // name for a place is the name the person who stood there wrote down. If
  // this ever fails it is because someone added a lookup table, and the answer
  // is to take the table out rather than to change the expectation.
  for (const name of ['Lisboa', 'München', 'Kraków', 'Firenze', '東京', 'Praha']) {
    assert.equal(cityLabel({ city: name }), name);
  }
});

// ---------- one spelling ----------

test('a city is settled to one spelling, and never to one case', () => {
  // spacing, which is the difference a reader cannot see and a Map key can
  assert.equal(oneSpelling(' Basel '), 'Basel');
  assert.equal(oneSpelling('New  York'), 'New York');
  assert.equal(oneSpelling('\tSão\nPaulo '), 'São Paulo');
  // and nothing at all is still nothing
  assert.equal(oneSpelling(''), '');
  assert.equal(oneSpelling(null), '');
  assert.equal(oneSpelling(undefined), '');
  // the case a person wrote is the case they wrote. deciding between Basel and
  // basel is deciding whose writing of the name is the real one.
  assert.equal(oneSpelling('basel'), 'basel');
  assert.equal(oneSpelling('LISBOA'), 'LISBOA');
});

test('the two ways Unicode writes an umlaut are one city', () => {
  // one record from a keyboard, the next from a service that answers in the
  // other normal form. they read identically and were two cities.
  // built rather than typed: an editor that normalises this file on save
  // would otherwise turn the fixture into two identical strings, and the
  // assertion under it into a failure with no defect behind it.
  const composed = 'München'.normalize('NFC');
  const decomposed = 'München'.normalize('NFD');
  assert.notEqual(composed, decomposed, 'the fixture stopped testing anything');
  assert.equal(oneSpelling(decomposed), composed);
  const groups = groupByCity([
    { city: oneSpelling(composed), country: 'Germany' },
    { city: oneSpelling(decomposed), country: 'Germany' },
  ]);
  assert.equal(groups.size, 1, 'the same city, written twice, was two cities');
});

test('two spellings of one city are one band, and one row', () => {
  const held = citiesHeld([
    { city: oneSpelling('Basel '), country: oneSpelling('Switzerland') },
    { city: oneSpelling('Basel'), country: oneSpelling(' Switzerland') },
    { city: oneSpelling(' Basel'), country: oneSpelling('Switzerland ') },
  ]);
  assert.equal(held.length, 1);
  assert.equal(held[0].label, 'Basel, Switzerland');
  assert.equal(held[0].places.length, 3);
});

test('the sheet groups in the order the records were written', () => {
  const places = [
    { name: 'a', city: 'Basel' },
    { name: 'b', city: 'Lisboa' },
    { name: 'c', city: 'Basel' },
    { name: 'd' },
  ];
  const groups = groupByCity(places);
  assert.deepEqual([...groups.keys()], ['Basel', 'Lisboa', PLACELESS]);
  assert.deepEqual(groups.get('Basel').map(p => p.name), ['a', 'c']);
  assert.deepEqual(groups.get(PLACELESS).map(p => p.name), ['d']);
});

test('the same city in two countries is two cities', () => {
  const groups = groupByCity([
    { city: 'Basel', country: 'Switzerland' },
    { city: 'Basel', country: 'Germany' },
  ]);
  assert.equal(groups.size, 2);
});

test('choosing a city offers the ones you hold most in first', () => {
  const held = citiesHeld([
    { city: 'Zürich' },
    { city: 'Lisboa' }, { city: 'Lisboa' }, { city: 'Lisboa' },
    { city: 'Basel' }, { city: 'Basel' },
    { city: 'Aarau' },
  ]);
  assert.deepEqual(held.map(g => g.label), ['Lisboa', 'Basel', 'Aarau', 'Zürich']);
  assert.deepEqual(held.map(g => g.places.length), [3, 2, 1, 1]);
});

test('the placeless wait at the end however many of them there are', () => {
  const held = citiesHeld([{}, {}, {}, {}, { city: 'Basel' }]);
  assert.deepEqual(held.map(g => g.label), ['Basel', PLACELESS]);
});

test('the city that was pressed comes before the ranking', () => {
  // a ranking is a guess about what was wanted and a press is not, so the
  // composer opens on the city the press pointed at rather than somewhere
  // below the fold
  const atlas = [
    { city: 'Lisboa' }, { city: 'Lisboa' }, { city: 'Lisboa' },
    { city: 'Basel' }, { city: 'Basel' },
    { city: 'Porto' },
    {},
  ];
  assert.deepEqual(citiesHeld(atlas, 'Porto').map(g => g.label),
    ['Porto', 'Lisboa', 'Basel', PLACELESS]);
  // and the rest of the order is untouched underneath it
  assert.deepEqual(citiesHeld(atlas).map(g => g.label),
    ['Lisboa', 'Basel', 'Porto', PLACELESS]);
  // asking for a city the atlas does not hold changes nothing
  assert.deepEqual(citiesHeld(atlas, 'Kyoto').map(g => g.label),
    ['Lisboa', 'Basel', 'Porto', PLACELESS]);
});

test('nothing to choose from is an empty list, not a throw', () => {
  assert.deepEqual(citiesHeld([]), []);
  assert.deepEqual(citiesHeld(undefined), []);
  assert.equal(groupByCity(null).size, 0);
});

// ---------- the question ----------

test('punctuation is not part of a word', () => {
  assert.deepEqual(wordsOf('wine bars, in Lisbon?'), ['wine', 'bars', 'lisbon']);
  assert.deepEqual(wordsOf('  spaced   out  '), ['spaced', 'out']);
  assert.deepEqual(wordsOf('...'), []);
});

test('a word of two characters or fewer is not a word', () => {
  // this is the whole of what stopped "do" answering for London
  assert.deepEqual(wordsOf('what should we do in Lisbon?'), ['what', 'should', 'lisbon']);
  assert.deepEqual(wordsOf('a b cd efg'), ['efg']);
});

test('a script that does not space its words is not silenced by that rule', () => {
  // the split has already cut these into whole words, so two characters is a
  // word. a question written in Japanese must not come back empty.
  assert.deepEqual(wordsOf('東京'), ['東京']);
  assert.deepEqual(wordsOf('서울'), ['서울']);
});

test('a question in German is not taxed by an English word list', () => {
  // "wir" and "was" are on no English list, and any list that grew to hold
  // them would be a list somebody has to maintain in every language forever
  const words = wordsOf('Wo sollen wir in Lissabon essen?');
  assert.deepEqual(words, ['sollen', 'wir', 'lissabon', 'essen']);
  assert.equal(hasWord('Lissabon, Portugal', 'wir'), false);
});

test('a word matches on its own edges', () => {
  assert.equal(hasWord('London', 'don'), false);
  assert.equal(hasWord('Athens', 'the'), false);
  assert.equal(hasWord('Cartagena', 'art'), false);
  assert.equal(hasWord('Antwerp', 'twe'), false);
  assert.equal(hasWord('Lisboa, Portugal', 'lisboa'), true);
  assert.equal(hasWord('Lisboa, Portugal', 'portugal'), true);
  assert.equal(hasWord('a wine bar', 'wine'), true);
  assert.equal(hasWord('Basel', 'basel'), true);
});

test('one letter at the end is the same word', () => {
  // the edges alone answered nothing to "a good bar" in an atlas holding
  // Wine Bars, and an ask nothing answers has no way to reply on it at all
  assert.equal(hasWord('Wine Bars', 'bar'), true);
  assert.equal(hasWord('a wine bar', 'bars'), true);
  // it is one rule in both directions, in any language that counts by adding
  // a letter at the end
  assert.equal(hasWord('tacos al pastor', 'taco'), true);
  assert.equal(hasWord('a praia', 'praias'), true);
  assert.equal(hasWord('zwei Hunde', 'hund'), true);
});

test('the give is at the end and never at the front', () => {
  // a letter in front changes a word far more often than a letter behind it
  assert.equal(hasWord('Cartagena', 'art'), false);
  assert.equal(hasWord('a cart', 'art'), false);
  assert.equal(hasWord('Antwerp', 'twerp'), false);
  assert.equal(hasWord('Athens', 'then'), false);
});

test('one letter of give is one letter, and no more', () => {
  // the price of the rule, written down rather than discovered later. these
  // are the cases it does not reach, and a stemmer is still not the answer.
  assert.equal(hasWord('two bakeries', 'bakery'), false);
  assert.equal(hasWord('das Haus', 'häuser'), false);
  assert.equal(hasWord('the children', 'child'), false);
  // a plural that replaces the last letter rather than adding one is a
  // substitution, and a substitution would make bar answer for bat
  assert.equal(hasWord('i vini della casa', 'vino'), false);
  assert.equal(hasWord('lange Spaziergänge', 'spaziergang'), false);
  // and the one it reaches too far: a bar is answered by a barn
  assert.equal(hasWord('The Red Barn', 'bar'), true);
  // it does not go round twice: bars reaches bar, and stops there
  assert.equal(hasWord('The Red Barn', 'bars'), false);
});

test('a two character word in an unspaced script is not given a letter', () => {
  // the give exists for suffixes, and a script that writes a whole word in
  // two characters is not adding one
  assert.equal(hasWord('東京', '東京'), true);
  assert.equal(hasWord('東京都', '東京'), false);
});

test('a needle from a stranger is never compiled as a pattern', () => {
  // it comes out of a link somebody else wrote. a regular expression built
  // from it would have to be escaped correctly forever.
  assert.equal(hasWord('a (bar)', '(bar)'), true);
  assert.equal(hasWord('anything at all', '.*'), false);
  assert.equal(hasWord('a.b', 'a.b'), true);
});

test('an empty question answers nothing rather than everything', () => {
  assert.deepEqual(wordsOf(''), []);
  assert.deepEqual(wordsOf(null), []);
  assert.equal(hasWord('Basel', ''), false);
  assert.equal(answers({ name: 'Basel' }, []), false);
});

test('a place answers on its name, its city, its country, its note or its tags', () => {
  const nameOf = (id) => ({ t1: 'wine', t2: 'breakfast' }[id]);
  const p = {
    name: 'Taberna do Mar', city: 'Lisboa', country: 'Portugal',
    note: 'the counter by the window', tags: ['t1'],
  };
  assert.equal(answers(p, wordsOf('taberna'), nameOf), true);
  assert.equal(answers(p, wordsOf('lisboa'), nameOf), true);
  assert.equal(answers(p, wordsOf('portugal'), nameOf), true);
  assert.equal(answers(p, wordsOf('window'), nameOf), true);
  assert.equal(answers(p, wordsOf('wine'), nameOf), true);
  assert.equal(answers(p, wordsOf('breakfast'), nameOf), false);
});

test('the ask that was over-counting is counted right now', () => {
  // the exact question from the report: "do" matched London, "in" matched
  // Berlin and Spain, "we" matched Antwerp, and the number was printed at the
  // person as though their atlas had answered
  const nameOf = () => '';
  const atlas = [
    { name: 'A Bridge', city: 'London', country: 'England', tags: [] },
    { name: 'A Bar', city: 'Berlin', country: 'Germany', tags: [] },
    { name: 'A Beach', city: 'Cádiz', country: 'Spain', tags: [] },
    { name: 'A Room', city: 'Antwerp', country: 'Belgium', tags: [] },
    { name: 'A Tasca', city: 'Lisbon', country: 'Portugal', tags: [] },
  ];
  const words = wordsOf('what should we do in Lisbon?');
  const found = atlas.filter(p => answers(p, words, nameOf));
  assert.deepEqual(found.map(p => p.name), ['A Tasca']);
});

test('one word is enough, because half an answer beats none', () => {
  const nameOf = (id) => ({ t1: 'wine' }[id]);
  const words = wordsOf('wine bars in Lisbon');
  assert.equal(answers({ name: 'A Bar', city: 'Porto', tags: ['t1'] }, words, nameOf), true);
  assert.equal(answers({ name: 'A Bakery', city: 'Lisbon', tags: [] }, words, nameOf), true);
  assert.equal(answers({ name: 'A Bakery', city: 'Porto', tags: [] }, words, nameOf), false);
});

test('a record with no tag function and no tags still answers', () => {
  assert.equal(answers({ name: 'Basel' }, wordsOf('basel')), true);
  assert.equal(answers({ name: 'Basel', tags: 'not an array' }, wordsOf('basel')), true);
});

// ---------- a title, read as a question ----------

// The atlas from the report, in miniature: three cities, one of them Basel,
// and a place that belongs to none of them.
const HELD = [
  { id: 'b1', name: 'Kaserne', city: 'Basel', country: 'Switzerland', tags: [] },
  { id: 'b2', name: 'Klingental', city: 'Basel', country: 'Switzerland', tags: [] },
  { id: 't1', name: 'Nakameguro Wine', city: 'Tokyo', country: 'Japan', tags: [] },
  { id: 't2', name: 'Golden Gai', city: 'Tokyo', country: 'Japan', tags: [] },
  { id: 't3', name: 'Yanaka', city: 'Tokyo', country: 'Japan', tags: [] },
  { id: 'l1', name: 'A Tasca', city: 'Lisboa', country: 'Portugal', tags: [] },
  { id: 'x1', name: 'The Middle Of A Field', tags: [] },
];

test('a city answers while it is still being typed', () => {
  // The exact keystrokes from the report, measured against the shipped build:
  // B, Ba and Bas moved nothing at all, and only Basel did anything. A person
  // typing has finished nothing, and a field that waits for the last letter is
  // waiting for no reason.
  for (const half of ['B', 'Ba', 'Bas', 'Basel', 'basel']) {
    assert.equal(cityTyped(HELD, half)?.label, 'Basel, Switzerland', `"${half}" answered with nothing`);
  }
  assert.equal(cityTyped(HELD, 'tok')?.label, 'Tokyo, Japan');
  // any word of the title, so a title that is more than a city still finds it
  assert.equal(cityTyped(HELD, 'basel bars')?.label, 'Basel, Switzerland');
  assert.equal(cityTyped(HELD, 'a sunday in Tokyo')?.label, 'Tokyo, Japan');
});

test('the town answers before the country it stands in', () => {
  // Measured, and wrong: reading the whole label at once answered "por" with
  // Lisboa, because Lisboa is in Portugal and is held five times to Porto's
  // one, so the country of the bigger city hid the smaller city being typed.
  const held = [
    { id: 'p1', name: 'Porto spot', city: 'Porto', country: 'Portugal', tags: [] },
    ...Array.from({ length: 5 }, (_, i) => (
      { id: `l${i}`, name: `Lisboa ${i}`, city: 'Lisboa', country: 'Portugal', tags: [] })),
  ];
  for (const typed of ['p', 'po', 'por', 'Porto']) {
    assert.equal(cityTyped(held, typed)?.label, 'Porto, Portugal', `"${typed}" answered with the wrong city`);
  }
  // and a country still answers, with the city held most often in it, because
  // no town is called Portugal
  assert.equal(cityTyped(held, 'portugal')?.label, 'Lisboa, Portugal');
});

test('a title that names no city moves nothing', () => {
  // a title is a title first. naming who a folio is for must leave the atlas
  // exactly where it was, and so must the space before a word is typed.
  assert.equal(cityTyped(HELD, 'three for Ana'), null);
  assert.equal(cityTyped(HELD, 'sunday morning, slowly'), null);
  assert.equal(cityTyped(HELD, ''), null);
  assert.equal(cityTyped(HELD, '   '), null);
  assert.equal(cityTyped(HELD, null), null);
  assert.equal(cityTyped(HELD, 'zzz'), null);
  // and a place with no city of its own is never what a title reaches for
  assert.equal(cityTyped([{ id: 'x1', name: 'The Middle Of A Field', tags: [] }], 'the'), null);
});


test('a question reads the tags, through the atlas that knows their words', () => {
  // a tag travels as an id, and only the atlas holding it knows the word. this
  // is what lets an ask for "sauna" be answered by a place nobody wrote the
  // word on.
  const nameOf = (id) => ({ t9: 'sauna' }[id]);
  const pool = { id: 'a', name: 'A Pool', city: 'Basel', tags: ['t9'] };
  const bar = { id: 'b', name: 'A Bar', city: 'Basel', tags: [] };
  assert.equal(answers(pool, wordsOf('sauna'), nameOf), true);
  assert.equal(answers(bar, wordsOf('sauna'), nameOf), false);
  // and with no atlas to ask, a tag is an id and answers for nothing
  assert.equal(answers(pool, wordsOf('sauna')), false);
});

