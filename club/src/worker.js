// worker.js — the travellers club.
//
// The club keeps two things and knows almost nothing:
//
//   a membership: a key, and "paid until when"
//   a vault: one sealed envelope per member, and the one before it
//
// The envelope is sealed on the member's device before it ever travels. The
// club cannot open it. All it holds about a member: the key, the subscription
// id, the billing account at Stripe, a paid-until date, and when the envelope
// was last sealed. No names, no addresses, no request logs. If this worker
// disappears, every atlas keeps living in its browser; only the backup goes
// quiet.
//
//   POST /checkout     a commitment becomes a checkout session, made here,
//                      at one price, in one currency, adaptive pricing refused.
//   POST /door         that session, once paid, becomes a key, for the device
//                      that can show the secret behind the commitment.
//   POST /stripe       Stripe's webhook: memberships begin, renew, and lapse
//                      here first. the door only ever collects.
//   POST /portal       a billing portal session, for leaving.
//   GET  /membership   the key's standing: good | lapsed | left, and until when.
//   PUT  /vault        the sealed envelope, if-match the revision held.
//   GET  /vault        the envelope back, with its revision as an etag.
//                      ?prev=1 for the one before.
//   DELETE /vault      both envelopes hidden now; physical erasure is retried.
//
//   GET  /letters      what is waiting, and who may post here.
//   POST /letters/cap  a fresh posting capability, to put in an introduction.
//   DELETE /letters/cap/<id>   that correspondent may no longer post.
//   POST /letters/post?id=     one letter into somebody else's box, x-cap the
//                      capability they gave you. the sender is a member too.
//   GET  /letters/<id>         one letter back, as bytes.
//   DELETE /letters/<id>       that letter, gone.
//   DELETE /letters    the whole box, capabilities included.
//
// KV: read-compatible mirrors at member:<key>, sub:<subscriptionId>, and a
//   thirty-day fast-path cache at ev:<stripeEventId>.
// Durable Object SUBSCRIPTIONS: one per Stripe subscription, the authoritative
//   membership transition history and event dedupe ledger.
// Durable Object VAULT: one per membership, holding the revision and the two
//   object names. It has never seen an envelope.
// Durable Object LETTERBOX: one per membership, at a route derived from the
//   key, holding sealed letters. It has never seen a membership key, and
//   nothing maps a route back to a member.
// Durable Object METER: one per hashed caller, holding a count of attempts.
// R2 VAULTS: the ciphertext, under names that are random and never reused.
// Secrets: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, MINT_SECRET.
// Vars: STRIPE_PRICE, SITE.

import {
  LIMITS, isKey, isSessionId, isSecret, isCommitment, commitmentOf, mintKeyFor, fingerprintOf,
  isLive, admits, patchFor, periodEndOf, standingOf,
  mintKey, routeFor, splitCap, isMsgId, isCapId,
} from './validate.js';
import { fetchSession, createCheckout, createPortal, verifyWebhook, isOurFault } from './stripe.js';
import { Vault, newObjectName } from './vault.js';
import { Letterbox, BOX_LIMITS } from './letterbox.js';
import { Meter, RATES } from './meter.js';
import { Subscription } from './subscription.js';

export { Vault, Letterbox, Meter, Subscription };

export const REQUEST_LIMITS = Object.freeze({
  publicJson: 4 * 1024,
  stripeWebhook: 256 * 1024,
});

// Why a box refused a letter, in the words the person holding it needs. The
// box answers in one word so a log line can carry it without carrying who; the
// sentence is put on here, where nothing is written down.
const POST_REFUSALS = Object.freeze({
  nobox: 'there is no box at that address. ask for a fresh introduction',
  notaletter: 'that is too short to be a letter',
  closed: 'that box is closed. its membership has lapsed, and it takes nothing until it comes back',
  nocap: 'that introduction has been withdrawn. ask for a fresh one',
  again: 'that letter is already waiting there',
  full: 'that box is full. it holds fifty letters and they have to be read first',
  heavy: 'that box has no room left. four megabytes is all of it',
  big: 'that letter is too big to post. a quarter of a megabyte is the most one carries',
});

// The revision is minted inside the vault object, where the rotation happens.
// Here it is only ever worn as an etag.
const etagOf = rev => `"${rev}"`;

// The three sentences a stranger at the door can be told, and no fourth.
//
// A refusal that says which check failed is a description of how to shape a
// session that passes, so the reason goes to a log line and the person gets
// one of these. The first one exists because a club that cannot reach Stripe
// used to say the same thing as a club that had refused your card, which
// blamed the member for our own broken configuration.
// The refusals that mean "not yet" rather than "no". A webhook refused for one
// of these is left unfinished so Stripe sends it again, because marking it
// handled would strand a payment that really was made.
const LATER = new Set(['no-subscription', 'status', 'period']);

