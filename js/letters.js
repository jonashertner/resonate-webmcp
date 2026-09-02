// letters.js — one letter, from one member to one member, sealed here.
//
// This is HPKE, RFC 9180, mode `auth`, and it is called that only because it
// is that: the exact LabeledExtract and LabeledExpand, the exact suite
// identifiers, the exact KEM context, the exact key schedule, and nonces
// derived from the context rather than carried on the wire. It is checked
// against the RFC's own published test vectors in test/letters.test.mjs, at
// every stage and not only at the end, so a construction that merely produced
// self-consistent bytes would not pass.
//
//   DHKEM(P-256, HKDF-SHA256)   kem_id 0x0010
//   HKDF-SHA256                 kdf_id 0x0001
//   AES-256-GCM                 aead_id 0x0002
//   mode auth                   0x02
//
// P-256 is chosen for one reason and it is not that it is the modern
// preference: it is the only curve WebCrypto gives us in all three engines
// without vendoring a library into an app that has no build step. X25519 is
// the better choice and is not yet reachable everywhere. That is a trade and
// it is written down here rather than implied.
//
// mode `auth` means the recipient learns that the sender holds the private key
// they claim, which is what makes a letter different from a link. RFC 9180 §9.1
// is explicit that authenticated DHKEM is open to key-compromise impersonation:
// someone who takes YOUR private key can forge letters TO you from anyone whose
// public key they know. THREATS says so where a member can act on it.
//
// What this file does NOT do: it reads no store, it names no endpoint, and it
// knows nothing about a letterbox. It takes keys and bytes and returns bytes,
// and the one thing it says about a key that is not cryptography is how a key
// is written down, because a key written two ways is two keys.

const SUITE = { kem: 0x0010, kdf: 0x0001, aead: 0x0002 };
const MODE_BASE = 0x00;
const MODE_AUTH = 0x02;

// the sizes this suite fixes, RFC 9180 §7
const Nsecret = 32;   // DHKEM(P-256, HKDF-SHA256)
const Nh = 32;        // HKDF-SHA256
const Nk = 32;        // AES-256-GCM
const Nn = 12;        // AES-256-GCM
const Ndh = 32;       // the P-256 x coordinate

const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

const bytes = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// I2OSP, the RFC's own name for it: an integer as a fixed-width big-endian
// string of octets.
function i2osp(n, width) {
  const out = new Uint8Array(width);
  let v = BigInt(n);
  for (let i = width - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new RangeError('i2osp: the number does not fit');
  return out;
}

// The two suite identifiers. They are different strings and mixing them is a
// silent failure: everything still derives, nothing interoperates, and only a
// test vector says so.
const KEM_SUITE = bytes(te.encode('KEM'), i2osp(SUITE.kem, 2));
const HPKE_SUITE = bytes(
  te.encode('HPKE'), i2osp(SUITE.kem, 2), i2osp(SUITE.kdf, 2), i2osp(SUITE.aead, 2));
const V1 = te.encode('HPKE-v1');

// ---------- HKDF, by hand ----------
//
// WebCrypto's HKDF is extract-and-expand in one call and hands back no PRK, and
// HPKE needs Extract and Expand separately: the KEM extracts with an empty
// salt, the key schedule extracts with the shared secret AS the salt, and both
// then expand that PRK several times. So both halves are built on HMAC, which
// WebCrypto does give exactly.

async function hmac(key, msg) {
  const k = await subtle().importKey('raw', key.length ? key : new Uint8Array(1),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // an empty HMAC key is legal in RFC 2104 and refused by WebCrypto, so a
  // zero-length salt is padded to the block the spec would pad it to anyway
  if (!key.length) {
    const k0 = await subtle().importKey('raw', new Uint8Array(Nh),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle().sign('HMAC', k0, msg));
  }
  return new Uint8Array(await subtle().sign('HMAC', k, msg));
}

const extract = (salt, ikm) => hmac(salt, ikm);

async function expand(prk, info, L) {
  const n = Math.ceil(L / Nh);
  if (n > 255) throw new RangeError('expand: too much asked of one prk');
  const out = new Uint8Array(n * Nh);
  let t = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    t = await hmac(prk, bytes(t, info, Uint8Array.of(i)));
    out.set(t, (i - 1) * Nh);
  }
  return out.slice(0, L);
}

const labeledExtract = (suiteId, salt, label, ikm) =>
  extract(salt, bytes(V1, suiteId, te.encode(label), ikm));

const labeledExpand = (suiteId, prk, label, info, L) =>
  expand(prk, bytes(i2osp(L, 2), V1, suiteId, te.encode(label), info), L);

// ---------- the KEM ----------

async function extractAndExpand(dh, kemContext) {
  const eaePrk = await labeledExtract(KEM_SUITE, new Uint8Array(0), 'eae_prk', dh);
  return labeledExpand(KEM_SUITE, eaePrk, 'shared_secret', kemContext, Nsecret);
}

// The Diffie-Hellman of RFC 9180 for a NIST curve is the x coordinate of the
// shared point and nothing else, which is what deriveBits returns.
async function dh(sk, pk) {
  const b = await subtle().deriveBits({ name: 'ECDH', public: pk }, sk, Ndh * 8);
  return new Uint8Array(b);
}

const serializePublic = async (pk) => new Uint8Array(await subtle().exportKey('raw', pk));

const deserializePublic = (raw) => {
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error('that is not an uncompressed P-256 point');
  }
  return subtle().importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
};

