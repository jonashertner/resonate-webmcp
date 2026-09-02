// validate.js — what the club will accept, and nothing else.
//
// The same discipline as the letterbox: a request is bounded and typed here,
// or it does not exist. Standalone, so the worker carries no dependency and
// the rules can be tested with plain node.

export const LIMITS = {
  // a sealed atlas is records, kilobytes to a few megabytes. KV holds 25MB;
  // we stop well before, and say so plainly. The number does not move with
  // the pictures: it is a ceiling against a runaway upload, not a description
  // of an atlas, and lowering it would refuse a last backup to exactly the
  // device that still has photographs in it.
  vaultBytes: 16_000_000,
  keyLength: 30, // tc_ + 26 crockford chars
  sessionId: 200,
};

// What a membership is, in the only terms the door accepts.
//
// One price, one currency, one interval, one of them. This is not decoration:
// a checkout session can be paid and still be the wrong thing, and a door that
// asks only "did money arrive" opens on any subscription in the account,
// including one at another price, in another currency, for a quantity of nine.
// Every field here is checked against the session before a key is minted.
export const TERMS = Object.freeze({
  currency: 'chf',
  interval: 'year',
  intervalCount: 1,
  quantity: 1,
});

// membership keys are minted here and only here: tc_ then crockford base32,
// no vowels that spell things, no characters that read two ways
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function mintKey(bytes) {
  // bytes: Uint8Array(16) of honest randomness, supplied by the caller
  let out = 'tc_';
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function isKey(v) {
  return typeof v === 'string'
    && v.length <= LIMITS.keyLength
    && /^tc_[0-9abcdefghjkmnpqrstvwxyz]{20,27}$/.test(v);
}

export function isSessionId(v) {
  return typeof v === 'string'
    && v.length <= LIMITS.sessionId
    && /^cs_[A-Za-z0-9_]+$/.test(v);
}

// The two halves of the join.
//
// A device mints a secret before it goes to pay, keeps it, and sends only the
// commitment: the sha-256 of the secret under one label. The commitment is
// written into the checkout session's metadata, where Stripe holds it. To be
// handed the key the device must show the secret, and the club hashes it and
// compares. So the thing stored at Stripe, visible to us in a dashboard, is
// not the thing that opens the door, and the thing that opens the door never
// leaves the device that paid until it is presented.
export function isSecret(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

export function isCommitment(v) {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

const te = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

// the same two lines live in js/club.js, on the other side of the wire. they
// are three lines each and the label is pinned by a test in both files,
// because importing across the deploy boundary would publish the worker.
export async function commitmentOf(secret) {
  return hex(await crypto.subtle.digest('SHA-256', te.encode(`tc-join:${secret}`)));
}

// The mint secret's fingerprint: the one value that makes a mistyped secret
// visible before it is too late.
//
// It lives here rather than beside its only caller because the launch has to
// compare what the worker stored against the secret a person wrote down, and
// that comparison is made by a tool outside the worker. Two copies of this
// label, or of this truncation, would be free to drift apart in precisely the
// situation that has no undo.
export async function fingerprintOf(secret) {
  return (await commitmentOf(`mint-fingerprint:${secret}`)).slice(0, 32);
}

// A membership key that two concurrent mints agree on.
//
// KV cannot compare and swap, so two doors opening at once for one payment
// used to be able to mint two keys, file two memberships, and leave the
// renewals pointing at one of them. Deriving the key from the subscription id
// under a worker secret removes the race instead of narrowing it: whoever
// mints, and however often, the answer is the same. It is also the recovery
// procedure, in one line, for the day a member's device loses its secret.
export async function mintKeyFor(subId, secret) {
  const k = await crypto.subtle.importKey(
    'raw', te.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(`tc-key:${subId}`)));
  return mintKey(mac.slice(0, 16));
}

// ---- the letterbox address ----
//
// A correspondent posts a letter without holding the recipient's membership
// key, so the address has to be in the capability they were handed. It cannot
// be the membership key itself: that key opens the vault, and an introduction
// is not a licence to read somebody's atlas.
//
// So the box is at a route, derived from the key under the same worker secret
// the key itself was derived under. The club can go key to route the instant a
// member authenticates, and cannot go route to key at all without trying every
// membership it has. A post therefore names a box and never a person, which is
// exactly as much as the club needs to deliver it.
//
// The route is the same length and alphabet as a membership key without its
// prefix, so nothing that reads one can be handed the other by accident.
export async function routeFor(key, secret) {
  const k = await crypto.subtle.importKey(
    'raw', te.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(`letterbox:${key}`)));
  return mintKey(mac.slice(0, 16)).slice(3);
}

export function isRoute(v) {
  return typeof v === 'string' && /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/.test(v);
}

// A capability is the route and a secret, joined by a dot: the route so the
// club knows which box, the secret so the box knows this poster was invited.
// Splitting on the first dot rather than on any dot, because only the shapes
// below are ever accepted and neither of them contains one.
export function splitCap(v) {
  const s = String(v || '');
  const dot = s.indexOf('.');
  if (dot < 0) return null;
  const route = s.slice(0, dot);
  const secret = s.slice(dot + 1);
  if (!isRoute(route) || !isRoute(secret)) return null;
  return { route, secret };
}

// The message id from a letter's own cleartext header, quoted by the sender so
// the box can refuse the same letter twice. Sixteen bytes, written in hex by
// js/letters.js, and the recipient checks it against the header it opens.
export function isMsgId(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

export function isCapId(v) {
  return typeof v === 'string' && /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(v);
}

// live keys open live doors. a test-mode session presented to a live club, or
// the reverse, is refused before anything is minted.
export function isLive(secret) {
  return /^(sk|rk)_live_/.test(String(secret || ''));
}

// the period end moved onto the items in the basil api version; both addresses
// answer, and a subscription with neither has none
export function periodEndOf(sub) {
  return Number(sub?.current_period_end)
    || (sub?.items?.data ?? []).map(i => Number(i.current_period_end) || 0).reduce((a, b) => Math.max(a, b), 0);
}

// Whether this checkout session opens the door, and if not, in one word why.
//
// The word is for a log line and never for the member: a refusal that
// enumerates what it checked is a description of how to shape a session that
// passes. The member gets one sentence.
export function admits(s, { prices, live, shown } = {}) {
  const allowed = (Array.isArray(prices) ? prices : [prices]).filter(Boolean);
  if (!s || typeof s !== 'object') return 'no-session';
  if (s.livemode !== live) return 'livemode';
  if (s.mode !== 'subscription') return 'mode';
  if (s.status !== 'complete') return 'incomplete';
  if (s.payment_status !== 'paid') return 'unpaid';

  const said = s.metadata?.claim;
  if (!isCommitment(said)) return 'no-claim';
  // `shown` is the commitment derived from the secret the device just
  // presented. a session read by the webhook, where no device is speaking, is
  // checked for shape alone and bound to nobody until a device shows a secret.
  if (shown !== undefined && !sameString(said, shown)) return 'claim';

  const sub = s.subscription && typeof s.subscription === 'object' ? s.subscription : null;
  if (!sub?.id) return 'no-subscription';
  if (sub.status !== 'active' && sub.status !== 'trialing') return 'status';

  const items = sub.items?.data ?? [];
  if (items.length !== 1) return 'items';
  const it = items[0];
  // More than one price id may be admitted, and only one is ever sold at.
  //
  // A Stripe Price is immutable in amount and, once set, in tax treatment, so
  // changing what a membership costs means creating a new Price. If the door
  // only ever admitted the current one, a member who paid last year, lost their
  // key, and still holds their join secret would present a session at the old
  // price and be refused: locked out of their own vault by a price change they
  // had nothing to do with. The old ids stay admissible here; the one new
  // checkouts are created at is a separate setting.
  if (!allowed.length || !allowed.includes(it.price?.id)) return 'price';
  if (Number(it.quantity ?? 1) !== TERMS.quantity) return 'quantity';
  if (String(it.price?.currency || '').toLowerCase() !== TERMS.currency) return 'currency';
  const r = it.price?.recurring;
  if (r?.interval !== TERMS.interval) return 'interval';
  if (Number(r?.interval_count ?? 1) !== TERMS.intervalCount) return 'interval';
  if (!periodEndOf(sub)) return 'period';
  return '';
}

// What a subscription's own status says about a membership.
//
// `leaving` is written every time and not only when it is true: a cancellation
// scheduled and then reversed used to leave the flag standing, so the club went
// on telling a paying member they were on their way out.
export function patchFor(sub) {
  const patch = { leaving: sub?.cancel_at_period_end === true };
  const end = periodEndOf(sub);
  if (end) patch.until = end;
  const st = String(sub?.status || '');
  if (st === 'canceled' || st === 'incomplete_expired') patch.standing = 'left';
  else if (st === 'unpaid' || st === 'paused') patch.standing = 'held';
  else if (st === 'active' || st === 'trialing' || st === 'past_due') patch.standing = 'good';
  return patch;
}

// standing: a membership answers for its paid period plus three days of
// grace, so a card that stumbles does not eat a backup
export const GRACE_S = 3 * 24 * 3600;

export function standingOf(member, nowS) {
  if (!member) return 'none';
  if (member.standing === 'left') return 'left';
  // stripe says the subscription is not paying: unpaid, or paused. the paid
  // period may still have weeks in it, and those weeks are not owed.
  if (member.standing === 'held') return 'lapsed';
  const until = Number(member.until) || 0;
  return nowS <= until + GRACE_S ? 'good' : 'lapsed';
}

// constant-time equality, the same everywhere node and workers run
export function sameString(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
