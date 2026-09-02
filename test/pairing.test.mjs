// pairing.test.mjs — the arithmetic two people say out loud to each other.
//
// The mark is the only part of direct exchange that a person performs by hand,
// and it is the only defence against a substituted address or a substituted
// key. Everything below is therefore about what the mark covers and what it
// deliberately does not, because a mark that binds the wrong things is worse
// than none: it teaches two people that they have checked something.
//
// The rest of the file is the state machine, which exists so that trust is
// never a boolean. Every transition here is one somebody could reach without
// meaning to, and the ones that must be loud are asserted to be loud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  markOf, routeOf, maySend, stillDescribes, onIntroduction, onVersion, isState, mergeLetters,
  PAIRING, PAIRING_VERSION,
} = await import('../js/pairing.js');
const { splitCap, isCapId } = await import('../club/src/validate.js');
const { normLetters } = await import('../js/schema.js');

// two routes and two keys, written the way the club and the letters module
// actually write them: a route is the club's alphabet, a key is base64url of
// sixty-five bytes
const ADA = { pub: 'BAda' + 'x'.repeat(83), route: '9c7k2m4n6p8q0r2s4t6v8w0x2y' };
const BRUNO = { pub: 'BBru' + 'y'.repeat(83), route: 'a1b3c5d7e9f0g2h4j5k6m7n8p9' };

test('the fixtures in this file are shapes the gate accepts', () => {
  // Otherwise everything below it is vacuous in the quietest possible way: a
  // key one character short is dropped by normLetters, every merge returns an
  // empty slice, and half the assertions pass because nothing happened. This
  // file lost an hour to exactly that.
  for (const who of [ADA, BRUNO]) {
    const read = normLetters({ v: 1, jwk: null, pub: who.pub, route: who.route, pairs: [] });
    assert.equal(read.pub, who.pub, 'a fixture key is not a key the gate reads');
    assert.equal(read.route, who.route, 'a fixture address is not one the gate reads');
  }
});

// ---------- the mark ----------

test('the mark is the same on both sides, because neither went first', async () => {
  // Ada computes it from her own route and the one she read out of Bruno's
  // introduction; Bruno computes it the other way around. Nothing in the
  // ceremony tells either of them which of them is `a`, so an asymmetric mark
  // would be two people reading different strings and concluding the worst.
  assert.equal(await markOf(ADA, BRUNO), await markOf(BRUNO, ADA));
});

test('the mark is twenty characters of the club alphabet, in five groups of four', async () => {
  const said = await markOf(ADA, BRUNO);
  const four = '[0-9abcdefghjkmnpqrstvwxyz]{4}';
  assert.match(said, new RegExp(`^${four} ${four} ${four} ${four} ${four}$`));
  // no i, l, o or u: a mark is read aloud and then typed by somebody who has
  // only heard it. Five groups rather than one run, because a person reading
  // twenty characters down a telephone loses their place in the middle.
  assert.equal(said.replace(/ /g, '').length, 20);
});

test('the mark is wide enough that nobody can grind two of them together', async () => {
  // What a spoken mark costs to defeat is not what one costs to hit. Standing
  // between Ada and Bruno, an impostor shows each of them a key of its own and
  // needs only
  //
  //   markOf(ada, the key it showed Ada) === markOf(bruno, the key it showed Bruno)
  //
  // and both halves are its own to choose. It knows all four fixed values
  // before it substitutes anything, and there is no commitment anywhere in this
  // ceremony that would make it choose first and learn afterwards. So it is a
  // birthday search between two sets it controls: 2^(n/2) keys a side, not 2^n.
  //
  // At the forty bits this began with that is about a million keypairs each
  // way, which is under a minute of one core, and the comment over markOf
  // priced it at a million million. Ninety-six bits puts the same search at
  // 2^48 a side, and there it stays.
  //
  // Asserted in bits, off the source, because the characters are the part that
  // could be widened or narrowed without anybody costing it.
  const src = (await import('node:fs')).readFileSync(
    new URL('../js/pairing.js', import.meta.url), 'utf8');
  const cut = /digest\.slice\(0, (\d+)\)/.exec(src);
  assert.ok(cut, 'the mark no longer takes a prefix of the digest, so this cannot cost it');
  const bits = Number(cut[1]) * 8;
  assert.ok(bits >= 96,
    `a mark of ${bits} bits is ${bits / 2} bits against somebody standing in the middle`);
});

