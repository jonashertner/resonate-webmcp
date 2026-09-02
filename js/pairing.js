// pairing.js — what two members have to agree on before a letter can travel.
//
// A letter is sealed to a public key and posted to a route. Neither of those
// is a name, and neither of them arrives on its own: somebody has to hand them
// over. That handing over is an introduction, and this file is the arithmetic
// of it. It reads no store, names no endpoint and speaks to nobody; it takes
// what two people have exchanged and says what it means together.
//
// The one decision that shapes everything here: an introduction travels as a
// link, in both directions, and the box never carries a stranger.
//
// The tempting design was the other one. Ada hands Bruno an introduction and
// Bruno replies by posting a letter to Ada's box. It cannot work. Opening a
// letter is mode `auth`: decapsulation needs the sender's static public key,
// and on a first contact Ada does not have Bruno's. The only way to accept
// that letter would be mode `base`, which is an unauthenticated letter in the
// box from anyone at all, claiming to be someone. So the rule is short enough
// to hold in one sentence, and js/letters.js already enforces half of it: a
// letter whose sender is not already a correspondent is never opened.
//
// That is also the ritual the voices surface has taught since it was written.
// Hand your atlas to one person. When theirs comes back, open it here.

import { normLetters } from './schema.js?v=rf157';

const te = new TextEncoder();
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

