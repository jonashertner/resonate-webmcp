// schema.test.mjs: the gate, examined at the gate.
//
// store.test.mjs asks what the device does with a file. These ask the narrower
// question underneath: what schema.js says a file lost. A loss invented here
// is a restore refused for nothing. A loss missed here is an archive that
// comes home smaller and reports that it came home whole, which is the exact
// failure the witness exists to make impossible.
//
// Nothing in schema.js touches storage or the page, so no shim is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  OWN, LIMITS, PORTABLE_SETTINGS,
  readArchive, losses, setAside, normImport, normPlace, normSettings, normPayload, classifyFile,
  ARCHIVE_VERSION, SHARE_VERSION, KIND_VERSION, BOOKS_RIDE_AT, ASSISTANT_TASK_VERSION, ASSISTANT_RESULT_VERSION,
  assistantTaskVersionOK, assistantResultVersionOK,
} = await import('../js/schema.js?v=test');

// the same file store.test.mjs sends through the store, kept here so the two
// levels can disagree loudly rather than pass together by accident
const theLossTable = () => ({
  app: 'resonate',
  version: 4,
  places: [{
    id: 'big', name: 'Everything at once', lat: 46, lng: 8, tags: [],
    note: 'n'.repeat(200001),
  },
  // the folio below names these, and an archive whose folio points at places
  // it does not carry is refused now, so the fixture carries them
  ...Array.from({ length: 501 }, (_, i) => ({ id: 'fp' + i, name: 'F' + i, lat: 46, lng: 8, tags: [] }))],
  routes: [{
    id: 'way', name: 'The long one', tags: [],
    path: Array.from({ length: 1475 }, (_, i) => ({
      lat: 46 + i * 0.0001, lng: 8 + i * 0.0001, ele: 1000 + (i % 60),
    })),
  }],
  folios: [{
    id: 'fol', title: 'A wide folio', routeIds: [],
    placeIds: Array.from({ length: 501 }, (_, i) => 'fp' + i),
  }],
  correspondents: [{
    id: 'voice', name: 'Mira', tags: [],
    places: Array.from({ length: 501 }, (_, i) => ({ id: 'vp' + i, name: 'V' + i, lat: 46, lng: 8, tags: [] })),
  }],
  tags: [],
  settings: {},
});


// ---------- the two doors ----------

test('every cap on a person’s own record is no cap at all', () => {
  const bounded = Object.entries(OWN).filter(([, v]) => v !== Infinity);
  assert.deepEqual(bounded, [], 'a bound crept back into the door that is supposed to have none');
  // and the stranger’s door still has real numbers behind it, or the two
  // doors have quietly become one
  assert.ok(Object.values(LIMITS).every(v => Number.isFinite(v) && v > 0),
    'a cap a hostile payload cannot meet is not a cap');
});

test('an own archive loses nothing at any depth, and its witness stays empty', () => {
  const read = readArchive(theLossTable());
  assert.deepEqual(read.cut, [], 'no collection was truncated');
  assert.deepEqual(read.rejected, [], 'no record was unreadable');
  assert.deepEqual(read.clipped, [], 'and no field was shortened');
  assert.deepEqual(losses(read), []);

  // the depths themselves, so an empty witness cannot pass by reading nothing
  assert.equal(read.value.places[0].note.length, 200001);
  assert.equal(read.value.routes[0].path.length, 1475);
  assert.equal(read.value.folios[0].placeIds.length, 501);
  assert.equal(read.value.correspondents[0].places.length, 501);
});

test('the stranger’s door clips the same file at every one of those depths', () => {
  const file = theLossTable();
  file.routes[0].path = Array.from({ length: 3001 }, (_, i) => ({ lat: 46 + i * 0.00001, lng: 8 }));
  const v = normImport(file);
  assert.equal(v.places[0].note.length, LIMITS.note);
  assert.equal(v.routes[0].path.length, LIMITS.routePoints);
  assert.equal(v.folios[0].placeIds.length, LIMITS.placeIds);
  assert.equal(v.correspondents[0].places.length, LIMITS.places);
});


// ---------- a field this version has no place for ----------
//
// Photographs left a record. Every archive a person has ever exported carries
// them, so what this door does with one decides whether a year of backups can
// still be opened. Refusing them is not the careful answer, it is the
// destructive one: nothing is lost by reading a file, because the file is
// still on the disk with every picture in it.