test('the gate keeps a whole mark, because half a mark is a mark that never matches', async () => {
  // normPair clips `mark` to a fixed width. A width left behind markOf writes
  // every mark down short, and a short mark never equals the one computed the
  // next time, so the pairing cannot be verified at all. The truncation is
  // silent and the symptom is a ceremony that simply does not take.
  const said = await markOf(ADA, BRUNO);
  const read = normLetters({ v: 1, jwk: null, pub: '', route: '', pairs: [{ id: 'p1', mark: said }] });
  assert.equal(read.pairs[0].mark, said, 'the gate clipped a mark that markOf produced');
});

test('a substituted address changes the mark, which is what it is for', async () => {
  // The attack: somebody who can change which box you post to cuts two people
  // off, and nothing they read to each other would notice unless the route is
  // in the material.
  const elsewhere = { ...BRUNO, route: 'zzzz2m4n6p8q0r2s4t6v8w0x2y' };
  assert.notEqual(await markOf(ADA, BRUNO), await markOf(ADA, elsewhere));
});

test('a substituted key changes the mark, from either side', async () => {
  const notAda = { ...ADA, pub: 'BAdb' + 'x'.repeat(83) };
  const notBruno = { ...BRUNO, pub: 'BBrv' + 'y'.repeat(83) };
  const said = await markOf(ADA, BRUNO);
  assert.notEqual(await markOf(notAda, BRUNO), said);
  assert.notEqual(await markOf(ADA, notBruno), said);
});

test('the mark says nothing about the posting secret, on purpose', async () => {
  // A capability is revocable and re-mintable by design, and the secret half
  // of it changes whenever a correspondent re-mints. If the mark covered it,
  // an ordinary act of hygiene would send two people back to the telephone,
  // and a ceremony performed too often is a ceremony performed carelessly.
  //
  // This is stated as a property of routeOf and markOf together: the same
  // route with two different secrets is the same address.
  const one = `${BRUNO.route}.00001111222233334444555566`;
  const two = `${BRUNO.route}.44445555666677778888999900`;
  assert.equal(routeOf(one), routeOf(two));
  assert.equal(
    await markOf(ADA, { pub: BRUNO.pub, route: routeOf(one) }),
    await markOf(ADA, { pub: BRUNO.pub, route: routeOf(two) }));
});

test('the version is in the material, so a later mark is a different mark', async () => {
  // Not a behaviour that can be observed from outside, so it is read from the
  // source: the day PAIRING_VERSION moves, every pair has to read again, and
  // that only happens if the number is actually in what is hashed.
  const src = (await import('node:fs')).readFileSync(
    new URL('../js/pairing.js', import.meta.url), 'utf8');
  assert.match(src, /resonate pairing v\$\{PAIRING_VERSION\}/);
  assert.equal(typeof PAIRING_VERSION, 'number');
});

test('a half-known pairing has no mark to read', async () => {
  // Before an introduction comes back there is nothing to compare, and a mark
  // computed over a missing half is a string two people could still read to
  // each other and agree on.
  assert.equal(await markOf(ADA, { pub: '', route: '' }), '');
  assert.equal(await markOf(ADA, { pub: BRUNO.pub, route: '' }), '');
  assert.equal(await markOf(null, BRUNO), '');
});

// ---------- the address ----------

