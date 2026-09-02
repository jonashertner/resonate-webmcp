// The invariants the club must hold: keys are honest, standing is bounded,
// the webhook only listens to Stripe, the commitment two sides of the wire
// compute is the same commitment, and the vault keeps exactly what it was
// given, replacing only the envelope the writer had read.
//
// The door, the payment desk and the subscription's own life are next door in
// checkout.test.mjs, which is where Stripe is pretended.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  mintKey, isKey, isSecret, isCommitment, commitmentOf, mintKeyFor,
  standingOf, sameString, GRACE_S, LIMITS,
} from '../src/validate.js';
import { verifyWebhook } from '../src/stripe.js';
import worker from '../src/worker.js';
import { commitmentOf as commitmentOnTheDevice, makeClient } from '../../js/club.js';
import { durableNamespace, vaultNamespace, bucket, kv, setAuthoritativeMember } from './fakes.mjs';

const req = (path, { method = 'GET', body, headers = {} } = {}) =>
  new Request(`https://club.example${path}`, { method, body, headers });

const seal = (body, headers) => req('/vault', { method: 'PUT', body, headers });

test('keys mint into their own alphabet and nothing else passes', () => {
  const k = mintKey(new Uint8Array(16).fill(7));
  assert.ok(isKey(k), k);
  assert.ok(k.startsWith('tc_'));
  assert.ok(!isKey('tc_UPPER'), 'no capitals');
  assert.ok(!isKey('tc_'), 'no empty');
  assert.ok(!isKey('sk_live_abcdefghij1234567890'), 'not a stripe secret');
});

test('standing honours the period, the grace, and the leaving', () => {
  const now = 1_000_000;
  assert.equal(standingOf(null, now), 'none');
  assert.equal(standingOf({ until: now + 10 }, now), 'good');
  assert.equal(standingOf({ until: now - 10 }, now), 'good', 'grace holds');
  assert.equal(standingOf({ until: now - GRACE_S - 1 }, now), 'lapsed');
  assert.equal(standingOf({ until: now + 10, standing: 'left' }, now), 'left');
});

test('the webhook only listens to stripe', async () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ type: 'invoice.paid' });
  const t = 1_700_000_000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  assert.equal(await verifyWebhook(body, `t=${t},v1=${hex}`, secret, t + 60), true);
  assert.equal(await verifyWebhook(body, `t=${t},v1=${hex}`, 'whsec_other', t + 60), false, 'wrong secret');
  assert.equal(await verifyWebhook(body, `t=${t},v1=${hex}`, secret, t + 3600), false, 'stale');
  assert.equal(await verifyWebhook(body + ' ', `t=${t},v1=${hex}`, secret, t + 60), false, 'tampered');
  assert.equal(sameString(hex, hex), true);
});

// The test above signs with the same formula the code signs with, so it proves
// the two agree with each other and nothing at all about whether either agrees
// with Stripe. That is the shape of a test that cannot fail for the reason it
// exists, and on 2026-08-16 it was the reason an hour went into asking whether
// our HMAC was wrong when the answer was in a dashboard.
//
// So: one vector, computed outside this codebase, written down as a constant.
// It was produced with node's own crypto, which is the module Stripe's own
// node library uses, and it can be reproduced by anyone from the four values
// named here:
//
//   node -e "const{createHmac}=require('node:crypto');console.log(
//     createHmac('sha256', SECRET).update(T + '.' + BODY).digest('hex'))"
//
// A change to the signed payload, the digest, or the encoding moves V1 and
// this goes red. Nothing here is a credential: the secret is a sentence.
test('the signature is stripe’s, and not merely our own twice', async () => {
  const SECRET = 'whsec_a_published_test_vector_not_a_secret';
  const BODY = '{"id":"evt_vector","object":"event","type":"invoice.paid"}';
  const T = 1_700_000_000;
  const V1 = '1378ca25ffcb23d9d9b1ac9e3878285e8d7601d0966c4ae6f2cc2a48da82b1d3';

  assert.equal(await verifyWebhook(BODY, `t=${T},v1=${V1}`, SECRET, T + 60), true,
    'HMAC-SHA256 over `${t}.${body}`, keyed with the whole secret including its prefix, lowercase hex');

  // the same bytes signed the other way round, which is the mistake this
  // vector exists to catch, and which a self-signed test cannot see
  const FLIPPED = '351b0c106ea270e9d143f654250a148181151deabc8a432ba939718989bc294c';
  assert.equal(await verifyWebhook(BODY, `t=${T},v1=${FLIPPED}`, SECRET, T + 60), false,
    'body-then-timestamp is not the payload stripe signs');

  // the prefix is part of the key. stripping it is a real implementation
  // choice someone could make on the way past, and it is the wrong one.
  assert.equal(await verifyWebhook(BODY, `t=${T},v1=${V1}`, SECRET.slice(6), T + 60), false,
    'the whsec_ prefix is keying material, not decoration');

  // stripe sends v0 alongside v1 on test events, and rotation sends two v1s
  assert.equal(await verifyWebhook(BODY, `t=${T},v0=ignored,v1=dead,v1=${V1}`, SECRET, T + 60), true,
    'every v1 offered is tried, and v0 is not one of them');
});