test('a file from before this comes home whole, and its photographs are counted, not lost', () => {
  const read = readArchive({
    app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'p1', name: 'A place', lat: 46, lng: 8, tags: [],
      photos: ['ph_abc', 'data:image/png;base64,iVBORw0KGgo='] }],
  });
  assert.equal('photos' in read.value.places[0], false, 'no picture is kept');
  assert.deepEqual(losses(read), [], 'and the atlas still comes home');

  const told = setAside(read);
  assert.equal(told.length, 1, 'the place that carried them is named');
  assert.equal(told[0].id, 'p1');
  assert.equal(told[0].given, 2, 'both of them, counted');
  assert.equal(told[0].kept, 0);
  assert.match(told[0].reason, /still has them/, 'and it says where they still are');
});

// The number in that sentence is what a person weighs a decision with: it is
// the count the club dialog puts in front of somebody about to save over a
// backup. So it counts photographs, not strings that happen to be sitting in
// the field. Told "three photographs in that backup" about a file holding one,
// a person goes looking for two that were never there.
test('the count is of photographs, and not of whatever the field holds', () => {
  const read = readArchive({
    app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'p1', name: 'A place', lat: 46, lng: 8, tags: [],
      photos: ['data:image/png;base64,iVBORw0KGgo=', 'ph_abc123', 'not a picture', '', 7] }],
  });
  const told = setAside(read);
  assert.equal(told.length, 1);
  assert.equal(told[0].given, 2, 'the inline picture and the id, and neither of the strings beside them');
  assert.match(told[0].reason, /^2 photographs/);
});

test('a field holding nothing that is a picture says nothing at all', () => {
  const read = readArchive({
    app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'p1', name: 'A place', lat: 46, lng: 8, tags: [], photos: ['x', 'https://x.test/a.png'] }],
  });
  assert.deepEqual(setAside(read), [], 'nobody is told about photographs that were never there');
  assert.deepEqual(losses(read), [], 'and nothing about it stops the atlas coming home');
});

test('a stranger’s pictures are simply not there, and nobody is told', () => {
  const v = normImport({
    places: [{ id: 'p1', name: 'Theirs', lat: 46, lng: 8, tags: [],
      photos: ['data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)'] }],
  });
  assert.equal('photos' in v.places[0], false, 'a stranger plants nothing');
  // the silence is the point: a hostile link may not spend a person's
  // attention any more than it may spend their browser
  assert.equal(JSON.stringify(v).includes('data:image/'), false);
});

test('a set-aside field never reaches the list a restore refuses on', () => {
  const flat = losses({
    clipped: [
      { kind: 'place', id: 'p1', field: 'note', reason: 'the note is 4001 characters' },
      { kind: 'place', id: 'p1', field: 'photos', setAside: true, given: 3, kept: 0, reason: 'three photographs' },
    ],
  });
  assert.equal(flat.length, 1, 'a shortened note stops the restore');
  assert.equal(flat[0].field, 'note');
  assert.equal(setAside({ clipped: [] }).length, 0);
  assert.deepEqual(setAside(null), [], 'and nothing read set nothing aside');
});

test('a byline is bounded for a stranger and unbounded for its author', () => {
  const long = 'A'.repeat(500);
  const read = readArchive({ places: [], settings: { authorName: long } });
  assert.equal(read.value.settings.authorName.length, 500);
  assert.deepEqual(read.clipped, []);
  assert.equal(normImport({ places: [], settings: { authorName: long } }).settings.authorName.length,
    LIMITS.author);
});


// ---------- the witness ----------

test('the witness names the field and the record when a cap does bite', () => {
  // called with the stranger’s numbers on purpose: this is what proves the
  // silence on an own archive means "nothing was cut" and not "nobody looked"
  const w = [];
  const p = normPlace({
    id: 'p1', lat: 46, lng: 8,
    note: 'n'.repeat(LIMITS.note + 1),
    tags: Array.from({ length: LIMITS.tagsPerPlace + 1 }, (_, i) => 't' + i),
  }, 0, LIMITS, w);

  assert.equal(p.note.length, LIMITS.note);
  assert.equal(p.tags.length, LIMITS.tagsPerPlace);
  assert.deepEqual(w.map(e => e.field).sort(), ['note', 'tags']);
  assert.ok(w.every(e => e.kind === 'place' && e.id === 'p1'), 'a loss without a record is not a loss anyone can act on');
  assert.ok(w.every(e => typeof e.reason === 'string' && e.reason), 'and each says why, in words');
});

