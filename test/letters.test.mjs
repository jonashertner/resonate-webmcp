// letters.test.mjs — the letters module against RFC 9180's own numbers.
//
// A cryptographic construction that only checks "what I sealed, I can open"
// tests nothing: two identical mistakes agree perfectly. So this file checks
// the intermediate values the RFC publishes, in the order they are computed,
// and each one is a place a wrong implementation stops matching:
//
//   shared_secret         the KEM, including whether both DH values went in
//   key_schedule_context  the mode byte, and both empty extracts
//   secret                the shared secret used as SALT and not as ikm
//   key, base_nonce       the labeled expands, and the suite id in them
//   exporter_secret       the third expand
//   every nonce           the xor, at sequence 0 and at 255 and 256
//   every ciphertext      the AEAD, with the aad the vector names
//   every export          the exporter, with its own label
//
// The vectors in test/fixtures/hpke-p256.json are the CFRG file, not something
// generated here. The mode-auth AES-128-GCM entry is the one RFC 9180 prints in
// full at A.3.3, and its every field was compared against the RFC text before
// the file was trimmed; if that entry passes, the file is the RFC's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { __rfc9180: R, sealLetter, openLetter, generateKeyPair, keyId, KINDS, LETTER_VERSION,
  mintIdentity, identityFrom, pubFrom, pubText } =
  await import('../js/letters.js');

const FIX = JSON.parse(readFileSync(new URL('./fixtures/hpke-p256.json', import.meta.url), 'utf8'));

const hex = (b) => [...b].map(v => v.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
const b64u = (b) => Buffer.from(b).toString('base64url');

// A private key as a scalar, which is how the vectors give it and which
// WebCrypto will not import. The public point supplies x and y, so the JWK can
// be assembled from the two the vector already names, and importing it proves
// they belong together: a mismatched pair is refused by the import itself.
async function importPrivate(skHex, pkHex) {
  const pk = unhex(pkHex);
  assert.equal(pk.length, 65, 'a vector public key is an uncompressed point');
  assert.equal(pk[0], 0x04);
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', ext: true,
    d: b64u(unhex(skHex)), x: b64u(pk.slice(1, 33)), y: b64u(pk.slice(33)),
  }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}
const importPublic = (pkHex) => R.deserializePublic(unhex(pkHex));

// the ephemeral the vector used, handed in so the encap is reproducible;
// nothing outside a test ever supplies this
const ephemeralOf = async (v) => ({
  privateKey: await importPrivate(v.skEm, v.pkEm),
  publicKey: await importPublic(v.pkEm),
});

for (const v of FIX.vectors) {
  const name = `mode ${v.mode}, aead ${v.aead_id}`;

  test(`RFC 9180 ${name}: the KEM reaches the published shared secret`, async () => {
    const pkR = await importPublic(v.pkRm);
    const e = await ephemeralOf(v);
    if (v.mode === R.MODE_AUTH) {
      const skS = await importPrivate(v.skSm, v.pkSm);
      const pkS = await importPublic(v.pkSm);
      const got = await R.authEncap(pkR, skS, pkS, e);
      assert.equal(hex(got.enc), v.enc, 'enc is the ephemeral public key, serialized');
      assert.equal(hex(got.shared), v.shared_secret);
      // and the other way: the recipient derives the same secret from the wire
      const skR = await importPrivate(v.skRm, v.pkRm);
      const back = await R.authDecap(unhex(v.enc), skR, pkR, pkS);
      assert.equal(hex(back), v.shared_secret, 'decap disagreed with encap');
    } else {
      const got = await R.encap(pkR, e);
      assert.equal(hex(got.enc), v.enc);
      assert.equal(hex(got.shared), v.shared_secret);
      const skR = await importPrivate(v.skRm, v.pkRm);
      assert.equal(hex(await R.decap(unhex(v.enc), skR, pkR)), v.shared_secret);
    }
  });

  test(`RFC 9180 ${name}: the key schedule reaches every published value`, async () => {
    // the suite the vector was made for, which for the aead 1 entry is not the
    // one this app ships: the schedule is driven with that entry's own Nk so
    // the RFC-anchored vector is checkable rather than merely present
    const ks = await scheduleFor(v);
    assert.equal(hex(ks.context), v.key_schedule_context, 'key_schedule_context');
    assert.equal(hex(ks.secret), v.secret, 'secret');
    assert.equal(hex(ks.key), v.key, 'key');
    assert.equal(hex(ks.baseNonce), v.base_nonce, 'base_nonce');
    assert.equal(hex(ks.exporterSecret), v.exporter_secret, 'exporter_secret');
  });

  test(`RFC 9180 ${name}: every published nonce, including past 255`, async () => {
    const base = unhex(v.base_nonce);
    for (const enc of v.encryptions) {
      assert.equal(hex(R.nonceAt(base, Number(enc.seq))), enc.nonce,
        `the nonce at sequence ${enc.seq}`);
    }
    // the two that matter: the xor has to carry into the second byte from the
    // end, which a plus-one implementation gets right and a wrong width does not
    const seqs = v.encryptions.map(e => Number(e.seq));
    assert.ok(seqs.includes(255) && seqs.includes(256),
      'the vector slice must reach past a single byte or the carry is untested');
  });

  test(`RFC 9180 ${name}: every published ciphertext, sealed and opened`, async () => {
    const ks = await scheduleFor(v);
    for (const enc of v.encryptions) {
      const seq = Number(enc.seq);
      const ct = await R.contextOf(ks).at(seq).seal(unhex(enc.aad), unhex(enc.pt));
      assert.equal(hex(ct), enc.ct, `the ciphertext at sequence ${seq}`);
      const back = await R.contextOf(ks).at(seq).open(unhex(enc.aad), unhex(enc.ct));
      assert.equal(hex(back), enc.pt, `opening the published ciphertext at ${seq}`);
    }
  });

  test(`RFC 9180 ${name}: every published export`, async () => {
    const ctx = R.contextOf(await scheduleFor(v));
    for (const ex of v.exports) {
      assert.equal(hex(await ctx.export(unhex(ex.exporter_context), ex.L)), ex.exported_value);
    }
  });
}

