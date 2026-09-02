// vault.js — the one place where a backup actually changes hands.
//
// What was here before was a compare-and-swap in name only. A seal read the
// revision from one key, read the envelope from a second, wrote the envelope
// before it to a third, wrote the new envelope to the second, and wrote the
// metadata back to the first: six independent operations on an eventually
// consistent store. The revision guard closed the window that happens, which
// is a device that read an hour ago sealing now. It could not close the window
// where two devices read the same revision in the same instant, both pass, and
// both write, and it could not make the five writes one thing. The threat
// model conceded both in writing. For a backup somebody has paid for, a
// conceded race is not a defence.
//
// So the transition moves here. A Durable Object is one thing at a time: this
// class holds nothing but pointers, and the compare and the rotation happen
// inside a single blocked section, which is what makes "exactly one of two
// seals wins" true rather than likely.
//
// The bytes are not here. A sealed envelope can be sixteen megabytes and a
// Durable Object's storage is not the place for it, so ciphertext lives in R2
// under a random, immutable name and this object holds the names. That split
// is what makes every interrupted seal harmless in one direction:
//
//   upload, then commit. A death before the commit leaves an object nobody
//   points at, which is litter. A death after it leaves a whole state. There
//   is no order of events that leaves half a rotation, because the rotation is
//   one write of one value.
//
// The names are random rather than derived. `vault/<member>/current` would put
// the state back into R2, where it would be mutable again and where two seals
// would race for the same name; a name that is never reused cannot be raced
// for, and the pointer is the only thing that moves.

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

// Sixteen fresh random bytes at every seal, derived from nothing. A revision
// that were a digest of the envelope would answer "is this still the envelope
// I hold a copy of" to anyone who asks; randomness answers nothing at all.
const newRev = () => hex(crypto.getRandomValues(new Uint8Array(16)));

// what a vault holds when it holds nothing
const EMPTY = { rev: '', current: null, previous: null };
const LEGACY_OBJECT = /^vault\/tc_[0-9abcdefghjkmnpqrstvwxyz]{20,27}\/[0-9a-f]{32}$/;

export class Vault {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async head() {
    const head = (await this.state.storage.get('head')) || EMPTY;
    return this.migrateLegacy(head);
  }

  // Old deployments put the bearer membership key in every R2 object name.
  // Copy first, then swap only pointers that still name the copied object. The
  // head and cleanup queue commit together, so no readable pointer is removed
  // before its replacement exists and no old name is forgotten on failure.
  async migrateLegacy(head) {
    if (!this.env?.VAULTS) return head;
    const slots = [head.current, head.previous]
      .filter(slot => slot?.id && LEGACY_OBJECT.test(slot.id));
    if (!slots.length) return head;

    const copies = [];
    for (const slot of slots) {
      if (copies.some(copy => copy.old === slot.id)) continue;
      try {
        const object = await this.env.VAULTS.get(slot.id);
        if (!object) continue;
        const fresh = newObjectName();
        const options = {};
        if (object.httpMetadata) options.httpMetadata = object.httpMetadata;
        if (object.customMetadata) options.customMetadata = object.customMetadata;
        await this.env.VAULTS.put(fresh, object.body, options);
        copies.push({ old: slot.id, fresh });
      } catch {
        // The old pointer and bytes remain readable. A later authenticated
        // read or write tries the migration again.
      }
    }
    if (!copies.length) return head;

    const byOld = new Map(copies.map(copy => [copy.old, copy.fresh]));
    let migrated;
    try {
      migrated = await this.state.storage.transaction(async txn => {
        const live = (await txn.get('head')) || EMPTY;
        const replace = slot => slot && byOld.has(slot.id)
          ? { ...slot, id: byOld.get(slot.id) }
          : slot;
        const next = {
          ...live,
          current: replace(live.current),
          previous: replace(live.previous),
        };
        const changed = next.current?.id !== live.current?.id
          || next.previous?.id !== live.previous?.id;
        if (changed) await txn.put('head', next);

        const referenced = new Set([next.current?.id, next.previous?.id].filter(Boolean));
        const garbage = [...new Set([
          ...copies.map(copy => copy.old),
          ...copies.map(copy => copy.fresh),
        ].filter(id => !referenced.has(id)))];
        if (garbage.length) {
          const deleting = await txn.get('deleting');
          await txn.put('deleting', {
            ids: [...new Set([...(deleting?.ids || []), ...garbage])],
            attempts: Number(deleting?.attempts) || 0,
          });
          await txn.setAlarm(Date.now());
        }
        return next;
      });
    } catch {
      // A failed storage transaction leaves the old head whole. Best-effort
      // collection of the unreferenced copies avoids turning that safety into
      // permanent litter; a future read retries the actual migration.
      try { await this.env.VAULTS.delete(copies.map(copy => copy.fresh)); } catch { /* unreferenced litter */ }
      return (await this.state.storage.get('head')) || EMPTY;
    }

    // The alarm was committed with the pointer swap. Try now for prompt
    // cleanup, but never make a successfully migrated vault unreadable because
    // collection itself is temporarily unavailable.
    try { await this.collect(); } catch { /* the committed alarm retries */ }
    return migrated;
  }

