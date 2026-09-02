// fakes.mjs — the platform, modelled as meanly as it will allow.
//
// One model, imported by every club suite, because two models of the same
// platform drift and the drift is invisible: a test passes against a fake that
// is kinder than production and nobody finds out until a member does.
//
// The guarantees the design leans on are modelled: blocked sections serialize,
// storage transactions commit all their writes or none, alarms persist, and an
// R2 operation either happened or did not. Everything else is deliberately dumb.
import { Vault } from '../src/vault.js';
import { Letterbox } from '../src/letterbox.js';
import { Meter } from '../src/meter.js';
import { Subscription } from '../src/subscription.js';

const CLASSES = { Vault, Letterbox, Meter, Subscription };

// ---- a durable object that is durable about the one thing that matters ----
//
// The gate is a promise chain, which is what the platform's own guarantee
// amounts to from inside: while one blocked section is running, nothing else
// enters. Without it, this fake would let two seals interleave between their
// reads and their writes, which is precisely the failure being tested for.
export function durable(kind = 'Vault', env = {}) {
  const map = new Map();
  let gate = Promise.resolve();
  let alarm = 0;
  let transactionFailAt = 0;
  const state = {
    storage: {
      async get(k) { await null; return map.has(k) ? structuredClone(map.get(k)) : undefined; },
      async put(k, v) { await null; map.set(k, structuredClone(v)); },
      async delete(k) { await null; map.delete(k); },
      async deleteAll() { await null; map.clear(); },
      // The platform returns a Map, sorted by key, of everything under the
      // prefix. Sorted matters: a letterbox lists what is waiting and a fake
      // that handed back insertion order would hide an ordering bug rather
      // than catch one. Cloned on the way out for the same reason get() is:
      // a caller that mutated what it was handed would be mutating storage.
      async list({ prefix = '' } = {}) {
        await null;
        const out = new Map();
        for (const k of [...map.keys()].sort()) {
          if (k.startsWith(prefix)) out.set(k, structuredClone(map.get(k)));
        }
        return out;
      },
      async setAlarm(at) { await null; alarm = at; },
      async getAlarm() { await null; return alarm || null; },
      async deleteAlarm() { await null; alarm = 0; },
      async transaction(fn) {
        return state.blockConcurrencyWhile(async () => {
          const copy = new Map([...map].map(([k, v]) => [k, structuredClone(v)]));
          let copyAlarm = alarm;
          let mutation = 0;
          const changes = () => {
            mutation += 1;
            if (transactionFailAt && mutation === transactionFailAt) {
              transactionFailAt = 0;
              throw new Error('transactional disk failure');
            }
          };
          const txn = {
            async get(k) { await null; return copy.has(k) ? structuredClone(copy.get(k)) : undefined; },
            async put(k, v) { await null; changes(); copy.set(k, structuredClone(v)); },
            async delete(k) { await null; changes(); copy.delete(k); },
            async deleteAll() { await null; changes(); copy.clear(); },
            async list({ prefix = '' } = {}) {
              await null;
              const out = new Map();
              for (const k of [...copy.keys()].sort()) {
                if (k.startsWith(prefix)) out.set(k, structuredClone(copy.get(k)));
              }
              return out;
            },
            async setAlarm(at) { await null; changes(); copyAlarm = at; },
            async getAlarm() { await null; return copyAlarm || null; },
            async deleteAlarm() { await null; changes(); copyAlarm = 0; },
          };
          const result = await fn(txn);
          map.clear();
          for (const [k, v] of copy) map.set(k, v);
          alarm = copyAlarm;
          return result;
        });
      },
    },
    blockConcurrencyWhile(fn) {
      const run = gate.then(fn);
      gate = run.then(() => {}, () => {});
      return run;
    },
  };
  const obj = new CLASSES[kind](state, env);
  return {
    obj, _map: map, _state: state, _alarm: () => alarm,
    _failTransactionAt: (n) => { transactionFailAt = n; },
    _runAlarm: () => obj.alarm?.(),
  };
}

