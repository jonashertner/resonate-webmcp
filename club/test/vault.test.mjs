// The vault's transition, adversarially.
//
// Every test here describes a way a backup could be lost, not a way the code
// could be tidier. The old storage conceded two of them in writing: two
// devices sealing in the same instant, and a seal that is five separate writes
// with no boundary around them. A conceded race is not a defence once somebody
// has paid for the thing being raced for.
//
// The fakes below model the load-bearing platform guarantees: object work is
// serialized, storage transactions commit whole, alarms persist, and an R2
// operation either happened or did not. Every await remains a real yield.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault, newObjectName } from '../src/vault.js';
import worker from '../src/worker.js';
import { LIMITS } from '../src/validate.js';
import { durable, durableNamespace, vaultNamespace, bucket, kv, setAuthoritativeMember } from './fakes.mjs';

const KEY = 'tc_0123456789abcdefghjkm';
const req = (path, { method = 'GET', body, headers = {} } = {}) =>
  new Request(`https://club.example${path}`, { method, body, headers });
const auth = (h = {}) => ({ authorization: `Bearer ${KEY}`, ...h });

function club({ standing = 'good', ...opts } = {}) {
  const env = { BOX: kv(), VAULTS: bucket(opts) };
  env.VAULT = vaultNamespace(env);
  env.SUBSCRIPTIONS = durableNamespace('Subscription');
  const until = Math.floor(Date.now() / 1000) + (standing === 'good' ? 3600 : -30 * 24 * 3600);
  env.BOX.put(`member:${KEY}`, JSON.stringify({ sub: 'sub_1', until, standing: 'good' }));
  return env;
}

const body = (n = 64, fill = 7) => new Uint8Array(n).fill(fill);
const sealed = (env, bytes, headers) => worker.fetch(
  req('/vault', { method: 'PUT', body: bytes, headers: auth({ 'content-length': String(bytes.byteLength), ...headers }) }),
  env,
);
const first = (env, bytes = body()) => sealed(env, bytes, { 'if-none-match': '*' });
const revOf = (res) => /"([0-9a-f]{32})"/.exec(res.headers.get('etag') || '')?.[1] || '';

const LEGACY_REV = 'a'.repeat(32);
async function seedLegacy(env) {
  const current = `vault/${KEY}/${'1'.repeat(32)}`;
  const previous = `vault/${KEY}/${'2'.repeat(32)}`;
  await env.VAULTS.put(current, body(64, 3), {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { generation: 'current' },
  });
  await env.VAULTS.put(previous, body(64, 2), {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { generation: 'previous' },
  });
  const object = env.VAULT.get(env.VAULT.idFromName(KEY));
  const head = {
    rev: LEGACY_REV,
    current: { id: current, bytes: 64, at: 'legacy-current', note: 'keep-current' },
    previous: { id: previous, bytes: 64, at: 'legacy-previous', note: 'keep-previous' },
  };
  object._map.set('head', structuredClone(head));
  return { object, head, current, previous };
}