test('losses flattens the three ways a file comes home shorter into one list', () => {
  const flat = losses({
    cut: [{ of: 'places', given: 501, kept: 500 }],
    rejected: [{ kind: 'way', id: 'r9', at: 3, field: null, reason: 'this record could not be read' }],
    clipped: [{ kind: 'place', id: 'p1', field: 'note', given: 4001, kept: 4000, reason: 'the note is 4001 characters' }],
  });
  assert.equal(flat.length, 3, 'a caller reads one list, not three');
  assert.deepEqual(flat.map(l => l.kind), ['places', 'way', 'place']);
  assert.deepEqual(flat.map(l => l.id), [null, 'r9', 'p1']);
  assert.deepEqual(flat.map(l => l.field), [null, null, 'note']);
  assert.ok(flat.every(l => typeof l.reason === 'string' && l.reason));
  assert.deepEqual(losses(null), [], 'and nothing read lost nothing');
});

test('a record that cannot be read is named, so a person is told which', () => {
  const read = readArchive({
    app: 'resonate', version: 4,
    places: [
      { id: 'ok', name: 'Fine', lat: 46, lng: 8 },
      { id: 'nowhere', name: 'No coordinates' },
      { id: 'offworld', name: 'Off the globe', lat: 999, lng: 8 },
    ],
  });
  assert.equal(read.value.places.length, 1);
  assert.deepEqual(read.rejected.map(r => r.id), ['nowhere', 'offworld']);
  assert.deepEqual(read.rejected.map(r => r.kind), ['place', 'place']);
  assert.deepEqual(read.rejected.map(r => r.at), [1, 2], 'and where in the file to look');
  assert.equal(losses(read).length, 2);
});

test('a file that is not an object is not an archive', () => {
  assert.equal(readArchive(null), null);
  assert.equal(readArchive('an atlas'), null);
  assert.equal(readArchive([]), null);
});

test('a file that does not say it is an archive is refused, empty or not', () => {
  // {} used to read as a perfectly good empty atlas. an archive nobody can
  // identify is exactly the one to be careful with, and every file this app
  // has ever written names itself.
  assert.match(losses(readArchive({})).map(l => l.reason).join(' '), /does not say/);
  const empty = readArchive({ app: 'resonate', version: 4 });
  assert.deepEqual(empty.value.places, []);
  assert.deepEqual(losses(empty), [], 'an empty atlas that names itself is still an atlas');
});


// ---------- what a file says about the look ----------

test('a file carries exactly the settings PORTABLE_SETTINGS names', () => {
  const out = normSettings({
    authorName: 'Mira', theme: 'dark', hue: 400, split: 999, words: false,
    introSeen: true, lastExportAt: '2026-01-01T00:00:00Z', erasedAt: '2025-12-24T00:00:00Z',
    clubKey: 'tc_secret', lastView: { z: 4 }, seeded: true, chosen: true,
  });
  assert.deepEqual(Object.keys(out).sort(), [...PORTABLE_SETTINGS].sort(),
    'the file says it carries your settings, so it has to carry them, and only them');
  assert.equal(out.hue, 40, 'a hue is an angle');
  assert.equal(out.split, 180, 'and the angle between the halves is bounded');
  assert.equal(out.words, false, 'a false is a decision, not an absence');
  assert.equal('clubKey' in out, false, 'a bearer credential is not a setting');
  assert.equal('lastView' in out, false, 'and where the map was last looking is not a memory');
});

test('settings that say nothing are carried as nothing', () => {
  assert.deepEqual(normSettings({}), {});
  assert.deepEqual(normSettings(null), {});
  assert.deepEqual(normSettings({ theme: 'chartreuse', hue: 'blue' }), {},
    'a value that is not one of the answers is no answer');
});

test('a point with no elevation reading does not become a reading of sea level', () => {
  // parseGPX writes ele: null for a trackpoint with no <ele>. Number(null) is
  // 0, which is finite, so an unmeasured point used to come back from every
  // reload as a measured sea level reading, and the way's climb with it.
  const raw = {
    app: 'resonate', version: 4, tags: [], places: [],
    routes: [{
      id: 'w1', name: 'flat', ascent: null, descent: null, high: null, low: null,
      path: [{ lat: 46, lng: 8, ele: null }, { lat: 46.01, lng: 8.01, ele: null }],
    }],
  };
  const read = readArchive(raw);
  const way = read.value.routes[0];
  assert.equal('ele' in way.path[0], false, 'unknown is not zero');
  assert.equal(way.ascent, null, 'and an unknown climb is not a flat one');
  assert.equal(way.high, null);
  assert.deepEqual(losses(read), [], 'and nothing was lost in saying so');
});

