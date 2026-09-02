// meter.js — a bucket of attempts, one per caller, that empties over time.
//
// Two doors of the club answer before anyone is a member: `/checkout`, which
// creates an object at Stripe, and `/door`, which spends an API call reading
// one. Both cost us money and neither asks for a key, so both are worth
// hammering. This is the thing that stops it.
//
// It is a Durable Object because a counter that is eventually consistent is
// not a counter: two requests reading "19 left" at the same moment both pass,
// and the limit is whatever the concurrency happens to be. One object per
// bucket, one blocked section per take, and the answer is the answer.
//
// What it keeps: a number and a timestamp. The object's NAME is a hash of the
// caller's address, never the address, because a durable object's name is
// stored and listable, and a list of addresses is exactly the record this club
// says it does not keep. And when a bucket has been full and quiet for two
// windows it deletes itself, so the set of names does not grow into a census.

const json = obj => new Response(JSON.stringify(obj), {
  headers: { 'content-type': 'application/json' },
});

export class Meter {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const u = new URL(req.url);
    const cap = Math.max(1, Number(u.searchParams.get('cap')) || 20);
    const per = Math.max(1, Number(u.searchParams.get('per')) || 3600);
    const cost = Math.max(1, Number(u.searchParams.get('cost')) || 1);
    const rate = cap / per; // tokens a second

    return this.state.blockConcurrencyWhile(async () => {
      const nowMs = Date.now();
      const held = await this.state.storage.get('bucket');
      const since = held ? Math.max(0, (nowMs - Number(held.at)) / 1000) : 0;
      const left = Math.min(cap, (held ? Number(held.left) : cap) + since * rate);

      if (left < cost) {
        await this.state.storage.put('bucket', { left, at: nowMs });
        await this.keepUntil(nowMs, per);
        return json({ ok: false, retryAfter: Math.ceil((cost - left) / rate) });
      }
      await this.state.storage.put('bucket', { left: left - cost, at: nowMs });
      await this.keepUntil(nowMs, per);
      return json({ ok: true, left: left - cost });
    });
  }

  // a bucket refills completely in one window, so after two it holds no
  // information anyone could want and the object is worth less than its name
  async keepUntil(nowMs, per) {
    try { await this.state.storage.setAlarm(nowMs + per * 2000); } catch { /* no alarms here */ }
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

// what the worker asks for, per door. the names are hashed before they are
// used, in the worker, where the address is known.
export const RATES = Object.freeze({
  // creating a checkout session costs us an object at Stripe and a member
  // nothing, so this is the tighter of the two
  checkout: { cap: 8, per: 3600 },
  // the door is asked again on purpose after a lost answer, so it is looser,
  // and still far under what a script would want
  door: { cap: 30, per: 3600 },
  // a wrong key is a guess. twenty-nine in an hour is not a fat-fingered paste.
  key: { cap: 30, per: 3600 },
  // posting a letter is the one act a member performs into somebody else's
  // storage, so it is metered on the sender rather than on the box: a box's own
  // caps stop it filling, and this stops one member spending an afternoon
  // filling fifty of them.
  post: { cap: 120, per: 3600 },
});