// ---------- 1 ----------
test('two seals presenting the same revision: exactly one commits', async () => {
  const env = club();
  const one = await first(env);
  const rev = revOf(one);
  assert.equal(one.status, 200);

  // both devices read the same revision and seal in the same instant. this is
  // the case the old storage conceded and this one must not.
  const [a, b] = await Promise.all([
    sealed(env, body(64, 1), { 'if-match': `"${rev}"` }),
    sealed(env, body(64, 2), { 'if-match': `"${rev}"` }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 412], 'both seals were obeyed, or neither was');

  // and the loser left nothing behind: the winner's bytes are current, and
  // the vault holds exactly two objects, current and previous
  const won = a.status === 200 ? a : b;
  const wonFill = a.status === 200 ? 1 : 2;
  const got = await worker.fetch(req('/vault', { headers: auth() }), env);
  const back = new Uint8Array(await got.arrayBuffer());
  assert.equal(got.headers.get('etag'), won.headers.get('etag'), 'the vault serves a revision nobody committed');
  assert.equal(back[0], wonFill, 'the loser\'s bytes are the ones being served');
  assert.equal(env.VAULTS._objs.size, 2, 'the refused seal left its bytes behind');
});

// ---------- 2 ----------
test('a death after the upload and before the rotation leaves the vault exact', async () => {
  const env = club();
  const one = await first(env, body(64, 3));
  const rev = revOf(one);

  // the upload happens, and then nothing does: this is a worker that stops
  // between the two operations the whole design is built around
  const orphan = newObjectName(KEY);
  await env.VAULTS.put(orphan, body(64, 9));

  const got = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(got.headers.get('etag'), `"${rev}"`, 'the revision moved without a rotation');
  assert.equal(new Uint8Array(await got.arrayBuffer())[0], 3, 'the current envelope changed');
  const head = await worker.fetch(req('/vault?prev=1', { headers: auth() }), env);
  assert.equal(head.status, 404, 'a previous envelope appeared from nowhere');
});

// ---------- 3 ----------
test('a death inside the rotation leaves no half rotation', async () => {
  const { obj, _map, _state } = durable();
  assert.equal((await obj.commit({ want: { fresh: true }, id: 'o1', bytes: 10, at: 'a' })).ok, true);
  assert.equal((await obj.commit({ want: { match: _map.get('head').rev }, id: 'o2', bytes: 10, at: 'b' })).ok, true);
  const before = structuredClone(_map.get('head'));
  assert.equal(before.current.id, 'o2');
  assert.equal(before.previous.id, 'o1');

  // the rotation is one write of one value, so there is no instant at which
  // current has moved and previous has not. the only way to prove that is to
  // make the write itself fail and look at what is left.
  const real = _state.storage.put;
  _state.storage.put = async () => { throw new Error('the disk went away'); };
  await assert.rejects(obj.commit({ want: { match: before.rev }, id: 'o3', bytes: 10, at: 'c' }));
  _state.storage.put = real;

  assert.deepEqual(_map.get('head'), before, 'a failed rotation changed the pointers');
  assert.equal(Object.keys(before).sort().join(','), 'current,previous,rev',
    'the pointer record holds something other than pointers');

  // and the object still works afterwards, at the revision it never left
  const after = await obj.commit({ want: { match: before.rev }, id: 'o3', bytes: 10, at: 'c' });
  assert.equal(after.ok, true);
  assert.equal(after.evicted, 'o1', 'the wrong object was handed back for collection');
});

// ---------- 4 ----------
test('a lost answer: the seal committed, the retry is told so, and the read proves it', async () => {
  const env = club();
  const one = await first(env, body(64, 4));
  const rev = revOf(one);
  const two = await sealed(env, body(64, 5), { 'if-match': `"${rev}"` });
  assert.equal(two.status, 200);

  // the member's device never saw that answer and asks again with the
  // revision it still believes in
  const again = await sealed(env, body(64, 6), { 'if-match': `"${rev}"` });
  assert.equal(again.status, 412, 'a stale seal was obeyed');
  assert.equal(again.headers.get('etag'), two.headers.get('etag'),
    'the refusal did not say which revision the vault now holds');

  const got = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(new Uint8Array(await got.arrayBuffer())[0], 5, 'the committed envelope is not the one served');
});

// ---------- 5 ----------
test('ciphertext the store will not take never moves the pointer', async () => {
  const env = club();
  const one = await first(env, body(64, 1));
  const rev = revOf(one);
  env.VAULTS.put = async () => { throw new Error('r2 refused'); };
  await assert.rejects(sealed(env, body(64, 2), { 'if-match': `"${rev}"` }));

  const got = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(got.headers.get('etag'), `"${rev}"`, 'the revision moved for bytes that were never written');
  assert.equal(new Uint8Array(await got.arrayBuffer())[0], 1);
});

test('a pointer at bytes the store has lost is not answered as an empty vault', async () => {
  const env = club();
  await first(env);
  for (const name of [...env.VAULTS._objs.keys()]) await env.VAULTS.delete(name);
  const got = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(got.status, 503, 'a lost envelope was reported as an empty vault, which a client seals over');
});

// ---------- 6 ----------
test('current and the one before it come back independently, and only one wears the revision', async () => {
  const env = club();
  await first(env, body(64, 1));
  const two = await sealed(env, body(64, 2), { 'if-match': `"${revOf(await worker.fetch(req('/vault', { headers: auth() }), env))}"` });
  assert.equal(two.status, 200);

  const now = await worker.fetch(req('/vault', { headers: auth() }), env);
  const before = await worker.fetch(req('/vault?prev=1', { headers: auth() }), env);
  assert.equal(new Uint8Array(await now.arrayBuffer())[0], 2);
  assert.equal(new Uint8Array(await before.arrayBuffer())[0], 1);
  assert.ok(now.headers.get('etag'), 'the current envelope carries no revision');
  assert.equal(before.headers.get('etag'), null, 'the slot before wears a revision no seal accepts');
});

// ---------- 7 ----------
test('the burn takes the pointers first and the bytes after', async () => {
  const env = club();
  await first(env, body(64, 1));
  const one = await worker.fetch(req('/vault', { headers: auth() }), env);
  await sealed(env, body(64, 2), { 'if-match': one.headers.get('etag') });
  assert.equal(env.VAULTS._objs.size, 2);

  const gone = await worker.fetch(req('/vault', { method: 'DELETE', headers: auth() }), env);
  assert.equal(gone.status, 200);
  assert.equal(env.VAULTS._objs.size, 0, 'the burn left ciphertext behind');
  const after = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(after.status, 404);
  // and the vault is sealable again, from empty
  assert.equal((await first(env)).status, 200);
});

test('a failed R2 burn keeps every object id durably and its alarm finishes later', async () => {
  const env = club({ failDelete: true });
  await first(env, body(64, 1));
  const one = await worker.fetch(req('/vault', { headers: auth() }), env);
  await sealed(env, body(64, 2), { 'if-match': one.headers.get('etag') });
  const ids = [...env.VAULTS._objs.keys()].sort();

  const pending = await worker.fetch(req('/vault', { method: 'DELETE', headers: auth() }), env);
  assert.equal(pending.status, 202, 'failed physical erasure was reported as complete');
  assert.deepEqual(await pending.json(), { gone: false, pending: true });
  assert.equal((await worker.fetch(req('/vault', { headers: auth() }), env)).status, 404,
    'a tombstoned vault remained readable');

  const object = env.VAULT._made.get(KEY);
  assert.deepEqual(object._map.get('deleting').ids.sort(), ids, 'the failed ids were forgotten');
  assert.ok(object._alarm() > Date.now(), 'no durable retry was scheduled');
  assert.equal(env.VAULTS._objs.size, 2);

  env.VAULTS._failDelete(false);
  await object._runAlarm();
  assert.equal(env.VAULTS._objs.size, 0, 'the alarm did not finish physical erasure');
  assert.equal(object._map.has('deleting'), false, 'successful erasure kept the sensitive pointers');
  assert.equal(object._alarm(), 0);
});

test('new object names carry no bearer key and old member-scoped ids still erase', async () => {
  const fresh = newObjectName(KEY);
  assert.match(fresh, /^vault\/[0-9a-f]{48}$/);
  assert.equal(fresh.includes(KEY), false, 'the bearer membership key was embedded in an R2 name');

  const VAULTS = bucket();
  const old = `vault/${KEY}/0123456789abcdef0123456789abcdef`;
  await VAULTS.put(old, body());
  const held = durable('Vault', { VAULTS });
  await held.obj.commit({ want: { fresh: true }, id: old, bytes: 64, at: 'old' });
  assert.equal((await held.obj.burn()).collected, true);
  assert.equal(VAULTS._objs.has(old), false, 'a pre-migration object id could no longer be collected');
});

test('an authenticated read migrates legacy current and previous without changing bytes, metadata, or revision', async () => {
  const env = club();
  const legacy = await seedLegacy(env);

  const current = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(current.status, 200);
  assert.equal(current.headers.get('etag'), `"${LEGACY_REV}"`);
  assert.equal(new Uint8Array(await current.arrayBuffer())[0], 3);

  const migrated = legacy.object._map.get('head');
  assert.equal(migrated.rev, LEGACY_REV);
  for (const slot of ['current', 'previous']) {
    assert.match(migrated[slot].id, /^vault\/[0-9a-f]{48}$/);
    assert.deepEqual({ ...migrated[slot], id: legacy.head[slot].id }, legacy.head[slot],
      `${slot} pointer metadata changed during migration`);
  }
  assert.equal(env.VAULTS._objs.has(legacy.current), false);
  assert.equal(env.VAULTS._objs.has(legacy.previous), false);
  assert.deepEqual(env.VAULTS._metadata.get(migrated.current.id).customMetadata, { generation: 'current' });
  assert.deepEqual(env.VAULTS._metadata.get(migrated.previous.id).customMetadata, { generation: 'previous' });

  const previous = await worker.fetch(req('/vault?prev=1', { headers: auth() }), env);
  assert.equal(previous.status, 200);
  assert.equal(previous.headers.get('etag'), null);
  assert.equal(new Uint8Array(await previous.arrayBuffer())[0], 2);
});

test('legacy cleanup failure leaves the migrated vault readable and durably retries old ids', async () => {
  const env = club();
  const legacy = await seedLegacy(env);
  env.VAULTS._failDelete(true);

  const read = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(read.status, 200);
  assert.equal(new Uint8Array(await read.arrayBuffer())[0], 3);
  const migrated = legacy.object._map.get('head');
  assert.match(migrated.current.id, /^vault\/[0-9a-f]{48}$/);
  assert.match(migrated.previous.id, /^vault\/[0-9a-f]{48}$/);
  assert.deepEqual(legacy.object._map.get('deleting').ids.sort(), [legacy.current, legacy.previous].sort());
  assert.ok(legacy.object._alarm() > Date.now());

  env.VAULTS._failDelete(false);
  await legacy.object._runAlarm();
  assert.equal(env.VAULTS._objs.has(legacy.current), false);
  assert.equal(env.VAULTS._objs.has(legacy.previous), false);
  assert.equal(env.VAULTS._objs.has(migrated.current.id), true);
  assert.equal(env.VAULTS._objs.has(migrated.previous.id), true);
  assert.equal(legacy.object._map.has('deleting'), false);
  const again = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(again.headers.get('etag'), `"${LEGACY_REV}"`);
  assert.equal(new Uint8Array(await again.arrayBuffer())[0], 3);
});

test('a failed migration transaction leaves both legacy pointers readable', async () => {
  const env = club();
  const legacy = await seedLegacy(env);
  legacy.object._failTransactionAt(2); // pointer swap staged, cleanup tombstone write fails

  const read = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(read.status, 200);
  assert.equal(new Uint8Array(await read.arrayBuffer())[0], 3);
  assert.deepEqual(legacy.object._map.get('head'), legacy.head);
  assert.equal(legacy.object._map.has('deleting'), false);
  assert.deepEqual([...env.VAULTS._objs.keys()].sort(), [legacy.current, legacy.previous].sort(),
    'failed migration leaked its unused copies');
});

test('an authenticated write migrates legacy pointers before rotating at the same revision', async () => {
  const env = club();
  const legacy = await seedLegacy(env);
  const written = await sealed(env, body(64, 9), { 'if-match': `"${LEGACY_REV}"` });
  assert.equal(written.status, 200);
  assert.notEqual(revOf(written), LEGACY_REV);

  const head = legacy.object._map.get('head');
  assert.match(head.current.id, /^vault\/[0-9a-f]{48}$/);
  assert.match(head.previous.id, /^vault\/[0-9a-f]{48}$/);
  assert.equal(env.VAULTS._objs.has(legacy.current), false);
  assert.equal(env.VAULTS._objs.has(legacy.previous), false);
  const previous = await worker.fetch(req('/vault?prev=1', { headers: auth() }), env);
  assert.equal(new Uint8Array(await previous.arrayBuffer())[0], 3,
    'rotation lost the legacy current envelope it had just migrated');
});

// ---------- 8 ----------
test('collection can only ever take the object the rotation evicted', async () => {
  const env = club();
  await first(env, body(64, 1));
  const names = [];
  for (let i = 2; i <= 5; i++) {
    const head = await worker.fetch(req('/vault', { headers: auth() }), env);
    await sealed(env, body(64, i), { 'if-match': head.headers.get('etag') });
    names.push([...env.VAULTS._objs.keys()]);
    // never more than the two the vault names: current and the one before
    assert.equal(env.VAULTS._objs.size, 2, `after ${i} seals the store holds ${env.VAULTS._objs.size} objects`);
  }
  // and what it holds is what is pointed at, both of them readable
  const now = await worker.fetch(req('/vault', { headers: auth() }), env);
  const before = await worker.fetch(req('/vault?prev=1', { headers: auth() }), env);
  assert.equal(new Uint8Array(await now.arrayBuffer())[0], 5);
  assert.equal(new Uint8Array(await before.arrayBuffer())[0], 4);
});

// ---------- 9 ----------
test('a lapsed member reads and burns, and cannot rotate', async () => {
  const env = club();
  await first(env, body(64, 1));
  const held = await worker.fetch(req('/vault', { headers: auth() }), env);
  const rev = held.headers.get('etag');

  await setAuthoritativeMember(env, KEY, { standing: 'held' });

  const refused = await sealed(env, body(64, 2), { 'if-match': rev });
  assert.equal(refused.status, 402, 'a lapsed membership sealed anew');
  const still = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(new Uint8Array(await still.arrayBuffer())[0], 1, 'a lapsed member cannot read what is theirs');
  assert.equal((await worker.fetch(req('/vault', { method: 'DELETE', headers: auth() }), env)).status, 200);
});

// ---------- 10 ----------
test('an envelope too large is refused before it is read, and leaves nothing logical behind', async () => {
  const env = club();
  await first(env, body(64, 1));
  const head = await worker.fetch(req('/vault', { headers: auth() }), env);
  const rev = head.headers.get('etag');

  // the declared length alone is enough to refuse: nothing is uploaded
  const declared = await worker.fetch(req('/vault', {
    method: 'PUT',
    body: body(64, 2),
    headers: auth({ 'if-match': rev, 'content-length': String(LIMITS.vaultBytes + 1) }),
  }), env);
  assert.equal(declared.status, 413);
  assert.equal(env.VAULTS._objs.size, 1, 'a refused seal wrote bytes anyway');

  // and a body that lies about its length is caught by its own size, with the
  // object it wrote taken back
  const lying = await worker.fetch(req('/vault', {
    method: 'PUT',
    body: body(8, 3),
    headers: auth({ 'if-match': rev, 'content-length': '64' }),
  }), env);
  assert.equal(lying.status, 400, 'eight bytes were accepted as a sealed envelope');
  assert.equal(env.VAULTS._objs.size, 1, 'the refused bytes were left in the store');

  const still = await worker.fetch(req('/vault', { headers: auth() }), env);
  assert.equal(still.headers.get('etag'), rev, 'a refused seal moved the revision');
});

// ---------- and the shape of what is kept ----------
test('the object that owns the transition holds no ciphertext and no member', async () => {
  const { obj, _map } = durable();
  await obj.commit({ want: { fresh: true }, id: 'vault/tc_x/abc', bytes: 4096, at: '2026-08-12T00:00:00.000Z' });
  const held = JSON.stringify([..._map.entries()]);
  assert.equal(/tc_0123456789/.test(held), false, 'a membership key is filed in the pointer object');
  assert.match(held, /vault\/tc_x\/abc/, 'the object name is not held, so nothing can be read back');
  assert.equal(held.length < 400, true, `the pointer record is ${held.length} bytes; it holds pointers only`);
});