test('a point that really is at sea level keeps its reading', () => {
  const read = readArchive({
    app: 'resonate', version: 4, tags: [], places: [],
    routes: [{ id: 'w2', name: 'the shore', path: [{ lat: 46, lng: 8, ele: 0 }, { lat: 46.01, lng: 8.01, ele: 2 }] }],
  });
  assert.equal(read.value.routes[0].path[0].ele, 0, 'zero written on purpose is still zero');
});

test('the loss report names a record by the word a person sees', () => {
  // the kind strings in losses() are read out loud in the app, so they are
  // copy: they were "way" and the app now says "path" everywhere else
  const read = readArchive({
    app: 'resonate', version: 4, tags: [],
    places: [{ id: 'good', name: 'Kept', lat: 46, lng: 8, tags: [] }, { id: 'bad', name: 'No coordinates' }],
    routes: [{ id: 'stub', name: 'One point', path: [{ lat: 46, lng: 8 }] }],
  });
  const kinds = losses(read).map(l => l.kind);
  assert.ok(kinds.includes('place'), 'a place is called a place');
  assert.ok(kinds.includes('path'), `a path is called a path, not: ${kinds.join(', ')}`);
  assert.equal(kinds.includes('way'), false, 'and never the old word');
});

// ---------- one number became four ----------
//
// SCHEMA_VERSION was one constant serving two unrelated protocols: the private
// archive and the handover a person sends. One could not move for one without
// moving for the other, which is why the split had to happen before the archive
// gains anything. Every call site now names its protocol.

test('the four protocol numbers are separate, and separately readable', () => {
  assert.ok(Number.isInteger(ARCHIVE_VERSION), 'the archive has a number of its own');
  assert.ok(Number.isInteger(SHARE_VERSION), 'and so does a handover');
  // declared at the split before anything uses them, on purpose: they are the
  // numbers the next release needs, and the point of the refactor is that a
  // call site must name its protocol rather than reach for whichever number
  // happens to be in scope.
  assert.equal(ASSISTANT_TASK_VERSION, 1);
  assert.equal(ASSISTANT_RESULT_VERSION, 1);
});

// The other side of the same door. The archive gate below has refused a newer
// file since the numbers split; the handover gate did not exist. normPayload
// read `v`, coerced it, and handed it back untouched, so a build knowing five
// would have taken a version-6 link, let the normalizers drop every field it
// has no place for, and shown the remainder as the atlas somebody sent.
test('a handover from a build this one does not know is refused whole', () => {
  const atlas = (v) => ({ v, kind: 'atlas', places: [{ id: 'p', name: 'A', lat: 46, lng: 8 }] });

  // a link written before there were numbers is a whole handover, not a
  // truncated one, and stays readable as the first version
  assert.equal(normPayload({ kind: 'atlas', places: atlas(1).places }).v, 1, 'a link with no number');
  assert.equal(normPayload(atlas(1)).v, 1);
  assert.equal(normPayload(atlas(SHARE_VERSION)).v, SHARE_VERSION);

  for (const v of [SHARE_VERSION + 1, 999, 0, -1, 1.5, NaN, Infinity]) {
    assert.equal(normPayload(atlas(v)), null, `a handover numbered ${v} was accepted`);
  }
  // deliberately refused rather than coerced: this app writes the number, and
  // a payload saying its version in another type is not one whose shape can be
  // assumed from what it says
  assert.equal(normPayload(atlas('5')), null, 'a number written as text was read as a number');
  assert.equal(normPayload(atlas(null)), null);

  // and the refusal is the whole payload, so nothing arrives half-read
  const ask = { v: SHARE_VERSION + 1, kind: 'ask', q: 'where should we eat' };
  assert.equal(normPayload(ask), null, 'an ask skipped the gate');
});

// A task and a result have no past: nothing has ever written one. So they
// accept their own number exactly, in both directions, and the policy is
// settled here rather than by whoever writes the first reader.
test('an assistant task or result is accepted at its own number and no other', () => {
  assert.equal(assistantTaskVersionOK(ASSISTANT_TASK_VERSION), true);
  assert.equal(assistantResultVersionOK(ASSISTANT_RESULT_VERSION), true);
  for (const v of [0, 2, 1.5, '1', null, undefined, NaN]) {
    assert.equal(assistantTaskVersionOK(v), false, `a task numbered ${String(v)} was accepted`);
    assert.equal(assistantResultVersionOK(v), false, `a result numbered ${String(v)} was accepted`);
  }
});