  // The whole of the transition, and the reason this class exists.
  //
  // `want` is the precondition the member's device stated, already parsed:
  // { match: '<rev>' } for a seal over a known envelope, { fresh: true } for
  // the first seal into an empty vault. Neither is not a case: a seal that
  // says nothing about what it replaces is refused by the caller before the
  // body is read, and it is refused there rather than here because a refusal
  // that costs an upload is a refusal that costs the member's data allowance.
  //
  // blockConcurrencyWhile is the guarantee. Without it this method awaits
  // storage twice and a second request can interleave between the two, which
  // is the same race in a new house.
  async commit({ want, id, bytes, at }) {
    return this.state.blockConcurrencyWhile(async () => {
      const head = (await this.state.storage.get('head')) || EMPTY;
      if (want.fresh) {
        if (head.rev) return { ok: false, code: 412, rev: head.rev };
      } else if (!head.rev || want.match !== head.rev) {
        return { ok: false, code: 412, rev: head.rev };
      }
      const next = {
        rev: newRev(),
        current: { id, bytes, at },
        previous: head.current || null,
      };
      // the object that falls out of the previous slot is referenced by
      // nothing the moment this write lands, and its name is handed back so
      // the caller can collect it. nothing else is ever collectable.
      const evicted = head.previous?.id || null;
      await this.state.storage.put('head', next);
      return { ok: true, rev: next.rev, evicted, head: next };
    });
  }

  // Both slots disappear from the readable head first, while their object ids
  // move atomically into a tombstone.  The ids are not forgotten until R2 has
  // confirmed deletion; an alarm retries after any failure or worker death.
  async burn() {
    const pending = await this.state.storage.transaction(async txn => {
      const head = (await txn.get('head')) || EMPTY;
      const deleting = await txn.get('deleting');
      const ids = [...new Set([
        ...(deleting?.ids || []), head.current?.id, head.previous?.id,
      ].filter(Boolean))];
      await txn.delete('head');
      if (ids.length) {
        await txn.put('deleting', { ids, attempts: Number(deleting?.attempts) || 0 });
        await txn.setAlarm(Date.now());
      }
      return ids.length > 0;
    });
    if (!pending) return { collected: true, pending: false };
    const collected = await this.collect();
    return { collected, pending: !collected };
  }

  async retry(deleting) {
    const attempts = (Number(deleting?.attempts) || 0) + 1;
    const delay = Math.min(24 * 3600_000, 1000 * (2 ** Math.min(attempts, 16)));
    await this.state.storage.transaction(async txn => {
      const held = await txn.get('deleting');
      if (!held?.ids?.length) return;
      await txn.put('deleting', { ...held, attempts });
      await txn.setAlarm(Date.now() + delay);
    });
  }

  async collect() {
    const deleting = await this.state.storage.get('deleting');
    const ids = [...new Set(deleting?.ids || [])];
    if (!ids.length) return true;
    if (!this.env?.VAULTS) { await this.retry(deleting); return false; }
    try {
      await this.env.VAULTS.delete(ids);
    } catch {
      await this.retry(deleting);
      return false;
    }

    // A fresh burn may have added ids while R2 was being awaited.  Remove
    // only the ids this attempt actually collected and keep the rest durable.
    return this.state.storage.transaction(async txn => {
      const held = await txn.get('deleting');
      const taken = new Set(ids);
      const left = (held?.ids || []).filter(id => !taken.has(id));
      if (left.length) {
        await txn.put('deleting', { ids: left, attempts: 0 });
        await txn.setAlarm(Date.now());
        return false;
      }
      await txn.delete('deleting');
      await txn.deleteAlarm();
      return true;
    });
  }

  async alarm() {
    await this.collect();
  }

  // The object is addressed over fetch, because that is the interface a
  // Durable Object stub offers. One route per act, and no route that reads or
  // writes ciphertext: this object has never seen an envelope.
  async fetch(req) {
    const url = new URL(req.url);
    const said = (v, status = 200) => new Response(JSON.stringify(v), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (url.pathname === '/head') return said(await this.head());
    if (url.pathname === '/commit' && req.method === 'POST') {
      return said(await this.commit(await req.json()));
    }
    if (url.pathname === '/burn' && req.method === 'POST') {
      return said(await this.burn());
    }
    return said({ error: 'nothing lives here' }, 404);
  }
}

// The name is a bearer-free random identifier.  Older names containing a
// membership key remain valid because reads and deletion treat ids as opaque.
export function newObjectName() {
  return `vault/${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
}