// The schedule, driven from the vector's own shared secret. The suite id and
// key length come from the vector, so the AES-128-GCM entry RFC 9180 prints in
// full goes through exactly the same code as the suite this app ships.
async function scheduleFor(v) {
  return R.keySchedule(v.mode, unhex(v.shared_secret), unhex(v.info),
    R.suiteIdFor(v.kem_id, v.kdf_id, v.aead_id), v.aead_id === 1 ? 16 : 32);
}

// ---------- and then the letter, which is ours and not the RFC's ----------

test('a letter seals and opens between two members', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({
    kind: 'folio', to: b.publicKey, from: a,
    payload: { kind: 'folio', title: 'a short walk', places: [{ name: 'Cabane de Moiry' }] },
  });
  const got = await openLetter(wire, { me: b, from: a.publicKey });
  assert.equal(got.kind, 'folio');
  assert.equal(got.payload.title, 'a short walk');
  assert.match(got.msgId, /^[0-9a-f]{32}$/);
});

test('the wire carries no place name: a letter is opaque until it is opened', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({
    kind: 'folio', to: b.publicKey, from: a,
    payload: { kind: 'folio', title: 'Cabane de Moiry', note: 'the light at six' },
  });
  const text = Buffer.from(wire).toString('latin1');
  for (const secret of ['Moiry', 'Cabane', 'the light at six', 'folio']) {
    assert.ok(!text.includes(secret), `the wire carries ${secret} in the clear`);
  }
  // and the header that IS in the clear says only what it must
  assert.equal(Buffer.from(wire.slice(0, 5)).toString(), 'rsntl');
  assert.equal(wire[5], LETTER_VERSION);
  assert.equal(wire[6], KINDS.folio);
});

test('a letter changed on the way does not open', async () => {
  // The ciphertext region: HEAD + 65 is its first byte and the last byte of the
  // wire is the last byte of the gcm tag. Both are refused by the aead itself,
  // which is the claim this test is here to make.
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'lisbon?' } });
  for (const at of [R.HEAD + 65, R.HEAD + 80, wire.length - 1]) {
    const bent = Uint8Array.from(wire);
    bent[at] ^= 0x01;
    await assert.rejects(() => openLetter(bent, { me: b, from: a.publicKey }),
      /does not open/, `a flipped bit at ${at} was accepted`);
  }
});

