// library.test.mjs — one index for every kind the atlas holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordKind, recordState, stateLabel, searchLibrary,
} from '../js/library.js?v=test';

const library = () => ({
  tags: [
    { id: 'culture', name: 'Culture' },
    { id: 'nature', name: 'Long walks' },
  ],
  places: [
    { id: 'p1', name: 'Casa do Alentejo', city: 'Lisboa', country: 'Portugal',
      address: 'Rua das Portas', note: 'the café courtyard', tags: ['culture'], status: 'visited' },
    { id: 'p2', name: 'Cabane de Moiry', city: 'Grimentz', country: 'Switzerland',
      tags: ['nature'], status: 'wishlist' },
  ],
  routes: [
    { id: 'r1', kind: 'route', name: 'Ridge to the hut', city: 'Grimentz',
      note: 'snow into July', tags: ['nature'], status: 'walked', path: [{ lat: 1, lng: 2 }] },
    { id: 'r2', kind: 'route', name: 'Coast path', city: 'Lisboa',
      tags: [], status: 'wishlist', path: [{ lat: 1, lng: 2 }] },
  ],
  books: [
    { id: 'b1', kind: 'book', title: 'Invisible Cities', author: 'Italo Calvino', year: '1972',
      note: 'every city is Venice', tags: ['culture'], status: 'visited' },
    { id: 'b2', kind: 'book', title: 'The Old Ways', author: 'Robert Macfarlane',
      tags: ['nature'], status: 'wishlist' },
  ],
  correspondents: [{
    id: 'c1', name: 'Marta',
    tags: [{ id: 'food', name: 'Restaurants' }],
    places: [{ id: 'cp1', name: 'Le Baratin', city: 'Paris', tags: ['food'], status: 'visited' }],
    paths: [{ id: 'cr1', kind: 'path', name: 'Canal at dusk', city: 'Paris', tags: [], status: 'wishlist' }],
    books: [{ id: 'cb1', kind: 'book', title: 'A Moveable Feast', author: 'Ernest Hemingway',
      tags: ['food'], status: 'visited' }],
  }],
});

test('stored shapes are named place, path and book at the library boundary', () => {
  assert.equal(recordKind({ name: 'A place', lat: 1, lng: 2 }), 'place');
  assert.equal(recordKind({ kind: 'route', name: 'A way', path: [] }), 'path');
  assert.equal(recordKind({ kind: 'path', name: 'A way' }), 'path');
  assert.equal(recordKind({ title: 'A book', author: 'Someone' }), 'book');
  assert.equal(recordKind({}, 'routes'), 'path');
  assert.equal(recordKind(null), '');
});

test('the shared two-state filter reads each kind in its own stored dialect', () => {
  assert.equal(recordState({ status: 'visited' }, 'place'), 'visited');
  assert.equal(recordState({ status: 'visited' }, 'book'), 'visited');
  assert.equal(recordState({ status: 'walked' }, 'path'), 'visited');
  assert.equal(recordState({ walkedAt: '2026-08-01' }, 'path'), 'visited');
  assert.equal(recordState({ status: 'wishlist' }, 'place'), 'wishlist');
  assert.equal(recordState({ status: 'wishlist' }, 'path'), 'wishlist');
  assert.equal(recordState({ status: 'wishlist' }, 'book'), 'wishlist');
});

test('one state is spoken truthfully for each kind', () => {
  assert.equal(stateLabel('place', 'visited'), 'been');
  assert.equal(stateLabel('place', 'wishlist'), 'want to go');
  assert.equal(stateLabel('route', 'visited'), 'walked');
  assert.equal(stateLabel('path', 'wishlist'), 'want to walk');
  assert.equal(stateLabel('book', 'visited'), 'read');
  assert.equal(stateLabel('book', 'wishlist'), 'want to read');
});

test('one search reaches local places, paths and books', () => {
  assert.deepEqual(searchLibrary(library(), 'Lisboa').map(x => [x.kind, x.title]), [
    ['place', 'Casa do Alentejo'],
    ['path', 'Coast path'],
  ]);
  assert.deepEqual(searchLibrary(library(), 'ridge').map(x => x.kind), ['path']);
  assert.deepEqual(searchLibrary(library(), 'Calvino').map(x => x.title), ['Invisible Cities']);
});

test('search reads tags, notes, accents and every word typed', () => {
  assert.deepEqual(searchLibrary(library(), 'culture venice').map(x => x.title), ['Invisible Cities']);
  assert.deepEqual(searchLibrary(library(), 'Lisboa courtyard').map(x => x.title), ['Casa do Alentejo']);
  assert.deepEqual(searchLibrary(library(), 'cafe').map(x => x.title), ['Casa do Alentejo']);
  assert.deepEqual(searchLibrary(library(), 'grimentz long').map(x => x.title), [
    'Cabane de Moiry', 'Ridge to the hut',
  ]);
  assert.deepEqual(searchLibrary(library(), 'moiry').map(x => x.title), ['Cabane de Moiry']);
});

test('correspondents contribute every shared kind they carry', () => {
  const found = searchLibrary(library(), 'Marta');
  assert.deepEqual(found.map(x => [x.kind, x.title]), [
    ['place', 'Le Baratin'],
    ['path', 'Canal at dusk'],
    ['book', 'A Moveable Feast'],
  ]);
  assert.ok(found.every(x => x.source === 'correspondent'));
  assert.ok(found.every(x => x.correspondent.name === 'Marta'));
  assert.deepEqual(searchLibrary(library(), 'restaurants Hemingway').map(x => x.title),
    ['A Moveable Feast']);
});

test('kind filters use the public names while accepting the stored route name', () => {
  assert.deepEqual(searchLibrary(library(), '', { kind: 'place' }).map(x => x.kind),
    ['place', 'place', 'place']);
  assert.deepEqual(searchLibrary(library(), '', { kind: 'path' }).map(x => x.kind),
    ['path', 'path', 'path']);
  assert.deepEqual(searchLibrary(library(), '', { kind: 'route' }).map(x => x.kind),
    ['path', 'path', 'path']);
  assert.deepEqual(searchLibrary(library(), '', { kind: 'book' }).map(x => x.kind),
    ['book', 'book', 'book']);
});

test('visited and wishlist filters cross kind boundaries without changing their words', () => {
  const visited = searchLibrary(library(), '', { state: 'visited' });
  assert.deepEqual(visited.map(x => [x.kind, x.stateLabel]), [
    ['place', 'been'],
    ['path', 'walked'],
    ['book', 'read'],
    ['place', 'been'],
    ['book', 'read'],
  ]);

  const wantedBooks = searchLibrary(library(), '', { kind: 'book', state: 'wishlist' });
  assert.deepEqual(wantedBooks.map(x => [x.title, x.stateLabel]), [
    ['The Old Ways', 'want to read'],
  ]);
  assert.deepEqual(searchLibrary(library(), '', { kind: 'path', state: 'done' })
    .map(x => x.title), ['Ridge to the hut']);
});

test('results preserve record identity, obey limits and do not mutate the library', () => {
  const atlas = library();
  const before = structuredClone(atlas);
  const found = searchLibrary(atlas, '', { limit: 2 });
  assert.equal(found.length, 2);
  assert.equal(found[0].record, atlas.places[0]);
  assert.equal(found[0].source, 'local');
  assert.deepEqual(atlas, before);
  assert.deepEqual(searchLibrary(null, 'anything'), []);
  assert.deepEqual(searchLibrary(atlas, '', { limit: 0 }), []);
});