export async function generateKeyPair() {
  // extractable on purpose: a member's identity is their membership, not this
  // device, so the private key has to be able to travel inside the archive,
  // sealed under the recovery phrase. That is the decision of 2026-08-16 and
  // its price is written in THREATS: a weak phrase plus a club breach is
  // impersonation, not merely disclosure.
  return subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

// ---------- a key written down ----------
//
// Two encodings and no third. On the wire a key is the raw uncompressed point,
// because that is what RFC 9180 serialises and what every fingerprint above is
// taken over. Anywhere a person or a link carries one it is base64url of
// exactly those bytes: 87 characters beginning with B, which is the 0x04 that
// says uncompressed. A JWK is neither of those; it is only how a private key
// sleeps inside the vault, and it never describes a correspondent.
// Sixty-five bytes is eighty-seven characters with no padding left over, which
// is why nothing here puts any back: the one thing this app ever writes in
// base64url is a P-256 point, and PUB_TEXT is the only length it accepts.
const PUB_TEXT = /^B[A-Za-z0-9_-]{86}$/;
const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(
  atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// A membership's identity, minted once. What comes back is the two forms it is
// kept in and no CryptoKey at all: the caller's job is to write this down, and
// an identity that was minted and not written down is worse than none, because
// a friend may have verified its mark before it vanished.
export async function mintIdentity() {
  const pair = await generateKeyPair();
  return {
    jwk: await subtle().exportKey('jwk', pair.privateKey),
    pub: b64u(await serializePublic(pair.publicKey)),
  };
}

// The keypair back out of what was written down. The public half is rebuilt
// from the same JWK rather than from the stored text, so a store whose two
// halves have drifted apart cannot produce a pair that signs as one identity
// and announces itself as another.
export async function identityFrom(jwk) {
  if (!jwk) throw new Error('this device holds no identity');
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  const { kty, crv, x, y } = jwk;
  return {
    privateKey: await subtle().importKey('jwk', jwk, alg, true, ['deriveBits']),
    publicKey: await subtle().importKey('jwk', { kty, crv, x, y }, alg, true, []),
  };
}

// A correspondent's public key, out of the 87 characters an introduction
// carries. deserializePublic refuses anything that is not an uncompressed
// P-256 point, so a mistyped introduction fails here rather than at the first
// letter that will not open.
// async even where it refuses, so a caller has one road for both answers: a
// function that rejects for one bad key and throws for another is a function
// whose callers handle one of them.
//
// The shape is checked before the decode rather than after, because atob's
// refusal is a browser's sentence about character counts and this app's reader
// is a person who was handed a link that lost a character in a chat window.
export const pubFrom = async (text) => {
  if (!PUB_TEXT.test(String(text || ''))) throw new Error('that is not an uncompressed P-256 point');
  return deserializePublic(unb64u(text));
};

// and the same key back to those 87 characters, for the one place that has a
// CryptoKey and needs the text: a mark computed over what an introduction said
export const pubText = async (pk) => b64u(await serializePublic(pk));

async function authEncap(pkR, skS, pkS, ephemeral) {
  const e = ephemeral || await generateKeyPair();
  const dhER = await dh(e.privateKey, pkR);
  const dhSR = await dh(skS, pkR);
  const enc = await serializePublic(e.publicKey);
  const kemContext = bytes(enc, await serializePublic(pkR), await serializePublic(pkS));
  return { shared: await extractAndExpand(bytes(dhER, dhSR), kemContext), enc };
}

async function authDecap(enc, skR, pkR, pkS) {
  const pkE = await deserializePublic(enc);
  const dhER = await dh(skR, pkE);
  const dhSR = await dh(skR, pkS);
  const kemContext = bytes(enc, await serializePublic(pkR), await serializePublic(pkS));
  return extractAndExpand(bytes(dhER, dhSR), kemContext);
}

async function encap(pkR, ephemeral) {
  const e = ephemeral || await generateKeyPair();
  const dhER = await dh(e.privateKey, pkR);
  const enc = await serializePublic(e.publicKey);
  const kemContext = bytes(enc, await serializePublic(pkR));
  return { shared: await extractAndExpand(dhER, kemContext), enc };
}

async function decap(enc, skR, pkR) {
  const pkE = await deserializePublic(enc);
  const dhER = await dh(skR, pkE);
  const kemContext = bytes(enc, await serializePublic(pkR));
  return extractAndExpand(dhER, kemContext);
}

// ---------- the key schedule ----------

// `suite` and `nk` are parameters for one reason: RFC 9180 prints exactly one
// P-256 suite in full, at A.3.3, and it is AES-128-GCM. Fixing them here would
// make the one vector the RFC publishes in its own text uncheckable, leaving
// only a JSON file to trust. Every caller in this app uses the defaults.
async function keySchedule(mode, shared, info, suite = HPKE_SUITE, nk = Nk) {
  // mode auth carries no pre-shared key, so psk and psk_id are both empty and
  // both are still hashed: the RFC's schedule has no branch here, and skipping
  // the empty extract is the shortcut that produces a working, wrong context.
  const psk = new Uint8Array(0);
  const pskId = new Uint8Array(0);
  const pskIdHash = await labeledExtract(suite, new Uint8Array(0), 'psk_id_hash', pskId);
  const infoHash = await labeledExtract(suite, new Uint8Array(0), 'info_hash', info);
  const context = bytes(Uint8Array.of(mode), pskIdHash, infoHash);
  const secret = await labeledExtract(suite, shared, 'secret', psk);
  return {
    suite,
    context,
    secret,
    key: await labeledExpand(suite, secret, 'key', context, nk),
    baseNonce: await labeledExpand(suite, secret, 'base_nonce', context, Nn),
    exporterSecret: await labeledExpand(suite, secret, 'exp', context, Nh),
  };
}

// the suite identifier for any HPKE triple, so a vector from another suite can
// be driven through the same code rather than through a copy of it
const suiteIdFor = (kem, kdf, aead) =>
  bytes(te.encode('HPKE'), i2osp(kem, 2), i2osp(kdf, 2), i2osp(aead, 2));

// The nonce is derived, never transmitted. A twelve-byte IV on the wire is the
// mistake this comment exists to keep out: it would let a sender reuse one
// under a key without the recipient being able to tell, which for GCM is
// catastrophic rather than untidy.
const nonceAt = (baseNonce, seq) => {
  const seqBytes = i2osp(seq, Nn);
  const out = new Uint8Array(Nn);
  for (let i = 0; i < Nn; i++) out[i] = baseNonce[i] ^ seqBytes[i];
  return out;
};

async function aeadKey(raw, use) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, [use]);
}