// one namespace, so idFromName returns the same object twice. the stub the
// platform hands back takes a url and an init and builds the request itself,
// which is what the worker calls, so the fake does the same.
export function durableNamespace(kind = 'Vault', env = {}) {
  const made = new Map();
  return {
    idFromName: (n) => n,
    get: (id) => {
      if (!made.has(id)) {
        const held = durable(kind, env);
        made.set(id, {
          fetch: (url, init) => held.obj.fetch(new Request(url, init)),
          _obj: held.obj, _map: held._map, _state: held._state,
          _alarm: held._alarm, _runAlarm: held._runAlarm,
          _failTransactionAt: held._failTransactionAt,
        });
      }
      return made.get(id);
    },
    _made: made,
  };
}

export const vaultNamespace = (env) => durableNamespace('Vault', env);
export const letterboxNamespace = (env) => durableNamespace('Letterbox', env);

let authorityEvent = 0;
export async function setAuthoritativeMember(env, key, patch) {
  const before = await env.BOX.get(`member:${key}`, 'json');
  const sub = patch.sub || before?.sub;
  const standing = patch.standing || before?.standing || 'good';
  const priority = standing === 'left' ? 400 : standing === 'held' ? 300 : 200;
  const at = Math.max(Math.floor(Date.now() / 1000), (Number(before?.seq) || 0) + 1);
  const eventId = `evt_fake_authority_${++authorityEvent}`;
  const stub = env.SUBSCRIPTIONS.get(env.SUBSCRIPTIONS.idFromName(sub));
  const response = await stub.fetch('https://subscription/transition', {
    method: 'POST', body: JSON.stringify({
      key, seed: before, incoming: { ...(before || {}), ...patch, sub },
      cursor: { at, priority, tie: eventId }, eventId,
    }),
  });
  const done = await response.json();
  await env.BOX.put(`member:${key}`, JSON.stringify(done.member));
  await env.BOX.put(`sub:${sub}`, key);
  return done.member;
}

// ---- an r2 that only knows how to hold bytes ----
export function bucket({ failPut = false, failDelete = false } = {}) {
  const objs = new Map();
  const metadata = new Map();
  let deleteFails = failDelete;
  return {
    async put(name, body, options = {}) {
      if (failPut) throw new Error('r2 refused');
      const buf = body instanceof ArrayBuffer ? new Uint8Array(body)
        : body instanceof Uint8Array ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      objs.set(name, buf);
      metadata.set(name, {
        httpMetadata: structuredClone(options.httpMetadata || {}),
        customMetadata: structuredClone(options.customMetadata || {}),
      });
      return { size: buf.byteLength };
    },
    async get(name) {
      if (!objs.has(name)) return null;
      const bytes = objs.get(name);
      return {
        body: bytes, size: bytes.byteLength, ...(metadata.get(name) || {}),
        async arrayBuffer() { return bytes.buffer; },
      };
    },
    async delete(name) {
      if (deleteFails) throw new Error('r2 delete refused');
      for (const id of Array.isArray(name) ? name : [name]) {
        objs.delete(id);
        metadata.delete(id);
      }
    },
    _failDelete(value = true) { deleteFails = value; },
    _objs: objs,
    _metadata: metadata,
  };
}

// ---- a kv that lives for one test, and forgets what it was told to ----
export function kv() {
  const m = new Map();
  const until = new Map(); // key -> ms, for the records that are given a ttl
  const live = (k) => {
    // cloudflare forgets an expired record; so does this, so that a test of a
    // record's lifetime is testing the mechanism and not a promise
    const t = until.get(k);
    if (t !== undefined && Date.now() > t) { m.delete(k); until.delete(k); }
    return m.get(k);
  };
  return {
    async get(k, type) {
      const v = live(k);
      if (v === undefined) return null;
      if (type === 'json') return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v));
      if (type === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async put(k, v, opts) {
      m.set(k, v instanceof ArrayBuffer ? v : String(v));
      if (opts?.expirationTtl) until.set(k, Date.now() + opts.expirationTtl * 1000);
      else until.delete(k);
    },
    async delete(k) { m.delete(k); until.delete(k); },
    _m: m,
  };
}