// A binding the platform does not hand you is not a slow failure. It is
// `env.BOX is undefined` on the first request from the first member who ever
// paid, and there is no way to see it in a test that supplies its own env.
//
// This exists because it happened. A `[vars]` table was written above
// `kv_namespaces = [...]`, and in TOML a bare key after a table header belongs
// to that table: the whole KV binding quietly became an environment variable
// called `kv_namespaces`. Every club test passed, because every club test
// builds its own env. Only `wrangler deploy --dry-run` showed it, and only if
// somebody read the binding table it prints.
test('every binding the worker reads is declared where the platform will find it', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

  // a tiny TOML walk: enough to know which table a key sits under, which is
  // the whole of what went wrong
  const vars = new Set(), bindings = new Set();
  let table = '';
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const head = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (head) { table = head[1]; continue; }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const name = kv[2].replace(/["']/g, '').trim();
    if (table === 'vars') vars.add(kv[1]);
    else if (table === 'durable_objects.bindings' && kv[1] === 'name') bindings.add(name);
    else if (kv[1] === 'binding') bindings.add(name);
  }

  // set with `wrangler secret put`, so they are named in the file only as prose
  const SECRETS = new Set(['STRIPE_SECRET', 'STRIPE_WEBHOOK_SECRET', 'MINT_SECRET']);
  const used = new Set([...src.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map(m => m[1]));
  assert.ok(used.size >= 6, `only ${used.size} bindings read; this test has stopped looking`);

  for (const name of used) {
    assert.ok(SECRETS.has(name) || vars.has(name) || bindings.has(name),
      `the worker reads env.${name} and wrangler.toml declares no such binding, var or secret`);
  }
  // and every secret the file promises is one the worker actually asks for
  for (const s of SECRETS) {
    assert.ok(used.has(s), `wrangler.toml documents ${s} and the worker never reads it`);
    assert.ok(new RegExp(`\\b${s}\\b`).test(toml), `${s} is read and never documented`);
  }
});

test('both sides of the wire compute the same commitment', async () => {
  // The device hashes its secret and the club hashes what the device shows.
  // Two implementations of one label, in two files that cannot import each
  // other: the app is published and the worker is not. If they ever disagree
  // the door stops opening for everybody, so they are compared here.
  const secret = '0123456789abcdef0123456789abcdef';
  const mine = await commitmentOnTheDevice(secret);
  assert.equal(mine, await commitmentOf(secret), 'the device and the club hash differently');
  assert.ok(isCommitment(mine), mine);
  assert.ok(isSecret(secret));
  assert.notEqual(mine, await commitmentOf('f'.repeat(32)), 'another secret, another commitment');

  // and the commitment does not give the secret away by being short
  assert.equal(mine.length, 64);
  assert.ok(!isSecret(mine), 'a commitment is not a secret, and cannot be presented as one');
  assert.ok(!isCommitment(secret), 'and a secret is not a commitment');
});

test('two doors opening at once for one payment agree on the key', async () => {
  // KV cannot compare and swap, so a key drawn at random could be drawn twice:
  // two memberships for one payment, and renewals reaching only one of them.
  const secret = 'f'.repeat(64);
  const a = await mintKeyFor('sub_77', secret);
  const b = await mintKeyFor('sub_77', secret);
  assert.equal(a, b, 'the same payment minted two different keys');
  assert.ok(isKey(a), a);
  assert.notEqual(a, await mintKeyFor('sub_78', secret), 'two payments, two memberships');
  assert.notEqual(a, await mintKeyFor('sub_77', '0'.repeat(64)), 'and the secret is what makes it unguessable');
});

async function memberEnv(until) {
  // the vault's pointers and its ciphertext, modelled once in fakes.mjs and
  // imported here so the two suites cannot drift apart about the platform
  const env = { BOX: kv(), VAULTS: bucket() };
  env.VAULT = vaultNamespace(env);
  env.SUBSCRIPTIONS = durableNamespace('Subscription');
  const key = mintKey(crypto.getRandomValues(new Uint8Array(16)));
  await env.BOX.put(`member:${key}`, JSON.stringify({ sub: 'sub_9', until, standing: 'good' }));
  return { env, key, auth: { authorization: `Bearer ${key}` } };
}

test('the vault keeps the envelope, and the one before it', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, auth } = await memberEnv(now + 3600);

  const first = new Uint8Array(64).fill(1);
  const r1 = await worker.fetch(seal(first, { ...auth, 'if-none-match': '*' }), env);
  assert.equal(r1.status, 200);

  const second = new Uint8Array(64).fill(2);
  await worker.fetch(seal(second, { ...auth, 'if-match': r1.headers.get('etag') }), env);

  const now1 = await worker.fetch(req('/vault', { headers: auth }), env);
  assert.deepEqual(new Uint8Array(await now1.arrayBuffer()), second);
  const before = await worker.fetch(req('/vault?prev=1', { headers: auth }), env);
  assert.deepEqual(new Uint8Array(await before.arrayBuffer()), first, 'the envelope before is kept');
  assert.equal(before.headers.get('etag'), null, 'the slot before is read, never written, and carries no revision');

  const gone = await worker.fetch(req('/vault', { method: 'DELETE', headers: auth }), env);
  assert.equal((await gone.json()).gone, true);
  assert.equal((await worker.fetch(req('/vault', { headers: auth }), env)).status, 404);
});