test('this file and the club split a capability by the same rule', async () => {
  // Two implementations of one rule drift. The browser must not import the
  // worker, so the rule is written twice and held against the same corpus
  // here; a change to either side that is not made to the other stops now.
  const cases = [
    `${ADA.route}.00001111222233334444555566`,
    `${BRUNO.route}.${'z'.repeat(26)}`,
    'nodothere',
    '.00001111222233334444555566',
    `${ADA.route}.`,
    `${ADA.route}.short`,
    'UPPER00112233445566778899ab.00001111222233334444555566',
    `${ADA.route}.00001111222233334444555566.extra`,
    `iiii11112222333344445555ab.00001111222233334444555566`,   // i is not in the alphabet
    // a route is twenty-six characters and not "some characters": the club's
    // isRoute counts them, and a browser that accepted a shorter or a longer
    // one would compose against an address the club refuses to deliver to
    '9c7k2m4n6p8q0r2s.9c7k2m4n6p8q0r2s',
    '9c7k2m4n6p8q0r2s4t6v8w0x2y7z.9c7k2m4n6p8q0r2s4t6v8w0x2y7z',
    '',
    null,
  ];
  for (const c of cases) {
    const club = splitCap(c);
    assert.equal(routeOf(c), club ? club.route : '',
      `the two rules disagree about ${JSON.stringify(c)}`);
  }
});

test('a handle the club would not answer to is not kept as a shorter one', () => {
  // The same corpus problem one field along, and the field where clipping is
  // worst. `capId` is what withdrawing names at the club, and the letters panel
  // reads its mere presence as "they can write to you". So eight characters
  // kept out of twenty is a row that says an address exists, over a name the
  // club refuses, with no word on the row that could mint a working one. The
  // gate refuses the field and keeps the person, and `send them mine` comes
  // back; the club's own isCapId is the arbiter of which is which.
  const cases = [
    '9c7k2m4n',                 // eight of the alphabet: the only shape there is
    '9c7k2m4',                  // one short
    '9c7k2m4n6',                // one long
    '9c7k2m4n6p8q0r2s4t6v8w0x', // twenty-four, and sixteen of it is a valid-looking lie
    '9C7K2M4N',                 // the alphabet is lower case
    '9c7k2m4i',                 // i is not in the alphabet
    '9c7k2m4.',
    '',
    null,
    undefined,
    12345678,
  ];
  for (const c of cases) {
    const read = normLetters({ v: 1, jwk: null, pub: '', route: '', pairs: [{ id: 'p1', capId: c }] });
    assert.equal(read.pairs.length, 1,
      `the pairing was dropped over a handle: ${JSON.stringify(c)}`);
    assert.equal(read.pairs[0].capId, isCapId(c) ? c : '',
      `the two rules disagree about ${JSON.stringify(c)}`);
  }
});

// ---------- who may be sent to ----------

test('only a verified pairing sends', () => {
  // The whole of the policy. A surface that forgets to ask cannot decide
  // otherwise, because it has to come through here.
  // The version rides in the fixture because the gate asks for it. Without it
  // this test was green about the wrong thing for one commit: every state read
  // as refused, including the one it exists to prove sends.
  const held = { pub: BRUNO.pub, cap: `${BRUNO.route}.00001111222233334444555566`, v: PAIRING_VERSION };
  for (const state of Object.values(PAIRING)) {
    assert.equal(maySend({ ...held, state }), state === PAIRING.verified,
      `a pairing in state ${state} was allowed to send`);
  }
  assert.equal(maySend(null), false);
});

test('a verified pairing with nowhere to post does not send', () => {
  // Withdrawn on their side rather than yours: the capability is gone and the
  // state has not caught up. Nothing may be composed against it.
  const v = PAIRING_VERSION;
  assert.equal(maySend({ state: PAIRING.verified, v, pub: BRUNO.pub, cap: '' }), false);
  assert.equal(maySend({ state: PAIRING.verified, v, pub: '', cap: `${BRUNO.route}.00001111222233334444555566` }), false);
});

test('a mark read under an older arithmetic is not a mark that was read', () => {
  // The whole reason the width could be widened at all. Twelve bytes where
  // there were five changes nothing for anybody already verified unless their
  // old reading stops counting, and it stops counting here, in the one gate
  // every surface has to come through.
  const held = { pub: BRUNO.pub, cap: `${BRUNO.route}.00001111222233334444555566`, state: PAIRING.verified };
  assert.equal(maySend({ ...held, v: PAIRING_VERSION }), true);
  assert.equal(maySend({ ...held, v: PAIRING_VERSION - 1 }), false);
  // and every pairing verified before this field existed, which is all of them
  assert.equal(maySend(held), false);
});