// A context, as the RFC has it: the key schedule plus a sequence number that
// only ever goes up. A letter here uses exactly one, but the context is the
// unit the vectors test and the unit anything later (a thread, a stream) would
// want, so it is the shape.
function contextOf(ks) {
  let seq = 0;
  return {
    ...ks,
    async seal(aad, pt) {
      const k = await aeadKey(ks.key, 'encrypt');
      const ct = new Uint8Array(await subtle().encrypt(
        { name: 'AES-GCM', iv: nonceAt(ks.baseNonce, seq), additionalData: aad }, k, pt));
      seq += 1;
      return ct;
    },
    async open(aad, ct) {
      const k = await aeadKey(ks.key, 'decrypt');
      const pt = new Uint8Array(await subtle().decrypt(
        { name: 'AES-GCM', iv: nonceAt(ks.baseNonce, seq), additionalData: aad }, k, ct));
      seq += 1;
      return pt;
    },
    at(n) { seq = n; return this; },
    export(context, L) {
      return labeledExpand(ks.suite, ks.exporterSecret, 'sec', context, L);
    },
  };
}

export async function setupAuthS(pkR, skS, pkS, info, ephemeral) {
  const { shared, enc } = await authEncap(pkR, skS, pkS, ephemeral);
  return { enc, ctx: contextOf(await keySchedule(MODE_AUTH, shared, info)) };
}

