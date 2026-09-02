// letterbox.js — where a letter waits, and the only thing the club holds that
// one member put there for another.
//
// The club cannot read any of it. What arrives here is the output of
// js/letters.js: RFC 9180 mode auth, sealed to the recipient's public key and
// authenticated under the sender's, both of which travelled in an introduction
// link and neither of which the club has ever seen. This object holds bytes, a
// length, and the moment they arrived.
//
// Why a Durable Object and not KV.
//
// The contract is "at most fifty letters, at most four megabytes, the
// fifty-first refused". KV cannot say that. A list is eventually consistent and
// a write is a write, so two posts arriving together both read forty-nine, both
// pass, and the box holds fifty-one. Here the count, total, and letter move in
// one storage transaction, which makes the refusal true rather than probable.
//
// Why the letter is written in the same act that counts it.
//
// The vault splits the upload from the commit because a sixteen-megabyte
// envelope cannot live in a Durable Object, and it pays for that split with
// orphaned objects it has to collect. A letter is at most 256 KB, which fits
// under a row's two-megabyte ceiling, so there is nothing to split: the count,
// the total and the bytes move together or not at all. A reservation followed
// by a body would reintroduce exactly the half-finished state that design
// exists to avoid, and here it would be visible, as a letter that is in the
// list and opens onto nothing.
//
// Why the box is named by a route rather than by the membership key.
//
// A correspondent has to be able to post without holding the member's key, so
// the address has to be in the capability they were given. Putting the
// membership key there would hand every correspondent the member's vault. The
// route is HMAC(MINT_SECRET, 'letterbox:' + key), so the club can go key to
// route whenever a member authenticates and cannot go route to key at all: a
// post names a box and never a person. The club still learns, live, that some
// member posted to some box, because it authenticated the sender in the same
// request. It stores none of that, and this file is where you can check.
//
// Retention: until burned.
//
// Not thirty days, not seven. An earlier draft wrote a thirty-day TTL beside a
// promise of "until burned" and a refusal of any letter more than a week old,
// and those three cannot all be true. The caps are the only pressure on a box.
// A letter whose recipient was away for a fortnight is still their letter.

// The same three days the vault gives a lapsed membership, and for the same
// reason: a card that fails on a saturday is not a member who left. Imported
// rather than written again, because two constants that have to agree are one
// constant with a bug waiting in it.
import { GRACE_S } from './validate.js';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const b32 = (bytes) => {
  let out = '', acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
};

// what a box holds when it holds nothing. `until` is the recipient's paid-until,
// stamped whenever they authenticate here, and it is the whole of what this
// object knows about a person.
const EMPTY = { count: 0, bytes: 0, caps: 0, until: 0 };

export const BOX_LIMITS = {
  // A letter is a 47-byte header, a 65-byte ephemeral point and at least a
  // 16-byte tag. Anything shorter cannot open, so it is not a letter and does
  // not get to take a place in somebody's box. The vault refuses under 24 for
  // the same reason.
  least: 128,
  letterBytes: 256 * 1024,   // one letter, and it fits under a DO row's 2MB
  count: 50,                 // letters waiting
  total: 4 * 1024 * 1024,    // all of them together
  caps: 100,                 // correspondents who may post
};

const te = new TextEncoder();

async function capHashOf(secret) {
  return b32(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(String(secret)))));
}

// A capability is named to its owner by the first eight characters of the hash
// of its secret, so a member can revoke one without sending the secret back.
export async function capIdOf(secret) {
  return (await capHashOf(secret)).slice(0, 8);
}

export class Letterbox {
  constructor(state) {
    this.state = state;
  }

  async head() {
    return (await this.state.storage.get('head')) || EMPTY;
  }