test('the archive gate reads the archive number and refuses what is past it', () => {
  const file = theLossTable();
  file.version = ARCHIVE_VERSION + 1;
  const read = readArchive(file);
  // the gate names the refusal in the witness; the store is what stops on it,
  // because a non-empty loss refuses a whole restore before a record is written
  const said = losses(read).map(l => l.reason || '').join(' ');
  assert.match(said, /newer resonate/, 'a newer archive was not refused, or not in words');
  assert.match(said, new RegExp(`its form is ${ARCHIVE_VERSION + 1}`),
    'the refusal did not name the form the file is in');
});

// ---------- a file is asked what it is, once, before anything reads it ----------
//
// The file door asked one question: is this a private archive? Everything else
// was told it was not a resonate export, which was untrue of the file this app
// itself offers when a link is too long to send. That file had no reader
// anywhere in the app that wrote it.

const anArchive = () => ({ app: 'resonate', version: ARCHIVE_VERSION, tags: [], routes: [], folios: [],
  correspondents: [], settings: {}, places: [{ id: 'p1', name: 'Sentinel', lat: 46, lng: 8, tags: [] }] });
const aHandover = () => ({ app: 'resonate', exportedAt: 'T', v: SHARE_VERSION, kind: 'atlas',
  author: 'ada', tags: [], routes: [], places: [{ id: 'p1', name: 'Sentinel', lat: 46, lng: 8 }] });
const anAssistantCopy = () => ({ app: 'resonate', kind: 'assistant_copy', exportedAt: 'T',
  terms: 'https://resonate.select/read.html?d=assistant', disclosure: { v: SHARE_VERSION, kind: 'atlas',
    author: 'ada', tags: [], routes: [], places: [{ id: 'p1', name: 'Sentinel', lat: 46, lng: 8 }] } });

test('each file this app writes is recognised as the kind it is', () => {
  assert.equal(classifyFile(anArchive()).kind, 'private_archive');
  assert.equal(classifyFile(aHandover()).kind, 'human_handover');
  assert.equal(classifyFile(anAssistantCopy()).kind, 'assistant_copy');

  // and what each answer carries is what its door needs: an archive is handed
  // on whole for the archive gate to read, and the other two arrive already
  // through the handover gate, so no door reads an unchecked payload
  assert.equal(classifyFile(anArchive()).value.version, ARCHIVE_VERSION);
  assert.equal(classifyFile(aHandover()).value.places[0].name, 'Sentinel');
  assert.equal(classifyFile(anAssistantCopy()).value.places[0].name, 'Sentinel',
    'the atlas inside the copy is what the copy classifies as');
});

test('a file answering to two descriptions is refused rather than read by the first branch', () => {
  // the danger is not hypothetical in shape: an archive may be replaced into
  // this atlas, a handover may not, and a file claiming both would otherwise
  // be routed by whichever `if` happens to be written first
  const both = { ...anArchive(), kind: 'atlas', v: SHARE_VERSION };
  assert.equal(classifyFile(both).kind, 'ambiguous');
  assert.equal(classifyFile(both).value, null, 'an ambiguous file handed something on anyway');

  const alsoBoth = { ...anAssistantCopy(), version: ARCHIVE_VERSION };
  assert.equal(classifyFile(alsoBoth).kind, 'ambiguous');
});

test('a file from somewhere else and a resonate file with no readable shape are told apart', () => {
  assert.equal(classifyFile({ app: 'some-other-program', version: 4 }).kind, 'unknown');
  assert.equal(classifyFile(null).kind, 'unknown');
  assert.equal(classifyFile([]).kind, 'unknown', 'an array is not a file this app wrote');
  assert.equal(classifyFile('{}').kind, 'unknown');

  // ours, and nothing in it a reader here answers to. said apart from unknown
  // because the two deserve different sentences
  assert.equal(classifyFile({ app: 'resonate' }).kind, 'unreadable');
  assert.equal(classifyFile({ app: 'resonate', kind: 'atlas', places: [], routes: [] }).kind, 'unreadable',
    'an empty handover is ours and empty, not somebody else’s file');
  assert.equal(classifyFile({ app: 'resonate', version: 1.5 }).kind, 'unreadable',
    'a version that is not a whole number is not an archive number');
});

