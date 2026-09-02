// subscription.js — one strongly-consistent history for one Stripe subscription.
//
// KV remains the public/read-compatible mirror used by older deployments, but
// it cannot arbitrate webhook order: two isolates can read the same value and
// both write a successor.  Every transition and its Stripe event marker live
// in this object and commit in one storage transaction instead.

const STATE = 'state';
const EVENT_TTL_MS = 30 * 24 * 3600 * 1000;

const n = value => Number(value) || 0;

const seedPriority = member => {
  if (member?.standing === 'left') return 400;
  if (member?.standing === 'held') return 300;
  return 200;
};

const cursorOfSeed = member => ({
  at: n(member?.seq),
  priority: seedPriority(member),
  tie: '',
});

const cursorOf = value => ({
  at: n(value?.at),
  priority: n(value?.priority),
  tie: String(value?.tie || ''),
});

const compare = (a, b) => {
  if (a.at !== b.at) return a.at - b.at;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0;
};

const mergeSeed = (held, seed) => {
  if (!seed) return held || null;
  if (!held) return { ...seed };
  // A KV mirror may lag the object, so it can fill old metadata but cannot
  // restore an older standing or cancellation flag.  A later period end is
  // monotonic information and remains useful even when its event was older.
  return {
    ...seed,
    ...held,
    until: Math.max(n(seed.until), n(held.until)),
  };
};

export class Subscription {
  constructor(state) {
    this.state = state;
  }

  async read({ key = null, seed = null } = {}) {
    return this.state.storage.transaction(async txn => {
      const held = await txn.get(STATE);
      if (held?.key && key && held.key !== key) return { ok: false, conflict: true };
      if (!held && !seed) return { ok: true, key: null, member: null };

      const member = mergeSeed(held?.member, seed);
      const next = {
        key: held?.key || key || null,
        member,
        cursor: held?.cursor || cursorOfSeed(member),
        rev: n(held?.rev) + (held ? 0 : 1),
      };
      if (!held || next.key !== held.key || JSON.stringify(next.member) !== JSON.stringify(held.member)) {
        await txn.put(STATE, next);
      }
      return { ok: true, key: next.key, member: next.member, rev: next.rev };
    });
  }

  async transition({ key = null, seed = null, incoming = {}, cursor = {}, eventId = '' } = {}) {
    const mark = typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 200
      ? `event:${eventId}` : null;
    return this.state.storage.transaction(async txn => {
      const received = Date.now();
      for (const [name, value] of await txn.list({ prefix: 'event:' })) {
        if (n(value?.at) + EVENT_TTL_MS <= received) await txn.delete(name);
      }
      const held = await txn.get(STATE);
      if (held?.key && key && held.key !== key) return { ok: false, conflict: true };
      if (mark && await txn.get(mark)) {
        return { ok: true, again: true, key: held?.key || key, member: held?.member || seed || null, rev: n(held?.rev) };
      }

      let member = mergeSeed(held?.member, seed) || {};
      let current = held?.cursor || (seed ? cursorOfSeed(seed) : { at: 0, priority: 0, tie: '' });
      const nextCursor = cursorOf(cursor);
      const newer = compare(nextCursor, current) > 0;
      const until = Math.max(n(member.until), n(incoming?.until));

      if (newer || (!held && !seed)) {
        member = { ...member, ...incoming, until, seq: nextCursor.at };
        current = nextCursor;
      } else {
        // Old events may fill fields and extend a paid period, but the current
        // authoritative state wins every field that can move backwards.
        member = { ...incoming, ...member, until, seq: current.at };
      }

      const next = {
        key: held?.key || key || null,
        member,
        cursor: current,
        rev: n(held?.rev) + 1,
      };
      await txn.put(STATE, next);
      if (mark) await txn.put(mark, { at: received });
      return { ok: true, applied: newer || (!held && !seed), key: next.key, member, rev: next.rev };
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const said = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (req.method !== 'POST') return said({ error: 'nothing lives here' }, 404);
    if (url.pathname === '/read') return said(await this.read(await req.json()));
    if (url.pathname === '/transition') return said(await this.transition(await req.json()));
    return said({ error: 'nothing lives here' }, 404);
  }
}
