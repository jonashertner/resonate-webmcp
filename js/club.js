// club.js — the travellers club, from the member's side.
//
// The rule that makes the club worth joining: the envelope is sealed HERE,
// on this device, before it travels. The phrase never leaves. The club keeps
// bytes it cannot read, and if the phrase is lost, the envelope is lost with
// it. That sentence is the price of the privacy, and it is said out loud.
//
// Sealing: Argon2id at 64 MiB, three passes, one lane, into AES-GCM-256 with
// a 12-byte nonce, over a 16-byte salt. PBKDF2-SHA256 at 600000 iterations is
// the fallback where a device cannot run Argon2id. The envelope is
//   rsnt2 | kdfId | params | kid8 | salt | iv | ciphertext
// and the older rsnt1 | salt | iv | ciphertext is read forever, written never.
// The exact bytes are specified in club/SPEC.md, published at /SPEC.md.

// where the club stands. empty until the door is deployed; a value in
// settings (clubUrl) overrides, which is also how the mock is reached.
//
// When it is filled in, index.html's connect-src has to name that exact
// origin, and it is the one thing that will not fail loudly: the page's policy
// listed https://*.workers.dev for a service that did not exist, which is a
// standing permission for every worker anyone has ever deployed, granted in
// advance of a need. It is gone. Put the one origin in, not the pattern.
export const CLUB_URL = 'https://club.resonate.select';

// What a membership costs, said in one place and shown only when it can be
// paid. A shut door that quotes a price is the app naming a sum nobody can
// hand over, so this stays empty until CLUB_URL is filled, and a test in
// test/docs.test.mjs fails in both directions if the two ever disagree.
//
// CHF 48 a year, Swiss francs only, tax-inclusive. One currency at launch is a
// decision and not an omission, and the reasoning is at the top of
// club/LAUNCH.md: a second currency is three immutable amounts priced off an
// exchange rate that will have moved before anybody abroad joins, and a card
// issued anywhere converts this one today. Inclusive because the seller is not
// registered yet: on the day registration comes, an inclusive price leaves the
// sticker where it is instead of raising it for every member already here.
export const PRICE = 'CHF 48';

// Whether the club is taking money yet.
//
// True means the payment side is pointed at Stripe's sandbox: a card typed into
// the door is a test card, nothing is charged, and a membership can be wiped
// without notice. That is not a detail to leave in a deployment note. It changes
// what the terms say, what the privacy notice promises, and what a person is
// agreeing to when they hand an atlas to a server, so it is a value in the
// source with a sentence attached to it and a test that fails in both
// directions: while this is true the documents must carry the words `no money
// changes hands` and the club room must say so out loud, and the day it goes
// false every one of those has to be gone.
//
// Flipping this to false is therefore not a tidy-up. It is the commit in which
// the club starts being a shop, and the suite will not let it be quiet.
export const TESTING = true;

const MAGIC1 = new TextEncoder().encode('rsnt1');
const MAGIC2 = new TextEncoder().encode('rsnt2');
const ROUNDS_V1 = 310_000;   // what rsnt1 envelopes were sealed with
const ROUNDS_WRITE = 600_000; // what a pbkdf2 fallback writes today

// argon2id, when the vendored library stands. the browser loads it as a
// script; node tests import it and set the global themselves.
const argon2 = () => globalThis.hashwasm?.argon2id ?? null;

// write-side kdf parameters. argon2id follows owasp's first recommendation:
// 64 MiB, three passes, one lane. the bounds in unseal are the read-side law.
const ARGON2_M = 65_536, ARGON2_T = 3, ARGON2_P = 1;

const te = new TextEncoder();

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function kid8Of(bind) {
  if (!bind) return new Uint8Array(8);
  return (await sha256(te.encode('tc:' + bind))).slice(0, 8);
}