export async function setupAuthR(enc, skR, pkR, pkS, info) {
  const shared = await authDecap(enc, skR, pkR, pkS);
  return contextOf(await keySchedule(MODE_AUTH, shared, info));
}

export async function setupBaseS(pkR, info, ephemeral) {
  const { shared, enc } = await encap(pkR, ephemeral);
  return { enc, ctx: contextOf(await keySchedule(MODE_BASE, shared, info)) };
}

export async function setupBaseR(enc, skR, pkR, info) {
  return contextOf(await keySchedule(MODE_BASE, await decap(enc, skR, pkR), info));
}

// ---------- a letter ----------
//
// The envelope, and every byte of it is either authenticated or the thing doing
// the authenticating:
//
//   'rsntl'      5   what this is
//   ver          1   1
//   kind         1   atlas | folio | ask | thanks
//   msgId       16   random, and the only thing the arrival ledger keys on
//   sent         8   milliseconds, big-endian, the sender's clock
//   fromKid      8   sha-256 of the sender's public key, first eight bytes
//   toKid        8   the same of the recipient's
//   enc         65   the ephemeral public key
//   ct         ...   the sealed payload
//
// The first 47 bytes are the AAD, so kind, id, time and both key fingerprints
// are covered by the tag; `enc` is bound into the shared secret by the KEM's
// own context and needs no second binding. Nothing here is a secret and nothing
// here is a place name.
//
// The key fingerprints are not identifiers the club can use: they are derived
// from public keys that only the two correspondents hold, and the club never
// sees either one.

const MAGIC = te.encode('rsntl');
const HEAD = MAGIC.length + 1 + 1 + 16 + 8 + 8 + 8;   // 47
export const LETTER_VERSION = 1;
export const LETTER_INFO = te.encode('resonate letters v1');
export const KINDS = { atlas: 1, folio: 2, ask: 3, thanks: 4 };
const KIND_NAME = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v, k]));

export async function keyId(pk) {
  const raw = pk instanceof Uint8Array ? pk : await serializePublic(pk);
  return new Uint8Array(await subtle().digest('SHA-256', raw)).slice(0, 8);
}

function headerOf({ kind, msgId, sent, fromKid, toKid }) {
  return bytes(MAGIC, Uint8Array.of(LETTER_VERSION), Uint8Array.of(kind),
    msgId, i2osp(sent, 8), fromKid, toKid);
}

const hex = b => [...b].map(v => v.toString(16).padStart(2, '0')).join('');

// A message id, in the two forms one send needs: the bytes that go into the
// header and the text the club is asked to file it under. They are made
// together because they must be the same sixteen bytes. The club refuses a
// letter whose id it already holds, and the recipient checks the id it opens
// against the one it was filed under, so a sender who writes down a different
// id from the one they sealed has posted a letter that will be thrown away.
export function newMsgId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { bytes, text: hex(bytes) };
}

// Who a letter says it is from, without opening it: eight bytes of the sender's
// public key, read out of the cleartext header.
//
// This is a hint and never a decision. It says which key to try, so a box of
// letters costs one decapsulation each instead of one per correspondent per
// letter, and that is the whole of its job. Nothing is believed because of it:
// the same eight bytes are inside the authenticated header, so a letter whose
// fingerprint was edited to point at somebody else fails to open at all.
export function senderOf(wire) {
  const b = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
  if (b.length < HEAD) return '';
  return hex(b.slice(HEAD - 16, HEAD - 8));
}

