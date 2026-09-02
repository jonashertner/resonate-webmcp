// The letterbox, adversarially.
//
// Every test here describes a way the club could take a letter it promised to
// refuse, hold one it promised to forget, or hand one to somebody it was not
// addressed to. None of them is about tidiness.
//
// The letters are real. They come out of js/letters.js, which is exact RFC 9180
// mode auth, and they go in as bytes, which is the only thing the club ever
// sees. A suite that posted `stand()` would be testing the storage
// and calling it a test of the letterbox; the two tests at the bottom, which
// read the club's own storage looking for a place name, would then be vacuous.
//
// The fake models the load-bearing guarantees: one object serializes work and
// a storage transaction commits both the item and its head, or neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { BOX_LIMITS } from '../src/letterbox.js';
import { routeFor } from '../src/validate.js';
import {
  durable, durableNamespace, letterboxNamespace, vaultNamespace, bucket, kv, setAuthoritativeMember,
} from './fakes.mjs';
import { sealLetter, openLetter, generateKeyPair } from '../../js/letters.js';
import { makeClient } from '../../js/club.js';
import { routeOf } from '../../js/pairing.js';

const MINT = 'a-mint-secret-for-the-suite';
const A = 'tc_0123456789abcdefghjkm';
const B = 'tc_nabcdefghjkm0123456789';

// One club, two members, both paid. The letterbox namespace is shared, which is
// the point: A posting to B has to arrive at B's object and nowhere else.
function club({ aStanding = 'good', bStanding = 'good' } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const env = {
    BOX: kv(), VAULTS: bucket(),
    LETTERBOX: letterboxNamespace(), MINT_SECRET: MINT,
    SUBSCRIPTIONS: durableNamespace('Subscription'),
  };
  env.VAULT = vaultNamespace(env);
  const until = s => nowS + (s === 'good' ? 30 * 24 * 3600 : -30 * 24 * 3600);
  env.BOX.put(`member:${A}`, JSON.stringify({ sub: 'sub_a', until: until(aStanding), standing: 'good' }));
  env.BOX.put(`member:${B}`, JSON.stringify({ sub: 'sub_b', until: until(bStanding), standing: 'good' }));
  return env;
}

const call = (env, key, path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(
  new Request(`https://club.example${path}`, {
    method, body, headers: { authorization: `Bearer ${key}`, ...headers },
  }),
  env,
);

// B opens their box and mints an introduction, which is what a member does
// before handing anyone a way to write to them.
async function introduce(env, key = B) {
  await call(env, key, '/letters');                       // opens the box
  const r = await call(env, key, '/letters/cap', { method: 'POST' });
  assert.equal(r.status, 200, 'the introduction was not minted');
  return r.json();
}

const post = (env, from, cap, id, bytes) => call(env, from, `/letters/post?id=${id}`, {
  method: 'POST', body: bytes,
  headers: { 'x-cap': cap, 'content-length': String(bytes.byteLength) },
});

const msgId = n => String(n).padStart(32, '0');

// A stand-in for a letter where the contents do not matter, but its size does:
// the box refuses anything under 128 bytes, because a header, an ephemeral
// point and a tag are already that long and nothing shorter can open.
const stand = (n = 160, fill = 7) => new Uint8Array(n).fill(fill);

test('letter and capability records never commit without their matching head', async () => {
  const snapshot = map => structuredClone([...map.entries()]);
  const future = Math.floor(Date.now() / 1000) + 3600;

  {
    const held = durable('Letterbox');
    await held.obj.touch(future);
    const before = snapshot(held._map);
    held._failTransactionAt(2);
    await assert.rejects(held.obj.mintCap('q'.repeat(32)));
    assert.deepEqual(snapshot(held._map), before, 'a cap was stored without raising the cap count');
  }

  {
    const held = durable('Letterbox');
    await held.obj.touch(future);
    const cap = await held.obj.mintCap('r'.repeat(32));
    const before = snapshot(held._map);
    held._failTransactionAt(2);
    await assert.rejects(held.obj.revokeCap(cap.id));
    assert.deepEqual(snapshot(held._map), before, 'a cap disappeared without lowering the cap count');
  }

  {
    const held = durable('Letterbox');
    await held.obj.touch(future);
    await held.obj.mintCap('s'.repeat(32));
    const before = snapshot(held._map);
    held._failTransactionAt(2);
    await assert.rejects(held.obj.post({ secret: 's'.repeat(32), id: msgId(999), at: 1 }, stand()));
    assert.deepEqual(snapshot(held._map), before, 'a letter was stored without its bytes/count head');
  }

  {
    const held = durable('Letterbox');
    await held.obj.touch(future);
    await held.obj.mintCap('t'.repeat(32));
    await held.obj.post({ secret: 't'.repeat(32), id: msgId(998), at: 1 }, stand());
    const before = snapshot(held._map);
    held._failTransactionAt(2);
    await assert.rejects(held.obj.drop(msgId(998)));
    assert.deepEqual(snapshot(held._map), before, 'a letter disappeared without returning its bytes/count');
  }
});

// Stripe, speaking. The signature is real because verifyWebhook checks it, and
// a suite that stubbed that out would be testing a door it had unlocked itself.
let evn = 0;
async function hook(env, ev) {
  env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: `evt_${++evn}`, created: now, ...ev });
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_test'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${now}.${body}`)));
  const sig = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return worker.fetch(new Request('https://club.example/stripe', {
    method: 'POST', body, headers: { 'stripe-signature': `t=${now},v1=${sig}` },
  }), env);
}