test('a moved arithmetic sends a pairing back for the words, and does not raise an alarm', () => {
  const held = { pub: BRUNO.pub, cap: `${BRUNO.route}.00001111222233334444555566` };
  assert.equal(onVersion({ ...held, state: PAIRING.verified, v: PAIRING_VERSION }), PAIRING.verified);
  assert.equal(onVersion({ ...held, state: PAIRING.verified, v: 1 }), PAIRING.returned);
  assert.equal(onVersion({ ...held, state: PAIRING.verified }), PAIRING.returned);
  // `returned` and not `repair`. Nothing moved underneath: the key is the key
  // and the address is the address, and only the reading over them changed.
  // Telling somebody their correspondent may be an impostor because this app
  // widened a hash would be the loudest sentence it owns, spent on its own
  // maintenance.
  assert.notEqual(onVersion({ ...held, state: PAIRING.verified }), PAIRING.repair);
  // nothing else is touched, and withdrawn least of all
  for (const state of Object.values(PAIRING)) {
    if (state === PAIRING.verified) continue;
    assert.equal(onVersion({ ...held, state }), state,
      `a pairing in state ${state} was moved by an arithmetic it never read under`);
  }
  assert.equal(onVersion(null), '');
});

test('the arithmetic a mark was read under travels with the pairing', () => {
  const read = normLetters({ v: 1, jwk: null, pub: '', route: '', pairs: [
    { id: 'p1', v: PAIRING_VERSION },
    { id: 'p2' },
    { id: 'p3', v: '2' },
    { id: 'p4', v: 99 },
  ] });
  assert.equal(read.pairs[0].v, PAIRING_VERSION);
  // a pairing from before the field existed reads as zero, which is older than
  // any version there has ever been, and that is the truth about it
  assert.equal(read.pairs[1].v, 0);
  // a string is not a version, asked its type first for the reason capId is
  assert.equal(read.pairs[2].v, 0);
  // a number no build here has written is kept rather than flattened: maySend
  // asks for equality, so it refuses on its own, and clipping it would quietly
  // rewrite what a newer build wrote down
  assert.equal(read.pairs[3].v, 99);
});

test('every state the module names is a state it recognises', () => {
  for (const s of Object.values(PAIRING)) assert.equal(isState(s), true);
  assert.equal(isState('trusted'), false);
  assert.equal(isState(''), false);
});

// ---------- what was verified, and whether it still holds ----------

test('a key or a route that moved means the mark was read about something else', () => {
  const cap = `${BRUNO.route}.00001111222233334444555566`;
  const p = { pub: BRUNO.pub, cap, state: PAIRING.verified };
  assert.equal(stillDescribes(p, { pub: BRUNO.pub, cap }), true);
  // the secret re-minted, the address the same: this is ordinary
  assert.equal(stillDescribes(p, { pub: BRUNO.pub, cap: `${BRUNO.route}.99998888777766665555444433` }), true);
  // the address moved
  assert.equal(stillDescribes(p, { pub: BRUNO.pub, cap: `${ADA.route}.00001111222233334444555566` }), false);
  // the key moved
  assert.equal(stillDescribes(p, { pub: ADA.pub, cap }), false);
  assert.equal(stillDescribes(p, null), false);
});

// ---------- an introduction arriving ----------

test('the first introduction back completes the pair', () => {
  const seen = { pub: BRUNO.pub, cap: `${BRUNO.route}.00001111222233334444555566` };
  // nothing held at all: somebody handed you an introduction unasked
  assert.equal(onIntroduction(null, seen), PAIRING.returned);
  // you introduced yourself and this is the reply
  assert.equal(onIntroduction({ state: PAIRING.introduced, pub: '', cap: '' }, seen),
    PAIRING.returned);
});