test('a handover from a build this one does not know is not classified as a handover', () => {
  // the version gate is inside the classifier by construction, because the
  // classifier asks the gate rather than reading the shape itself
  const future = { ...aHandover(), v: SHARE_VERSION + 1 };
  assert.equal(classifyFile(future).kind, 'unreadable');
  const futureCopy = anAssistantCopy();
  futureCopy.disclosure.v = SHARE_VERSION + 1;
  assert.equal(classifyFile(futureCopy).kind, 'unreadable');
});

test('a folio and an ask arrive as files the same way they arrive as links', () => {
  const folio = { app: 'resonate', v: SHARE_VERSION, kind: 'folio', title: 'Basel', author: 'ada',
    tags: [], routes: [], places: [{ id: 'p1', name: 'Sentinel', lat: 46, lng: 8 }] };
  const asked = classifyFile(folio);
  assert.equal(asked.kind, 'human_handover');
  assert.equal(asked.value.kind, 'folio', 'a folio arrived as a bare atlas');
  assert.equal(asked.value.title, 'Basel');

  const ask = { app: 'resonate', v: SHARE_VERSION, kind: 'ask', from: 'bruno', q: 'where should we eat' };
  assert.equal(classifyFile(ask).kind, 'human_handover');
  assert.equal(classifyFile(ask).value.kind, 'ask');
});

// ---------- a thanks: one heart, for one place, carried back ----------

test('a thanks passes the gate whole, and half a thanks does not pass at all', () => {
  const whole = { v: SHARE_VERSION, kind: 'thanks', from: 'bruno', pid: 'p_x1',
    name: 'Cervejaria Ramiro', at: { lat: 38.72136, lng: -9.13563 }, when: '2026-08-11T00:00:00.000Z' };
  const read = normPayload(whole);
  assert.ok(read, 'a well-formed thanks was refused');
  assert.equal(read.kind, 'thanks');
  assert.equal(read.pid, 'p_x1');
  assert.equal(read.at.lat, 38.72136);

  // `when` is the whole of the replay defence, so a thanks without one is
  // not counted rather than counted forever
  assert.equal(normPayload({ ...whole, when: '' }), null, 'a thanks with no when passed');
  assert.equal(normPayload({ ...whole, name: '' }), null, 'a thanks naming no place passed');
  // a byline is not required: a person may have declined one, and gratitude
  // unsigned is still gratitude
  assert.equal(normPayload({ ...whole, from: '' }).kind, 'thanks');
  // a point outside the world is no point, and the name still lands the heart
  const wild = normPayload({ ...whole, at: { lat: 999, lng: 0 } });
  assert.equal(wild.at, null);
  assert.equal(wild.name, 'Cervejaria Ramiro');
});

test('hearts enter by the own door and no other', () => {
  const carried = { id: 'p1', name: 'A', lat: 46, lng: 8, tags: [],
    thanks: [{ from: 'marta', when: '2026-08-11T00:00:00.000Z' }, { from: '', when: 'T2' }] };

  const own = readArchive({ app: 'resonate', version: ARCHIVE_VERSION, tags: [], routes: [],
    folios: [], correspondents: [], settings: {}, places: [carried] });
  assert.equal(own.value.places[0].thanks.length, 2, 'a person’s own hearts did not come home');
  assert.equal(own.value.places[0].thanks[0].from, 'marta');
  assert.deepEqual(losses(own), [], 'and nothing about them reads as a loss');

  // a stranger's file claiming hearts is manufacturing the evidence the
  // field exists to witness. dropped without a word, like their photographs.
  const stranger = normImport({ places: [carried] });
  assert.equal('thanks' in stranger.places[0], false, 'a stranger planted gratitude');

  // and an entry that will not say when is not an entry
  const trimmed = readArchive({ app: 'resonate', version: ARCHIVE_VERSION, tags: [], routes: [],
    folios: [], correspondents: [], settings: {},
    places: [{ ...carried, thanks: [{ from: 'x', when: '' }] }] });
  assert.equal('thanks' in trimmed.value.places[0], false,
    'a heart with no when survived as a shape');
});