// two members with keys, and a real letter between them
async function pair() {
  const a = await generateKeyPair(), b = await generateKeyPair();
  return { a, b };
}
const letterFrom = (a, b, payload, id) => sealLetter({
  kind: 'folio', to: b.publicKey, from: a, payload,
  msgId: id ? Uint8Array.from(id.match(/../g).map(h => parseInt(h, 16))) : undefined,
});

// ---- what the club is for ----

test('a letter posted by one member is read back by the other, byte for byte', async () => {
  const env = club();
  const { a, b } = await pair();
  const { cap } = await introduce(env);
  const wire = await letterFrom(a, b, { kind: 'folio', title: 'a short walk' });
  const id = msgId(1);

  const put = await post(env, A, cap, id, wire);
  assert.equal(put.status, 200);

  const list = await (await call(env, B, '/letters')).json();
  assert.equal(list.letters.length, 1);
  assert.equal(list.letters[0].id, id);
  assert.equal(list.letters[0].bytes, wire.byteLength);

  const got = new Uint8Array(await (await call(env, B, `/letters/${id}`)).arrayBuffer());
  assert.deepEqual([...got], [...wire], 'the letter came back changed');

  // and it opens, which is the only proof that matters
  const opened = await openLetter(got, { me: b, from: a.publicKey });
  assert.equal(opened.payload.title, 'a short walk');
});

test('the club holds ciphertext: no place name is anywhere in its storage', async () => {
  const env = club();
  const { a, b } = await pair();
  const { cap } = await introduce(env);
  const wire = await letterFrom(a, b, { kind: 'folio', title: 'Cabane de Moiry', note: 'the light at six' });
  await post(env, A, cap, msgId(1), wire);

  // everything the letterbox object holds, read straight out of its storage
  const held = [...env.LETTERBOX._made.keys()].map(String).join(' ');
  const box = await (await call(env, B, '/letters')).json();
  const all = JSON.stringify(box) + ' ' + held + ' ' + JSON.stringify([...env.BOX._m]);
  for (const secret of ['Moiry', 'Cabane', 'the light at six']) {
    assert.ok(!all.includes(secret), `the club is holding ${secret} in the clear`);
  }
});

// ---- the caps, which are the reason this is not KV ----

test('the fifty-first letter is refused, and the box holds exactly fifty', async () => {
  const env = club();
  const { cap } = await introduce(env);
  const one = new Uint8Array(128).fill(9);
  for (let i = 0; i < BOX_LIMITS.count; i++) {
    assert.equal((await post(env, A, cap, msgId(i), one)).status, 200, `letter ${i} was refused`);
  }
  const over = await post(env, A, cap, msgId(999), one);
  assert.equal(over.status, 507);
  assert.match((await over.json()).error, /holds fifty letters/);
  const box = await (await call(env, B, '/letters')).json();
  assert.equal(box.letters.length, BOX_LIMITS.count);
});