test('the same introduction sent twice is not news', () => {
  const cap = `${BRUNO.route}.00001111222233334444555566`;
  const seen = { pub: BRUNO.pub, cap };
  for (const state of [PAIRING.returned, PAIRING.verified]) {
    assert.equal(onIntroduction({ state, pub: BRUNO.pub, cap }, seen), state);
  }
  // and a re-minted secret is not news either
  assert.equal(
    onIntroduction({ state: PAIRING.verified, pub: BRUNO.pub, cap }, {
      pub: BRUNO.pub, cap: `${BRUNO.route}.55554444333322221111000099`,
    }),
    PAIRING.verified);
});

test('an introduction that moves a verified key or route asks for repair, loudly', () => {
  // This is the shape an impersonation makes, and it is also the shape a
  // friend's lost device makes. The two are indistinguishable from here, which
  // is exactly why it is never quiet and never an upgrade.
  const cap = `${BRUNO.route}.00001111222233334444555566`;
  const p = { state: PAIRING.verified, pub: BRUNO.pub, cap };
  assert.equal(onIntroduction(p, { pub: ADA.pub, cap }), PAIRING.repair);
  assert.equal(onIntroduction(p, { pub: BRUNO.pub, cap: `${ADA.route}.00001111222233334444555566` }),
    PAIRING.repair);
});

test('an introduction does not undo a withdrawal', () => {
  // You took your introduction back. Their sending you theirs is their act and
  // not yours, and letting it reopen the door would make withdrawal advisory.
  const cap = `${BRUNO.route}.00001111222233334444555566`;
  assert.equal(
    onIntroduction({ state: PAIRING.withdrawn, pub: BRUNO.pub, cap }, { pub: BRUNO.pub, cap }),
    PAIRING.withdrawn);
});

// ---------- what a backup holds about writing to people ----------

const anIdentity = (d = 'PrivateHalfOne0000000000000000000000000000') => ({
  kty: 'EC', crv: 'P-256',
  x: 'PublicXhalf00000000000000000000000000000000',
  y: 'PublicYhalf00000000000000000000000000000000',
  d,
});
const slice = (over = {}) => ({
  v: 1, jwk: anIdentity(), pub: ADA.pub, route: ADA.route, pairs: [], ...over,
});
const aPair = (over = {}) => ({
  id: 'k1', name: 'Bruno', pub: BRUNO.pub,
  cap: `${BRUNO.route}.00001111222233334444555566`,
  capId: 'cap00001', state: PAIRING.verified, mark: '9c7k 2m4n', at: '2026-08-16', cid: '',
  ...over,
});

test('a device with no identity takes the one the vault is holding', () => {
  // The restore, and the reason a private key travels sealed at all. A device
  // that minted its own here would be a stranger wearing a familiar name: the
  // mark the person's friends read aloud was read about the other key.
  const done = mergeLetters(slice({ jwk: null, pub: '' }), slice({ pairs: [aPair()] }));
  assert.equal(done.identity, 'taken');
  assert.equal(done.added, 1);
  assert.equal(done.letters.jwk.d, anIdentity().d);
  assert.equal(done.letters.pairs[0].state, PAIRING.verified);
});

test('a backup does not overwrite a mark that was read aloud on this device', () => {
  // The device withdrew from Bruno. The backup was written before that. A
  // merge that let the older reading win would quietly reopen a door somebody
  // had shut, and they would never be told.
  const mine = slice({ pairs: [aPair({ state: PAIRING.withdrawn })] });
  const done = mergeLetters(mine, slice({ pairs: [aPair()] }));
  assert.equal(done.identity, 'kept');
  assert.equal(done.added, 0);
  assert.equal(done.letters.pairs.length, 1);
  assert.equal(done.letters.pairs[0].state, PAIRING.withdrawn);
});

test('the same person restored under two ids is still one person', () => {
  const mine = slice({ pairs: [aPair({ id: 'local' })] });
  const done = mergeLetters(mine, slice({ pairs: [aPair({ id: 'fromTheVault' })] }));
  assert.equal(done.added, 0, 'one correspondent came home as two rows');
});