const DESK = 'the club cannot reach its payment desk. this is ours to fix, and it is not about your payment';
const SHUT = 'the door only opens on a paid subscription';
const ELSEWHERE = 'this membership was begun on another device, and only that device holds what opens it';

// Deliberate events, and nothing that names anyone.
//
// Invocation logs are off in wrangler.toml, which is where a membership key, a
// session id and a path parameter would otherwise be kept. What is written
// here is written on purpose: an outcome, a reason word, a status class. A
// paid backup with no signal at all is a black box, and when a member says
// "it stopped saving" there has to be something to look at.
const say = (event, detail = {}) => {
  try { console.log(JSON.stringify({ e: event, ...detail })); } catch { /* never load-bearing */ }
};

const siteOf = env => String(env.SITE || 'https://resonate.select').replace(/\/$/, '');

function cors(req, env) {
  const o = req.headers.get('origin') || '';
  const h = {
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    // the preconditions travel on if-match and if-none-match, and the
    // revision comes back on the etag: a browser sees neither unless it is
    // named here, and a vault whose etag is invisible cannot be written to
    // the preconditions travel on if-match and if-none-match, the posting
    // capability on x-cap, and the revision and the arrival time come back on
    // etag and x-arrived-at: a browser sees none of them unless they are named
    'access-control-allow-headers': 'authorization,content-type,if-match,if-none-match,x-cap',
    'access-control-expose-headers': 'x-sealed-at,x-arrived-at,etag',
    'access-control-max-age': '86400',
    // the answer differs by origin, and a cache that does not know that will
    // hand one origin's allowance to another
    vary: 'Origin',
  };
  if (o && o === siteOf(env)) h['access-control-allow-origin'] = o;
  return h;
}

const json = (obj, status, extra) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...extra },
});