test('a letter whose ephemeral key is bent is refused, and not by the aead', async () => {
  // enc is the sender's ephemeral public point and it sits outside the aad, as
  // it does in rfc 9180: the binding is not additional data but kem_context,
  // enc || pkRm || pkSm, mixed into the shared secret, so a changed enc yields
  // a different key rather than a failed tag check. In practice the refusal
  // arrives earlier still, from the point deserialization at the leading 0x04
  // or from webcrypto's own on-curve check inside the coordinates, so the
  // sentence differs by where the bit fell. Three places, one requirement: no
  // path accepts it, and each names its own reason rather than the aead's.
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'lisbon?' } });
  for (const at of [R.HEAD, R.HEAD + 1, R.HEAD + 64]) {
    const bent = Uint8Array.from(wire);
    bent[at] ^= 0x01;
    await assert.rejects(() => openLetter(bent, { me: b, from: a.publicKey }),
      err => err instanceof Error && !/does not open/.test(err.message),
      `a flipped bit at ${at} in enc was accepted`);
  }
});

test('a point that is not sixty-five uncompressed bytes is refused by name', async () => {
  // This check reads like belt and braces and is not. Node 25.8.2 ACCEPTS a
  // thirty-three byte compressed point for a raw ECDH import, verified here;
  // it refuses a sixty-five byte blob with a lead other than 0x04 as
  // `DataError: Invalid keyData`. So without this check the engines would
  // disagree about what a valid enc even is, and the disagreement would surface
  // as an unexplained import failure on one device and a working letter on
  // another. RFC 9180 serializes DHKEM(P-256) public keys uncompressed, and
  // this is where that is enforced rather than assumed.
  const compressed = new Uint8Array(33); compressed[0] = 0x02;
  const wrongLead = new Uint8Array(65); wrongLead[0] = 0x05;
  // The refusal is a throw rather than a rejection, because it happens before
  // anything is awaited. A caller cannot tell those apart and neither does this.
  const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
  for (const [what, raw] of [['a compressed point', compressed], ['a wrong lead byte', wrongLead]]) {
    const e = await refusal(() => R.deserializePublic(raw));
    assert.match(e?.message ?? 'it was accepted', /uncompressed P-256 point/,
      `${what} was not refused by name`);
  }
});

test('a letter whose header is edited does not open: the header is the aad', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({ kind: 'thanks', to: b.publicKey, from: a, payload: { kind: 'thanks' } });
  const bent = Uint8Array.from(wire);
  bent[6] = KINDS.atlas;   // a thanks announced as an atlas
  await assert.rejects(() => openLetter(bent, { me: b, from: a.publicKey }), /does not open/);
});

test('a letter from someone else does not open as a letter from you', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair(), c = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'where' } });
  // opened against the wrong sender: refused on the fingerprint, before any
  // derivation, so the message says which thing is wrong
  await assert.rejects(() => openLetter(wire, { me: b, from: c.publicKey }),
    /names a sender who is not the one it was opened against/);
});

test('a letter addressed to someone else is refused as that', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair(), c = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'where' } });
  await assert.rejects(() => openLetter(wire, { me: c, from: a.publicKey }),
    /was not addressed to you/);
});

test('a sender who is not who they claim cannot forge the claim', async () => {
  // c seals to b but writes a's fingerprint into the header. the aad matches
  // what c sealed under, so the tag would pass; what fails is the KEM, because
  // mode auth mixes the SENDER's static key into the shared secret and b
  // derives with a's public key.
  const a = await generateKeyPair(), b = await generateKeyPair(), c = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: c, payload: { q: 'where' } });
  const bent = Uint8Array.from(wire);
  bent.set(await keyId(a.publicKey), R.HEAD - 16);
  await assert.rejects(() => openLetter(bent, { me: b, from: a.publicKey }), /does not open/);
});

test('an inner kind that contradicts the authenticated one is refused', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  // sealed honestly as an ask, carrying a payload that calls itself an atlas
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { kind: 'atlas', places: [] } });
  await assert.rejects(() => openLetter(wire, { me: b, from: a.publicKey }),
    /says one thing outside and another inside/);
});

test('a letter from another version is refused by name', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'x' } });
  const bent = Uint8Array.from(wire);
  bent[5] = 9;
  await assert.rejects(() => openLetter(bent, { me: b, from: a.publicKey }), /version 9/);
});