test('two letters racing for the last place: exactly one is taken', async () => {
  // The reason the box is a Durable Object. Without one transaction around the
  // count and write, both read forty-nine, both pass, and the box holds fifty-one.
  const env = club();
  const { cap } = await introduce(env);
  const one = new Uint8Array(128).fill(9);
  for (let i = 0; i < BOX_LIMITS.count - 1; i++) await post(env, A, cap, msgId(i), one);

  const [x, y] = await Promise.all([
    post(env, A, cap, msgId(900), one),
    post(env, A, cap, msgId(901), one),
  ]);
  const taken = [x, y].filter(r => r.status === 200).length;
  assert.equal(taken, 1, `${taken} letters took the last place`);
  const box = await (await call(env, B, '/letters')).json();
  assert.equal(box.letters.length, BOX_LIMITS.count);
});

test('two letters racing for the last megabyte: exactly one is taken', async () => {
  const env = club();
  const { cap } = await introduce(env);
  const big = new Uint8Array(BOX_LIMITS.letterBytes).fill(3);
  const fits = Math.floor(BOX_LIMITS.total / BOX_LIMITS.letterBytes);
  for (let i = 0; i < fits - 1; i++) {
    assert.equal((await post(env, A, cap, msgId(i), big)).status, 200, `letter ${i} was refused`);
  }
  const [x, y] = await Promise.all([
    post(env, A, cap, msgId(900), big),
    post(env, A, cap, msgId(901), big),
  ]);
  assert.equal([x, y].filter(r => r.status === 200).length, 1, 'the box went over four megabytes');
  const box = await (await call(env, B, '/letters')).json();
  assert.ok(box.bytes <= BOX_LIMITS.total, `the box holds ${box.bytes} bytes`);
});

test('a letter too big to post never reaches the box at all', async () => {
  // Two ceilings, and this checks which one caught it. content-length is a
  // claim; a post that understates itself must still be cut off in the worker,
  // because the alternative is buffering a hundred megabytes in order to refuse
  // it. So from here the box counts every time it is spoken to, and a refusal
  // that arrives with the count still at zero is a refusal that cost us nothing.
  const env = club();
  const { cap } = await introduce(env);
  const big = new Uint8Array(BOX_LIMITS.letterBytes + 1).fill(4);

  const real = env.LETTERBOX.get.bind(env.LETTERBOX);
  let asked = 0;
  env.LETTERBOX.get = (id) => { asked += 1; return real(id); };

  // the declared length, refused before the body is read at all
  assert.equal((await post(env, A, cap, msgId(1), big)).status, 413);
  assert.equal(asked, 0, 'an oversize claim was carried to the box');

  // and the same body with the claim removed, refused on what it actually is
  const lying = await call(env, A, `/letters/post?id=${msgId(2)}`, {
    method: 'POST', body: big, headers: { 'x-cap': cap },
  });
  assert.equal(lying.status, 413, 'a post that understated its size was taken');
  assert.equal(asked, 0, 'a post that lied about its size was carried to the box');

  env.LETTERBOX.get = real;
  const box = await (await call(env, B, '/letters')).json();
  assert.equal(box.letters.length, 0);
});

test('something too short to be a letter does not take a place in a box', async () => {
  // Fifty places is fifty, and a box filled with empty posts is as full as a
  // box filled with letters. The floor is the shortest thing js/letters.js can
  // produce: 47 header, 65 ephemeral point, 16 tag.
  const env = club();
  const { cap } = await introduce(env);
  const { a, b } = await pair();
  const shortest = await letterFrom(a, b, {});
  assert.ok(shortest.byteLength >= BOX_LIMITS.least,
    `the shortest real letter is ${shortest.byteLength} bytes and the floor is ${BOX_LIMITS.least}`);

  for (const n of [0, 1, 64, BOX_LIMITS.least - 1]) {
    const r = await post(env, A, cap, msgId(n), stand(n));
    assert.equal(r.status, 400, `${n} bytes took a place in a box`);
  }
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 0);
});

test('a capability travels in a header and is never read from a url', async () => {
  // A secret in a query string is a secret in every proxy log, every referrer
  // and every browser history between here and the club.
  const env = club();
  const { cap } = await introduce(env);
  const r = await call(env, A, `/letters/post?id=${msgId(1)}&cap=${cap}`, {
    method: 'POST', body: stand(), headers: { 'content-length': '160' },
  });
  assert.equal(r.status, 400, 'a capability was accepted out of the query string');
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 0);
});