async function pbkdf2Key(phrase, salt, iterations) {
  const raw = await crypto.subtle.importKey(
    'raw', te.encode(String(phrase).normalize('NFC')),
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function argon2Key(phrase, salt, m, t, pl) {
  const bits = await argon2()({
    password: String(phrase).normalize('NFC'), salt,
    memorySize: m, iterations: t, parallelism: pl,
    hashLength: 32, outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// the envelope, second form:
//   rsnt2 | kdfId u8 | p0 u32le | p1 u8 | p2 u8 | kid8 | salt16 | iv12 | ct
//   kdfId 1 = pbkdf2-sha256, p0 iterations
//   kdfId 2 = argon2id, p0 memory KiB, p1 passes, p2 lanes
// the first twenty bytes and the membership key are bound into the seal as
// aad, so neither the kdf parameters nor the owner can be quietly swapped.
// the first form, rsnt1 | salt16 | iv12 | ct, is read forever, written never.

function u32le(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }

export async function seal(text, phrase, { bind = '' } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // argon2id when the library stands AND the device can run it: a wasm that
  // parses but cannot compile (lockdown modes, old policies, low memory)
  // falls back to pbkdf2 rather than failing the seal
  let key = null;
  let useArgon = !!argon2();
  if (useArgon) {
    try { key = await argon2Key(phrase, salt, ARGON2_M, ARGON2_T, ARGON2_P); }
    catch { useArgon = false; }
  }
  if (!key) key = await pbkdf2Key(phrase, salt, ROUNDS_WRITE);

  const header = new Uint8Array(20);
  header.set(MAGIC2, 0);
  header[5] = useArgon ? 2 : 1;
  header.set(u32le(useArgon ? ARGON2_M : ROUNDS_WRITE), 6);
  header[10] = useArgon ? ARGON2_T : 0;
  header[11] = useArgon ? ARGON2_P : 0;
  header.set(await kid8Of(bind), 12);
  const aad = new Uint8Array([...header, ...te.encode(bind)]);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, key, te.encode(text)));

  const out = new Uint8Array(20 + 16 + 12 + ct.length);
  out.set(header, 0); out.set(salt, 20); out.set(iv, 36); out.set(ct, 48);
  return out;
}

// returns the text, or throws:
//   'not-an-envelope' | 'sealed-for-another-key' | 'wrong-phrase'
export async function unseal(bytes, phrase, { bind = '' } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // the first form: pbkdf2 at its old count, nothing bound. 49 bytes is the
  // smallest honest rsnt1: magic, salt, iv, and one gcm tag over nothing.
  if (b.length >= 49 && MAGIC1.every((v, i) => b[i] === v)) {
    const salt = b.slice(5, 21), iv = b.slice(21, 33);
    const key = await pbkdf2Key(phrase, salt, ROUNDS_V1);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b.slice(33));
      return new TextDecoder().decode(pt);
    } catch { throw new Error('wrong-phrase'); }
  }

  if (b.length < 49 || !MAGIC2.every((v, i) => b[i] === v)) throw new Error('not-an-envelope');
  const kdfId = b[5];
  const p0 = new DataView(b.buffer, b.byteOffset + 6, 4).getUint32(0, true);
  const p1 = b[10], p2 = b[11];
  // read-side bounds: a hostile header may not spend this device's memory
  if (kdfId === 1) {
    if (p0 < 100_000 || p0 > 5_000_000) throw new Error('not-an-envelope');
  } else if (kdfId === 2) {
    if (p0 < 8_192 || p0 > 262_144 || p1 < 1 || p1 > 10 || p2 < 1 || p2 > 4) throw new Error('not-an-envelope');
    // the envelope is fine; this device cannot derive its key
    if (!argon2()) throw new Error('this-device-cannot-open-it');
  } else {
    throw new Error('not-an-envelope');
  }

  const kid = b.slice(12, 20);
  if (bind) {
    const mine = await kid8Of(bind);
    const zero = kid.every(x => x === 0);
    if (!zero && !kid.every((x, i) => x === mine[i])) throw new Error('sealed-for-another-key');
  }

  const header = b.slice(0, 20), salt = b.slice(20, 36), iv = b.slice(36, 48);
  let key;
  if (kdfId === 2) {
    try { key = await argon2Key(phrase, salt, p0, p1, p2); }
    catch { throw new Error('this-device-cannot-open-it'); }
  } else {
    key = await pbkdf2Key(phrase, salt, p0);
  }
  const aad = new Uint8Array([...header, ...te.encode(bind)]);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, b.slice(48));
    return new TextDecoder().decode(pt);
  } catch { throw new Error('wrong-phrase'); }
}