test('two letters with the same keys never reuse a nonce', async () => {
  // the nonce is derived from a per-letter ephemeral, so two letters between
  // the same pair share no key at all. this is the property that makes a
  // transmitted iv unnecessary, and it is worth pinning rather than assuming.
  const a = await generateKeyPair(), b = await generateKeyPair();
  const one = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'x' } });
  const two = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'x' } });
  const encOf = w => hex(w.slice(R.HEAD, R.HEAD + 65));
  assert.notEqual(encOf(one), encOf(two), 'the same ephemeral was used twice');
  assert.notEqual(hex(one.slice(R.HEAD + 65)), hex(two.slice(R.HEAD + 65)),
    'the same plaintext sealed to the same ciphertext');
});

test('the sent time is carried, big-endian, and survives a round trip', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const sent = 1786000000000;
  const wire = await sealLetter({ kind: 'ask', to: b.publicKey, from: a, payload: { q: 'x' }, sent });
  assert.equal((await openLetter(wire, { me: b, from: a.publicKey })).sent, sent);
});

// ---------- the identity, written down and read back ----------
//
// Everything above works in CryptoKeys, which live for as long as a tab does.
// A membership outlives a tab, so the identity has to survive as text: a JWK
// for the private half, eighty-seven characters for the public one. These are
// the tests that the trip through text changes nothing, because a key that
// comes back subtly different is a key whose letters no longer open and whose
// mark no longer matches, and neither failure names its cause.

test('an identity survives being written down and read back', async () => {
  const { jwk, pub } = await mintIdentity();
  const me = await identityFrom(jwk);
  const them = await generateKeyPair();
  // the trip through text is the thing under test, so the letter is sealed by
  // the restored keypair and opened against the public half a correspondent
  // would have read out of an introduction
  const wire = await sealLetter({ kind: 'ask', to: them.publicKey, from: me, payload: { q: 'where' } });
  const got = await openLetter(wire, { me: them, from: await pubFrom(pub) });
  assert.deepEqual(got.payload, { q: 'where' });
});

test('the public half in text and the public half in the jwk are one key', async () => {
  // Two halves that had drifted apart would give a person a working private
  // key and an address nobody can seal to, and every letter would fail as
  // "not addressed to you" rather than as what it was.
  const { jwk, pub } = await mintIdentity();
  const me = await identityFrom(jwk);
  assert.equal(await pubText(me.publicKey), pub);
  assert.equal(await pubText(await pubFrom(pub)), pub);
});

test('a public key written down is eighty-seven characters beginning with B', async () => {
  // the shape every other file in this app checks for. B is base64url's first
  // character for a leading 0x04, which is what says uncompressed point.
  for (let i = 0; i < 4; i++) {
    const { pub } = await mintIdentity();
    assert.match(pub, /^B[A-Za-z0-9_-]{86}$/, 'a key was written in a shape the gates refuse');
  }
});

test('a key that is not an uncompressed P-256 point is refused as text', async () => {
  const { pub } = await mintIdentity();
  await assert.rejects(() => pubFrom(pub.slice(0, 80)), /uncompressed P-256 point/);
  // eighty-five characters is the one length base64 itself refuses, and it is
  // the reason the shape is checked before the decode: without that check a
  // person who lost two characters out of a chat window is handed the
  // browser's sentence about character counts instead of this app's.
  await assert.rejects(() => pubFrom(pub.slice(0, 85)), /uncompressed P-256 point/);
  await assert.rejects(() => pubFrom(`${pub}x`), /uncompressed P-256 point/);
  await assert.rejects(() => pubFrom(`A${pub.slice(1)}`), /uncompressed P-256 point/);
  await assert.rejects(() => pubFrom(''), /uncompressed P-256 point/);
  // and the leading byte itself, which the shape alone cannot pin: B says the
  // first byte is one of four, and only 0x04 says uncompressed point. Q in the
  // second character lifts it to 0x05, which is the length shape exactly and
  // the wrong point encoding entirely.
  await assert.rejects(() => pubFrom(`BQ${pub.slice(2)}`), /uncompressed P-256 point/);
});

test('two identities are never the same identity', async () => {
  const a = await mintIdentity(), b = await mintIdentity();
  assert.notEqual(a.pub, b.pub);
  assert.notEqual(a.jwk.d, b.jwk.d);
});

test('an identity with no private half cannot be restored', async () => {
  await assert.rejects(() => identityFrom(null), /holds no identity/);
});