  // The member has authenticated, so the box learns how long it is paid for.
  //
  // Set, not raised. The membership record is the authority and this is a copy
  // of one field of it, so it has to be able to go down: a subscription ended
  // early or refunded lowers the paid-until, and a box that only ever took the
  // higher of the two would keep accepting mail for a membership that no longer
  // exists, for as long as the last date it happened to see.
  //
  // It moves here and nowhere else, which is what lets a poster be refused
  // without the club looking up whose box this is. A box whose member never
  // comes back therefore closes by the date passing, and a membership that ends
  // early is shut by the webhook, which knows the key at the moment it happens.
  async touch(until) {
    return this.state.blockConcurrencyWhile(async () => {
      const head = (await this.state.storage.get('head')) || EMPTY;
      const next = { ...head, until: Number(until) || 0 };
      await this.state.storage.put('head', next);
      return next;
    });
  }

  // The membership changed at Stripe, so the box is told, without anybody
  // having come to look at it.
  //
  // A box that was never opened stays never opened. Writing here would create
  // storage for every member who has never sent or received anything, and would
  // turn `there is no box at that address` into a lie for every route in the
  // club. So this refuses rather than creates, and the refusal costs nothing.
  async restamp(until) {
    return this.state.blockConcurrencyWhile(async () => {
      const head = await this.state.storage.get('head');
      if (!head) return { ok: false, why: 'nobox' };
      await this.state.storage.put('head', { ...head, until: Number(until) || 0 });
      return { ok: true };
    });
  }

  async mintCap(secret) {
    const hash = await capHashOf(secret);
    return this.state.storage.transaction(async txn => {
      const head = (await txn.get('head')) || EMPTY;
      if (await txn.get(`cap:${hash}`)) return { ok: true, id: hash.slice(0, 8), again: true };
      // Counted from the capabilities themselves rather than from a running
      // total. A counter incremented here and decremented in revokeCap is two
      // numbers that have to agree forever, and the day they stop agreeing the
      // limit is silently wrong in one direction or the other. There are at
      // most a hundred of these and the list is inside the lock anyway.
      const held = (await txn.list({ prefix: 'cap:' })).size;
      if (held >= BOX_LIMITS.caps) return { ok: false, code: 429, why: 'crowd' };
      // The secret itself is never stored. What is kept is its hash, which
      // answers "may this poster post" and nothing else: not who they are, not
      // who introduced them, not what they have ever sent.
      await txn.put(`cap:${hash}`, { id: hash.slice(0, 8), at: Date.now() });
      await txn.put('head', { ...head, caps: held + 1 });
      return { ok: true, id: hash.slice(0, 8) };
    });
  }

  async revokeCap(id) {
    return this.state.storage.transaction(async txn => {
      const head = (await txn.get('head')) || EMPTY;
      for (const [k, v] of await txn.list({ prefix: 'cap:' })) {
        if (v?.id !== id) continue;
        await txn.delete(k);
        await txn.put('head', { ...head, caps: (await txn.list({ prefix: 'cap:' })).size });
        return { ok: true };
      }
      return { ok: false, code: 404, why: 'nocap' };
    });
  }

  // The whole of an arrival, and the reason this class exists.
  //
  // The bytes and capability hash are prepared before the transaction. Every
  // decision about them is taken inside it, so two posts that would together
  // break a cap cannot both pass it.
  async post({ secret, id, at }, body) {
    if (body.byteLength > BOX_LIMITS.letterBytes) return { ok: false, code: 413, why: 'big' };
    if (body.byteLength < BOX_LIMITS.least) return { ok: false, code: 400, why: 'notaletter' };
    const hash = await capHashOf(secret);
    return this.state.storage.transaction(async txn => {
      // Absent and closed are two different sentences and the difference is
      // the head, not the date. A box nobody has ever opened has no head at
      // all; a box whose membership ended has a head with a paid-until of zero,
      // written there by the webhook, and it may well still be holding letters
      // and correspondents. Reading `until` alone would tell somebody holding a
      // real introduction that the address does not exist.
      const head = await txn.get('head');
      if (!head) return { ok: false, code: 404, why: 'nobox' };
      // A box whose member has stopped paying stops taking mail, per the
      // decision of 2026-08-12: on lapse the box stops in both directions.
      if (!head.until || Date.now() / 1000 > head.until + GRACE_S) {
        return { ok: false, code: 403, why: 'closed' };
      }
      if (!(await txn.get(`cap:${hash}`))) return { ok: false, code: 403, why: 'nocap' };
      // The same letter twice is one letter. The id is the message id from the
      // letter's own cleartext header, which the sender is quoting rather than
      // choosing; a sender who quotes it wrongly can only collide with their
      // own earlier letter, and the recipient checks it against the opened
      // header before anything is applied.
      if (await txn.get(`letter:${id}`)) return { ok: false, code: 409, why: 'again' };
      if (head.count >= BOX_LIMITS.count) return { ok: false, code: 507, why: 'full' };
      if (head.bytes + body.byteLength > BOX_LIMITS.total) return { ok: false, code: 507, why: 'heavy' };
      await txn.put(`letter:${id}`, { bytes: body.byteLength, at, body });
      await txn.put('head', {
        ...head, count: head.count + 1, bytes: head.bytes + body.byteLength,
      });
      return { ok: true, waiting: head.count + 1 };
    });
  }