// Seal one letter. `payload` is the object a link would have carried; what
// leaves is its utf-8 JSON, and nothing about its size or shape is hidden.
export async function sealLetter({ kind, payload, to, from, sent, msgId }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`a letter has no kind ${kind}`);
  const id = msgId || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const when = Number.isFinite(sent) ? sent : Date.now();
  const head = headerOf({
    kind: k, msgId: id, sent: when,
    fromKid: await keyId(from.publicKey), toKid: await keyId(to),
  });
  const { enc, ctx } = await setupAuthS(to, from.privateKey, from.publicKey, LETTER_INFO);
  const ct = await ctx.seal(head, te.encode(JSON.stringify(payload)));
  return bytes(head, enc, ct);
}

// Open one letter, or refuse it. Every refusal here is a sentence, because a
// letter that will not open is a thing a person has to be told about.
export async function openLetter(wire, { me, from }) {
  const b = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
  if (b.length < HEAD + 65 + 16) throw new Error('that is too short to be a letter');
  for (let i = 0; i < MAGIC.length; i++) {
    if (b[i] !== MAGIC[i]) throw new Error('that is not a letter this app wrote');
  }
  const ver = b[MAGIC.length];
  if (ver !== LETTER_VERSION) throw new Error(`this letter is version ${ver} and this app reads ${LETTER_VERSION}`);
  const kind = KIND_NAME[b[MAGIC.length + 1]];
  if (!kind) throw new Error('this letter names a kind this app has no reader for');

  const head = b.slice(0, HEAD);
  const enc = b.slice(HEAD, HEAD + 65);
  const ct = b.slice(HEAD + 65);

  // The fingerprints are checked before anything is derived, so a letter
  // addressed to somebody else is refused as that rather than as a broken tag.
  const mine = await keyId(me.publicKey);
  const toKid = b.slice(HEAD - 8, HEAD);
  if (!toKid.every((v, i) => v === mine[i])) throw new Error('this letter was not addressed to you');
  const theirs = await keyId(from);
  const fromKid = b.slice(HEAD - 16, HEAD - 8);
  if (!fromKid.every((v, i) => v === theirs[i])) {
    throw new Error('this letter names a sender who is not the one it was opened against');
  }

  const ctx = await setupAuthR(enc, me.privateKey, me.publicKey, from, LETTER_INFO);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await ctx.open(head, ct)));
  } catch (e) {
    // AES-GCM refuses in one word, and the one word is the whole point: the
    // bytes were changed, or the sender is not who the header says.
    throw new Error(e?.name === 'OperationError'
      ? 'this letter does not open: it was changed on the way, or it is not from who it says'
      : 'this letter opened onto something that is not a payload');
  }

  // The authenticated kind and the payload's own kind must agree. Two places
  // said what this is, so a reader that trusted the inner one could be handed
  // an atlas inside a letter announced as a thanks.
  if (payload?.kind && payload.kind !== kind) {
    throw new Error('this letter says one thing outside and another inside');
  }

  let sent = 0;
  for (let i = 0; i < 8; i++) sent = sent * 256 + b[MAGIC.length + 2 + 16 + i];
  return {
    kind,
    payload,
    sent,
    msgId: [...b.slice(MAGIC.length + 2, MAGIC.length + 18)]
      .map(v => v.toString(16).padStart(2, '0')).join(''),
  };
}

// what a letterbox is allowed to hold, named here because the client checks the
// same numbers the box does, and a client that let a person compose past the
// limit would only find out after the send
export const LETTER_LIMITS = {
  bytes: 256 * 1024,    // one letter
  count: 50,            // letters in a box
  total: 4 * 1024 * 1024,
};

// The two exports below exist for the test vectors and for nothing else. They
// are the internals the RFC publishes intermediate values for, and a suite that
// could only check the final ciphertext would pass a construction that was
// wrong in the middle and right by accident at the end.
export const __rfc9180 = {
  i2osp, labeledExtract, labeledExpand, extractAndExpand, keySchedule, suiteIdFor,
  nonceAt, deserializePublic, serializePublic, contextOf,
  KEM_SUITE, HPKE_SUITE, MODE_BASE, MODE_AUTH, HEAD,
  authEncap, authDecap, encap, decap,
};