test('the id a record wore in the sender’s atlas survives adoption in provenance', () => {
  const own = readArchive({ app: 'resonate', version: ARCHIVE_VERSION, tags: [], routes: [],
    folios: [], correspondents: [], settings: {},
    places: [{ id: 'mine', name: 'A', lat: 46, lng: 8, tags: [],
      provenance: { name: 'Marta', adoptedAt: 'T', chain: [], srcId: 'theirs_9' } }] });
  assert.equal(own.value.places[0].provenance.srcId, 'theirs_9');
  // absent when empty: one shape everywhere
  const bare = readArchive({ app: 'resonate', version: ARCHIVE_VERSION, tags: [], routes: [],
    folios: [], correspondents: [], settings: {},
    places: [{ id: 'mine', name: 'A', lat: 46, lng: 8, tags: [],
      provenance: { name: 'Marta', adoptedAt: 'T', chain: [] } }] });
  assert.equal('srcId' in bare.value.places[0].provenance, false);
});

test('a version-6 reader would refuse what this build writes, and this build says so', () => {
  // the archive number moved for the hearts, and again for books: a record
  // that may answer to no place could not be folded into places, so it
  // arrives as a collection of its own and a version-6 build reading this
  // would restore an atlas with every book silently missing. the reading
  // ceiling moved when books learned to ride a handover. the gate math is
  // pinned elsewhere, and this pins the two deliberate acts themselves so a
  // merge cannot lower either back
  assert.equal(ARCHIVE_VERSION, 7);
  assert.equal(SHARE_VERSION, 8);
});

test('books ride a handover now, and the number that says so is conditional', () => {
  // KIND_VERSION does not move: the usual shape of an atlas is unchanged,
  // and a bookless link must keep opening in every build already shipped. So
  // the number an atlas or a folio declares is decided by its own contents,
  // at the moment it is built: carrying books, BOOKS_RIDE_AT, so a shipped
  // 7-reader refuses the whole payload out loud instead of keeping the
  // places and dropping the shelf in silence; carrying none, the kind's own
  // number. The builder's half of this claim is pinned in test/atlas.test.mjs,
  // where the builder can be loaded.
  assert.deepEqual(KIND_VERSION, { atlas: 6, folio: 6, ask: 6, thanks: 6, intro: 7 });
  assert.equal(BOOKS_RIDE_AT, 8);
  assert.equal(BOOKS_RIDE_AT, SHARE_VERSION,
    'the shelf is the newest thing a payload can say, so its number is the ceiling');
  const shared = normImport({
    places: [{ id: 'p1', name: 'A place', lat: 1, lng: 2 }],
    books: [{ id: 'b1', title: 'A book' }],
  });
  assert.ok(shared, 'a stranger\u2019s atlas naming books must still open');
  assert.equal(shared.places.length, 1);
  assert.equal((shared.books ?? []).length, 1, 'a book arrives over a handover now');
  assert.equal(shared.books[0].title, 'A book');
});

test('an atlas of books and no places is still a handover', () => {
  // a shelf handed over alone is what a reading friend actually keeps, and
  // refusing it because no coordinate came along would be the map deciding
  // what counts as a record
  const read = normPayload({ v: 8, kind: 'atlas', books: [{ id: 'b1', title: 'Invisible Cities', author: 'Italo Calvino' }] });
  assert.ok(read);
  assert.equal(read.books.length, 1);
  assert.equal(read.places.length, 0);
  // and above the ceiling the whole payload is refused, shelf and all
  assert.equal(normPayload({ v: 9, kind: 'atlas', books: [{ id: 'b1', title: 'X' }] }), null);
});

test('a book arrives off a link carrying its road, read like a place\u2019s own', () => {
  const read = normPayload({
    v: 8, kind: 'atlas',
    books: [{ id: 'b1', title: 'A Moveable Feast',
      prov: [{ name: 'Ada', at: '2024-05-01' }, { name: 'L\u00e9a', at: '2026-02-11' }] }],
  });
  assert.ok(read);
  const prov = read.books[0].provenance;
  assert.equal(prov.name, 'L\u00e9a', 'the last hand on the road is the byline');
  assert.equal(prov.adoptedAt, '2026-02-11');
  assert.deepEqual(prov.chain, [{ name: 'Ada', at: '2024-05-01' }]);
  assert.equal(prov.sig, 0);
  // and a road of noise is no road at all, not a half-built one
  assert.equal('provenance' in normPayload({
    v: 8, kind: 'atlas', books: [{ id: 'b2', title: 'X', prov: [{ at: 'no name' }] }],
  }).books[0], false);
});