// the same alphabet the membership key and the route are written in: no vowels
// that spell things, no characters that read two ways
function b32(bytes) {
  let out = '';
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

// The number in the material every mark is hashed from, so moving it makes
// every mark in the world a different string. It moved to 2 when the mark went
// from forty bits to ninety-six, and the reasoning is over markOf below.
export const PAIRING_VERSION = 2;

// ---------- the address, and the secret that is not part of it ----------

// A posting capability is a route and a secret, written with one dot between
// them, and the club splits it with exactly this rule at club/src/validate.js.
// Two implementations of one rule drift, so a test holds them against the same
// corpus; this one exists because the browser must not import the worker.
//
// It returns the route alone. Nothing in this file ever wants the secret: a
// capability is a bearer token, and the less of it travels between functions
// the fewer places it can be written down by accident.
//
// Twenty-six characters, which is what the club's mintKey writes for sixteen
// bytes, and the same shape isRoute checks before the club delivers anything.
const ROUTE = /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/;
export function routeOf(cap) {
  const s = String(cap || '');
  const dot = s.indexOf('.');
  if (dot < 0) return '';
  const route = s.slice(0, dot);
  const secret = s.slice(dot + 1);
  return ROUTE.test(route) && ROUTE.test(secret) ? route : '';
}

// ---------- the mark ----------
//
// Two people who have exchanged introductions have four things between them:
// two public keys and two routes. The mark is a short reading of all four,
// computed the same way on both sides and said out loud, once.
//
// It is symmetric, so neither side has to know whether they were the one who
// went first: the two keys are sorted, and so are the two routes. Both sides
// therefore produce the same string from the same four values, and a mark that
// differs is not a mismatch of etiquette but of facts.
//
// It binds the ROUTES and not the posting secrets. Address substitution is the
// attack a mark exists to catch: somebody who can change which box you post to
// can cut two people off without either of them noticing. A posting secret is
// a different thing. It is revocable on purpose, and re-minting one is an
// ordinary act that must not send two people back to reading eight characters
// at each other.
//
// Twenty characters in five groups of four, which is ninety-six bits.
//
// It was forty, and forty was priced wrong. This comment used to say that a
// collision cost an attacker who also had to hold a live position between two
// people, and what it was pricing was the cost of hitting one mark. Nobody
// would run that search. Somebody standing between Ada and Bruno substitutes a
// key of their own in each direction and needs only the two marks to agree
// with each other:
//
//   markOf(ada, the key they showed Ada) === markOf(bruno, the key they showed Bruno)
//
// Both halves are theirs to choose, and they choose last. All four of the
// fixed values are on the table before either substitution, and there is no
// commitment anywhere in this ceremony that could make them go first and learn
// afterwards. So it is a birthday search between two sets they control:
// 2^(n/2) keypairs a side, not 2^n. Forty bits meant about a million each way,
// which is under a minute of one core.
//
// Ninety-six bits puts that same search at 2^48 a side and ends it. What it
// costs is twelve more characters said out loud, and the membership key this
// same person already reads back to themselves is twenty-six.
export async function markOf(a, b) {
  const keys = [a?.pub, b?.pub].map(v => String(v || '')).sort();
  const routes = [a?.route, b?.route].map(v => String(v || '')).sort();
  if (!keys[0] || !routes[0]) return '';
  const material = te.encode(
    `resonate pairing v${PAIRING_VERSION}\n${keys[0]}\n${keys[1]}\n${routes[0]}\n${routes[1]}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', material));
  const said = b32(digest.slice(0, 12));
  return said.match(/.{4}/g).join(' ');
}

// ---------- the states ----------
//
// A pairing is not a boolean, and pretending otherwise is how a person comes to
// believe that a name in a list is a person. These are the only five, and each
// one is a different sentence on the surface.
//
//   introduced   you handed yours over. nothing has come back.
//   returned     theirs came back. the mark exists and nobody has read it.
//   verified     you and they read the same mark aloud and it matched.
//   withdrawn    you took your introduction back. they can post nothing.
//   repair       something moved underneath: a key or a route changed, and the
//                old mark no longer describes what you hold. That is the shape
//                an impersonation makes, so it is never quiet.
export const PAIRING = Object.freeze({
  introduced: 'introduced',
  returned: 'returned',
  verified: 'verified',
  withdrawn: 'withdrawn',
  repair: 'repair',
});

const STATES = new Set(Object.values(PAIRING));
export const isState = s => STATES.has(s);

// Only `verified` sends, and only verified under this arithmetic. That is the
// whole of the policy, written once, here, so that no surface can decide
// otherwise by forgetting to ask.
//
// A matching name never authorises exchange. An introduction is reusable and is
// not a secret between two people: whoever holds the link holds it, and two
// people who have not read the mark to each other have established nothing
// except that a link arrived.
//
// The version is asked here as well as swept for on the way in, and the
// repetition is deliberate. The sweep writes, and a browser that refuses a
// write leaves a pairing sitting in memory still saying `verified` over a mark
// nobody read. This is the gate that does not depend on a disk.
export function maySend(p) {
  return !!p && p.state === PAIRING.verified && p.v === PAIRING_VERSION && !!p.cap && !!p.pub;
}

// What a pairing becomes when the arithmetic behind the mark has moved, which
// is the other half of ever being able to move it.
//
// A mark is not a fact about two people. It is a reading, and a reading is only
// worth what it was worth on the day: eight characters read aloud in a build
// where eight characters were forty bits stays worth forty bits forever, and
// widening the hash underneath somebody does not retroactively make their
// telephone call longer. So a pairing verified under an older version goes back
// to `returned`, which is exactly what it is: both halves are held, the mark
// exists, and nobody has read this one.
//
// `returned` and not `repair`, and the distinction is the whole of the manners
// here. `repair` is the sentence about a key or an address that moved
// underneath, which is the shape an impersonation makes. Nothing moved. This
// app changed its own hash, and spending its loudest word on its own
// maintenance would teach the one person who ever hears it to discount it.
export function onVersion(p) {
  if (!p) return '';
  if (p.state !== PAIRING.verified) return p.state;
  return p.v === PAIRING_VERSION ? p.state : PAIRING.returned;
}

// Whether what is in hand still describes what was verified. A key or a route
// that has moved since the mark was read means the mark was read about
// something else.
//
// The secret is deliberately not compared. A correspondent who re-mints their
// posting capability has changed the secret and not the address, and sending
// two people back to the telephone for that would teach them that the ceremony
// is noise. What must never move quietly is the key and the route, and those
// are what this reads.
export function stillDescribes(p, seen) {
  if (!p || !seen) return false;
  return p.pub === seen.pub && routeOf(p.cap) === routeOf(seen.cap);
}

// What a pairing becomes when an introduction arrives for somebody already in
// the list. Everything here is one decision: an arrival never silently upgrades
// trust, and never silently keeps it either.
//
//   nothing held yet          -> returned, because both halves now exist
//   the same key and route    -> unchanged; a re-sent introduction is not news
//   anything else moved       -> repair, loudly, whatever it was before
export function onIntroduction(p, seen) {
  if (!p) return PAIRING.returned;
  if (stillDescribes(p, seen)) return p.state === PAIRING.introduced ? PAIRING.returned : p.state;
  if (p.state === PAIRING.introduced && !p.pub) return PAIRING.returned;
  return PAIRING.repair;
}

// ---------- what a backup holds about writing to people ----------
//
// Pure, and here rather than beside the surface that calls it, because the
// rule is not about a panel: it is about which of two people somebody is.
//
// The rule is the club panel's own sentence and not a new one. A backup brings
// home what it has and this device lacks, and never changes what this device
// already has. Applied to an identity and a list of pairings that is three
// cases and one refusal.
//
//   this device has no identity   take the whole slice. this is the restore,
//                                 and it is why the key travels sealed at all:
//                                 identity is the membership, so a second
//                                 device has to be able to become the same
//                                 person rather than a new one.
//   the same identity             add the pairings this device does not hold,
//                                 and touch none that it does. a state here is
//                                 the record of a mark somebody read aloud on
//                                 THIS device, and an older backup does not get
//                                 to overwrite that with an older reading.
//   a different identity          nothing at all. two keys under one membership
//                                 means one of them is not the person their
//                                 friends verified, and there is nothing here
//                                 that could say which. Choosing silently would
//                                 be choosing who somebody is.
//
// What arrives is read through the archive gate first, whatever it claims to
// be. It has been through a network and a decryption and may be from a build
// that is not this one, and a key of the wrong curve refused here gives a
// person this app's sentence rather than the browser's.
export function mergeLetters(mine, theirs) {
  const held = normLetters(mine) || { v: 1, jwk: null, pub: '', route: '', pairs: [] };
  // Wrapper versions before the letters slice omit the property altogether.
  // That is the only absent shape. A present value that this build cannot read
  // is remote state we must preserve, not an empty slice we may overwrite.
  if (theirs === undefined) {
    return { identity: 'none', added: 0, letters: held, theirs: null };
  }
  const read = normLetters(theirs);
  if (!read) return { identity: 'invalid', added: 0, letters: held, theirs: null };
  // A clash hands back what the backup holds as well as what this device does,
  // and the caller needs both. `letters` is what stays on the device: nothing
  // changed. `theirs` is what has to be sealed back, unchanged, because the
  // very next thing the caller does is write a new envelope, and an envelope
  // written from this device's slice would settle the question this branch
  // exists to refuse to settle — quietly, in favour of whichever device the
  // person happened to press the button on.
  if (held.jwk && read.jwk && held.pub !== read.pub) {
    return { identity: 'clash', added: 0, letters: held, theirs: read };
  }
  const taking = !held.jwk && !!read.jwk;
  const byId = new Set(held.pairs.map(p => p.id));
  // by id and by key both: the same person restored twice under two ids is two
  // rows on a surface and one person who cannot tell which of them is them
  const byPub = new Set(held.pairs.map(p => p.pub).filter(Boolean));
  const fresh = read.pairs.filter(p => !byId.has(p.id) && !(p.pub && byPub.has(p.pub)));
  if (!taking && !fresh.length) {
    return { identity: held.jwk ? 'kept' : 'none', added: 0, letters: held, theirs: null };
  }
  return {
    identity: taking ? 'taken' : 'kept',
    added: fresh.length,
    theirs: null,
    letters: {
      ...held,
      jwk: taking ? read.jwk : held.jwk,
      pub: taking ? read.pub : held.pub,
      route: held.route || read.route,
      pairs: [...held.pairs, ...fresh],
    },
  };
}