test('a lapsed member reads and deletes, but does not write', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, key, auth } = await memberEnv(now + 3600);
  const kept = await worker.fetch(seal(new Uint8Array(64), { ...auth, 'if-none-match': '*' }), env);
  assert.equal(kept.status, 200);

  await setAuthoritativeMember(env, key, { until: now - GRACE_S - 10, standing: 'held' });
  const w = await worker.fetch(seal(new Uint8Array(64), { ...auth, 'if-match': kept.headers.get('etag') }), env);
  assert.equal(w.status, 402, 'no new envelopes');
  const r = await worker.fetch(req('/vault', { headers: auth }), env);
  assert.equal(r.status, 200, 'but the envelope is still theirs');
  const m = await (await worker.fetch(req('/membership', { headers: auth }), env)).json();
  assert.equal(m.standing, 'lapsed');
});

test('the vault is bounded and strangers stay outside', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, auth } = await memberEnv(now + 3600);

  const tiny = await worker.fetch(seal(new Uint8Array(4), { ...auth, 'if-none-match': '*' }), env);
  assert.equal(tiny.status, 400, 'too small to be sealed');
  assert.ok(LIMITS.vaultBytes <= 20_000_000, 'stays under the KV ceiling');

  const anon = await worker.fetch(req('/vault'), env);
  assert.equal(anon.status, 401);
  const wrong = await worker.fetch(req('/vault', { headers: { authorization: 'Bearer tc_00000000000000000000' } }), env);
  assert.equal(wrong.status, 401);
});