// ---- the sync's pure law, testable without a browser ----

// after a burn, the count starts over: apply this to settings
export function burnPatch() { return { clubSeq: 0, clubSealedAt: '' }; }

// an empty vault over a history of sealing is refused; anything else proceeds
export function syncGuard(gotExists, lastSeq) {
  return !gotExists && lastSeq > 0 ? 'refuse-empty' : 'proceed';
}

// ---- the join ----
//
// The door used to open for whoever held the checkout session id. That made
// the Stripe receipt a credential: a session id in a browser history, a
// screenshot or a support thread was a way into a stranger's backup, once.
//
// Now the binding is made before the payment rather than after it. This device
// mints a secret, keeps it, and sends only its hash: the commitment. The
// commitment is written into the checkout session's metadata by the club, where
// Stripe holds it. Coming back, the device shows the secret, the club hashes it
// and compares. A stranger with the session id has no secret and computes no
// commitment, and the door does not open twice for the same reason it does not
// open once.
//
// The commitment is what is stored at Stripe, visible to us in a dashboard, and
// it opens nothing. The secret is what opens the door, and it never leaves this
// device until it is presented.
//
// A device that cannot store is not stranded by this, because a device that
// cannot store cannot hold a membership key either: the club is not usable
// there at all, with or without a join.
const JOIN_STORE = 'resonate.club.join.v1';
const JOIN_KEEP = 4;                  // how many attempts are remembered
const JOIN_TTL_MS = 30 * 24 * 3600e3; // and for how long

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

function joinsHeld() {
  let raw = '';
  try { raw = globalThis.localStorage?.getItem(JOIN_STORE) || ''; } catch { return []; }
  let held = [];
  try { held = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(held)) return [];
  const now = Date.now();
  return held.filter(j => j && /^[0-9a-f]{32}$/.test(j.secret) && now - (Number(j.at) || 0) < JOIN_TTL_MS);
}

function keepJoins(held) {
  try { globalThis.localStorage?.setItem(JOIN_STORE, JSON.stringify(held.slice(0, JOIN_KEEP))); }
  catch { /* private mode: the attempt lives as long as this page does */ }
}

// a fresh secret for each attempt, so a second try is a second attempt and
// not a device writing over the one it is still waiting on
export function newJoin() {
  const secret = hex(crypto.getRandomValues(new Uint8Array(16)));
  keepJoins([{ secret, session: '', at: Date.now() }, ...joinsHeld()]);
  return secret;
}

// The address is kept beside the session, and it is the whole of what makes an
// interrupted join finishable. A Stripe checkout url stays good for a day, so a
// person who shut the tab at the card can be put back where they were instead
// of being asked to start again, which is the thing that charges them twice.
export function noteJoinSession(secret, session, url = '') {
  keepJoins(joinsHeld().map(j => (j.secret === secret ? { ...j, session, url } : j)));
}

// What this device began and never finished, newest first.
//
// `become a member` mints a fresh secret on every press, by design: a second
// try must not write over the one still in flight. But a fresh secret is a
// fresh commitment, a fresh idempotency key at /checkout, and therefore a
// genuinely new subscription. Pressed twice, paid twice, and nothing on the
// panel said so. Three of these were left on a device by three presses during
// one walk through the join flow.
//
// Only attempts that reached the payment desk count. An attempt with no session
// never got an address to be sent to, so no card was ever shown and nothing can
// have been charged for it.
export function unfinishedJoins() {
  return joinsHeld().filter(j => j.session);
}

// the attempt that began this session first, then the others: a device whose
// note of the session never landed still has its secret, and four tries is a
// bounded search
export function secretsFor(session) {
  const held = joinsHeld();
  return [...held.filter(j => j.session === session), ...held.filter(j => j.session !== session)]
    .map(j => j.secret);
}