test('a letter posted under something that is not a message id is refused', async () => {
  const env = club();
  const { cap } = await introduce(env);
  for (const id of ['', 'hello', 'f'.repeat(31), 'f'.repeat(33), 'F'.repeat(32), '../../etc']) {
    const r = await call(env, A, `/letters/post?id=${encodeURIComponent(id)}`, {
      method: 'POST', body: stand(), headers: { 'x-cap': cap, 'content-length': '64' },
    });
    assert.equal(r.status, 400, `"${id}" was accepted as a message id`);
  }
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 0);
});

test('deleting a letter gives its bytes back, so a box does not fill for good', async () => {
  const env = club();
  const { cap } = await introduce(env);
  const one = new Uint8Array(1024).fill(9);
  await post(env, A, cap, msgId(1), one);
  assert.equal((await (await call(env, B, '/letters')).json()).bytes, 1024);
  assert.equal((await call(env, B, `/letters/${msgId(1)}`, { method: 'DELETE' })).status, 200);
  const box = await (await call(env, B, '/letters')).json();
  assert.equal(box.bytes, 0, 'the bytes were counted against the box after the letter was gone');
  assert.equal(box.count, 0);
});

test('the same letter posted twice is one letter', async () => {
  const env = club();
  const { cap } = await introduce(env);
  const one = stand().fill(1);
  assert.equal((await post(env, A, cap, msgId(1), one)).status, 200);
  const again = await post(env, A, cap, msgId(1), one);
  assert.equal(again.status, 409);
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 1);
});

// ---- who may post ----