  async list() {
    const letters = [];
    for (const [k, v] of await this.state.storage.list({ prefix: 'letter:' })) {
      // the body is deliberately not spread into this: a list is a list
      letters.push({ id: k.slice(7), bytes: v.bytes, at: v.at });
    }
    letters.sort((a, b) => a.at - b.at);
    const caps = [];
    for (const [, v] of await this.state.storage.list({ prefix: 'cap:' })) caps.push(v.id);
    const head = await this.head();
    return { letters, caps, count: head.count, bytes: head.bytes, until: head.until };
  }

  async read(id) {
    return (await this.state.storage.get(`letter:${id}`)) || null;
  }

  async drop(id) {
    return this.state.storage.transaction(async txn => {
      const head = (await txn.get('head')) || EMPTY;
      const meta = await txn.get(`letter:${id}`);
      if (!meta) return { ok: false, code: 404, why: 'gone' };
      await txn.delete(`letter:${id}`);
      await txn.put('head', {
        ...head,
        count: Math.max(0, head.count - 1),
        bytes: Math.max(0, head.bytes - (Number(meta.bytes) || 0)),
      });
      return { ok: true };
    });
  }

  // Everything, including the capabilities, so a burned box cannot be posted to
  // by somebody still holding an introduction from before it. A member who
  // burns and comes back mints new ones and hands them out again, which is the
  // honest shape: burning a box is not tidying, it is changing the address.
  async burn() {
    return this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.deleteAll();
      return { ok: true };
    });
  }

  // Addressed over fetch, because that is the interface a Durable Object stub
  // offers. The posting secret travels in a header rather than in the path, so
  // it cannot be picked up by anything that records a URL.
  async fetch(req) {
    const url = new URL(req.url);
    const said = (v, status = 200) => new Response(JSON.stringify(v), {
      status, headers: { 'content-type': 'application/json' },
    });
    const asked = async () => (req.method === 'POST' ? req.json() : {});

    if (url.pathname === '/list') return said(await this.list());
    if (url.pathname === '/touch') return said(await this.touch((await asked()).until));
    if (url.pathname === '/restamp') return said(await this.restamp((await asked()).until));
    if (url.pathname === '/mint') return said(await this.mintCap((await asked()).secret));
    if (url.pathname === '/revoke') return said(await this.revokeCap((await asked()).id));
    if (url.pathname === '/drop') return said(await this.drop((await asked()).id));
    if (url.pathname === '/burn') return said(await this.burn());

    if (url.pathname === '/post') {
      const body = new Uint8Array(await req.arrayBuffer());
      return said(await this.post({
        secret: req.headers.get('x-cap') || '',
        id: url.searchParams.get('id') || '',
        at: Number(url.searchParams.get('at')) || Date.now(),
      }, body));
    }

    if (url.pathname === '/read') {
      const got = await this.read(url.searchParams.get('id') || '');
      if (!got) return said({ error: 'no such letter' }, 404);
      return new Response(got.body, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'x-arrived-at': String(got.at) },
      });
    }

    return said({ error: 'nothing lives here' }, 404);
  }
}