export function forgetJoins() { keepJoins([]); }

export async function commitmentOf(secret) {
  return hex(await sha256(te.encode(`tc-join:${secret}`)));
}

// ---- speaking to the club ----

export function makeClient(base, keyGetter) {
  const call = async (path, opts = {}) => {
    const key = keyGetter();
    const headers = { ...(opts.headers || {}) };
    if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch(base.replace(/\/$/, '') + path, { ...opts, headers });
    return r;
  };

  // the revision this client last saw in the vault. '' is not ignorance but a
  // fact: an empty vault. a client that has read nothing yet is treated as
  // having seen emptiness, so its first seal can only create, never replace.
  let seen = '';

  const post = (path, body) => call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const said = async r => (await r.json().catch(() => ({})))?.error || 'the club did not answer';

  return {
    // What the desk says it is, before this device is asked for a card.
    //
    // Answers `null` rather than throwing when the club cannot be reached or
    // does not know the question, because both of those are the same fact from
    // here: we did not find out. What the room must never do is read a silence
    // as agreement, which is the whole reason this exists.
    async desk() {
      try {
        const r = await call('/desk', { method: 'GET' });
        if (!r.ok) return null;
        const got = await r.json();
        return got && typeof got.live === 'boolean' ? got : null;
      } catch { return null; }
    },
    // Begin: a secret is minted and kept here, its commitment goes with the
    // ask, and the session it comes back with is written down beside the
    // secret before this page navigates anywhere. A checkout that never
    // returns is still a checkout this device can prove it started.
    async checkout() {
      const secret = newJoin();
      const r = await post('/checkout', { claim: await commitmentOf(secret) });
      if (!r.ok) throw new Error(await said(r));
      const got = await r.json();
      noteJoinSession(secret, got.session || '', got.url || '');
      return got;
    },
    // Coming back: the session becomes a key, for the device that started it.
    // Every secret this device is still holding is offered, newest match
    // first, because the note of which session belongs to which secret is
    // written after the ask and a device can be closed in between.
    async door(session) {
      const secrets = secretsFor(session);
      if (!secrets.length) throw new Error('this device did not begin that membership');
      let last = 'the door did not answer';
      for (const secret of secrets) {
        const r = await post('/door', { session, secret });
        if (r.ok) return r.json();
        last = await said(r);
        // only a mismatched secret is worth trying another secret for
        if (r.status !== 403) break;
      }
      throw new Error(last);
    },
    // the way out, which is Stripe's to give
    async portal() {
      const r = await post('/portal', {});
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },
    async membership() {
      const r = await call('/membership');
      if (r.status === 401) return { standing: 'none' };
      if (!r.ok) throw new Error('the club did not answer');
      return r.json();
    },
    // seals over the envelope this client last read, and nothing else. pass a
    // revision to say so explicitly. throws 'stale' when the vault has moved
    // on: the caller reads again, merges, and seals over what it has now seen.
    // it does not retry here, because retrying without merging is the clobber
    // this exists to prevent.
    async putVault(bytes, rev) {
      const expect = rev === undefined ? seen : rev;
      const headers = expect ? { 'if-match': expect } : { 'if-none-match': '*' };
      const r = await call('/vault', { method: 'PUT', body: bytes, headers });
      if (r.status === 402) throw new Error('lapsed');
      if (r.status === 413) throw new Error('too-large');
      if (r.status === 412 || r.status === 428) throw new Error('stale');
      if (!r.ok) throw new Error('the club did not answer');
      const meta = await r.json();
      // the etag is the revision; the body carries it too, so a client whose
      // browser was not shown the header still knows what it just wrote
      seen = r.headers.get('etag') || (meta.rev ? `"${meta.rev}"` : '');
      return { ...meta, rev: seen };
    },
    // returns { bytes, at, rev } or null when the vault is empty
    async getVault(prev = false) {
      const r = await call(prev ? '/vault?prev=1' : '/vault');
      if (r.status === 404) {
        if (!prev) seen = '';
        return null;
      }
      if (!r.ok) throw new Error('the club did not answer');
      const rev = r.headers.get('etag') || '';
      if (!prev) seen = rev; // the slot before is read, never written
      return { bytes: new Uint8Array(await r.arrayBuffer()), at: r.headers.get('x-sealed-at') || '', rev };
    },
    async delVault() {
      const r = await call('/vault', { method: 'DELETE' });
      if (!r.ok) throw new Error('the club did not answer');
      const got = await r.json().catch(() => null);
      if (got?.gone === true) {
        seen = ''; // an emptied vault is created into, not replaced
        return { gone: true, pending: false };
      }
      // The durable pointer is already tombstoned, but the ciphertext store
      // may still be retrying physical deletion. Keep the revision we saw: a
      // pending response is not permission to create a new backup over a burn
      // whose bytes have not yet been collected.
      if (got?.gone === false && got?.pending === true) {
        return { gone: false, pending: true };
      }
      throw new Error('the club did not answer');
    },
    // ---------- the letterbox ----------
    //
    // The vault above is one member alone: they seal it, they open it, nobody
    // else has an address for it. The box is the other thing entirely, and
    // every method here is written so that the difference is visible at the
    // call site.
    //
    // Two facts shape all of it. The route is not this device's to choose: the
    // club derives it from the membership key and hands it back, so a box is
    // reached by an address its owner was given rather than by a name anybody
    // could guess. And a capability is a bearer secret: whoever holds it may
    // post, so it travels in a header and never in a path or a query, where
    // every proxy log and browser history between here and there would keep it.

    // What is waiting, who may post, and this member's own address. The route
    // in the answer is what goes into an introduction; the letters are ids,
    // sizes and arrival times, never bodies, so a box can be surveyed without
    // pulling four megabytes through a phone.
    async box() {
      const r = await call('/letters');
      if (r.status === 401) throw new Error('the club does not know this key');
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // A fresh posting capability, for one correspondent and nobody else.
    //
    // One each is the whole design. A box with a single secret is a box that
    // cannot be half-closed: withdrawing from one person would withdraw from
    // everybody, so nobody would ever withdraw. The club mints it rather than
    // the device, because a device with a poor random source would otherwise
    // hand out a guessable address to its friends.
    async mintCap() {
      const r = await post('/letters/cap', {});
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // That correspondent may no longer post. Their letters already in the box
    // stay: what has arrived is the recipient's, and revoking an address has
    // never been a way to unsend.
    async dropCap(id) {
      const r = await call(`/letters/cap/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // DELETE is retried after an interrupted local cleanup. If the first
      // request reached the club, “already absent” is the successful state the
      // retry was asking for, not a reason to strand the tombstone forever.
      if (r.status === 404) return { revoked: true, already: true };
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // One letter into somebody else's box. The capability says which box and
    // that this poster was invited; the message id is the letter's own, quoted
    // from its cleartext header so the box can refuse the same letter twice
    // and the recipient can check that the two agree.
    async postLetter(cap, msgId, bytes) {
      const r = await call(`/letters/post?id=${encodeURIComponent(msgId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-cap': cap },
        body: bytes,
      });
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // returns { bytes, at } or null when that letter is not there. A letter
    // that has been read and dropped is gone rather than absent-for-now, and
    // a caller asking again is not an error worth a sentence.
    async letter(msgId) {
      const r = await call(`/letters/${encodeURIComponent(msgId)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(await said(r));
      return { bytes: new Uint8Array(await r.arrayBuffer()), at: r.headers.get('x-arrived-at') || '' };
    },

    // Deleted only after it is safely written down here. The order is the
    // whole of the guarantee: a letter dropped before it is persisted is a
    // letter that existed for nobody.
    async dropLetter(msgId) {
      const r = await call(`/letters/${encodeURIComponent(msgId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // the box, emptied, capabilities included: every correspondent has to be
    // introduced again, which is the point of it rather than a side effect
    async burnBox() {
      const r = await call('/letters', { method: 'DELETE' });
      if (!r.ok) throw new Error(await said(r));
      return r.json();
    },

    // what this client last saw, for a caller that keeps its own bookkeeping
    revSeen() { return seen; },
  };
}