test('a folio in an archive keeps its shelf, and may not name a book the file left out', () => {
  const base = { ...anArchive(), books: [{ id: 'b1', title: 'A book' }] };
  const whole = readArchive({ ...base, folios: [{ id: 'f1', title: 'F', placeIds: [], routeIds: [], bookIds: ['b1'] }] });
  assert.equal(whole.refused.length, 0);
  assert.deepEqual(whole.value.folios[0].bookIds, ['b1']);
  const torn = readArchive({ ...base, folios: [{ id: 'f1', title: 'F', placeIds: [], routeIds: [], bookIds: ['b_gone'] }] });
  assert.ok(torn.refused.some(x => x.kind === 'folio' && x.field === 'contents'),
    'a folio naming a book the file does not carry is a loss said out loud');
});

test('what each kind declares is what that kind is, and not what this build can read', () => {
  // The two numbers parted company when the protocol gained an introduction,
  // and the whole reason is in this table. SHARE_VERSION is the ceiling this
  // build reads to. KIND_VERSION is what each kind SAYS about itself, and an
  // atlas has not changed since 6: if it declared 7 because the app had
  // learned a new kind, every build shipped since 6 would refuse an atlas it
  // understands perfectly, and would be right to, because the number said so.
  assert.deepEqual(KIND_VERSION, { atlas: 6, folio: 6, ask: 6, thanks: 6, intro: 7 });
  // and no kind may claim a number this build cannot read, which would be a
  // build writing links it refuses to open itself
  for (const [kind, v] of Object.entries(KIND_VERSION)) {
    assert.ok(v <= SHARE_VERSION, `${kind} declares ${v}, above what this build reads`);
  }
});

// ---------- an introduction ----------

const anIntro = (over = {}) => ({
  v: KIND_VERSION.intro, kind: 'intro', from: 'ada',
  pub: 'B' + 'A'.repeat(86),
  cap: `${'9c7k2m4n6p8q0r2s4t6v8w0x2y'}.${'a1b3c5d7e9f0g2h4j5k6m7n8p9'}`,
  ...over,
});

test('an introduction carries a key and an address, and nothing else at all', () => {
  const read = normPayload(anIntro({ places: [{ id: 'p', name: 'X', lat: 1, lng: 2 }], note: 'hi' }));
  assert.ok(read);
  assert.deepEqual(Object.keys(read).sort(), ['cap', 'from', 'kind', 'pub', 'v']);
});

test('an introduction missing either half is not a partial introduction', () => {
  // It is a thing somebody could store beside a name and later believe they
  // had paired with. There is no half of this that is worth keeping.
  assert.equal(normPayload(anIntro({ pub: '' })), null);
  assert.equal(normPayload(anIntro({ cap: '' })), null);
  assert.equal(normPayload(anIntro({ pub: undefined })), null);
  assert.equal(normPayload(anIntro({ cap: undefined })), null);
});

test('a key or an address of the wrong shape is refused here, not deep inside a crypto call', () => {
  // the leading B is the 0x04 that says uncompressed point: some other kind of
  // point is refused by its shape rather than by importKey's word for it
  assert.equal(normPayload(anIntro({ pub: 'A' + 'A'.repeat(86) })), null);
  assert.equal(normPayload(anIntro({ pub: 'B' + 'A'.repeat(85) })), null);
  assert.equal(normPayload(anIntro({ pub: 'B' + 'A'.repeat(87) })), null);
  assert.equal(normPayload(anIntro({ pub: 'B' + '.'.repeat(86) })), null);
  // both halves of a capability, in the club's alphabet, joined by one dot
  assert.equal(normPayload(anIntro({ cap: '9c7k2m4n6p8q0r2s4t6v8w0x2y' })), null);
  assert.equal(normPayload(anIntro({ cap: '9c7k2m4n6p8q0r2s4t6v8w0x2y.short' })), null);
  assert.equal(normPayload(anIntro({ cap: 'iiii2m4n6p8q0r2s4t6v8w0x2y.a1b3c5d7e9f0g2h4j5k6m7n8p9' })), null);
  assert.equal(normPayload(anIntro({ cap: 'A'.repeat(26) + '.' + 'A'.repeat(26) })), null);
});

test('a build that reads to six refuses an introduction rather than opening it as an atlas', () => {
  // The mechanism, stated in the one direction that matters. This build reads
  // to eight, so the refusal is simulated the only honest way: a payload
  // numbered above what a reader knows is refused whole, and an introduction
  // is numbered above six on purpose so that exactly this happens over there.
  assert.ok(KIND_VERSION.intro > 6);
  assert.ok(KIND_VERSION.intro <= SHARE_VERSION);
  assert.equal(normPayload({ ...anIntro(), v: SHARE_VERSION + 1 }), null);
});