// ---------- how much folio fits in one letter ----------
//
// The box refuses a letter over 256 KB and the app refuses it first, with a
// sentence, where a person can still do something about it. Both numbers are
// only worth having if somebody has measured what a real folio weighs against
// them, because a cap nobody has measured is a cap that is either pointless or
// waiting to be hit by the first person with a large atlas.
//
// So it is measured here, on the sealed bytes rather than on a guess about
// them: buildPayload builds what actually leaves, sealLetter seals it, and the
// length is the length the club would see.
const { buildPayload } = await import('../js/share.js');
const { LETTER_LIMITS } = await import('../js/letters.js');

// A place carrying everything a place can carry short of the note limit: a
// real name, a real city, coordinates at full precision, tags, and a note of
// the length people actually write. LIMITS.note is 4000 and nobody writes
// 4000; a hundred and fifty characters is a paragraph about a bar.
const heavyPlace = (i) => ({
  id: `p-${i}-${'x'.repeat(12)}`,
  name: `Restaurante do Bairro Alto number ${i}`,
  lat: 38.7139 + i / 10000, lng: -9.1394 - i / 10000,
  city: 'Lisboa', country: 'Portugal',
  status: 'visited',
  tags: ['t0', 't1', 't2'],
  note: 'Go on a weekday, sit at the counter, and let them bring whatever came in that morning. '
      + 'The room is loud by nine and the walk down is steep.',
  url: 'https://example.org/a-place-with-a-reasonably-long-address/and-a-path',
  createdAt: '2026-03-04T18:22:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
});

const folioOf = (n) => buildPayload('folio', {
  title: 'Everything I know about Lisboa',
  dedication: 'for Bruno, who asked',
  author: 'ada',
  tags: [{ id: 't0', name: 'wine' }, { id: 't1', name: 'late' }, { id: 't2', name: 'counter' }],
  places: Array.from({ length: n }, (_, i) => heavyPlace(i)),
  routes: [], books: [],
}, { forLink: false });

const sealedBytes = async (payload) => {
  const me = await mintIdentity();
  const them = await mintIdentity();
  const wire = await sealLetter({
    kind: 'folio', payload,
    to: await pubFrom(them.pub), from: await identityFrom(me.jwk),
  });
  return wire.length;
};

test('a large folio of real places fits in one letter, with room to spare', async () => {
  // Four hundred places is a very large folio. The atlas cap is five hundred,
  // so this is four fifths of everything a person is allowed to keep, every
  // one of them written up.
  const n = await sealedBytes(folioOf(400));
  assert.ok(n < LETTER_LIMITS.bytes,
    `four hundred written-up places seal to ${n} bytes and the box takes ${LETTER_LIMITS.bytes}`);
  // and it is not squeaking under: a bound that only just holds is one that
  // the next field added to a place will break without anybody noticing.
  assert.ok(n < LETTER_LIMITS.bytes * 0.75,
    `four hundred places seal to ${n} bytes, which is most of the box already`);
});

test('the letter cap bites on notes and not on places, which is what the refusal is for', async () => {
  // Where the line actually falls, measured rather than assumed. The first
  // draft of this test asserted that the whole atlas was the case a person
  // gets told to hand over as a link instead. It is not: five hundred places
  // is the atlas cap and, written up the way people write, it seals to about
  // four fifths of a letter and goes.
  const whole = await sealedBytes(folioOf(500));
  assert.ok(whole < LETTER_LIMITS.bytes,
    `the whole atlas written up seals to ${whole} bytes and will not go as a letter`);

  // What the cap is for is notes. LIMITS.note is four thousand characters, and
  // a folio of places written up at that length crosses the cap at about sixty
  // places, which is a folio somebody could plausibly compose on an afternoon.
  // So the refusal in sendLetterTo is a sentence a real person will really
  // read, and it is worth the words it is written in.
  const wordy = (n) => buildPayload('folio', {
    title: 'Everything I know about Lisboa', dedication: '', author: 'ada', tags: [],
    places: Array.from({ length: n }, (_, i) => ({ ...heavyPlace(i), note: 'x '.repeat(2000) })),
    routes: [], books: [],
  }, { forLink: false });

  const fifty = await sealedBytes(wordy(50));
  assert.ok(fifty < LETTER_LIMITS.bytes,
    `fifty places at the note limit seal to ${fifty} bytes, so the cap bites sooner than measured`);
  const hundred = await sealedBytes(wordy(100));
  assert.ok(hundred > LETTER_LIMITS.bytes,
    `a hundred places at the note limit seal to ${hundred} bytes, so nothing this app builds can reach the cap`);
});