test('a box takes a hundred correspondents, and withdrawing one makes room for one', async () => {
  // The limit nothing else covers, and the reason the count is taken from the
  // capabilities themselves rather than from a running total: a number kept
  // beside the thing it counts is a number that can stop describing it, and
  // the failure is silent in whichever direction it drifts.
  const env = club();
  await call(env, B, '/letters');
  for (let i = 0; i < BOX_LIMITS.caps; i++) {
    assert.equal((await call(env, B, '/letters/cap', { method: 'POST' })).status, 200,
      `correspondent ${i} was refused`);
  }
  assert.equal((await call(env, B, '/letters/cap', { method: 'POST' })).status, 429);

  const { caps } = await (await call(env, B, '/letters')).json();
  assert.equal(caps.length, BOX_LIMITS.caps);
  assert.equal((await call(env, B, `/letters/cap/${caps[0]}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(env, B, '/letters/cap', { method: 'POST' })).status, 200, 'the freed place was not free');
  assert.equal((await call(env, B, '/letters/cap', { method: 'POST' })).status, 429, 'one revocation made room for two');
});

test('a withdrawn introduction cannot post again', async () => {
  const env = club();
  const { cap, id } = await introduce(env);
  assert.equal((await post(env, A, cap, msgId(1), stand())).status, 200);
  assert.equal((await call(env, B, `/letters/cap/${id}`, { method: 'DELETE' })).status, 200);
  const after = await post(env, A, cap, msgId(2), stand());
  assert.equal(after.status, 403);
  assert.match((await after.json()).error, /withdrawn/);
  // and the letter already delivered under it is still there: revoking an
  // introduction closes a door, it does not reach back through it
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 1);
});

test('an introduction to one box does not open another', async () => {
  const env = club();
  const { cap } = await introduce(env, B);
  await introduce(env, A);
  // B's secret, offered at A's address: a different object entirely
  const mine = await routeFor(A, MINT);
  const wrong = `${mine}.${cap.split('.')[1]}`;
  const r = await post(env, B, wrong, msgId(1), stand());
  assert.equal(r.status, 403);
  assert.equal((await (await call(env, A, '/letters')).json()).letters.length, 0);
});

test('a box nobody has opened takes nothing', async () => {
  const env = club();
  // an address of the right shape, for a member who has never come to collect
  const route = await routeFor(B, MINT);
  const madeUp = `${route}.${'q'.repeat(26)}`;
  const r = await post(env, A, madeUp, msgId(1), stand());
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /no box at that address/);
});

test('a capability that is not a capability is refused as that', async () => {
  const env = club();
  await introduce(env);
  for (const bad of ['', 'nonsense', 'a'.repeat(26), `${'a'.repeat(26)}.short`, `${'a'.repeat(26)}.${'A'.repeat(26)}`]) {
    const r = await post(env, A, bad, msgId(1), stand());
    assert.equal(r.status, 400, `"${bad.slice(0, 20)}" was accepted as an address`);
  }
});

// ---- lapsing, in both directions ----

test('a lapsed member cannot post: the exchange stops outward too', async () => {
  const env = club({ aStanding: 'lapsed' });
  const { cap } = await introduce(env, B);
  const r = await post(env, A, cap, msgId(1), stand());
  assert.equal(r.status, 402);
  assert.equal((await (await call(env, B, '/letters')).json()).letters.length, 0);
});

test('a lapsed box takes nothing, and still gives back what it holds', async () => {
  // Decision 4, both halves. The box stops in both directions, and what is
  // already in it stays readable and deletable until burned: a membership that
  // ran out is not a reason to hold somebody's letters hostage.
  const env = club();
  const { cap } = await introduce(env, B);
  await post(env, A, cap, msgId(1), stand());

  // B lapses, which in the club's terms is their paid-until falling behind,
  // and then comes to look at their box, which is how a box that nobody told
  // finds out. The case where nobody ever comes back is the test below.
  const nowS = Math.floor(Date.now() / 1000);
  await setAuthoritativeMember(env, B, { until: nowS - 90 * 24 * 3600, standing: 'held' });
  await call(env, B, '/letters');

  const shut = await post(env, A, cap, msgId(2), stand());
  assert.equal(shut.status, 403);
  assert.match((await shut.json()).error, /that box is closed/);

  const list = await call(env, B, '/letters');
  assert.equal(list.status, 200, 'a lapsed member was refused their own letters');
  assert.equal((await list.json()).letters.length, 1);
  assert.equal((await call(env, B, `/letters/${msgId(1)}`)).status, 200);
  assert.equal((await call(env, B, `/letters/${msgId(1)}`, { method: 'DELETE' })).status, 200);
});

test('a membership that ends shuts its box before its owner comes back', async () => {
  // The case the touch on a read cannot reach: somebody cancels and never opens
  // the app again. Their box would go on taking mail for the rest of a period
  // that no longer exists. Stripe says so, and the club knows the key at that
  // moment, so the box is told then rather than whenever it is next looked at.
  const env = club();
  const { cap } = await introduce(env, B);
  assert.equal((await post(env, A, cap, msgId(1), stand())).status, 200);

  await env.BOX.put('sub:sub_b', B);
  assert.equal((await hook(env, {
    type: 'customer.subscription.deleted', data: { object: { id: 'sub_b' } },
  })).status, 200);

  // nobody has opened the box since, and it is shut anyway
  const after = await post(env, A, cap, msgId(2), stand());
  assert.equal(after.status, 403, 'a cancelled membership was still taking mail');
  assert.match((await after.json()).error, /that box is closed/);
});

test('a member who has never used letters still has no box', async () => {
  // boxKnows must not be the thing that creates one. A restamp that wrote into
  // an empty box would give every paying member a letterbox the moment their
  // subscription was next touched at Stripe, and `there is no box at that
  // address` would be a sentence the club could never say truthfully again.
  // So this goes through the webhook, which is the only caller that reaches a
  // box nobody has opened.
  const env = club();
  await env.BOX.put('sub:sub_b', B);
  assert.equal((await hook(env, {
    type: 'customer.subscription.deleted', data: { object: { id: 'sub_b' } },
  })).status, 200);

  const route = await routeFor(B, MINT);
  const r = await post(env, A, `${route}.${'q'.repeat(26)}`, msgId(1), stand());
  assert.equal(r.status, 404, 'the webhook built a letterbox for a member who has never had one');
  assert.match((await r.json()).error, /no box at that address/);
});

test('nothing a caller sends can point them at another box', async () => {
  // The route is derived from the membership key and from nothing else. This is
  // the test that goes red the day somebody adds a convenience for naming a
  // box, which is the shape address substitution would take here: the club has
  // no other way to tell whose letters these are.
  const env = club();
  const { cap } = await introduce(env, B);
  const theirs = (await (await call(env, B, '/letters')).json()).route;
  await post(env, A, cap, msgId(1), stand());

  for (const path of [`/letters?box=${theirs}`, `/letters?route=${theirs}`, `/letters?id=${theirs}`]) {
    const got = await (await call(env, A, path)).json();
    assert.notEqual(got.route, theirs, `${path} pointed one member at another's box`);
    assert.equal(got.letters.length, 0);
  }
  for (const headers of [{ 'x-box': theirs }, { 'x-route': theirs }, { 'x-cap': `${theirs}.${'q'.repeat(26)}` }]) {
    const got = await (await call(env, A, '/letters', { headers })).json();
    assert.notEqual(got.route, theirs, `${Object.keys(headers)[0]} pointed one member at another's box`);
    assert.equal(got.letters.length, 0);
  }
});

test('looking at a lapsed box does not quietly reopen it', async () => {
  // The box's own paid-until is the thing a poster is judged against, and it
  // only ever moves when the member is in good standing. A read that stamped it
  // unconditionally would let a lapsed member reopen their box by refreshing.
  const env = club();
  const { cap } = await introduce(env, B);
  const nowS = Math.floor(Date.now() / 1000);
  await setAuthoritativeMember(env, B, { until: nowS - 90 * 24 * 3600, standing: 'held' });
  await call(env, B, '/letters');
  assert.equal((await post(env, A, cap, msgId(1), stand())).status, 403);
});

// ---- what a member's own key reaches ----

test('a member reaches their own box and no one else can name it', async () => {
  const env = club();
  const { a, b } = await pair();
  const { cap } = await introduce(env, B);
  await post(env, A, cap, msgId(1), await letterFrom(a, b, { kind: 'folio', title: 'x' }, msgId(1)));

  // A's key reaches A's box, which is empty, not B's, which is not
  assert.equal((await (await call(env, A, '/letters')).json()).letters.length, 0);
  assert.equal((await call(env, A, `/letters/${msgId(1)}`)).status, 404);

  const mine = await (await call(env, A, '/letters')).json();
  const theirs = await (await call(env, B, '/letters')).json();
  assert.notEqual(mine.route, theirs.route);
});

test('a route is not a membership key, and a capability does not carry one', async () => {
  const env = club();
  const { cap } = await introduce(env, B);
  const box = await (await call(env, B, '/letters')).json();
  assert.ok(!box.route.startsWith('tc_'), 'the route is wearing a membership key');
  assert.ok(!cap.includes(B), 'the capability carries the membership key it was minted from');
  assert.ok(!cap.includes('tc_'), 'the capability carries something shaped like a membership key');
  assert.equal(cap.split('.')[0], box.route);
});

test('burning a box takes the introductions with it', async () => {
  // Otherwise a burn is tidying rather than a change of address: everyone
  // holding an old introduction could start the box again by writing to it.
  const env = club();
  const { cap } = await introduce(env, B);
  await post(env, A, cap, msgId(1), stand());
  assert.equal((await call(env, B, '/letters', { method: 'DELETE' })).status, 200);

  const after = await post(env, A, cap, msgId(2), stand());
  assert.equal(after.status, 404, 'an introduction survived the burn');
  const box = await (await call(env, B, '/letters')).json();
  assert.equal(box.letters.length, 0);
  assert.equal(box.caps.length, 0);
});

test('a club with no letterbox bound says so rather than answering nonsense', async () => {
  const env = club();
  delete env.LETTERBOX;
  assert.equal((await call(env, B, '/letters')).status, 503);
});

test('a stranger with no key reaches none of it', async () => {
  const env = club();
  const { cap } = await introduce(env, B);
  for (const [path, method] of [['/letters', 'GET'], ['/letters/cap', 'POST'], ['/letters', 'DELETE']]) {
    const r = await worker.fetch(new Request(`https://club.example${path}`, { method }), env);
    assert.equal(r.status, 401, `${method} ${path} answered a stranger`);
  }
  // and posting is not a way around it: the sender is a member or nobody
  const r = await worker.fetch(new Request(`https://club.example/letters/post?id=${msgId(1)}`, {
    method: 'POST', body: stand(), headers: { 'x-cap': cap },
  }), env);
  assert.equal(r.status, 401);
});

// ---- the browser's side of the same protocol ----
//
// Everything above drives the club by hand. These drive it through
// js/club.js, which is what the app will actually call, against the same
// worker and the same fakes: a client whose paths, headers and refusals are
// only ever exercised by a browser is a client nobody has tested.

// The worker, standing in for the network, with every request it is handed
// written down. The recording is not decoration: one of the claims below is
// about what must never appear in a URL, and it can only be made by looking
// at the URLs.
function wire(env, t) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => {
    const r = new Request(u, init);
    seen.push({ url: r.url, cap: r.headers.get('x-cap') || '' });
    return worker.fetch(r, env);
  };
  t.after(() => { globalThis.fetch = real; });
  return seen;
}

test('a letter goes out through the client and comes back through it', async (t) => {
  const env = club();
  const { a, b } = await pair();
  wire(env, t);

  const ada = makeClient('https://club.example', () => A);
  const bruno = makeClient('https://club.example', () => B);

  // Bruno opens his box and mints one introduction, for Ada and nobody else
  const his = await bruno.box();
  assert.match(his.route, /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/, 'a box has an address of the club’s making');
  assert.equal(his.letters.length, 0);
  const { cap, id } = await bruno.mintCap();
  assert.equal(routeOf(cap), his.route, 'the introduction leads somewhere other than his box');

  // Ada writes, and the club takes it
  const payload = { v: 6, kind: 'folio', title: 'Basel', places: [] };
  const wireBytes = await letterFrom(a, b, payload, msgId(11));
  const done = await ada.postLetter(cap, msgId(11), wireBytes);
  assert.equal(done.posted, true);

  // Bruno finds it waiting, reads it, opens it, and only then drops it
  const box = await bruno.box();
  assert.equal(box.letters.length, 1);
  assert.equal(box.letters[0].id, msgId(11));
  const got = await bruno.letter(msgId(11));
  assert.deepEqual(got.bytes, new Uint8Array(wireBytes), 'the bytes changed on the way through the client');
  const opened = await openLetter(got.bytes, { me: b, from: a.publicKey });
  assert.deepEqual(opened.payload, payload);
  await bruno.dropLetter(msgId(11));
  assert.equal(await bruno.letter(msgId(11)), null, 'a letter read and dropped is gone, not absent-for-now');

  // and the introduction is Bruno's to take back
  await bruno.dropCap(id);
  await bruno.dropCap(id); // retry after an interrupted local cleanup is success too
  await assert.rejects(() => ada.postLetter(cap, msgId(12), wireBytes), /withdrawn/);
});

test('the posting secret is in a header and in no url the client ever builds', async (t) => {
  // A capability is a bearer secret: whoever holds it may post. A secret in a
  // path or a query is a secret in every proxy log, every referrer and every
  // browser history between here and there, and it stays there long after the
  // correspondent it was minted for has been withdrawn.
  const env = club();
  const { a, b } = await pair();
  const seen = wire(env, t);

  const bruno = makeClient('https://club.example', () => B);
  const ada = makeClient('https://club.example', () => A);
  await bruno.box();
  const { cap } = await bruno.mintCap();
  const secret = cap.slice(cap.indexOf('.') + 1);
  await ada.postLetter(cap, msgId(21), await letterFrom(a, b, { v: 6, kind: 'ask', q: 'x' }, msgId(21)));

  assert.ok(seen.some(s => s.cap === cap), 'the capability did not travel in the header it belongs in');
  for (const s of seen) {
    assert.equal(s.url.includes(secret), false, `the posting secret was written into ${s.url}`);
    assert.equal(s.url.includes(cap), false, `the whole capability was written into ${s.url}`);
  }
  // the membership key is a bearer secret too, and it has the same rule
  for (const s of seen) {
    assert.equal(s.url.includes(A) || s.url.includes(B), false,
      `a membership key was written into ${s.url}`);
  }
});

test('the club’s refusal is the sentence the client passes on', async (t) => {
  // A client that turned every refusal into "the club did not answer" would
  // leave a person with a full box and no idea it was full.
  const env = club();
  const { a, b } = await pair();
  wire(env, t);
  const bruno = makeClient('https://club.example', () => B);
  const ada = makeClient('https://club.example', () => A);
  await bruno.box();
  const { cap } = await bruno.mintCap();

  const once = await letterFrom(a, b, { v: 6, kind: 'ask', q: 'x' }, msgId(31));
  await ada.postLetter(cap, msgId(31), once);
  await assert.rejects(() => ada.postLetter(cap, msgId(31), once), /already waiting/,
    'the same letter twice was not named as such');
  await assert.rejects(() => ada.postLetter(`${'z'.repeat(26)}.${'z'.repeat(26)}`, msgId(32), once),
    /no box at that address|fresh introduction/);
});

test('a key the club does not know is told so, and not left to guess', async (t) => {
  const env = club();
  wire(env, t);
  const stranger = makeClient('https://club.example', () => 'tc_zzzzzzzzzzzzzzzzzzzzzz');
  await assert.rejects(() => stranger.box(), /does not know this key/);
});