test('two devices cannot write over one another', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, auth } = await memberEnv(now + 3600);

  // nothing sealed yet, and the first seal is the one that says so
  const created = await worker.fetch(seal(new Uint8Array(64).fill(1), { ...auth, 'if-none-match': '*' }), env);
  assert.equal(created.status, 200);
  const revA = created.headers.get('etag');
  assert.match(revA, /^"[0-9a-f]{32}"$/, 'an opaque revision, and nothing of the envelope in it');

  const twice = await worker.fetch(seal(new Uint8Array(64).fill(9), { ...auth, 'if-none-match': '*' }), env);
  assert.equal(twice.status, 412, 'the vault is no longer empty, and the creating seal is refused');

  // two devices read the same envelope and hold the same revision
  const read = await worker.fetch(req('/vault', { headers: auth }), env);
  assert.equal(read.headers.get('etag'), revA);

  // one of them seals
  const won = await worker.fetch(seal(new Uint8Array(64).fill(2), { ...auth, 'if-match': revA }), env);
  assert.equal(won.status, 200);
  const revB = won.headers.get('etag');
  assert.notEqual(revB, revA, 'every seal moves the revision');

  // the other, still holding the old revision, is refused rather than obeyed
  const lost = await worker.fetch(seal(new Uint8Array(64).fill(3), { ...auth, 'if-match': revA }), env);
  assert.equal(lost.status, 412);
  assert.equal(lost.headers.get('etag'), revB, 'and is told which envelope to read');

  const held = new Uint8Array(await (await worker.fetch(req('/vault', { headers: auth }), env)).arrayBuffer());
  assert.deepEqual(held, new Uint8Array(64).fill(2), 'the winner is still there');

  // having read again, it may seal
  const retried = await worker.fetch(seal(new Uint8Array(64).fill(3), { ...auth, 'if-match': revB }), env);
  assert.equal(retried.status, 200);
});

test('a seal that names no envelope, or names them all, is refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, auth } = await memberEnv(now + 3600);
  const created = await worker.fetch(seal(new Uint8Array(64).fill(1), { ...auth, 'if-none-match': '*' }), env);
  const rev = created.headers.get('etag');

  const silent = await worker.fetch(seal(new Uint8Array(64).fill(2), auth), env);
  assert.equal(silent.status, 428, 'the old unconditional write is now a refusal, not a clobber');

  const star = await worker.fetch(seal(new Uint8Array(64).fill(2), { ...auth, 'if-match': '*' }), env);
  assert.equal(star.status, 412, 'a star is a licence to overwrite, which is the thing being refused');

  const weak = await worker.fetch(seal(new Uint8Array(64).fill(2), { ...auth, 'if-match': `W/${rev}` }), env);
  assert.equal(weak.status, 412, 'and a weak comparison is no comparison');

  const held = new Uint8Array(await (await worker.fetch(req('/vault', { headers: auth }), env)).arrayBuffer());
  assert.deepEqual(held, new Uint8Array(64).fill(1), 'none of them touched the envelope');
});

test('the client seals over what it read, and refuses to clobber what it did not', async (t) => {
  const now = Math.floor(Date.now() / 1000);
  const { env, key, auth } = await memberEnv(now + 3600);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, init) => worker.fetch(new Request(u, init), env);
  t.after(() => { globalThis.fetch = realFetch; });

  const c = makeClient('https://club.example', () => key);
  assert.equal(await c.getVault(), null, 'an empty vault, and the client knows it');
  const first = await c.putVault(new Uint8Array(64).fill(1));
  assert.match(first.rev, /^"[0-9a-f]{32}"$/);

  // another device seals in between
  await worker.fetch(seal(new Uint8Array(64).fill(2), { ...auth, 'if-match': first.rev }), env);

  await assert.rejects(() => c.putVault(new Uint8Array(64).fill(3)), /stale/,
    'the client does not write over an envelope it has not read');

  const got = await c.getVault();
  assert.deepEqual(got.bytes, new Uint8Array(64).fill(2), 'so it reads again');
  const after = await c.putVault(new Uint8Array(64).fill(3));
  assert.notEqual(after.rev, got.rev, 'and then it may seal');

  await c.delVault();
  const fresh = await c.putVault(new Uint8Array(64).fill(4));
  assert.ok(fresh.rev, 'a burned vault is created into, not replaced');
});