// A body, read with a ceiling on it.
//
// content-length is a claim and the bytes are the fact, and the gap between
// them is a way in: a post that declares a kilobyte and sends a hundred
// megabytes would be buffered whole and refused afterwards, having already
// spent the worker's memory to be told no. This stops reading at the limit and
// answers null, so the refusal costs the sender's bandwidth rather than ours.
// The vault does not need this because its body goes straight to R2, which
// measures what actually landed; a letter is small enough to hold, so it is
// held here and bounded here.
async function bodyUnder(req, max) {
  const reader = req.body?.getReader?.();
  if (!reader) return new Uint8Array(0);
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch { /* it is going anyway */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

async function jsonUnder(req, max) {
  const bytes = await bodyUnder(req, max);
  if (bytes === null) return { tooLarge: true };
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { invalid: true }; }
}

// everything the payment desk needs before it can answer at all. a club
// missing any of them is misconfigured, and says so in its own words rather
// than passing for a refusal.
const ready = env => !!(env.STRIPE_SECRET && env.STRIPE_PRICE && env.MINT_SECRET);

// The price new checkouts are created at, and every price the door still
// admits. The second list exists because a Price cannot be edited: changing
// what a membership costs means a new id, and a member recovering a key from
// an old session must not be refused for it.
const pricesAdmitted = env => [
  env.STRIPE_PRICE,
  ...String(env.STRIPE_PRICE_ALSO || '').split(',').map(s => s.trim()),
].filter(Boolean);

// ---- the meter ----
//
// The caller's address is hashed before it is used, because a durable object's
// name is stored and listable and a list of addresses is a record this club
// says it does not keep. A deployment without the binding is not stopped: the
// limit is a guard on our costs, not a correctness property, and a worker that
// refused every request because a binding was missing would be worse.
async function allow(env, kind, req) {
  if (!env.METER) return true;
  const who = req.headers.get('cf-connecting-ip') || 'unknown';
  const name = (await commitmentOf(`${kind}:${who}`)).slice(0, 32);
  const { cap, per } = RATES[kind];
  try {
    const r = await env.METER.get(env.METER.idFromName(name))
      .fetch(`https://meter/take?cap=${cap}&per=${per}`);
    const got = await r.json();
    if (!got.ok) say('meter.full', { kind });
    return got.ok !== false;
  } catch {
    return true; // the meter is not the club, and its failure is not a refusal
  }
}

// ---- provisioning, done in one place ----
//
// Both the webhook and the door land here, and both may land more than once.
// The key is derived from the subscription id rather than drawn from a hat, so
// two arrivals at the same moment agree on it instead of minting two
// memberships for one payment. Everything else is a merge that never lowers a
// paid-until date.
// The mint secret is not a credential that can be rotated.
//
// Every membership key is derived from it, and a member's vault is addressed by
// that key. Setting a new one does not lock people out loudly: it silently
// re-keys every member at once, so their stored key stops resolving, and if
// they recover through the door they are handed a different key pointing at a
// different, empty vault. Their envelope is still in R2 and nothing addresses
// it any more. `wrangler secret put MINT_SECRET` is one command and there is no
// undo, so the first membership ever minted leaves a fingerprint behind, and a
// club whose secret has changed underneath it refuses to mint rather than
// quietly starting a second, parallel membership list.
async function mintAllowed(env) {
  const fp = await fingerprintOf(env.MINT_SECRET);
  const held = await env.BOX.get('mint:fp');
  if (!held) { await env.BOX.put('mint:fp', fp); return true; }
  if (held === fp) return true;
  say('mint.changed');
  return false;
}

const subscriptionAt = (env, id) => env.SUBSCRIPTIONS
  ?.get(env.SUBSCRIPTIONS.idFromName(String(id)));

async function subscriptionAsk(env, id, path, body) {
  const stub = subscriptionAt(env, id);
  if (!stub) throw new Error('subscription object binding unavailable');
  const response = await stub.fetch(`https://subscription${path}`, {
    method: 'POST', body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`subscription object answered ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.conflict ? 'subscription key conflict' : 'subscription transition failed');
  return result;
}

async function mirrorMembership(env, key, member, { stamp = true } = {}) {
  if (!key || !member) return;
  await env.BOX.put(`member:${key}`, JSON.stringify(member));
  if (member.sub) await env.BOX.put(`sub:${member.sub}`, key);
  if (stamp) await boxKnows(env, key, member.standing === 'good' ? member.until : 0);
}

async function openMembership(env, s, at, eventId = '') {
  const sub = s.subscription;
  const key = await mintKeyFor(sub.id, env.MINT_SECRET);
  const before = await env.BOX.get(`member:${key}`, 'json');
  const cus = (typeof s.customer === 'string' ? s.customer : s.customer?.id) || before?.cus || '';
  // Kept as one literal so the disclosure test reads the exact compatibility
  // record the worker mirrors, including the sequence the object arbitrates.
  const member = {
    sub: sub.id,
    cus,
    until: periodEndOf(sub),
    standing: 'good',
    leaving: sub.cancel_at_period_end === true,
    seq: Number(at) || 0,
  };
  const done = await subscriptionAsk(env, sub.id, '/transition', {
    key, seed: before, incoming: member,
    cursor: { at, priority: 250, tie: eventId || 'door' }, eventId,
  });
  const opened = done?.member || {
    ...(before || {}), ...member,
    until: Math.max(Number(before?.until) || 0, Number(member.until) || 0),
    seq: Math.max(Number(before?.seq) || 0, Number(at) || 0),
  };
  await mirrorMembership(env, key, opened);
  return { key, until: opened.until, again: !!before || done?.again === true };
}

// The box learns its member's paid-until from the same write that changes it.
//
// Without this, a membership that ends early leaves the box open until its
// owner next comes to look, and for the member who has walked away that is
// never: the box would keep taking mail for a membership Stripe has already
// ended, for the rest of a period nobody paid for. The route is derived rather
// than looked up, so this adds nothing at all to what the club stores, and the
// box refuses to be created by it, so a member who has never used letters still
// has no box.
//
// A failure here never fails the write that mattered. The membership record is
// the authority; this is a copy of one field of it, and a copy that did not
// arrive is corrected the moment its owner opens the box.
async function boxKnows(env, key, until) {
  if (!env.LETTERBOX || !env.MINT_SECRET) return;
  try {
    const route = await routeFor(key, env.MINT_SECRET);
    await env.LETTERBOX.get(env.LETTERBOX.idFromName(route)).fetch(
      'https://box/restamp', { method: 'POST', body: JSON.stringify({ until: Number(until) || 0 }) });
  } catch { say('letters.unstamped'); }
}

async function memberOf(req, env) {
  const auth = req.headers.get('authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!isKey(key)) return { key: null, member: null };
  let member = await env.BOX.get(`member:${key}`, 'json');
  if (!member) return { key, member: null };
  try {
    if (!member.sub) throw new Error('membership has no subscription authority');
    const held = await subscriptionAsk(env, member.sub, '/read', { key, seed: member });
    if (held?.member) {
      member = held.member;
      // Repair a lagging KV mirror on ordinary authenticated traffic.
      await mirrorMembership(env, key, member, { stamp: false });
    }
    return { key, member };
  } catch {
    say('subscription.unavailable');
    return { key, member: null, authorityError: true };
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const nowS = Math.floor(Date.now() / 1000);
    const site = siteOf(env);

    // ---- what this desk is, said out loud ----
    //
    // `TESTING` in js/club.js is a claim the app makes about this worker, and
    // until this route it was a claim nobody could check. The app tells a
    // person, in the moment before they type a card, `this is a test, no money
    // changes hands`. That sentence is true if and only if the secret set on
    // this worker by hand is a test key, and the two facts lived in two places
    // that never met: one of them in git, read by the suite and by the smoke
    // walk, the other in `wrangler secret put`, invisible to all three.
    //
    // The failure is silent and it runs one way only. `admits` refuses a test
    // session against a live desk, so a person who obeys the app and types a
    // test card is turned away and knows something is wrong. A person who types
    // a real card produces a live session, which passes every check, and is
    // charged for a year having just read that nothing is charged. The check
    // that exists protects the configuration and not the customer.
    //
    // None of this is a secret. Stripe stamps `livemode` on every object it
    // returns, and wrangler.toml already says of the price id that it is not a
    // secret and belongs in the open. What is published here is what the app
    // says on its own face; the one thing it adds is that the face can now be
    // checked, by the room before it offers a door and by the smoke walk before
    // a release is believed.
    if (url.pathname === '/desk' && req.method === 'GET') {
      return json({
        live: isLive(env.STRIPE_SECRET),
        price: env.STRIPE_PRICE || null,
        ready: ready(env),
      }, 200, { ...h, 'cache-control': 'no-store' });
    }

    // ---- the payment desk: a commitment becomes a session to pay for ----
    if (url.pathname === '/checkout' && req.method === 'POST') {
      if (!ready(env)) { say('checkout.unconfigured'); return json({ error: DESK }, 503, h); }
      if (!(await allow(env, 'checkout', req))) {
        return json({ error: 'too many of these, too quickly. try again shortly' }, 429, { ...h, 'retry-after': '600' });
      }
      const read = await jsonUnder(req, REQUEST_LIMITS.publicJson);
      if (read.tooLarge) return json({ error: 'that request is too large' }, 413, h);
      if (read.invalid) return json({ error: 'a commitment, as json' }, 400, h);
      const body = read.value;
      if (!isCommitment(body?.claim)) return json({ error: 'that is not a commitment' }, 400, h);

      const made = await createCheckout({
        secret: env.STRIPE_SECRET, price: env.STRIPE_PRICE, commitment: body.claim, site,
      });
      if (!made.ok || !made.body?.url) {
        say('checkout.failed', { reason: made.reason || 'no-url' });
        return json({ error: DESK }, 503, h);
      }
      say('checkout.made');
      return json({ session: made.body.id, url: made.body.url }, 200, { ...h, 'cache-control': 'no-store' });
    }

    // ---- the door: a paid session becomes a key, for the device that paid ----
    if (url.pathname === '/door' && req.method === 'POST') {
      if (!ready(env)) { say('door.unconfigured'); return json({ error: DESK }, 503, h); }
      if (!(await allow(env, 'door', req))) {
        return json({ error: 'too many of these, too quickly. try again shortly' }, 429, { ...h, 'retry-after': '600' });
      }
      const read = await jsonUnder(req, REQUEST_LIMITS.publicJson);
      if (read.tooLarge) return json({ error: 'that request is too large' }, 413, h);
      if (read.invalid) return json({ error: 'a session id, as json' }, 400, h);
      const body = read.value;
      if (!isSessionId(body?.session)) return json({ error: 'that is not a checkout session' }, 400, h);
      // the secret, before Stripe is troubled: a malformed one costs an api call
      if (!isSecret(body?.secret)) return json({ error: 'that is not what opens a door' }, 400, h);

      const got = await fetchSession(body.session, env.STRIPE_SECRET);
      if (!got.ok) {
        say('door.stripe', { reason: got.reason });
        return json({ error: isOurFault(got.reason) ? DESK : SHUT }, isOurFault(got.reason) ? 503 : 403, h);
      }
      const why = admits(got.body, {
        prices: pricesAdmitted(env),
        live: isLive(env.STRIPE_SECRET),
        shown: await commitmentOf(body.secret),
      });
      if (why) {
        say('door.refused', { reason: why });
        return json({ error: why === 'claim' ? ELSEWHERE : SHUT }, 403, h);
      }
      if (!(await mintAllowed(env))) return json({ error: DESK }, 503, h);

      // The session is paid, it is for the one thing we sell, and the device
      // asking is the device that started it. Whether the webhook has already
      // been here or not, the answer is the same key: it is derived from the
      // subscription, not drawn fresh, so there is nothing to race over and
      // nothing to lose when an answer never arrives.
      const done = await openMembership(env, got.body, nowS);
      say('door.opened', { again: done.again });
      return json({ key: done.key, until: done.until, again: done.again },
        200, { ...h, 'cache-control': 'no-store' });
    }

    // ---- stripe speaks: memberships begin, renew, and lapse ----
    if (url.pathname === '/stripe' && req.method === 'POST') {
      const raw = await bodyUnder(req, REQUEST_LIMITS.stripeWebhook);
      if (raw === null) return json({ error: 'that delivery is too large' }, 413, h);
      const ok = await verifyWebhook(raw, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, nowS);
      if (!ok) return json({ error: 'not stripe' }, 400, h);
      let ev;
      try { ev = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'unreadable' }, 400, h); }

      // Stripe delivers at least once, and at least once means twice. This KV
      // marker is only a quick read-compatible cache; the subscription object
      // commits its event marker and state together. The cache is written after
      // the work, so a delivery that failed halfway is retried.
      if (ev.id && await env.BOX.get(`ev:${ev.id}`)) {
        say('hook.again', { type: ev.type });
        return json({ received: true, again: true }, 200, h);
      }
      const at = Number(ev.created) || nowS;

      // A patch carries the state at the moment the event was made, and events
      // do not arrive in the order they were made. An older one may not undo a
      // newer one; it may still carry a period end further out than the one
      // held, and that much is information rather than history.
      const touch = async (subId, patch, priority) => {
        if (!subId) return 'no-subscription';
        const key = await env.BOX.get(`sub:${subId}`);
        const seed = key ? await env.BOX.get(`member:${key}`, 'json') : null;
        const done = await subscriptionAsk(env, subId, '/transition', {
          key, seed, incoming: { sub: subId, ...patch },
          cursor: { at, priority, tie: String(ev.id || '') },
          eventId: String(ev.id || ''),
        });
        if (done.key && done.member) await mirrorMembership(env, done.key, done.member);
        if (done.again) return 'again';
        return done.key ? (done.applied ? 'applied' : 'late') : 'pending';
      };

      const obj = ev.data?.object ?? {};
      let outcome = 'ignored';

      if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
        // The membership begins here and not on the return page. Card is the
        // only method this checkout offers, so settlement is immediate, but
        // reaching the success page is not: a member who paid and closed the
        // tab is a member, and their key is waiting when they come back.
        //
        // The session is read back from Stripe rather than trusted from the
        // body. The event carries an unexpanded session; the subscription, the
        // price, the currency and the interval are what have to be checked,
        // and they are only in the expansion.
        if (!ready(env)) { say('hook.unconfigured'); return json({ error: 'not configured' }, 500, h); }
        const got = await fetchSession(obj.id, env.STRIPE_SECRET);
        if (!got.ok) {
          say('hook.stripe', { reason: got.reason });
          // ours or Stripe's: let it come again rather than lose the membership
          if (isOurFault(got.reason)) return json({ error: 'ask again' }, 500, h);
          outcome = 'unreadable';
        } else {
          const why = admits(got.body, { prices: pricesAdmitted(env), live: isLive(env.STRIPE_SECRET) });
          // A refusal here is not always the session's fault. Three of them
          // mean the club could not see enough to decide rather than that the
          // payment was wrong: no expanded subscription is a restricted key
          // missing the subscriptions scope, and a subscription not yet active
          // or without a period is a state that moves on its own moments later.
          // Marking those handled would strand a real payment for good, so they
          // go back unfinished and Stripe delivers again.
          if (LATER.has(why)) {
            say('hook.unfinished', { reason: why });
            return json({ error: 'ask again' }, 500, h);
          }
          if (why) { say('hook.refused', { reason: why }); outcome = `refused:${why}`; }
          else if (!(await mintAllowed(env))) {
            return json({ error: 'the mint is not what it was' }, 500, h);
          } else {
            const done = await openMembership(env, got.body, at, String(ev.id || ''));
            outcome = done.again ? 'known' : 'opened';
          }
        }
      } else if (ev.type === 'invoice.paid') {
        // the subscription moved house in 2025-03-31.basil; both addresses answer
        const subId = obj.parent?.subscription_details?.subscription
          ?? (typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id);
        const until = obj.lines?.data?.map(l => Number(l.period?.end) || 0).reduce((a, b) => Math.max(a, b), 0);
        outcome = await touch(subId, until ? { until, standing: 'good' } : { standing: 'good' }, 100);
      } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.created') {
        const patch = patchFor(obj);
        const priority = patch.standing === 'left' ? 400 : patch.standing === 'held' ? 300 : 200;
        outcome = await touch(obj.id, patch, priority);
      } else if (ev.type === 'customer.subscription.deleted') {
        outcome = await touch(obj.id, { standing: 'left', leaving: false }, 400);
      }

      // Thirty days, not the three that automatic retries run for. Stripe keeps
      // an event retrievable for thirty days and a person can resend one by
      // hand for that whole time, so a marker that expires sooner lets a
      // resent delivery be handled a second time.
      if (ev.id) await env.BOX.put(`ev:${ev.id}`, '1', { expirationTtl: 30 * 24 * 3600 });
      say('hook', { type: ev.type, outcome });
      return json({ received: true }, 200, h);
    }

    // ---- everything below is a member speaking ----
    const { key, member, authorityError } = await memberOf(req, env);
    if (authorityError) return json({ error: DESK }, 503, h);
    const standing = key ? standingOf(member, nowS) : 'none';
    if (standing === 'none') {
      // a wrong key is a guess, and guesses are counted
      if (!(await allow(env, 'key', req))) {
        return json({ error: 'too many of these, too quickly. try again shortly' }, 429, { ...h, 'retry-after': '600' });
      }
      return json({ error: key ? 'unknown key' : 'no key' }, 401, h);
    }
    // nothing below this line may be held by a cache: it is one member's
    // standing, one member's envelope, and one member's way out
    const mh = { ...h, 'cache-control': 'no-store' };

    if (url.pathname === '/membership' && req.method === 'GET') {
      return json({ standing, until: member.until ?? null, leaving: member.leaving === true }, 200, mh);
    }

    // ---- the way out, opened on demand ----
    if (url.pathname === '/portal' && req.method === 'POST') {
      if (!env.STRIPE_SECRET) { say('portal.unconfigured'); return json({ error: DESK }, 503, mh); }
      if (!member.cus) {
        return json({ error: 'this membership has no billing account on file. write to us and it will be ended by hand' }, 409, mh);
      }
      const made = await createPortal({ secret: env.STRIPE_SECRET, customer: member.cus, site });
      if (!made.ok || !made.body?.url) {
        say('portal.failed', { reason: made.reason || 'no-url' });
        return json({ error: DESK }, 503, mh);
      }
      say('portal.made');
      return json({ url: made.body.url }, 200, mh);
    }

    // ---- the letterbox: one member's letters, from other members ----
    //
    // Every route here sits below the member gate, and that is decision 3 of
    // 2026-08-12 in code: anyone at all can receive a link, and a direct
    // exchange needs both people in the club. The sender is authenticated here,
    // by their own membership key, before their letter is offered to anybody's
    // box. Which is also why a lapsed membership stops the exchange in both
    // directions: outward at this line, and inward at the recipient's box,
    // which carries its own copy of how long it is paid for.
    //
    // The club learns, in the instant it delivers, that this member posted to
    // that box. It writes none of it down: the box's storage holds ciphertext,
    // a length and an arrival time, and there is no key anywhere that maps a
    // route back to a person.
    if (url.pathname === '/letters' || url.pathname.startsWith('/letters/')) {
      if (!env.LETTERBOX) return json({ error: DESK }, 503, mh);
      if (!env.MINT_SECRET) { say('letters.unconfigured'); return json({ error: DESK }, 503, mh); }

      const boxAt = (route) => env.LETTERBOX.get(env.LETTERBOX.idFromName(route));
      const ask = async (route, path, body) => (await boxAt(route).fetch(
        `https://box${path}`,
        body ? { method: 'POST', body: JSON.stringify(body) } : {},
      )).json();

      const mine = await routeFor(key, env.MINT_SECRET);
      const rest = url.pathname.slice('/letters'.length).replace(/^\//, '');

      // ---- posting, which is the only act a non-owner performs ----
      if (rest === 'post' && req.method === 'POST') {
        if (standing !== 'good') return json({ error: 'the membership has lapsed' }, 402, mh);
        if (!(await allow(env, 'post', req))) {
          return json({ error: 'too many of these, too quickly. try again shortly' }, 429, { ...mh, 'retry-after': '60' });
        }
        // The header and nowhere else. A capability is a secret, and a secret in
        // a query string is a secret in every proxy log, every referrer and
        // every browser history between here and there. There was a fallback to
        // `?cap=` here for one hour and it is gone.
        const cap = splitCap(req.headers.get('x-cap'));
        if (!cap) return json({ error: 'that is not an address this club can deliver to' }, 400, mh);
        const id = url.searchParams.get('id') || '';
        if (!isMsgId(id)) return json({ error: 'a letter is posted under its own message id' }, 400, mh);

        // The declared length is refused before the body is read, the same way
        // the vault refuses one, so a hopeless post does not spend the worker's
        // memory to be told no. The real length decides, inside the box.
        const said = Number(req.headers.get('content-length') || 0);
        if (said > BOX_LIMITS.letterBytes) {
          return json({ error: `a letter is ${BOX_LIMITS.letterBytes} bytes at most` }, 413, mh);
        }

        const bytes = await bodyUnder(req, BOX_LIMITS.letterBytes);
        if (bytes === null) {
          return json({ error: `a letter is ${BOX_LIMITS.letterBytes} bytes at most` }, 413, mh);
        }

        const r = await boxAt(cap.route).fetch(
          `https://box/post?id=${id}&at=${Date.now()}`,
          { method: 'POST', headers: { 'x-cap': cap.secret }, body: bytes },
        );
        const done = await r.json();
        if (!done.ok) {
          say('letters.refused', { why: done.why || 'unknown' });
          return json({ error: POST_REFUSALS[done.why] || 'that letter was not taken' }, done.code || 400, mh);
        }
        say('letters.posted');
        return json({ posted: true, waiting: done.waiting }, 200, mh);
      }

      // ---- everything else is the owner of this box ----

      if (rest === '' && req.method === 'GET') {
        // Reading is allowed while lapsed: what is already in the box stays
        // readable and deletable until burned, per decision 4. The touch is
        // not withheld here, because it sets rather than raises: handing the
        // box a paid-until that has already passed is how a lapsed box learns
        // it is shut, and is the opposite of reopening it.
        await ask(mine, '/touch', { until: standing === 'good' ? Number(member.until) || 0 : 0 });
        const got = await ask(mine, '/list');
        return json({ route: mine, ...got }, 200, mh);
      }

      if (rest === 'cap' && req.method === 'POST') {
        if (standing !== 'good') return json({ error: 'the membership has lapsed' }, 402, mh);
        // Minted here rather than sent by the device, so a device with a poor
        // random source cannot hand out a guessable address to its friends.
        // The club sees this secret once, on its way out, and keeps its hash.
        const secret = mintKey(crypto.getRandomValues(new Uint8Array(16))).slice(3);
        await ask(mine, '/touch', { until: Number(member.until) || 0 });
        const made = await ask(mine, '/mint', { secret });
        if (!made.ok) return json({ error: 'this box already has as many correspondents as it holds' }, made.code || 400, mh);
        say('letters.cap');
        return json({ cap: `${mine}.${secret}`, id: made.id }, 200, mh);
      }

      if (rest.startsWith('cap/') && req.method === 'DELETE') {
        const id = rest.slice(4);
        if (!isCapId(id)) return json({ error: 'that is not a correspondent of this box' }, 400, mh);
        const done = await ask(mine, '/revoke', { id });
        if (!done.ok) return json({ error: 'that correspondent is not on this box' }, 404, mh);
        say('letters.revoked');
        return json({ revoked: true }, 200, mh);
      }

      if (isMsgId(rest) && req.method === 'GET') {
        const r = await boxAt(mine).fetch(`https://box/read?id=${rest}`);
        if (!r.ok) return json({ error: 'no letter of that name is waiting' }, 404, mh);
        return new Response(r.body, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'x-arrived-at': r.headers.get('x-arrived-at') || '',
            ...mh,
          },
        });
      }

      if (isMsgId(rest) && req.method === 'DELETE') {
        const done = await ask(mine, '/drop', { id: rest });
        if (!done.ok) return json({ error: 'no letter of that name is waiting' }, 404, mh);
        return json({ gone: true }, 200, mh);
      }

      if (rest === '' && req.method === 'DELETE') {
        await ask(mine, '/burn', {});
        say('letters.burned');
        return json({ gone: true }, 200, mh);
      }

      return json({ error: 'nothing lives here' }, 404, mh);
    }

    // a lapsed member may still read and delete: the envelope is theirs.
    // only writing new ones asks for good standing.
    if (url.pathname === '/vault') {
      // The pointers live in a Durable Object, one per membership, and the
      // ciphertext lives in R2 under a name that is never reused. What used to
      // be six operations on an eventually consistent store is now an upload
      // and one atomic rotation; the reasoning is written out in vault.js.
      const vault = env.VAULT.get(env.VAULT.idFromName(key));
      const ask = async (path, body) => (await vault.fetch(
        `https://vault${path}`,
        body ? { method: 'POST', body: JSON.stringify(body) } : {},
      )).json();

      if (req.method === 'PUT') {
        if (standing !== 'good') return json({ error: 'the membership has lapsed' }, 402, mh);

        // What the seal says it replaces, read before the body is touched.
        //
        // The star form of if-match is deliberately not honoured: `If-Match: *`
        // means "whatever is there", which is a licence to clobber, which is
        // the thing this guard exists to refuse. Only a revision matches.
        const ifMatch = req.headers.get('if-match');
        const ifNone = req.headers.get('if-none-match');
        let want = null;
        if (ifMatch !== null) {
          const m = /^"([0-9a-f]{32})"$/.exec(ifMatch.trim());
          if (!m) {
            const head0 = await ask('/head');
            return json({ error: 'the vault has moved on. read it again and seal over what it now holds' },
              412, { ...mh, ...(head0.rev ? { etag: etagOf(head0.rev) } : {}) });
          }
          want = { match: m[1] };
        } else if (ifNone !== null) {
          if (ifNone.trim() !== '*') return json({ error: 'if-none-match takes a star and nothing else' }, 400, mh);
          want = { fresh: true };
        } else {
          const head0 = await ask('/head');
          return json({ error: 'a seal must say what it replaces: if-match, or if-none-match: *' },
            428, { ...mh, ...(head0.rev ? { etag: etagOf(head0.rev) } : {}) });
        }

        // A refusal that costs an upload costs the member their data
        // allowance, so the precondition is asked once here, cheaply, before
        // the bytes move. It is advisory: the commit asks again, inside the
        // lock, and that answer is the one that decides.
        const seen = await ask('/head');
        if ((want.fresh && seen.rev) || (want.match && want.match !== seen.rev)) {
          return json({ error: 'the vault has moved on. read it again and seal over what it now holds' },
            412, { ...mh, ...(seen.rev ? { etag: etagOf(seen.rev) } : {}) });
        }

        // The declared length is refused before the body is read at all, so a
        // hostile or hopeless upload does not spend the worker's memory to be
        // told no. The real length is checked again after the write, because a
        // declared length is a claim and the object's own size is a fact.
        const said = Number(req.headers.get('content-length') || 0);
        if (said > LIMITS.vaultBytes) {
          return json({ error: `the vault holds ${LIMITS.vaultBytes} bytes at most` }, 413, mh);
        }

        const name = newObjectName(key);
        const put = await env.VAULTS.put(name, req.body);
        const bytes = Number(put?.size ?? 0);
        const undo = async () => { try { await env.VAULTS.delete(name); } catch { /* litter, not damage */ } };
        if (bytes < 24) { await undo(); return json({ error: 'that is not a sealed envelope' }, 400, mh); }
        if (bytes > LIMITS.vaultBytes) {
          await undo();
          return json({ error: `the vault holds ${LIMITS.vaultBytes} bytes at most` }, 413, mh);
        }

        const at = new Date().toISOString();
        const done = await ask('/commit', { want, id: name, bytes, at });
        if (!done.ok) {
          // the pointer never moved, so the object just written is referenced
          // by nothing: it goes, and the vault is exactly as it was
          await undo();
          say('vault.conflict');
          return json({ error: 'the vault has moved on. read it again and seal over what it now holds' },
            412, { ...mh, ...(done.rev ? { etag: etagOf(done.rev) } : {}) });
        }
        // Only ever the name the rotation handed back, and only after it
        // landed. Nothing else in this worker deletes ciphertext, so an object
        // still named by current or previous cannot be collected by accident.
        if (done.evicted) { try { await env.VAULTS.delete(done.evicted); } catch { /* litter */ } }
        say('vault.sealed', { kb: Math.round(bytes / 1024) });
        return json({ bytes, at, rev: done.rev }, 200, { ...mh, etag: etagOf(done.rev) });
      }

      if (req.method === 'GET') {
        const wantPrev = !!url.searchParams.get('prev');
        const head = await ask('/head');
        const slot = wantPrev ? head.previous : head.current;
        if (!slot) return json({ error: 'the vault is empty' }, 404, mh);
        const obj = await env.VAULTS.get(slot.id);
        // the pointer names an object the store does not have. that is not an
        // empty vault and must not be answered as one: an empty vault is a
        // thing a client seals over.
        if (!obj) { say('vault.lost'); return json({ error: 'the club cannot read that envelope back' }, 503, mh); }
        // an etag invites a cache to hold the answer, and an envelope read
        // from a cache is an envelope the writer would then seal over with a
        // revision that has moved. this response is for one reader, once.
        const headers = {
          'content-type': 'application/octet-stream',
          'x-sealed-at': slot.at ?? '',
          ...mh,
        };
        // the revision names the current envelope alone. the slot before is
        // not writable, and an etag there would name a thing no put accepts.
        if (!wantPrev && head.rev) headers.etag = etagOf(head.rev);
        return new Response(obj.body, { status: 200, headers });
      }

      if (req.method === 'DELETE') {
        // The object keeps a durable tombstone until R2 confirms collection;
        // a failed delete is retried by its alarm and is never called finished.
        const done = await ask('/burn', {});
        say(done.collected ? 'vault.burned' : 'vault.burn.pending');
        return json(done.collected
          ? { gone: true }
          : { gone: false, pending: true }, done.collected ? 200 : 202, mh);
      }
    }

    return json({ error: 'nothing lives here' }, 404, mh);
  },
};