test('two identities under one membership is a refusal and not a choice', () => {
  // One of the two is not the person their friends verified, and nothing here
  // could say which. Choosing silently would be choosing who somebody is.
  const mine = slice({ pub: BRUNO.pub });
  const done = mergeLetters(mine, slice({ pairs: [aPair()] }));
  assert.equal(done.identity, 'clash');
  assert.equal(done.added, 0);
  assert.equal(done.letters.pub, BRUNO.pub, 'the vault overwrote the identity in use');
  assert.deepEqual(done.letters.pairs, [], 'a stranger’s correspondents were merged in');
});

test('a clash hands back the backup’s own slice, to be sealed again unchanged', () => {
  // The half of the refusal that lives at the other end. Refusing to change
  // this device settles nothing on its own: the caller's very next act is to
  // write a new envelope, and an envelope written from this device's slice
  // would settle the question in favour of whichever device the button was
  // pressed on. So the backup's slice comes back out, to go back in exactly as
  // it was read.
  const theirs = slice({ pairs: [aPair()] });
  const done = mergeLetters(slice({ pub: BRUNO.pub }), theirs);
  assert.equal(done.identity, 'clash');
  assert.equal(done.theirs.pub, ADA.pub, 'the backup’s identity was not handed back');
  assert.equal(done.theirs.pairs.length, 1, 'the backup’s correspondents were not handed back');
  assert.notEqual(done.theirs, done.letters, 'one slice was handed back as both answers');
});

test('nothing but a clash hands anything back to be written', () => {
  // Everywhere else `letters` is the whole answer, and a `theirs` that was
  // sometimes set would be a second slice a caller could seal by accident.
  const fresh = slice({ jwk: null, pub: '' });
  for (const [what, done] of [
    ['a restore', mergeLetters(fresh, slice({ pairs: [aPair()] }))],
    ['a merge', mergeLetters(slice(), slice({ pairs: [aPair()] }))],
    ['nothing new', mergeLetters(slice(), slice())],
    ['no slice at all', mergeLetters(slice(), undefined)],
  ]) {
    assert.equal(done.theirs, null, `${what} handed back a slice to seal`);
  }
});

test('what comes back out of the vault is read through the gate, whatever it claims', () => {
  // It has been through a network and a decryption and may be from a build
  // that is not this one. A key of another curve refused here gives a person
  // this app's sentence rather than the browser's; a capability of the wrong
  // shape refused here is a row that cannot be composed against.
  const bad = mergeLetters(slice({ jwk: null, pub: '' }), {
    v: 1, jwk: { kty: 'RSA', n: 'x', d: 'y' }, pub: ADA.pub, route: ADA.route,
    pairs: [aPair({ cap: 'not-a-capability' })],
  });
  assert.equal(bad.identity, 'invalid', 'a malformed present slice was mistaken for no slice');
  assert.equal(bad.letters.jwk, null, 'a key of the wrong curve came home');
  assert.equal(bad.added, 0, 'a pairing with an unusable address came home');

  // and a slice numbered something nothing has ever written is not migrated
  const future = mergeLetters(slice({ jwk: null, pub: '' }), { ...slice(), v: 2 });
  assert.equal(future.identity, 'invalid');
  assert.equal(future.letters.jwk, null);
});

test('nothing to bring home changes nothing', () => {
  const mine = slice({ pairs: [aPair()] });
  const absent = mergeLetters(mine, undefined);
  assert.equal(absent.identity, 'none');
  assert.equal(absent.added, 0);
  assert.equal(absent.letters.pairs.length, 1);

  for (const malformed of [null, {}, 'a string', 42, []]) {
    const done = mergeLetters(mine, malformed);
    assert.equal(done.identity, 'invalid', `${JSON.stringify(malformed)} was treated as absent`);
    assert.equal(done.added, 0);
    assert.equal(done.letters.pairs.length, 1, `${JSON.stringify(malformed)} disturbed the slice`);
    assert.equal(done.theirs, null);
  }
});
